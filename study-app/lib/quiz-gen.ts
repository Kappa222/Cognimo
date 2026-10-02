import { completeJson, AiError, aiRetry } from "./ai";

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
  if (allowed.size === 0 || total === 0) {
    throw new AiError("ai_invalid", 500, false, "Invalid quiz spec");
  }

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

  // Shared server-side retry (F44) covers both the AI call and unusable
  // output: a fresh regeneration usually fixes a bad roll, and completeJson's
  // inner retry stops via the exhausted flag instead of stacking calls.
  return aiRetry("quiz:generate", async () => {
    const parsed = await completeJson([{ role: "user", content: parts.join("\n\n") }]);

    const rawQuestions = isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
    // Keep AI order but guarantee the requested type mix: take typed first,
    // then MCQ (generators sometimes skew the mix).
    const items = (rawQuestions as unknown[])
      .map((q) => coerceItem(q, allowed))
      .filter((q): q is QuizItem => q !== null);
    const typed = items.filter((q) => q.type === "typed").slice(0, typedCount);
    const mcq = items.filter((q) => q.type === "mcq").slice(0, mcqCount);
    if (typed.length < typedCount || mcq.length < mcqCount) {
      throw new AiError("ai_bad_response", 502, true, "Incomplete quiz generated", {
        detail: `want mcq=${mcqCount} typed=${typedCount} got mcq=${mcq.length} typed=${typed.length}`,
      });
    }
    return [...mcq, ...typed];
  });
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
  // Retry both the AI call and a malformed verdict — the judge usually
  // returns a valid verdict on a reroll (F44).
  return aiRetry("quiz:judge", async () => {
    const raw = await completeJson([{ role: "system", content: prompt }]);
    if (!isRecord(raw)) {
      throw new AiError("ai_bad_response", 502, true, "Invalid grade response");
    }
    const verdict =
      raw.verdict === "correct" || raw.verdict === "partial" || raw.verdict === "wrong"
        ? raw.verdict
        : null;
    if (!verdict) {
      throw new AiError("ai_bad_response", 502, true, "Invalid grade response");
    }
    return {
      verdict,
      explanation: typeof raw.explanation === "string" ? raw.explanation : "",
    };
  });
}

// ---------------------------------------------------------------------------
// Shared attempt grading — used by both the island quiz and the finale quiz.
// ---------------------------------------------------------------------------

export const MAX_ANSWERS = 20;
export const MAX_TYPED_CHARS = 5000;

export interface SubmittedAnswer {
  index: number;
  mcqChoice: number | null;
  typedText: string | null;
}

/** Shape check for one submitted answer (bounds included). */
export function isValidSubmission(value: unknown): value is SubmittedAnswer {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  if (typeof a.index !== "number" || !Number.isInteger(a.index) || a.index < 0) return false;
  if (a.mcqChoice !== null && (typeof a.mcqChoice !== "number" || !Number.isInteger(a.mcqChoice))) {
    return false;
  }
  if (a.typedText !== null && (typeof a.typedText !== "string" || a.typedText.length > MAX_TYPED_CHARS)) {
    return false;
  }
  return true;
}

/** Every stored question answered exactly once — no cherry-picking. */
export function isCompleteAttempt(questionCount: number, submitted: SubmittedAnswer[]): boolean {
  const byIndex = new Map(submitted.map((a) => [a.index, a]));
  return byIndex.size === questionCount && submitted.length === questionCount;
}

/** Question fields both attempt sources expose after loading stored rows. */
export interface GradeableQuestion {
  type: "mcq" | "typed";
  text: string;
  concept: string;
  options?: string[] | null;
  correctIndex?: number | null;
  referenceAnswer?: string | null;
}

/**
 * Grade an attempt: MCQs locally, typed answers via the AI judge in
 * parallel. Throws when AI grading fails so callers return 503 without
 * persisting a half-graded attempt.
 */
export async function gradeAttempt(
  questions: GradeableQuestion[],
  submitted: SubmittedAnswer[],
): Promise<AttemptResult[]> {
  const byIndex = new Map(submitted.map((a) => [a.index, a]));
  const typedGrades = new Map<number, TypedGrade>();
  await Promise.all(
    questions.map(async (q, i) => {
      if (q.type !== "typed") return;
      const text = byIndex.get(i)?.typedText?.trim() ?? "";
      if (!text || !q.referenceAnswer) {
        typedGrades.set(i, { verdict: "wrong", explanation: "Üres válasz." });
        return;
      }
      typedGrades.set(i, await gradeTypedAnswer(q.text, q.referenceAnswer, text));
    }),
  );

  return questions.map((q, i) => {
    const sub = byIndex.get(i);
    if (q.type === "mcq") {
      const correct = sub?.mcqChoice === q.correctIndex;
      return {
        index: i,
        type: "mcq",
        concept: q.concept,
        points: correct ? 1 : 0,
        maxPoints: 1,
        verdict: correct ? "correct" : "wrong",
        explanation: null,
        correctIndex: q.correctIndex ?? null,
        referenceAnswer: null,
        userAnswer:
          typeof sub?.mcqChoice === "number" && q.options
            ? (q.options[sub.mcqChoice] ?? null)
            : null,
      };
    }
    const grade = typedGrades.get(i) ?? { verdict: "wrong" as const, explanation: "" };
    return {
      index: i,
      type: "typed",
      concept: q.concept,
      points: grade.verdict === "correct" ? 1 : grade.verdict === "partial" ? 0.5 : 0,
      maxPoints: 1,
      verdict: grade.verdict,
      explanation: grade.explanation || null,
      correctIndex: null,
      referenceAnswer: q.referenceAnswer ?? null,
      userAnswer: sub?.typedText?.trim() || null,
    };
  });
}

export interface AttemptScores {
  quizPct: number;
  teachingPct: number;
  blended: number;
  correctCount: number;
}

/**
 * Blended score: 60% quiz + 40% teaching. With no teaching evidence the
 * quiz carries the whole weight (teachingPct falls back to quizPct).
 */
export function scoreAttempt(
  results: AttemptResult[],
  teachingCorrect: number,
  teachingTotal: number,
): AttemptScores {
  const points = results.reduce((sum, r) => sum + r.points, 0);
  const quizPct = Math.round((100 * points) / results.length);
  const teachingPct =
    teachingTotal > 0 ? Math.round((100 * teachingCorrect) / teachingTotal) : quizPct;
  const blended = Math.round(0.6 * quizPct + 0.4 * teachingPct);
  return {
    quizPct,
    teachingPct,
    blended,
    correctCount: results.filter((r) => r.verdict === "correct").length,
  };
}
