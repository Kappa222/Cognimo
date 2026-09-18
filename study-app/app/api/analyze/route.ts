import { createClient } from "../../../lib/supabase-server";
import { completeJson } from "../../../lib/ai";
import { chunkText, LARGE_CORPUS_THRESHOLD } from "../../../lib/chunks";

const SYSTEM_PROMPT =
  "Te vagy Lumi, egy barátságos tanulótárs. A feladatod, hogy tananyagokat elemezz, és strukturált tanulási tervet készíts.\n\n" +
  "Oszd fel az anyagot logikai egységekre. Minden egység egy összefüggő altémát fedjen le. Az egységek száma tükrözze az anyag hosszát és mélységét — rövid anyagoknál 2-3 egység, hosszabbaknál 6-10 vagy több.\n\n" +
  "Minden egységhez határozd meg a legjobb tanítási megközelítést:\n" +
  '- "scenario": Mutass be egy valós szituációt vagy problémát, és vezesd végig a felhasználót a megértésén. Legjobb ok-okozati összefüggésekhez, történelmi eseményekhez, folyamatokhoz.\n' +
  '- "socratic": Tegyél fel irányított kérdéseket, amelyek segítenek a felhasználónak felfedezni a választ. Legjobb definíciókhoz, elvekhez, elméleti fogalmakhoz.\n' +
  '- "conversational": Magyarázz természetesen, miközben bevonod a felhasználót. Legjobb elbeszélésekhez, életrajzokhoz, leíró tartalomhoz.\n\n' +
  "Minden egységből emelj ki 2-3 kulcsfogalmat, amelyeket feltétlenül le kell fedni.\n" +
  "Minden egységhez generálj 2-3 próbakérdést a fordított tanár módszerhez — olyan kérdéseket, amelyek tesztelik, hogy a felhasználó valóban megértette-e, úgy megfogalmazva, mintha Lumi nem értené és segítségre szorulna.\n\n" +
  "Minden kimeneti érték (titles, key_concepts, probe_questions) magyarul legyen, függetlenül a tananyagok nyelvétől.\n\n" +
  'Csak egy érvényes JSON objektumot adj vissza "islands" tömbbel. Markdown, kódblokk nélkül.\n' +
  'Formátum: {"islands": [{"title": "...", "approach": "scenario|socratic|conversational", "key_concepts": ["...", "..."], "probe_questions": ["...?", "...?"]}]}';

// Max chars per summarization batch in the two-stage path.
const SUMMARY_BATCH_CHARS = 50_000;

const SUMMARY_PROMPT =
  "Foglald össze magyarul az alábbi tananyagrészletet 5-8 tömör mondatban, kiemelve a legfontosabb fogalmakat és összefüggéseket. " +
  "A végén egy Kulcsszavak sorban sorolj fel 5-10 kulcsszót vesszővel elválasztva.\n\n" +
  'Csak érvényes JSON-t adj vissza: {"summary": "...", "keywords": "..."}';

interface ChunkRefShape {
  material_id: string;
  idx: number;
}

interface IslandShape {
  title: string;
  approach: string;
  key_concepts: string[];
  probe_questions: string[];
  chunk_indices?: number[];
  chunk_refs?: ChunkRefShape[];
}

interface BatchInfo {
  label: string;
  summary: string;
  keywords: string;
  chunkIndices: number[];
  chunkRefs: ChunkRefShape[];
}

