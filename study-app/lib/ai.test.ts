import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiError,
  aiErrorResponse,
  aiRetry,
  classifyAiError,
  completeJson,
  streamChat,
} from "./ai";

type FetchMock = ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

let fetchMock: FetchMock;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chatContent(content: unknown): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function errorResponse(status: number, retryAfterSec?: number): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (retryAfterSec !== undefined) headers["Retry-After"] = String(retryAfterSec);
  return new Response(
    JSON.stringify({ error: { message: "upstream boom", code: "rate_limit_exceeded" } }),
    { status, headers },
  );
}

function sseResponse(texts: string[]): Response {
  const encoder = new TextEncoder();
  const payload =
    texts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") +
    "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(payload));
      c.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** Flush retries/backoff/gates under fake timers, then assert the rejection code. */
async function rejectsWithCode(
  promise: Promise<unknown>,
  code: string,
  advanceMs = 60_000,
): Promise<void> {
  const assertion = expect(promise).rejects.toMatchObject({ code });
  await vi.advanceTimersByTimeAsync(advanceMs);
  await assertion;
}

async function readStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += String(value);
  }
  return out;
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("classifyAiError", () => {
  it("passes AiError through untouched", () => {
    const ai = new AiError("ai_quota", 429, true, "q");
    expect(classifyAiError(ai)).toBe(ai);
  });

  it("maps upstream statuses", () => {
    expect(classifyAiError({ status: 429 }).code).toBe("ai_quota");
    expect(classifyAiError({ status: 429 }).retryable).toBe(true);
    expect(classifyAiError({ status: 500 }).code).toBe("ai_unavailable");
    expect(classifyAiError({ status: 402 }).code).toBe("ai_invalid");
    expect(classifyAiError({ status: 402 }).retryable).toBe(false);
    expect(classifyAiError({ status: 400 }).code).toBe("ai_invalid");
  });

  it("maps missing-key config errors as non-retryable", () => {
    const ai = classifyAiError(new Error('Missing required environment variable "DEEPSEEK_API_KEY"'));
    expect(ai.code).toBe("ai_invalid");
    expect(ai.retryable).toBe(false);
  });

  it("maps DOM and network failures", () => {
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    expect(classifyAiError(timeout)).toMatchObject({ code: "ai_unavailable", httpStatus: 504 });

    const abort = new Error("a");
    abort.name = "AbortError";
    expect(classifyAiError(abort)).toMatchObject({ code: "ai_unavailable", httpStatus: 504 });

    const network = new Error("fetch failed");
    network.name = "TypeError";
    expect(classifyAiError(network)).toMatchObject({ code: "ai_unavailable", httpStatus: 503 });

    expect(classifyAiError(new Error("boom"))).toMatchObject({
      code: "ai_unavailable",
      detail: "boom",
    });
    expect(classifyAiError("weird").code).toBe("ai_unavailable");
  });
});

describe("aiErrorResponse", () => {
  it("returns the classified status with Retry-After when known", async () => {
    const res = aiErrorResponse("json", new AiError("ai_quota", 429, true, "slow", { retryAfterMs: 2000 }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "ai_quota", retryAfterSec: 2 });
  });

  it("omits Retry-After when unknown", () => {
    const res = aiErrorResponse("json", new AiError("ai_empty", 502, true, "empty"));
    expect(res.status).toBe(502);
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});

describe("aiRetry", () => {
  it("throws non-retryable errors immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new AiError("ai_invalid", 500, false, "bad"));
    await expect(aiRetry("op", fn)).rejects.toMatchObject({ code: "ai_invalid" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never retries quota without a known-short window", async () => {
    const fn = vi.fn().mockRejectedValue(new AiError("ai_quota", 429, true, "q"));
    await expect(aiRetry("op", fn)).rejects.toMatchObject({ code: "ai_quota" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("surfaces long Retry-After waits instead of blocking", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new AiError("ai_unavailable", 503, true, "down", { retryAfterMs: 60_000 }));
    await expect(aiRetry("op", fn)).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors a short Retry-After then succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new AiError("ai_quota", 429, true, "q", { retryAfterMs: 2000 }))
      .mockResolvedValueOnce("ok");
    const promise = aiRetry("op", fn);
    const assertion = expect(promise).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("marks the error exhausted after the local budget, blocking outer retries", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new AiError("ai_unavailable", 503, true, "down"));
    const promise = aiRetry("op", fn);
    const assertion = expect(promise).rejects.toMatchObject({ code: "ai_unavailable", exhausted: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not stack retries on an already-exhausted error", async () => {
    const exhausted = new AiError("ai_unavailable", 503, true, "down", { exhausted: true });
    const fn = vi.fn().mockRejectedValue(exhausted);
    await expect(aiRetry("op", fn)).rejects.toBe(exhausted);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("completeJson", () => {
  it("parses model content and sends the DeepSeek JSON contract", async () => {
    fetchMock.mockResolvedValue(chatContent('{"islands": []}'));
    await expect(
      completeJson([{ role: "system", content: "Return JSON." }]),
    ).resolves.toEqual({ islands: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(init?.body as string) as {
      model: string;
      messages: { role: string }[];
      response_format: unknown;
      temperature: number;
    };
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages).toEqual([{ role: "system", content: "Return JSON." }]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0.3);
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("fails fast on a missing API key", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 429 without Retry-After to ai_quota immediately", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errorResponse(429));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_quota");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 402 billing to non-retryable ai_invalid", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errorResponse(402));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps refusals to ai_blocked", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { refusal: "no" } }] }));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports empty model responses after retries", async () => {
    vi.useFakeTimers();
    // Fresh Response per call: retries re-read the body, and a consumed
    // Undici body would throw on the second read.
    fetchMock.mockImplementation(() => Promise.resolve(chatContent("   ")));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_empty");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports malformed model JSON after retries", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(chatContent("{not json")));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_bad_json");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries then reports upstream 500s", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(500)));
    await rejectsWithCode(completeJson([{ role: "user", content: "hi" }]), "ai_unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("streamChat", () => {
  it("assembles SSE deltas and sends system + mapped history", async () => {
    fetchMock.mockResolvedValue(sseResponse(["Hello", " world"]));
    const stream = await streamChat(
      [
        { role: "assistant", content: "prior" },
        { role: "user", content: "hi" },
      ],
      "Be Lumi.",
    );
    await expect(readStream(stream)).resolves.toBe("Hello world");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(init?.body as string) as {
      messages: { role: string; content: string }[];
      stream: boolean;
      temperature: number;
    };
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.7);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
    expect(body.messages[0].content).toBe("Be Lumi.");
  });

  it("maps unknown roles to user", async () => {
    fetchMock.mockResolvedValue(sseResponse(["x"]));
    await streamChat([{ role: "weird", content: "hi" }], "sys");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string) as { messages: { role: string }[] };
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("rejects an empty stream without opening a 200 body", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      () => Promise.resolve(new Response("", { headers: { "Content-Type": "text/event-stream" } })),
    );
    await rejectsWithCode(streamChat([{ role: "user", content: "hi" }], "sys"), "ai_empty");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects HTTP errors before streaming", async () => {
    fetchMock.mockResolvedValue(errorResponse(429));
    await expect(streamChat([{ role: "user", content: "hi" }], "sys")).rejects.toMatchObject({
      code: "ai_quota",
    });
  });

  it("times out when no token arrives", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      () =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({}), {
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
    );
    // Two 30 s first-token gates plus backoff between the attempts.
    await rejectsWithCode(streamChat([{ role: "user", content: "hi" }], "sys"), "ai_unavailable", 120_000);
  });
});
