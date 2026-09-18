import type { Island } from "./types";

const VALID_APPROACHES = ["scenario", "socratic", "conversational"] as const;

/**
 * Validate AI-generated island output shape before it touches session state.
 * Malformed islands crash phase instructions (key_concepts.join etc.), so
 * anything without a title or at least one key concept is dropped. Unknown
 * approaches fall back to conversational. Throws when nothing usable remains.
 */
export function parseIslands(raw: unknown): Island[] {
  const islands = (Array.isArray(raw) ? raw : [])
    .filter(
      (i): i is Island =>
        !!i &&
        typeof i === "object" &&
        typeof (i as { title?: unknown }).title === "string" &&
        (i as { title: string }).title.trim().length > 0 &&
        Array.isArray((i as { key_concepts?: unknown }).key_concepts) &&
        (i as { key_concepts: unknown[] }).key_concepts.length > 0 &&
        Array.isArray((i as { probe_questions?: unknown }).probe_questions),
    )
    .map((i) => ({
      title: (i as { title: string }).title,
      approach: (
        VALID_APPROACHES as readonly string[]
      ).includes((i as { approach?: string }).approach as string)
        ? (i as { approach: "scenario" | "socratic" | "conversational" }).approach
        : ("conversational" as const),
      key_concepts: (
        (i as { key_concepts: unknown[] }).key_concepts as unknown[]
      ).filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      ),
      probe_questions: (
        (i as { probe_questions: unknown[] }).probe_questions as unknown[]
      ).filter(
        (q): q is string => typeof q === "string" && q.trim().length > 0,
      ),
      ...("chunk_indices" in (i as object)
        ? { chunk_indices: (i as Island).chunk_indices }
        : {}),
      ...("chunk_refs" in (i as object)
        ? { chunk_refs: (i as Island).chunk_refs }
        : {}),
    }))
    .filter((i) => i.key_concepts.length > 0);

  if (islands.length === 0) throw new Error("No islands generated");
  return islands;
}
