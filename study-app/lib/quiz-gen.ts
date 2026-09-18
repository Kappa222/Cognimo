import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { completeJson } from "./ai";

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

export interface QuizItem {
  type: "mcq" | "typed";
  text: string;
  options: string[] | null;
  correctIndex: number | null;
  referenceAnswer: string | null;
  concept: string;
}

export interface GradedAnswer {
  index: number;
  points: number;
  maxPoints: number;
  verdict: "correct" | "partial" | "wrong";
  explanation: string | null;
}

/** Per-question attempt detail, shared by island + finale attempt routes. */
export interface AttemptResult extends GradedAnswer {
  type: "mcq" | "typed";
  concept: string;
  correctIndex: number | null;
  referenceAnswer: string | null;
  userAnswer: string | null;
}

interface GenerateSpec {
  materialText: string;
  topicName: string;
  /** Human scope label, e.g. island title or "teljes téma". */
  scopeLabel: string;
  keyConcepts: string[];
  mcqCount: number;
  typedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/** Validate one AI-generated question; returns null for unusable items. */
function coerceItem(raw: unknown, allowedConcepts: Set<string>): QuizItem | null {
  if (!isRecord(raw)) return null;
  const type = raw.type === "typed" ? "typed" : raw.type === "mcq" ? "mcq" : null;
  if (!type) return null;
  if (typeof raw.text !== "string" || !raw.text.trim()) return null;
  const concept =
    typeof raw.concept === "string" && allowedConcepts.has(raw.concept.trim())
      ? raw.concept.trim()
      : [...allowedConcepts][0] ?? "";
  if (!concept) return null;

  if (type === "mcq") {
    if (!Array.isArray(raw.options) || raw.options.length !== 4) return null;
    const options = (raw.options as unknown[]).filter(
      (o): o is string => typeof o === "string" && o.trim().length > 0,
    );
    if (options.length !== 4) return null;
    if (
      typeof raw.correctIndex !== "number" ||
      !Number.isInteger(raw.correctIndex) ||
      raw.correctIndex < 0 ||
      raw.correctIndex > 3
    ) {
      return null;
    }
    return {
      type,
      text: (raw.text as string).trim(),
      options,
      correctIndex: raw.correctIndex,
      referenceAnswer: null,
      concept,
    };
  }

  if (typeof raw.referenceAnswer !== "string" || !raw.referenceAnswer.trim()) {
    return null;
  }
  return {
    type,
    text: (raw.text as string).trim(),
    options: null,
    correctIndex: null,
    referenceAnswer: raw.referenceAnswer.trim(),
    concept: concept,
  };
}

/**
 * Generate a mixed MCQ + typed quiz via Gemini. Throws when the AI output
 * cannot satisfy the requested counts — callers surface a retryable error.
 */
export async function generateQuizQuestions(spec: GenerateSpec): Promise<QuizItem[]> {
  const { materialText, topicName, scopeLabel, keyConcepts, mcqCount, typedCount } = spec;
  const total = mcqCount + typedCount;
  const allowed = new Set(keyConcepts.map((c) => c.trim()).filter(Boolean));
  if (allowed.size === 0 || total === 0) throw new Error("Invalid quiz spec");

  const systemPrompt =
    `Te vagy Lumi, egy barátságos tanulótárs. Készíts pontosan ${total} kvízkérdést magyar nyelven: ` +
    `${mcqCount} feleletválasztósat és ${typedCount} kifejtőset (szabadszavas válasz).\n\n` +
    "Feleletválasztós kérdés:\n" +
    "- Pontosan 4 opciója legyen, pontosan egy helyes válasszal\n" +
    "- A megértés tesztelésére alkalmas legyen, ne bemagolható definíció\n\n" +
    "Kifejtős kérdés:\n" +
    "- Olyan legyen, amire 1-3 mondatban lehet válaszolni\n" +
    "- Adj meg hozzá minta helyes választ (referenceAnswer)\n\n" +
    `Minden kérdés pontosan egy kulcsfogalomhoz kapcsolódjon az alábbiak közül: ${[...allowed].join(", ")}.\n` +
    `A kérdések a következő altémára összpontosítsanak: "${scopeLabel}". Ne kérdezz a fogalmakon kívüli témákról.\n\n` +
    "Csak egy érvényes JSON objektumot adj vissza. Markdown, kódblokk nélkül.\n" +
    'Formátum: {"questions": [{"type": "mcq|typed", "text": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "referenceAnswer": "...", "concept": "..."}]} ' +
    "(mcq-nél options + correctIndex kötelező, referenceAnswer elhagyható; typed-nél referenceAnswer kötelező, options/correctIndex elhagyható)";

  const parts = [
    systemPrompt,
    `Téma: "${topicName}".`,
    materialText
      ? "A kvízkérdéseket a következő tananyagok alapján állítsd össze:\n\n" + materialText
      : "Tananyagrészlet most nem érhető el — általános, de a témához és a kulcsfogalmakhoz hű kérdéseket készíts.",
  ];

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { responseMimeType: "application/json" },
  });

  let parsed: unknown;
  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: parts.join("\n\n") }] }],
    });
    let content: string;
    try {
      content = result.response.text();
    } catch {
      throw new Error("AI response blocked");
    }
    if (!content) throw new Error("Empty response");
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("Quiz generation error:", err);
    throw new Error("AI service unavailable");
  }

  const rawQuestions = isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
  // Keep AI order but guarantee the requested type mix: take typed first,
  // then MCQ (generators sometimes skew the mix).
  const items = (rawQuestions as unknown[])
    .map((q) => coerceItem(q, allowed))
    .filter((q): q is QuizItem => q !== null);
  const typed = items.filter((q) => q.type === "typed").slice(0, typedCount);
  const mcq = items.filter((q) => q.type === "mcq").slice(0, mcqCount);
  if (typed.length < typedCount || mcq.length < mcqCount) {
    console.error("Quiz generation shortfall:", {
      wantMcq: mcqCount,
      wantTyped: typedCount,
      gotMcq: mcq.length,
      gotTyped: typed.length,
    });
    throw new Error("Incomplete quiz generated");
  }
  return [...mcq, ...typed];
}

