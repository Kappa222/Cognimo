import { describe, expect, it, vi } from "vitest";
import {
  ApiCallError,
  failureFromError,
  makeAiFailure,
  withAiRetry,
  withHint,
} from "./aiErrors";

describe("makeAiFailure", () => {
  it("builds the Hungarian quota failure with a hint", () => {
    const f = makeAiFailure("ai_quota", 429);
    expect(f.code).toBe("ai_quota");
    expect(f.status).toBe(429);
    expect(f.message).toContain("kvóta");
    expect(f.hint).toBe("HTTP 429 · ai_quota");
    // Quota is deliberately not auto-retryable (F48).
    expect(f.retryable).toBe(false);
  });

  it("marks transient codes retryable", () => {
    expect(makeAiFailure("ai_unavailable", 503).retryable).toBe(true);
    expect(makeAiFailure("network").retryable).toBe(true);
    expect(makeAiFailure("timeout").retryable).toBe(true);
    expect(makeAiFailure("ai_blocked", 502).retryable).toBe(false);
  });

  it("omits the HTTP prefix for local failures", () => {
    expect(makeAiFailure("network").hint).toBe("network");
  });
});

describe("withHint", () => {
  it("combines message and hint", () => {
    const f = makeAiFailure("ai_empty", 502);
    expect(withHint(f)).toBe(`${f.message} (${f.hint})`);
  });
});

describe("failureFromError", () => {
  it("unwraps ApiCallError", () => {
    const failure = makeAiFailure("ai_empty", 502);
    expect(failureFromError(new ApiCallError(failure))).toBe(failure);
  });

  it("maps DOM error names", () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    expect(failureFromError(timeout).code).toBe("timeout");

    const abort = new Error("stop");
    abort.name = "AbortError";
    expect(failureFromError(abort).code).toBe("aborted");

    const network = new Error("fetch failed");
    network.name = "TypeError";
    expect(failureFromError(network).code).toBe("network");
  });

  it("keeps local validation messages", () => {
    expect(failureFromError(new Error("saját hiba")).message).toBe("saját hiba");
    expect(failureFromError("weird").code).toBe("client_error");
  });
});

describe("withAiRetry", () => {
  it("returns after a transient failure", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiCallError(makeAiFailure("network")))
      .mockResolvedValueOnce("ok");
    await expect(withAiRetry(fn, { attempts: 3 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("never retries non-retryable codes", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new ApiCallError(makeAiFailure("ai_blocked", 502)));
    await expect(withAiRetry(fn, { attempts: 3 })).rejects.toBeInstanceOf(ApiCallError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
