import { createClient } from "../../../../lib/supabase-server";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const MODEL = "gemini-3.5-flash";

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

function getGeminiClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { topicId, islandTitle, keyConcepts, questionCount } = await req.json();
  if (!topicId) return new Response("topicId required", { status: 400 });

  const count = typeof questionCount === "number" ? Math.max(1, Math.min(10, questionCount)) : 4;

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

  const isScoped = !!keyConcepts && keyConcepts.length > 0;

  const systemPrompt =
    `Te vagy Lumi, egy barátságos tanulótárs. Készíts pontosan ${count} feleletválasztós kvízkérdést magyar nyelven a megadott tananyagok alapján.\n\n` +
    "Minden kérdésnek meg kell felelnie az alábbiaknak:\n" +
    "- Kapcsolódjon a témához és a tananyagokhoz\n" +
    "- Pontosan 4 opciója legyen (A, B, C, D)\n" +
    "- Pontosan egy helyes válasza legyen\n" +
    "- A megértés tesztelésére alkalmas legyen\n\n" +
    "Csak egy érvényes JSON tömböt adj vissza. Markdown, kódblokk vagy extra szöveg nélkül.\n" +
    'Formátum: [{"text": "kérdés szövege", "options": ["opció1", "opció2", "opció3", "opció4"], "correctIndex": 0}]';

  const parts: string[] = [systemPrompt];

  if (isScoped) {
    parts.push(
      `A kérdések kifejezetten a következő altémára összpontosítsanak: "${islandTitle ?? "(névtelen szekció)"}"\n` +
      `Kulcsfogalmak, amelyeket le kell fedni: ${keyConcepts.join(", ")}.\n` +
      "Ne kérdezz a fogalmakon kívüli témákról."
    );
  }

  if (materials && materials.length > 0) {
    const materialText = materials
      .map((m) => `--- ${m.title} ---\n${m.content}`)
      .join("\n\n");
    parts.push(
      "A kvízkérdéseket a következő tananyagok alapján állítsd össze:\n\n" + materialText
    );
  }

  parts.push('Készíts kvízkérdéseket a következő témához: "' + (topic?.name ?? 'ez a téma') + '".');

  const fullPrompt = parts.join("\n\n");

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    });

    let content: string;
    try {
      content = result.response.text();
    } catch {
      const feedback = result.response.promptFeedback;
      const blockReason = feedback?.blockReason;
      const finishReason = result.response.candidates?.[0]?.finishReason;
      console.error("Gemini response blocked", { blockReason, finishReason, promptFeedback: feedback });
      return new Response("AI service unavailable", { status: 503 });
    }

    if (!content) throw new Error("Empty response");

    const parsed = JSON.parse(content);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions ?? parsed.quiz ?? [];

    return new Response(JSON.stringify(questions), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Gemini quiz generation error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}
