import {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIRequestInputError,
  GoogleGenerativeAIResponseError,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import { requireEnv } from "./env";

const MODEL = "gemini-3.5-flash";

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// One shared client for all AI calls (chat, evaluation, quiz generation,
// grading) — constructing it per call would rebuild the transport every time.
let geminiClient: GoogleGenerativeAI | null = null;

function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(requireEnv("GEMINI_API_KEY"));
  }
  return geminiClient;
}

// ---------------------------------------------------------------------------
// Error classification (F44)
//
// Every upstream failure is normalized into an AiError carrying a stable
// machine code, the HTTP status routes should return, and whether a retry
// can plausibly help. Routes then answer JSON {error, message} instead of a
// blanket 503, so clients can show a precise Hungarian message and the
// server log gets one structured line per failure.
// ---------------------------------------------------------------------------

export type AiErrorCode =
  | "ai_quota" // upstream 429 — free-tier quota/rate limit in most cases
  | "ai_unavailable" // upstream 5xx, network error or timeout
  | "ai_empty" // 200 response carried no usable text/JSON
  | "ai_blocked" // safety or prompt-level block — retrying rarely helps
  | "ai_bad_json" // model output was not valid JSON
  | "ai_bad_response" // parsed but unusable output (e.g. quiz shortfall)
  | "ai_invalid"; // upstream rejected the request (config/input)

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

function extractRetryAfterMs(details: unknown[] | undefined): number | undefined {
  for (const d of details ?? []) {
    if (d && typeof d === "object" && "retryDelay" in d) {
      const raw = (d as { retryDelay?: unknown }).retryDelay;
      if (typeof raw === "string") {
        const sec = Number.parseFloat(raw.replace(/s$/, ""));
        if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
      }
    }
  }
  return undefined;
}

// Bundler-safe upstream status probe: instanceof works within one process,
// the duck-typed fallback survives duplicated SDK copies after bundling.
function upstreamStatusOf(err: unknown): number | undefined {
  if (err instanceof GoogleGenerativeAIFetchError) return err.status;
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

function fromUpstream(err: unknown, status: number | undefined): AiError | null {
  if (status === undefined) return null;
  const retryAfterMs = extractRetryAfterMs(
    err instanceof GoogleGenerativeAIFetchError ? err.errorDetails : undefined,
  );
  const detail = `upstream ${status}`;
  if (status === 429) {
    return new AiError("ai_quota", 429, true, "AI rate/quota limit reached", { retryAfterMs, detail });
  }
  if (status >= 500) {
    return new AiError("ai_unavailable", 503, true, "AI upstream unavailable", { detail });
  }
  if (status >= 400) {
    return new AiError("ai_invalid", 500, false, "AI request rejected upstream", { detail });
  }
  return null;
}

export function classifyAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;

  const upstream = fromUpstream(err, upstreamStatusOf(err));
  if (upstream) return upstream;

  if (err instanceof GoogleGenerativeAIResponseError) {
    return new AiError("ai_blocked", 502, false, "AI response blocked", { detail: excerpt(err.message) });
  }
  if (err instanceof GoogleGenerativeAIRequestInputError) {
    return new AiError("ai_invalid", 500, false, "AI request invalid", { detail: excerpt(err.message) });
  }
  if (err instanceof GoogleGenerativeAIAbortError) {
    return new AiError("ai_unavailable", 504, true, "AI request aborted", { detail: "abort" });
  }
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

function toGeminiMessages(
  messages: { role: string; content: string }[],
): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : ("user" as "user" | "model"),
    parts: [{ text: m.content }],
  }));
}

