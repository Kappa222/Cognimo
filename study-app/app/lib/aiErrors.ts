// Client-side AI/API failure handling (F45): one schema for every failure a
// learning turn can hit — classified server codes ({error, message} JSON),
// our own rate limiter, timeouts and network drops. Produces ready-to-render
// Hungarian messages plus a self-describing hint ("HTTP 429 · ai_quota") so
// bug reports identify the cause without opening DevTools.

export interface AiFailure {
  code: string;
  /** HTTP status (0 for local failures like network/timeout). */
  status: number;
  /** Hungarian, ready to render. */
  message: string;
  /** Small diagnostic line, e.g. "HTTP 502 · ai_empty". */
  hint: string;
  retryable: boolean;
  retryAfterSec?: number;
}

export class ApiCallError extends Error {
  readonly failure: AiFailure;

  constructor(failure: AiFailure) {
    super(failure.message);
    this.name = "ApiCallError";
    this.failure = failure;
  }
}

export const DEFAULT_AI_TIMEOUT_MS = 60_000;

// Codes where an automatic retry can plausibly help. rate_limit only qualifies
// for short windows (retryDelayMs caps long Retry-After waits to the panel).
const RETRYABLE_CODES = new Set([
  "ai_quota",
  "ai_unavailable",
  "ai_empty",
  "ai_bad_json",
  "ai_bad_response",
  "rate_limit",
  "network",
  "timeout",
]);

function hungarianMessage(code: string, retryAfterSec?: number): string | null {
  const ra = retryAfterSec != null && retryAfterSec > 0 ? retryAfterSec : undefined;
  switch (code) {
    case "rate_limit":
      return ra
        ? `Túl sok kérés — próbáld újra ${ra} mp múlva!`
        : "Túl sok kérés — próbáld újra pár másodperc múlva!";
    case "ai_quota":
      return ra
        ? `A Gemini AI szolgáltatása átmenetileg túl van terhelve (kvóta) — próbáld újra ${ra} mp múlva!`
        : "A Gemini AI szolgáltatása átmenetileg túl van terhelve (kvóta) — próbáld újra később!";
    case "ai_empty":
      return "Lumi nem adott választ — próbáld újra!";
    case "ai_unavailable":
      return "Lumi szolgáltatása most nem érhető el — próbáld újra pár másodperc múlva!";
    case "ai_blocked":
      return "A választ biztonsági okokból elutasította a rendszer — fogalmazd másképp!";
    case "ai_bad_json":
    case "ai_bad_response":
      return "Lumi válasza érvénytelen volt — próbáld újra!";
    case "ai_invalid":
      return "Váratlan szolgáltatási hiba — próbáld újra később!";
    case "network":
      return "Hálózati hiba — ellenőrizd az internetet, majd próbáld újra!";
    case "timeout":
      return "Lumi túl sokáig gondolkodott — próbáld újra!";
    case "http_401":
      return "A munkameneted lejárt — jelentkezz be újra!";
    case "http_404":
      return "A munkamenet vagy téma nem található — töltsd újra az oldalt!";
    case "http_409":
      return "Ez a lépés már rögzítve van.";
    case "http_413":
      return "A küldött adat túl nagy.";
    default:
      return null;
  }
}

function hintFor(code: string, status: number): string {
  return status > 0 ? `HTTP ${status} · ${code}` : code;
}

/** failure + diagnostic hint in one line, for string-only error slots. */
export function withHint(f: AiFailure): string {
  return f.hint ? `${f.message} (${f.hint})` : f.message;
}

/**
 * Build a failure directly (for errors detected client-side, e.g. an empty
 * stream body). `message` defaults to the Hungarian text for `code`.
 */
export function makeAiFailure(
  code: string,
  status = 0,
  message?: string,
  retryAfterSec?: number,
): AiFailure {
  const resolved =
    message ??
    hungarianMessage(code, retryAfterSec) ??
    (status > 0 ? `A kérés nem sikerült (HTTP ${status}).` : "Ismeretlen hiba.");
  return {
    code,
    status,
    message: resolved,
    hint: hintFor(code, status),
    retryable: RETRYABLE_CODES.has(code),
    retryAfterSec,
  };
}

