import { createClient } from "../../../../../lib/supabase-server";
import {
  gradeTypedAnswer,
  type AttemptResult,
  type QuizItem,
} from "../../../../../lib/quiz-gen";

const MAX_TITLE_CHARS = 200;
const MAX_ANSWERS = 20;
const MAX_TYPED_CHARS = 5000;
const MAX_COUNT = 1000;

interface SubmittedAnswer {
  index: number;
  mcqChoice: number | null;
  typedText: string | null;
}

function isValidSubmission(value: unknown): value is SubmittedAnswer {
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

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { topicId, islandTitle, answers, teachingCorrect, teachingTotal } = body;
  if (
    typeof topicId !== "string" || !topicId ||
    typeof islandTitle !== "string" || !islandTitle.trim() ||
    islandTitle.length > MAX_TITLE_CHARS ||
    !Array.isArray(answers) || answers.length === 0 || answers.length > MAX_ANSWERS ||
    !answers.every(isValidSubmission) ||
    typeof teachingCorrect !== "number" || !Number.isInteger(teachingCorrect) ||
    teachingCorrect < 0 || teachingCorrect > MAX_COUNT ||
    typeof teachingTotal !== "number" || !Number.isInteger(teachingTotal) ||
    teachingTotal < 0 || teachingTotal > MAX_COUNT ||
    teachingCorrect > teachingTotal
  ) {
    return new Response("Invalid attempt", { status: 400 });
  }
  const title = (islandTitle as string).trim();
  const submitted = answers as SubmittedAnswer[];

  const { data: topic } = await supabase
    .from("topics")
    .select("id")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .single();
  if (!topic) return new Response("Topic not found", { status: 404 });

  const { data: stored } = await supabase
    .from("island_quizzes")
    .select("questions")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .eq("island_title", title)
    .maybeSingle();
  if (!stored || !Array.isArray(stored.questions)) {
    return new Response("Quiz not found — open the island quiz first", { status: 404 });
  }
  const questions = stored.questions as QuizItem[];

  // Every stored question answered exactly once — no cherry-picking.
  const byIndex = new Map(submitted.map((a) => [a.index, a]));
  if (byIndex.size !== questions.length || submitted.length !== questions.length) {
    return new Response("Invalid attempt", { status: 400 });
  }

  // Grade typed answers in parallel; nothing is stored until all succeed,
  // so a retry never creates a half-graded attempt.
  const typedGrades = new Map<number, { verdict: "correct" | "partial" | "wrong"; explanation: string }>();
  try {
    await Promise.all(
      questions.map(async (q, i) => {
        if (q.type !== "typed") return;
        const sub = byIndex.get(i);
        const text = sub?.typedText?.trim() ?? "";
        if (!text || !q.referenceAnswer) {
          typedGrades.set(i, { verdict: "wrong", explanation: "Üres válasz." });
          return;
        }
        typedGrades.set(i, await gradeTypedAnswer(q.text, q.referenceAnswer, text));
      }),
    );
  } catch {
    return new Response("AI service unavailable", { status: 503 });
  }

  const results: AttemptResult[] = questions.map((q, i) => {
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
        correctIndex: q.correctIndex,
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
      referenceAnswer: q.referenceAnswer,
      userAnswer: sub?.typedText?.trim() || null,
    };
  });

  const points = results.reduce((sum, r) => sum + r.points, 0);
  const quizPct = Math.round((100 * points) / questions.length);
  const teachingPct =
    teachingTotal > 0 ? Math.round((100 * (teachingCorrect as number)) / (teachingTotal as number)) : quizPct;
  const blended = Math.round(0.6 * quizPct + 0.4 * teachingPct);

  const { error: insertError } = await supabase.from("island_quiz_attempts").insert({
    user_id: user.id,
    topic_id: topicId,
    island_title: title,
    correct_count: results.filter((r) => r.verdict === "correct").length,
    total: questions.length,
    teaching_correct: teachingCorrect,
    teaching_total: teachingTotal,
    quiz_pct: quizPct,
    teaching_pct: teachingPct,
    blended,
    answers: results as unknown as Record<string, unknown>[],
  });
  if (insertError) {
    console.error("Island attempt insert failed:", insertError);
    return new Response("Failed to save attempt", { status: 500 });
  }

  return new Response(
    JSON.stringify({
      quiz_pct: quizPct,
      teaching_pct: teachingPct,
      blended,
      correct_count: results.filter((r) => r.verdict === "correct").length,
      total: questions.length,
      results,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