export async function completeJson(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<unknown> {
  return aiRetry("json", async () => {
    const genAI = getGeminiClient();
    const firstIsSystem = messages[0]?.role === "system";

    let systemMessage: string | undefined;
    let geminiMessages: { role: "user" | "model"; parts: { text: string }[] }[];

    if (firstIsSystem) {
      systemMessage = messages[0].content;
      geminiMessages = toGeminiMessages(messages.slice(1));
    } else {
      geminiMessages = toGeminiMessages(messages);
    }

    if (geminiMessages.length === 0) {
      // Gemini needs at least one content message; keep the system instruction
      // (dropping it weakens JSON adherence) and send a minimal trigger.
      geminiMessages = [
        { role: "user", parts: [{ text: "Kövesd a rendszerutasítást, és csak érvényes JSON-nal válaszolj." }] },
      ];
    }

    const model = genAI.getGenerativeModel({
      model: MODEL,
      ...(systemMessage ? { systemInstruction: systemMessage } : {}),
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    let result;
    try {
      result = await model.generateContent({ contents: geminiMessages });
    } catch (e) {
      throw classifyAiError(e);
    }

    let text: string;
    try {
      text = result.response.text();
    } catch (e) {
      // Blocked candidate / missing text: SDK throws with finish details.
      throw classifyAiError(e);
    }

    if (!text) {
      throw new AiError("ai_empty", 502, true, "Empty response from AI", { detail: "no text" });
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new AiError("ai_bad_json", 502, true, "AI response was not valid JSON", {
        detail: excerpt(text),
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

type StreamChunk = { text: () => string; promptFeedback?: { blockReason?: string }; candidates?: { finishReason?: string }[] };

function chunkText(chunk: StreamChunk, finish: string): string {
  try {
    return chunk.text();
  } catch (e) {
    const ai = classifyAiError(e);
    throw new AiError(ai.code, ai.httpStatus, ai.retryable, ai.message, {
      retryAfterMs: ai.retryAfterMs,
      detail: `finish=${finish || "-"} ${ai.detail ?? ""}`.trim(),
    });
  }
}

// Streams tokens from the gated iterator: the first usable chunk is replayed,
// the rest pulled live. Cancelling (client disconnect) stops the upstream too.
function streamFrom(
  iterator: AsyncGenerator<StreamChunk>,
  first: string,
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(first);
        for (;;) {
          const { done, value } = await iterator.next();
          if (done) break;
          const text = chunkText(value, value.candidates?.[0]?.finishReason ?? "");
          if (text) controller.enqueue(text);
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
      void iterator.return(undefined).catch(() => {});
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
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      safetySettings: SAFETY_SETTINGS,
    });

    const geminiMessages = toGeminiMessages(messages);
    let streamResult;
    try {
      streamResult = await model.generateContentStream({ contents: geminiMessages });
    } catch (e) {
      throw classifyAiError(e);
    }

    // First-chunk gate (F44): don't open the HTTP response until real text
    // arrives. A stream that ends empty (the silent "Empty response" bug)
    // or dies before the first token becomes a classified HTTP error here,
    // with finishReason/blockReason captured for the log.
    const iterator = streamResult.stream;
    let first = "";
    let chunks = 0;
    let lastFinish = "";
    let blockReason = "";
    for (;;) {
      let next: IteratorResult<StreamChunk>;
      try {
        next = await withTimeout(iterator.next(), FIRST_TOKEN_TIMEOUT_MS, () => {
          void iterator.return(undefined).catch(() => {});
        });
      } catch (e) {
        throw classifyAiError(e);
      }
      if (next.done) break;
      chunks += 1;
      const value = next.value;
      if (value.promptFeedback?.blockReason) blockReason = value.promptFeedback.blockReason;
      const finish = value.candidates?.[0]?.finishReason ?? "";
      if (finish) lastFinish = finish;
      first = chunkText(value, finish);
      if (first) break;
    }

    if (!first) {
      throw new AiError("ai_empty", 502, true, "AI stream ended without text", {
        detail: `chunks=${chunks} finish=${lastFinish || "-"} block=${blockReason || "-"}`,
      });
    }

    return streamFrom(iterator, first);
  });
}
