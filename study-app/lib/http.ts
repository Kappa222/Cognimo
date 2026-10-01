// Bounded request-body reads: a large payload must never be pulled fully
// into memory before validation.

// Comfortably above the largest legitimate JSON payload (chat history:
// 40 messages x 10k chars), far below anything a client should send.
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "too_large" | "invalid" };

/**
 * Read and parse a JSON request body with a hard size cap. The declared
 * Content-Length is rejected up front; bodies without one are read with a
 * streaming byte budget. Returns "too_large" (→ 413) or "invalid" (→ 400).
 */
export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!req.body) return { ok: false, reason: "invalid" };

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Uniform response for a failed readJsonBody. */
export function jsonBodyError(reason: "too_large" | "invalid"): Response {
  return reason === "too_large"
    ? new Response("Payload too large", { status: 413 })
    : new Response("Invalid JSON", { status: 400 });
}

/**
 * Early Content-Length gate for non-JSON bodies (multipart/PDF uploads).
 * Chunked bodies may omit the header; those are still bounded by the
 * handlers' own field-level checks.
 */
export function contentLengthTooLarge(req: Request, maxBytes: number): boolean {
  const declared = Number(req.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}
