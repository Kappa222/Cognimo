import { requireEnv } from "./env";

// DeepSeek Cloud (OpenAI-compatible) endpoint + model. Override with
// DEEPSEEK_BASE_URL / DEEPSEEK_MODEL (.env.local) to experiment.
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

// ---------------------------------------------------------------------------
// Error classification (F44, kept across the Gemini -> DeepSeek migration)
//
// Every upstream failure is normalized into an AiError carrying a stable
// machine code, the HTTP status routes should return, and whether a retry
// can plausibly help. Routes then answer JSON {error, message} instead of a
// blanket 503, so clients can show a precise Hungarian message and the
// server log gets one structured line per failure.
// ---------------------------------------------------------------------------

export type AiErrorCode =
  | "ai_quota" // upstream 429 — rate limit / insufficient quota
  | "ai_unavailable" // upstream 5xx, network error or timeout
  | "ai_empty" // 200 response carried no usable text/JSON
  | "ai_blocked" // refusal or content filter — retrying rarely helps
  | "ai_bad_json" // model output was not valid JSON
  | "ai_bad_response" // parsed but unusable output (e.g. quiz shortfall)
  | "ai_invalid"; // upstream rejected the request (config/input/auth/billing)

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly detail?: string;
  /** Set when an aiRetry level ran out — outer wrappers must not stack more. */
  readonly exhausted: boolean;

  constructor(
    code: AiErrorCode,
    httpStatus: number,
    retryable: boolean,
    message: string,
    opts: { retryAfterMs?: number; detail?: string; exhausted?: boolean } = {},
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.retryAfterMs = opts.retryAfterMs;
    this.detail = opts.detail;
    this.exhausted = opts.exhausted ?? false;
  }
}

