import type { SupabaseClient } from "@supabase/supabase-js";

// Tunables for large-document scale-up. Pure string ops — no AI involved.
export const CHUNK_SIZE = 6000;
export const CHUNK_OVERLAP = 500;
// Corpora above this size use two-stage analysis (summarize, then islands).
export const LARGE_CORPUS_THRESHOLD = 120_000;
// Safety cap for the legacy full-text fallback path in AI prompts.
export const MAX_PROMPT_MATERIAL_CHARS = 30_000;
// Extracted texts shorter than this are treated as unreadable (e.g. scanned PDFs).
export const MIN_READABLE_CHARS = 500;
// Upload guardrails (see POST /api/materials).
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;

export interface IslandLike {
  title: string;
  chunk_indices?: number[];
}

/**
 * Split text into overlapping chunks at paragraph boundaries.
 * Overlap preserves concepts explained across a chunk boundary.
 * Returns [] for empty input.
 */
export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const para of paragraphs) {
    // Single paragraph longer than size: hard-split it.
    if (para.length > size) {
      pushCurrent();
      current = "";
      for (let i = 0; i < para.length; i += size - overlap) {
        const slice = para.slice(i, i + size).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > size && current) {
      pushCurrent();
      // Start next chunk with overlap tail of the previous one.
      const tail = current.slice(-overlap);
      const cutAt = tail.search(/\n|[.!?]\s/);
      current = (cutAt >= 0 ? tail.slice(cutAt + 1) : tail).trim();
      current = current ? `${current}\n\n${para}` : para;
    } else {
      current = candidate;
    }
  }
  pushCurrent();

  return chunks;
}

/** Truncate text to a char limit (for prompt safety caps). */
export function capText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + "\n\n[… a tananyag további része rövidítve …]";
}

/** Normalize titles for matching plan islands to request params. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

interface ChunkRow {
  material_id: string;
  idx: number;
  content: string;
}

interface MaterialRow {
  id: string;
  title: string;
  content: string | null;
}

/**
 * Load the material context relevant to one island.
 *
 * 1. If the session plan maps the island title to chunk indices, load only
 *    those chunks (fast path for large documents).
 * 2. Else if key concepts are given, return chunks mentioning them (capped).
 * 3. Else fall back to the legacy full-text join (capped).
 *
 * Small corpora behave exactly as before (single chunk / full text).
 */
export async function getIslandContext(
  supabase: SupabaseClient,
  topicId: string,
  opts: { islandTitle?: string; keyConcepts?: string[]; plan?: unknown } = {},
): Promise<string> {
  const { data: materials } = await supabase
    .from("study_materials")
    .select("id, title, content")
    .eq("topic_id", topicId)
    .not("content", "is", null);

  const rows = (materials ?? []) as MaterialRow[];
  const readable = rows.filter((m) => m.content && m.content.trim().length > 0);
  if (readable.length === 0) return "";

  const titleByMaterial = new Map(readable.map((m) => [m.id, m.title]));

  // 1. Chunk-index mapping from the session plan.
  const plan = opts.plan;
  const wanted = opts.islandTitle ? normalizeTitle(opts.islandTitle) : "";
  if (wanted && Array.isArray(plan)) {
    const island = (plan as IslandLike[]).find(
      (i) => i && typeof i.title === "string" && normalizeTitle(i.title) === wanted,
    );
    const indices = Array.isArray(island?.chunk_indices)
      ? island.chunk_indices.filter((n) => Number.isInteger(n) && (n as number) >= 0)
      : [];
    if (indices.length > 0) {
      const materialIds = readable.map((m) => m.id);
      const { data: chunkRows } = await supabase
        .from("material_chunks")
        .select("material_id, idx, content")
        .in("material_id", materialIds)
        .in("idx", indices as number[])
        .order("idx", { ascending: true });

      const chunks = (chunkRows ?? []) as ChunkRow[];
      if (chunks.length > 0) {
        // Capped as insurance: per-material idx values can collide across
        // materials, slightly over-fetching on multi-material topics.
        return capText(
          chunks
            .map((c) => `--- ${titleByMaterial.get(c.material_id) ?? "Tananyag"} [részlet ${c.idx}] ---\n${c.content}`)
            .join("\n\n"),
          MAX_PROMPT_MATERIAL_CHARS,
        );
      }
    }
  }

  // Load all chunks for keyword matching (cheap: one indexed query).
  const materialIds = readable.map((m) => m.id);
  const { data: allChunkRows } = await supabase
    .from("material_chunks")
    .select("material_id, idx, content")
    .in("material_id", materialIds)
    .order("material_id", { ascending: true })
    .order("idx", { ascending: true });

  const allChunks = (allChunkRows ?? []) as ChunkRow[];

  // 2. Keyword fallback on key concepts.
  const concepts = (opts.keyConcepts ?? []).map((c) => c.toLowerCase()).filter(Boolean);
  if (concepts.length > 0 && allChunks.length > 0) {
    const matched = allChunks.filter((c) => {
      const body = c.content.toLowerCase();
      return concepts.some((k) => body.includes(k));
    });
    if (matched.length > 0) {
      return capText(
        matched
          .map((c) => `--- ${titleByMaterial.get(c.material_id) ?? "Tananyag"} [részlet ${c.idx}] ---\n${c.content}`)
          .join("\n\n"),
        MAX_PROMPT_MATERIAL_CHARS,
      );
    }
  }

  // 3. Legacy full-text fallback (capped). Used for small docs and old sessions.
  return capText(
    readable.map((m) => `--- ${m.title} ---\n${m.content}`).join("\n\n"),
    MAX_PROMPT_MATERIAL_CHARS,
  );
}
