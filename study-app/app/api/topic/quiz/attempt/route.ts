import { requireUser } from "../../../../../lib/api-auth";
import { rateLimit } from "../../../../../lib/rate-limit";
import { readJsonBody, jsonBodyError } from "../../../../../lib/http";
import { aiErrorResponse } from "../../../../../lib/ai";
import {
  gradeAttempt,
  isCompleteAttempt,
  isValidSubmission,
  scoreAttempt,
  MAX_ANSWERS,
  type AttemptResult,
  type SubmittedAnswer,
} from "../../../../../lib/quiz-gen";

const MAX_COUNT = 10000;

interface StoredFinaleQuestion {
  type: "mcq" | "typed";
  text: string;
  options: string[] | null;
  correctIndex: number | null;
  referenceAnswer: string | null;
  concept: string | null;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const rateLimited = rateLimit("topic-attempt:" + user.id, 20, 3600000);
  if (rateLimited) return rateLimited;

  const read = await readJsonBody(req);
  if (!read.ok) return jsonBodyError(read.reason);
  const body = read.body;
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

  // Every stored question answered exactly once — no cherry-picking.
  if (!isCompleteAttempt(questions.length, submitted)) {
    return new Response("Invalid attempt", { status: 400 });
  }

  // Grade MCQs locally and typed answers via AI in parallel; nothing is
  // stored until all succeed, so a retry never creates a half-graded attempt.
  let results: AttemptResult[];
  try {
    results = await gradeAttempt(
      questions.map((q) => ({ ...q, concept: q.concept ?? "" })),
      submitted,
    );
  } catch (err) {
    return aiErrorResponse("topic-quiz-attempt", err);
  }

  const { quizPct, teachingPct, blended, correctCount } = scoreAttempt(
    results,
    teachingCorrect as number,
    teachingTotal as number,
  );

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
