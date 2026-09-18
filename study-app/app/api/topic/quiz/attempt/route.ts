import { createClient } from "../../../../../lib/supabase-server";
import { gradeTypedAnswer, type AttemptResult } from "../../../../../lib/quiz-gen";

const MAX_ANSWERS = 20;
const MAX_TYPED_CHARS = 5000;
const MAX_COUNT = 10000;

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

interface StoredFinaleQuestion {
  type: "mcq" | "typed";
  text: string;
  options: string[] | null;
  correctIndex: number | null;
  referenceAnswer: string | null;
  concept: string | null;
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
  const { topicId, answers, teachingCorrect, teachingTotal } = body;
  if (
    typeof topicId !== "string" || !topicId ||
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
  const submitted = answers as SubmittedAnswer[];

  const { data: topic } = await supabase
    .from("topics")
    .select("id, subject_id")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .single();
  if (!topic) return new Response("Topic not found", { status: 404 });

  const { data: rows } = await supabase
    .from("quiz_questions")
    .select("question_type, question, options, correct_answer, reference_answer, concept")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  if (!rows || rows.length === 0) {
    return new Response("Quiz not found — open the finale quiz first", { status: 404 });
  }

  const questions: StoredFinaleQuestion[] = rows.map((r) => {
    const options = Array.isArray(r.options)
      ? (r.options as unknown[]).filter((o): o is string => typeof o === "string")
      : [];
    return {
      type: r.question_type === "typed" ? "typed" : "mcq",
      text: r.question as string,
      options: r.question_type === "typed" ? null : options,
      correctIndex:
        r.question_type === "typed" ? null : options.indexOf(r.correct_answer as string),
      referenceAnswer: (r.reference_answer as string | null) ?? null,
      concept: (r.concept as string | null) ?? null,
    };
  });

  const byIndex = new Map(submitted.map((a) => [a.index, a]));
  if (byIndex.size !== questions.length || submitted.length !== questions.length) {
    return new Response("Invalid attempt", { status: 400 });
  }

  const typedGrades = new Map<number, { verdict: "correct" | "partial" | "wrong"; explanation: string }>();
  try {
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
        concept: q.concept ?? "",
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
      concept: q.concept ?? "",
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
  const correctCount = results.filter((r) => r.verdict === "correct").length;

  const { error: insertError } = await supabase.from("quiz_attempts").insert({
    user_id: user.id,
    subject_id: topic.subject_id,
    topic_id: topicId,
    score: correctCount,
    total_questions: questions.length,
    answers: results as unknown as Record<string, unknown>[],
    teaching_score: teachingPct,
    blended,
  });
  if (insertError) {
    console.error("Finale attempt insert failed:", insertError);
    return new Response("Failed to save attempt", { status: 500 });
  }

  return new Response(
    JSON.stringify({
      quiz_pct: quizPct,
      teaching_pct: teachingPct,
      blended,
      correct_count: correctCount,
      total: questions.length,
      results,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