function excerpt(value: string, max = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const sec = Number.parseFloat(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
  return undefined;
}

// Bundler-safe upstream status probe: keeps working if a raw upstream error
// object with a numeric status ever reaches classifyAiError.
function upstreamStatusOf(err: unknown): number | undefined {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function fromUpstream(status: number, retryAfterMs?: number): AiError {
  const detail = `upstream ${status}`;
  if (status === 429) {
    return new AiError("ai_quota", 429, true, "AI rate/quota limit reached", { retryAfterMs, detail });
  }
  if (status === 402) {
    // DeepSeek "insufficient balance" — topping up, not retrying, fixes it.
    return new AiError("ai_invalid", 500, false, "AI quota/billing rejected upstream", { detail });
  }
  if (status >= 500) {
    return new AiError("ai_unavailable", 503, true, "AI upstream unavailable", { detail });
  }
  if (status >= 400) {
    return new AiError("ai_invalid", 500, false, "AI request rejected upstream", { detail });
  }
  return new AiError("ai_unavailable", 503, true, "AI call failed", { detail });
}

export function classifyAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;

  const status = upstreamStatusOf(err);
  if (status !== undefined) return fromUpstream(status);

  if (err instanceof Error) {
    if (err.message.includes("Missing required environment variable")) {
      // Fail-fast env helper — retrying a missing key never helps.
      return new AiError("ai_invalid", 500, false, "AI configuration error", {
        detail: excerpt(err.message),
      });
    }
    if (err.name === "TimeoutError") {
      return new AiError("ai_unavailable", 504, true, "AI request timed out", { detail: "timeout" });
    }
    if (err.name === "AbortError") {
      return new AiError("ai_unavailable", 504, true, "AI request aborted", { detail: "abort" });
    }
    if (err.name === "TypeError") {
      // fetch() network failures surface as TypeError ("fetch failed").
      return new AiError("ai_unavailable", 503, true, "AI network error", { detail: excerpt(err.message) });
    }
    return new AiError("ai_unavailable", 503, true, "AI call failed", { detail: excerpt(err.message) });
  }
  return new AiError("ai_unavailable", 503, true, "AI call failed", {});
}

/** One structured log line per AI failure — the sole server-side diagnostic. */
export function logAiFailure(op: string, err: unknown): AiError {
  const ai = classifyAiError(err);
  console.error(
    `[AI] fail op=${op} code=${ai.code} http=${ai.httpStatus} retryable=${ai.retryable}` +
      (ai.retryAfterMs != null ? ` retryAfterMs=${ai.retryAfterMs}` : "") +
      (ai.detail ? ` detail=${ai.detail}` : "") +
      ` :: ${ai.message}`,
  );
  return ai;
}

/** JSON error response with the classified status (+ Retry-After when known). */
export function aiErrorResponse(op: string, err: unknown): Response {
  const ai = logAiFailure(op, err);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const body: Record<string, unknown> = { error: ai.code, message: ai.message };
  if (ai.retryAfterMs != null && ai.retryAfterMs > 0) {
    const sec = Math.max(1, Math.ceil(ai.retryAfterMs / 1000));
    headers["Retry-After"] = String(sec);
    body.retryAfterSec = sec;
  }
  return new Response(JSON.stringify(body), { status: ai.httpStatus, headers });
}

// Server-side retry: one immediate-class retry for plausible transient
// failures (short Retry-After honored up to 5 s; longer waits surface to the
// client instead of blocking the request). Intermediate attempts are logged;
// the final error is logged by aiErrorResponse at the route.
const SERVER_BACKOFF_MS = [1000, 2500];

export async function aiRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const ai = classifyAiError(err);
      if (ai.exhausted || !ai.retryable) throw ai;
      // Quota (F48): never retry a 429 blindly — no Retry-After means the
      // window won't open on a known schedule, and every attempt burns a
      // paid request. Only a known-short window (Retry-After ≤5s) earns an
      // auto-retry.
      if (ai.code === "ai_quota" && (ai.retryAfterMs == null || ai.retryAfterMs > 5000)) throw ai;
      const longWait = ai.retryAfterMs != null && ai.retryAfterMs > 5000;
      if (longWait) throw ai;
      if (attempt >= SERVER_BACKOFF_MS.length) {
        // Local budget spent: mark exhausted so an outer aiRetry wrapper
        // (e.g. quiz generation around completeJson) doesn't multiply calls.
        throw new AiError(ai.code, ai.httpStatus, ai.retryable, ai.message, {
          retryAfterMs: ai.retryAfterMs,
          detail: ai.detail,
          exhausted: true,
        });
      }
      logAiFailure(`${op} attempt=${attempt + 1}`, err);
      const wait =
        ai.retryAfterMs != null && ai.retryAfterMs > 0
          ? ai.retryAfterMs
          : SERVER_BACKOFF_MS[attempt] + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ---------------------------------------------------------------------------
// DeepSeek transport (native fetch, OpenAI-compatible — no SDK dependency).
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Longest a single structured call may take — island analysis ships large
// prompts and the client allows up to 6 min for /api/analyze.
const JSON_TIMEOUT_MS = 180_000;

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${requireEnv("DEEPSEEK_API_KEY")}`,
  };
}

function upstreamErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const e = (payload as { error: unknown }).error;
    if (typeof e === "string" && e.trim()) return e.trim().slice(0, 300);
    if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
      const m = (e as { message: string }).message;
      if (m.trim()) return m.trim().slice(0, 300);
    }
  }
  return fallback;
}

async function throwForStatus(op: string, res: Response): Promise<never> {
  const retryAfterMs = retryAfterFromHeaders(res.headers);
  const text = await res.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const message = upstreamErrorMessage(payload, `DeepSeek request failed (${op})`);
  const ai = fromUpstream(res.status, retryAfterMs);
  throw new AiError(ai.code, ai.httpStatus, ai.retryable, message, {
    retryAfterMs: ai.retryAfterMs,
    detail: ai.detail,
  });
}

export async function completeJson(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<unknown> {
  return aiRetry("json", async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("AI request timed out", "TimeoutError")),
      JSON_TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: MODEL,
          messages: messages.map(
            (m): ChatMessage => ({ role: m.role, content: m.content }),
          ),
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw classifyAiError(e);
    }
    clearTimeout(timer);

    if (!res.ok) await throwForStatus("json", res);

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AiError("ai_bad_json", 502, true, "AI response was not JSON", {
        detail: `upstream ${res.status}`,
      });
    }

    const choices =
      payload && typeof payload === "object" && "choices" in payload
        ? (payload as { choices?: unknown }).choices
        : undefined;
    const firstChoice =
      Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
        ? (choices[0] as Record<string, unknown>)
        : null;
    const choiceMessage =
      firstChoice && firstChoice.message && typeof firstChoice.message === "object"
        ? (firstChoice.message as Record<string, unknown>)
        : null;
    const content = choiceMessage ? choiceMessage.content : undefined;
    const refusal = choiceMessage ? choiceMessage.refusal : undefined;
    if (typeof refusal === "string" && refusal.trim()) {
      throw new AiError("ai_blocked", 502, false, "AI refused the request", {
        detail: excerpt(refusal),
      });
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new AiError("ai_empty", 502, true, "Empty response from AI", { detail: "no text" });
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new AiError("ai_bad_json", 502, true, "AI response was not valid JSON", {
        detail: excerpt(content),
      });
    }
  });
}

// Longest we wait for the first streamed token before failing the request —
// keeps a hung upstream from pinning the route (the client has its own
// 60 s budget on top of this).
const FIRST_TOKEN_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(
        new AiError("ai_unavailable", 504, true, "Timed out waiting for AI stream", {
          detail: "first-token-timeout",
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

interface SseStream {
  iterator: AsyncGenerator<string>;
  cancel: () => void;
}

// Pulls OpenAI-style SSE (`data: {...}` / `data: [DONE]`) off the upstream
// body and yields `delta.content` strings. Shared by the first-token gate
// and the response stream so no token is lost between the two.
function openSseStream(res: Response, abort: () => void): SseStream {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let cancelled = false;

  async function* iterator(): AsyncGenerator<string> {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") {
            finished = true;
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (parsed && typeof parsed === "object" && "error" in parsed) {
            const msg = upstreamErrorMessage(parsed, "AI stream failed");
            throw new AiError("ai_unavailable", 503, true, msg, { detail: "midstream-error" });
          }
          const choices =
            parsed && typeof parsed === "object" && "choices" in parsed
              ? (parsed as { choices?: unknown }).choices
              : undefined;
          const firstChoice =
            Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
              ? (choices[0] as Record<string, unknown>)
              : null;
          const delta =
            firstChoice && firstChoice.delta && typeof firstChoice.delta === "object"
              ? (firstChoice.delta as Record<string, unknown>)
              : null;
          const text = delta ? delta.content : undefined;
          if (typeof text === "string" && text) yield text;
        }
        if (finished) break;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader already released or cancelled — nothing to do.
      }
    }
  }

  const gen = iterator();
  return {
    iterator: gen,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      void gen.return(undefined).catch(() => {});
      void reader.cancel().catch(() => {});
      abort();
    },
  };
}

// Streams tokens from the gated iterator: the first usable chunk is replayed,
// the rest pulled live. Cancelling (client disconnect) stops the upstream too.
function streamFrom(iterator: AsyncGenerator<string>, first: string, cancel: () => void): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(first);
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        // Mid-stream failure: the body is already a 200, so the client sees a
        // truncated read — log the classified cause here for diagnosis.
        logAiFailure("chat:midstream", err);
        controller.error(err);
      }
    },
    cancel() {
      cancel();
    },
  });
}

export async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<ReadableStream> {
  // Retry covers stream setup + the first-token gate. Once the HTTP response
  // is open we can no longer change the status code, so everything after the
  // gate streams as-is (failures logged by streamFrom).
  return aiRetry("chat", async () => {
    const controller = new AbortController();
    const setupTimer = setTimeout(
      () => controller.abort(new DOMException("AI request timed out", "TimeoutError")),
      FIRST_TOKEN_TIMEOUT_MS,
    );
    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...history],
          temperature: 0.7,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(setupTimer);
      throw classifyAiError(e);
    }
    clearTimeout(setupTimer);

    if (!res.ok || !res.body) {
      if (res.ok && !res.body) {
        throw new AiError("ai_empty", 502, true, "AI stream ended without text", {
          detail: "no-body",
        });
      }
      await throwForStatus("chat", res);
    }

    const sse = openSseStream(res, () => controller.abort());

    // First-chunk gate (F44): don't open the HTTP response until real text
    // arrives. A stream that ends empty or dies before the first token
    // becomes a classified HTTP error here.
    let first = "";
    try {
      for (;;) {
        let next: IteratorResult<string>;
        try {
          next = await withTimeout(sse.iterator.next(), FIRST_TOKEN_TIMEOUT_MS, () => {
            sse.cancel();
          });
        } catch (e) {
          throw classifyAiError(e);
        }
        if (next.done) break;
        if (next.value) {
          first = next.value;
          break;
        }
      }
    } catch (e) {
      sse.cancel();
      throw e;
    }

    if (!first) {
      sse.cancel();
      throw new AiError("ai_empty", 502, true, "AI stream ended without text", {
        detail: "no-text",
      });
    }

    return streamFrom(sse.iterator, first, () => sse.cancel());
  });
}
