import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows requests inside the window", () => {
    expect(rateLimit("test:allow", 2, 60_000)).toBeNull();
    expect(rateLimit("test:allow", 2, 60_000)).toBeNull();
  });

  it("returns a 429 with Retry-After once exhausted", async () => {
    expect(rateLimit("test:block", 1, 60_000)).toBeNull();
    const limited = rateLimit("test:block", 1, 60_000);
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(limited!.headers.get("Retry-After")).toBe("60");
    const body = (await limited!.json()) as Record<string, unknown>;
    expect(body.error).toBe("rate_limit");
    expect(body.retryAfterSec).toBe(60);
  });

  it("tracks buckets per key", () => {
    expect(rateLimit("test:key-a", 1, 60_000)).toBeNull();
    expect(rateLimit("test:key-b", 1, 60_000)).toBeNull();
    expect(rateLimit("test:key-a", 1, 60_000)!.status).toBe(429);
  });
});
