import { requireUser } from "../../../../../lib/api-auth";
import { rateLimit } from "../../../../../lib/rate-limit";
import { readJsonBody, jsonBodyError } from "../../../../../lib/http";
import {
  gradeAttempt,
  isCompleteAttempt,
  isValidSubmission,
  scoreAttempt,
  MAX_ANSWERS,
  type AttemptResult,
  type QuizItem,
  type SubmittedAnswer,
} from "../../../../../lib/quiz-gen";

const MAX_TITLE_CHARS = 200;
const MAX_COUNT = 1000;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const rateLimited = rateLimit("island-attempt:" + user.id, 20, 3600000);
  if (rateLimited) return rateLimited;

  const read = await readJsonBody(req);
  if (!read.ok) return jsonBodyError(read.reason);
  const body = read.body;
  const { topicId, islandTitle, answers, teachingCorrect, teachingTotal, isReview } = body;
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
    teachingCorrect > teachingTotal ||
    (isReview !== undefined && typeof isReview !== "boolean")
  ) {
    return new Response("Invalid attempt", { status: 400 });
  }
  const title = (islandTitle as string).trim();
  const submitted = answers as SubmittedAnswer[];
  // Review replays grade and return a breakdown but never touch stored stats.
  const review = isReview === true;

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
  if (!isCompleteAttempt(questions.length, submitted)) {
    return new Response("Invalid attempt", { status: 400 });
  }

  // Grade MCQs locally and typed answers via AI in parallel; nothing is
  // stored until all succeed, so a retry never creates a half-graded attempt.
  let results: AttemptResult[];
  try {
    results = await gradeAttempt(questions, submitted);
  } catch {
    return new Response("AI service unavailable", { status: 503 });
  }

  const { quizPct, teachingPct, blended, correctCount } = scoreAttempt(
    results,
    teachingCorrect as number,
    teachingTotal as number,
  );

  if (!review) {
    const { error: insertError } = await supabase.from("island_quiz_attempts").insert({
      user_id: user.id,
      topic_id: topicId,
      island_title: title,
      correct_count: correctCount,
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
