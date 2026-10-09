import { describe, expect, it } from "vitest";
import {
  MAX_JSON_BODY_BYTES,
  contentLengthTooLarge,
  jsonBodyError,
  readJsonBody,
} from "./http";

function postRequest(body: string, contentLength?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
    body,
  });
}

describe("readJsonBody", () => {
  it("parses a valid JSON object", async () => {
    const payload = JSON.stringify({ topicId: "abc" });
    const result = await readJsonBody(postRequest(payload, String(payload.length)));
    expect(result).toEqual({ ok: true, body: { topicId: "abc" } });
  });

  it("rejects an oversized declared body up front", async () => {
    const result = await readJsonBody(
      postRequest("{}", String(MAX_JSON_BODY_BYTES + 1)),
    );
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("enforces the streaming byte budget without a content-length", async () => {
    const big = JSON.stringify({ data: "x".repeat(MAX_JSON_BODY_BYTES + 1) });
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: big,
      // Undici sets no content-length for duplex streams; force chunked read.
      duplex: "half",
    } as RequestInit & { duplex: string });
    const result = await readJsonBody(req);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects invalid JSON and non-object payloads", async () => {
    expect(await readJsonBody(postRequest("{oops"))).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBody(postRequest("[1,2]"))).toEqual({ ok: false, reason: "invalid" });
    expect(await readJsonBody(postRequest("null"))).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a missing body", async () => {
    const req = new Request("http://localhost/api/test", { method: "POST" });
    expect(await readJsonBody(req)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("jsonBodyError", () => {
  it("maps reasons to 413 and 400", () => {
    expect(jsonBodyError("too_large").status).toBe(413);
    expect(jsonBodyError("invalid").status).toBe(400);
  });
});

describe("contentLengthTooLarge", () => {
  it("gates on the declared content-length", () => {
    const over = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": "99999999" },
    });
    const under = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": "10" },
    });
    const missing = new Request("http://localhost/x", { method: "POST" });
    expect(contentLengthTooLarge(over, 100)).toBe(true);
    expect(contentLengthTooLarge(under, 100)).toBe(false);
    expect(contentLengthTooLarge(missing, 100)).toBe(false);
  });
});
