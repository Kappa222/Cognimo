import { createClient } from "../../../lib/supabase-server";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const MODEL = "gemini-3.5-flash";

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

const PLAN_SYSTEM_PROMPT =
  "Te vagy Lumi, egy barátságos és bátorító tanulótárs. A feladatod, hogy strukturált tanulási tervet készíts a felhasználó tananyagai alapján.\n\n" +
  "Készíts egy részletes tanulási tervet magyar nyelven, amely a következőket tartalmazza:\n" +
  "1. **Témakör áttekintése** — Rövid összefoglaló, hogy miről szól a téma\n" +
  "2. **Főbb fogalmak** — Kulcsfontosságú fogalmak logikai egységekre bontva\n" +
  "3. **Tanulási terv** — Hogyan fog zajlani a foglalkozás (3 fázis: gyakorlatok ahol magyarázol és kérdezel, tanítás ahol a felhasználó tanít vissza, és kvíz)\n" +
  "4. **Célkitűzések** — Mit fog tudni a felhasználó a teljesítés után\n\n" +
  "Formázd a tervet áttekinthető szakaszokkal markdown segítségével. Legyél alapos, de tömör. A tervet kizárólag a megadott tananyagokra alapozd. Válaszolj magyarul.";

function getGeminiClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
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
    .not("content", "is", null);

  const parts: string[] = [PLAN_SYSTEM_PROMPT];

  if (materials && materials.length > 0) {
    const materialText = materials
      .map((m) => `--- ${m.title} ---\n${m.content}`)
      .join("\n\n");
    parts.push(
      "A tanulási tervet a következő tananyagok alapján állítsd össze:\n\n" + materialText
    );
  }

  parts.push(
    `Készíts tanulási tervet a következő témához: "${topic?.name ?? "ez a téma"}".`
  );

  const systemPrompt = parts.join("\n\n");

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    safetySettings: SAFETY_SETTINGS,
  });

  try {
    const streamResult = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: "Készítsd el a tanulási tervet." }] }],
    });

    return new Response(
      new ReadableStream({
        async start(controller) {
          for await (const chunk of streamResult.stream) {
            const text = chunk.text();
            if (text) controller.enqueue(text);
          }
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/plain" } },
    );
  } catch (err) {
    console.error("Gemini API error for plan:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}