async function failureFromResponse(res: Response): Promise<AiFailure> {
  let retryAfterSec: number | undefined;
  const headerRA = res.headers.get("Retry-After");
  if (headerRA) {
    const sec = Number.parseInt(headerRA, 10);
    if (Number.isFinite(sec) && sec >= 0) retryAfterSec = sec;
  }

  let code = `http_${res.status}`;
  let serverMessage = "";
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.error === "string" && parsed.error) code = parsed.error;
    if (typeof parsed.message === "string") serverMessage = parsed.message;
    if (typeof parsed.retryAfterSec === "number") retryAfterSec = parsed.retryAfterSec;
  } catch {
    if (text.trim()) serverMessage = text.trim().slice(0, 300);
  }
  // Our coded errors (ai_*, rate_limit) always get the Hungarian copy; plain
  // HTTP responses prefer the server's specific text (e.g. 404 "No learning
  // plan...") over the generic per-status wording.
  const isCoded = code !== `http_${res.status}`;
  const message = isCoded
    ? (hungarianMessage(code, retryAfterSec) ?? (serverMessage || undefined))
    : (serverMessage || hungarianMessage(code, retryAfterSec) || undefined);
  return makeAiFailure(code, res.status, message || undefined, retryAfterSec);
}

/** Normalize any thrown value into a renderable failure. */
export function failureFromError(err: unknown): AiFailure {
  if (err instanceof ApiCallError) return err.failure;
  if (err instanceof Error) {
    if (err.name === "TimeoutError") {
      return makeAiFailure("timeout");
    }
    if (err.name === "AbortError") {
      return makeAiFailure("aborted", 0, "Megszakítva");
    }
    if (err.name === "TypeError") {
      // fetch() network failures surface as TypeError ("fetch failed").
      return makeAiFailure("network");
    }
    // Local validation errors keep their (already Hungarian) message.
    return makeAiFailure("client_error", 0, err.message || "Ismeretlen hiba.");
  }
  return makeAiFailure("client_error", 0, "Ismeretlen hiba.");
}

function chainTimeout(
  signal: AbortSignal | null,
  ms: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("AI request timed out", "TimeoutError")),
    ms,
  );
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * fetch for AI endpoints: bounded by `timeoutMs`, non-2xx responses become
 * ApiCallError with a parsed/classified failure. Manual aborts rethrow their
 * AbortError untouched so callers can exit silently.
 */
export async function aiFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_AI_TIMEOUT_MS,
): Promise<Response> {
  const chain = chainTimeout(init.signal ?? null, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: chain.signal });
    if (res.ok) return res;
    throw new ApiCallError(await failureFromResponse(res));
  } catch (err) {
    if (err instanceof ApiCallError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new ApiCallError(failureFromError(err));
  } finally {
    chain.dispose();
  }
}

/** Backoff before the next attempt; -1 = show the error panel instead. */
function retryDelayMs(f: AiFailure, attempt: number): number {
  if (!f.retryable) return -1;
  if (f.retryAfterSec != null) {
    const ms = f.retryAfterSec * 1000;
    // Long windows (e.g. a 60 s quota window) would freeze the UI — surface
    // the panel with the countdown in the message instead.
    if (ms > 10_000) return -1;
    return ms + Math.floor(Math.random() * 300);
  }
  return Math.min(900 * 2 ** attempt + Math.floor(Math.random() * 500), 6000);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function cleanup() {
      signal?.removeEventListener("abort", onAbort);
    }
    if (!signal) return;
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Total attempts (default 3). */
  attempts?: number;
  /** Aborts the backoff sleep as well as the request. */
  signal?: AbortSignal;
  onRetry?: (failure: AiFailure, attempt: number, delayMs: number) => void;
}

/**
 * Class-aware retry: exponential backoff with jitter, honors Retry-After for
 * short windows, never retries 4xx/blocked errors, and stops sleeping when
 * the signal aborts (unmount/navigation) so no retry fires after leaving.
 */
export async function withAiRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      lastErr = err;
      const failure = failureFromError(err);
      const delay = retryDelayMs(failure, attempt);
      if (delay < 0 || attempt >= attempts - 1) break;
      opts.onRetry?.(failure, attempt, delay);
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr instanceof ApiCallError
    ? lastErr
    : new ApiCallError(failureFromError(lastErr));
}
