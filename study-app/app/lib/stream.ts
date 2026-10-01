// Client-side streaming helper shared by the learn page and FinaleRunner:
// reads a text stream to completion, calling onChunk with the accumulated
// text after every chunk so callers can render progressively.
export async function readTextStream(
  body: ReadableStream<Uint8Array>,
  onChunk?: (fullText: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
    onChunk?.(fullText);
  }
  // Flush any trailing multi-byte character.
  fullText += decoder.decode();
  return fullText;
}
