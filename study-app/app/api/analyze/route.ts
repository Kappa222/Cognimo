import { createClient } from "../../../lib/supabase-server";
import { completeJson } from "../../../lib/ai";

const SYSTEM_PROMPT =
  "Te vagy Lumi, egy barátságos tanulótárs. A feladatod, hogy tananyagokat elemezz, és strukturált tanulási tervet készíts.\n\n" +
  "Oszd fel az anyagot logikai egységekre. Minden egység egy összefüggő altémát fedjen le. Az egységek száma tükrözze az anyag hosszát és mélységét — rövid anyagoknál 2-3 egység, hosszabbaknál 6-10 vagy több.\n\n" +
  "Minden egységhez határozd meg a legjobb tanítási megközelítést:\n" +
  '- "scenario": Mutass be egy valós szituációt vagy problémát, és vezesd végig a felhasználót a megértésén. Legjobb ok-okozati összefüggésekhez, történelmi eseményekhez, folyamatokhoz.\n' +
  '- "socratic": Tegyél fel irányított kérdéseket, amelyek segítenek a felhasználónak felfedezni a választ. Legjobb definíciókhoz, elvekhez, elméleti fogalmakhoz.\n' +
  '- "conversational": Magyarázz természetesen, miközben bevonod a felhasználót. Legjobb elbeszélésekhez, életrajzokhoz, leíró tartalomhoz.\n\n' +
  "Minden egységből emelj ki 2-3 kulcsfogalmat, amelyeket feltétlenül le kell fedni.\n" +
  "Minden egységhez generálj 2-3 próbakérdést a fordított tanár módszerhez — olyan kérdéseket, amelyek tesztelik, hogy a felhasználó valóban megértette-e, úgy megfogalmazva, mintha Lumi nem értené és segítségre szorulna.\n\n" +
  "All output values (titles, key_concepts, probe_questions) MUST be in Hungarian, regardless of the language of the study materials.\n\n" +
  'Return ONLY a valid JSON object with an "islands" array. No markdown, no code fences.\n' +
  'Format: {"islands": [{"title": "...", "approach": "scenario|socratic|conversational", "key_concepts": ["...", "..."], "probe_questions": ["...?", "...?"]}]}';

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
    .not("content", "is", null);

  const parts: string[] = [SYSTEM_PROMPT];

  if (materials && materials.length > 0) {
    const materialText = materials
      .map((m) => "--- " + m.title + " ---\n" + m.content)
      .join("\n\n");
    parts.push("Analyze the following study materials:\n\n" + materialText);
  }

  parts.push('Create a learning plan for the topic: "' + (topic?.name ?? "this topic") + '".');

  const fullPrompt = parts.join("\n\n");
  const messages = [{ role: "system" as const, content: fullPrompt }];

  try {
    const parsed = await completeJson(messages);
    const islands = (parsed as Record<string, unknown>).islands ?? [];

    if (!Array.isArray(islands) || islands.length === 0) {
      throw new Error("No islands generated");
    }

    return new Response(JSON.stringify(islands), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Analyze error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}