const JUDGE_PROMPT =
  "Te egy szigorú, de igazságos vizsgáztató vagy. Értékeld a felhasználó válaszát a mintaválasz alapján.\n\n" +
  "<kérdés>\n{question}\n</kérdés>\n" +
  "<mintaválasz>\n{reference}\n</mintaválasz>\n" +
  "<felhasználó-válasza>\n{answer}\n</felhasználó-válasza>\n\n" +
  'Ítéletek: "correct" (helyes, más szavakkal is elfogadható), "partial" (részben jó, hiányos vagy pontatlan), "wrong" (téves vagy teljesen hiányzik).\n' +
  "A helyes VÉGEREDMÉNY önmagában nem elég — az OK/MŰKÖDÉS is kell a correct-hez.\n" +
  "Adj 1 mondatos magyar magyarázatot is.\n\n" +
  'Csak érvényes JSON-t adj vissza: {"verdict": "correct|partial|wrong", "explanation": "..."}';

export interface TypedGrade {
  verdict: "correct" | "partial" | "wrong";
  explanation: string;
}

/** Grade one free-text answer against its reference. Throws on AI failure. */
export async function gradeTypedAnswer(
  question: string,
  referenceAnswer: string,
  userAnswer: string,
): Promise<TypedGrade> {
  const prompt = JUDGE_PROMPT.replace("{question}", question)
    .replace("{reference}", referenceAnswer)
    .replace("{answer}", userAnswer);
  let raw: unknown;
  try {
    raw = await completeJson([{ role: "system", content: prompt }]);
  } catch (err) {
    console.error("Typed grading AI error:", err);
    throw new Error("AI service unavailable");
  }
  if (!isRecord(raw)) throw new Error("Invalid grade response");
  const verdict =
    raw.verdict === "correct" || raw.verdict === "partial" || raw.verdict === "wrong"
      ? raw.verdict
      : null;
  if (!verdict) throw new Error("Invalid grade response");
  return {
    verdict,
    explanation: typeof raw.explanation === "string" ? raw.explanation : "",
  };
}