interface MaterialInput {
  id: string;
  content: string | null;
  title: string;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { topicId?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { topicId } = body;
  if (!topicId || typeof topicId !== "string") {
    return new Response("topicId required", { status: 400 });
  }

  const { data: topic } = await supabase
    .from("topics")
    .select("name")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .single();

  if (!topic) return new Response("Topic not found", { status: 404 });

  // Fetch every row including null-content ones (legacy failed extractions):
  // otherwise "uploaded but unreadable" is indistinguishable from "nothing
  // uploaded" and the user gets a false "Nincs tananyag" message.
  const { data: materials, error: materialsError } = await supabase
    .from("study_materials")
    .select("id, content, title")
    .eq("topic_id", topicId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (materialsError) {
    console.error("Analyze materials load failed:", materialsError);
    return new Response("Failed to load materials", { status: 500 });
  }

  const all = (materials ?? []) as MaterialInput[];
  const readable = all.filter(
    (m) => m.content && m.content.trim().length > 0,
  );
  if (readable.length === 0) {
    // Distinguish "nothing uploaded" from "uploaded but unreadable" so the
    // UI can guide (scanned PDFs need paste-as-text, not a retry).
    if (all.length === 0) {
      return new Response("Nincs tananyag ehhez a témához. Adj hozzá szöveget vagy PDF-et!", { status: 400 });
    }
    return new Response("A feltöltött tananyagok szövege nem olvasható (pl. szkennelt PDF). Másold be a tartalmat szövegként a Tananyagok oldalon!", { status: 400 });
  }

  const topicSuffix =
    'Készíts tanulási tervet a következő témához: "' + (topic?.name ?? "ez a téma") + '".';

  try {
    const islands = await buildIslands(readable, topicSuffix);
    return new Response(JSON.stringify(islands), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Analyze error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}

async function buildIslands(
  materials: MaterialInput[],
  topicSuffix: string,
): Promise<IslandShape[]> {
  const readable = materials.filter(
    (m) => m.content && m.content.trim().length > 0,
  ) as { id: string; content: string; title: string }[];

  const totalChars = readable.reduce((sum, m) => sum + m.content.length, 0);

  // Pre-chunk with the same splitter as upload time, so per-material idx
  // values line up with the stored material_chunks rows.
  const chunked = readable.map((m) => ({
    id: m.id,
    title: m.title,
    chunks: chunkText(m.content),
  }));
  const flatChunks = chunked.flatMap((m) =>
    m.chunks.map((text, idx) => ({ material_id: m.id, idx, text })),
  );

  // Small corpora: current single-pass path, byte-identical prompting.
  if (totalChars <= LARGE_CORPUS_THRESHOLD) {
    const parts: string[] = [SYSTEM_PROMPT];
    if (readable.length > 0) {
      const materialText = readable
        .map((m) => "--- " + m.title + " ---\n" + m.content)
        .join("\n\n");
      parts.push("Elemezd a következő tananyagokat:\n\n" + materialText);
    }
    parts.push(topicSuffix);
    const messages = [{ role: "system" as const, content: parts.join("\n\n") }];
    const parsed = await completeJson(messages);
    const islands = coerceIslands(parsed);
    // Map islands to precise chunk refs even on the small path, so chat
    // and evaluate can scope to the island instead of full text.
    mapIslandsToChunks(islands, flatChunks);
    return islands;
  }

  // Large corpora: two-stage path — summarize batches, then islands from summaries.
  const batches = toBatches(chunked);
  const batchInfos: BatchInfo[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const messages = [
      { role: "system" as const, content: SUMMARY_PROMPT + "\n\n" + batch.text },
    ];
    try {
      const raw = await completeJson(messages) as { summary?: unknown; keywords?: unknown };
      batchInfos.push({
        label: `${i + 1}. összefoglaló (${batch.firstGlobal}–${batch.lastGlobal}. részletek)`,
        summary: typeof raw.summary === "string" ? raw.summary : "",
        keywords: typeof raw.keywords === "string" ? raw.keywords : "",
        chunkIndices: batch.globalIndices,
        chunkRefs: batch.chunkRefs,
      });
    } catch (err) {
      // One bad batch must not abort the whole plan; keep its refs so the
      // island mapping can still reach those chunks via other batches.
      console.error(`Analyze batch ${i + 1}/${batches.length} failed:`, err);
      batchInfos.push({
        label: `${i + 1}. összefoglaló (${batch.firstGlobal}–${batch.lastGlobal}. részletek)`,
        summary: "",
        keywords: "",
        chunkIndices: batch.globalIndices,
        chunkRefs: batch.chunkRefs,
      });
    }
  }
  if (batchInfos.every((b) => !b.summary && !b.keywords)) {
    throw new Error("All summarization batches failed");
  }

  const parts: string[] = [SYSTEM_PROMPT];
  parts.push(
    "Elemezd a következő tananyag-összefoglalókat (az eredeti anyag sorszámozott részeiből készültek):\n\n" +
    batchInfos.map((b) => `--- ${b.label} ---\n${b.summary}\nKulcsszavak: ${b.keywords}`).join("\n\n"),
  );
  parts.push(topicSuffix);
  const messages = [{ role: "system" as const, content: parts.join("\n\n") }];
  const parsed = await completeJson(messages);
  const islands = coerceIslands(parsed);

  // Deterministic island → chunk mapping: match Hungarian key concepts against
  // the Hungarian batch summaries (works for English sources too, where raw
  // keyword matching on chunks would miss translations).
  for (const island of islands) {
    const concepts = island.key_concepts.map((c) => c.toLowerCase());
    const matchedIdx = new Set<number>();
    const matchedRefs = new Map<string, ChunkRefShape>();
    for (const b of batchInfos) {
      const haystack = `${b.summary}\n${b.keywords}`.toLowerCase();
      if (concepts.some((c) => c && haystack.includes(c))) {
        for (const n of b.chunkIndices) matchedIdx.add(n);
        for (const r of b.chunkRefs) matchedRefs.set(`${r.material_id}:${r.idx}`, r);
      }
    }
    island.chunk_indices = Array.from(matchedIdx).sort((a, b) => a - b);
    island.chunk_refs = Array.from(matchedRefs.values()).sort(
      (a, b) => a.material_id.localeCompare(b.material_id) || a.idx - b.idx,
    );
  }

  return islands;
}

/** Match island key concepts directly against chunk texts (small corpora). */
function mapIslandsToChunks(
  islands: IslandShape[],
  flatChunks: { material_id: string; idx: number; text: string }[],
): void {
  for (const island of islands) {
    const concepts = island.key_concepts
      .map((c) => c.toLowerCase())
      .filter((c) => c.length >= 3);
    if (concepts.length === 0 || flatChunks.length === 0) continue;
    const matchedIdx = new Set<number>();
    const matchedRefs = new Map<string, ChunkRefShape>();
    for (const c of flatChunks) {
      const body = c.text.toLowerCase();
      if (concepts.some((k) => body.includes(k))) {
        matchedIdx.add(c.idx);
        matchedRefs.set(`${c.material_id}:${c.idx}`, {
          material_id: c.material_id,
          idx: c.idx,
        });
      }
    }
    if (matchedRefs.size > 0) {
      island.chunk_indices = Array.from(matchedIdx).sort((a, b) => a - b);
      island.chunk_refs = Array.from(matchedRefs.values()).sort(
        (a, b) => a.material_id.localeCompare(b.material_id) || a.idx - b.idx,
      );
    }
  }
}

function coerceIslands(parsed: unknown): IslandShape[] {
  const islands = (parsed as Record<string, unknown>).islands ?? [];
  if (!Array.isArray(islands) || islands.length === 0) {
    throw new Error("No islands generated");
  }
  return (islands as Record<string, unknown>[]).map((i) => ({
    title: typeof i.title === "string" ? i.title : "Névtelen rész",
    approach: typeof i.approach === "string" ? i.approach : "conversational",
    key_concepts: Array.isArray(i.key_concepts)
      ? (i.key_concepts as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
    probe_questions: Array.isArray(i.probe_questions)
      ? (i.probe_questions as unknown[]).filter((q): q is string => typeof q === "string")
      : [],
  }));
}

function toBatches(
  chunked: { id: string; title: string; chunks: string[] }[],
): {
  text: string;
  globalIndices: number[];
  chunkRefs: ChunkRefShape[];
  firstGlobal: number;
  lastGlobal: number;
}[] {
  // Global chunk numbering across materials (1-based for prompt readability).
  const numbered: { materialId: string; materialTitle: string; idx: number; global: number; text: string }[] = [];
  let global = 0;
  for (const m of chunked) {
    m.chunks.forEach((text, idx) => {
      global += 1;
      numbered.push({ materialId: m.id, materialTitle: m.title, idx, global, text });
    });
  }

  const batches: { text: string; globalIndices: number[]; chunkRefs: ChunkRefShape[]; firstGlobal: number; lastGlobal: number }[] = [];
  let current: typeof numbered = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    batches.push({
      text: current.map((c) => `[${c.global}. részlet — ${c.materialTitle}]\n${c.text}`).join("\n\n"),
      globalIndices: current.map((c) => c.idx),
      chunkRefs: current.map((c) => ({ material_id: c.materialId, idx: c.idx })),
      firstGlobal: current[0].global,
      lastGlobal: current[current.length - 1].global,
    });
    current = [];
    currentChars = 0;
  };
  for (const c of numbered) {
    if (current.length > 0 && currentChars + c.text.length > SUMMARY_BATCH_CHARS) flush();
    current.push(c);
    currentChars += c.text.length;
  }
  flush();
  return batches;
}
