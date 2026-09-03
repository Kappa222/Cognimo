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

interface IslandShape {
  title: string;
  approach: string;
  key_concepts: string[];
  probe_questions: string[];
  chunk_indices?: number[];
}

interface BatchInfo {
  label: string;
  summary: string;
  keywords: string;
  chunkIndices: number[];
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { topicId } = await req.json();
  if (!topicId) return new Response("topicId required", { status: 400 });

  const { data: topic } = await supabase
    .from("topics")
    .select("name")
    .eq("id", topicId)
    .single();

  const { data: materials } = await supabase
    .from("study_materials")
    .select("content, title")
    .eq("topic_id", topicId)
    .not("content", "is", null)
    .order("created_at", { ascending: true });

  const topicSuffix =
    'Készíts tanulási tervet a következő témához: "' + (topic?.name ?? "ez a téma") + '".';

  try {
    const islands = await buildIslands(materials ?? [], topicSuffix);
    return new Response(JSON.stringify(islands), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Analyze error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}

async function buildIslands(
  materials: { content: string | null; title: string }[],
  topicSuffix: string,
): Promise<IslandShape[]> {
  const readable = (materials ?? []).filter(
    (m) => m.content && m.content.trim().length > 0,
  ) as { content: string; title: string }[];

  const totalChars = readable.reduce((sum, m) => sum + m.content.length, 0);

  // Small corpora: current single-pass path, byte-identical behavior.
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
    return coerceIslands(parsed);
  }

  // Large corpora: two-stage path — summarize batches, then islands from summaries.
  // Chunks are derived with the same splitter as upload time, so per-material
  // indices line up with the stored material_chunks rows.
  const batches = toBatches(readable);
  const batchInfos: BatchInfo[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const messages = [
      { role: "system" as const, content: SUMMARY_PROMPT + "\n\n" + batch.text },
    ];
    const raw = await completeJson(messages) as { summary?: unknown; keywords?: unknown };
    batchInfos.push({
      label: `${i + 1}. összefoglaló (${batch.firstGlobal}–${batch.lastGlobal}. részletek)`,
      summary: typeof raw.summary === "string" ? raw.summary : "",
      keywords: typeof raw.keywords === "string" ? raw.keywords : "",
      chunkIndices: batch.globalIndices,
    });
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
    const matched = new Set<number>();
    for (const b of batchInfos) {
      const haystack = `${b.summary}\n${b.keywords}`.toLowerCase();
      if (concepts.some((c) => c && haystack.includes(c))) {
        for (const n of b.chunkIndices) matched.add(n);
      }
    }
    island.chunk_indices = Array.from(matched).sort((a, b) => a - b);
  }

  return islands;
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
  readable: { content: string; title: string }[],
): { text: string; globalIndices: number[]; firstGlobal: number; lastGlobal: number }[] {
  // Global chunk numbering across materials (1-based for prompt readability).
  const numbered: { materialTitle: string; idx: number; global: number; text: string }[] = [];
  let global = 0;
  for (const m of readable) {
    const chunks = chunkText(m.content);
    chunks.forEach((text, idx) => {
      global += 1;
      numbered.push({ materialTitle: m.title, idx, global, text });
    });
  }

  const batches: { text: string; globalIndices: number[]; firstGlobal: number; lastGlobal: number }[] = [];
  let current: typeof numbered = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    batches.push({
      text: current.map((c) => `[${c.global}. részlet — ${c.materialTitle}]\n${c.text}`).join("\n\n"),
      globalIndices: current.map((c) => c.idx),
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
