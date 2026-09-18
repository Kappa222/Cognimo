import { createClient } from "../../../../lib/supabase-server";
import { gradeTypedAnswer } from "../../../../lib/quiz-gen";

const MAX_TEXT_FIELD = 5000;

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
  const { question, referenceAnswer, userAnswer } = body;

  if (
    typeof question !== "string" || !question.trim() || question.length > MAX_TEXT_FIELD ||
    typeof referenceAnswer !== "string" || !referenceAnswer.trim() || referenceAnswer.length > MAX_TEXT_FIELD ||
    typeof userAnswer !== "string" || !userAnswer.trim() || userAnswer.length > MAX_TEXT_FIELD
  ) {
    return new Response("Missing required fields", { status: 400 });
  }

  try {
    const grade = await gradeTypedAnswer(question, referenceAnswer, userAnswer);
    return new Response(JSON.stringify(grade), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response("AI service unavailable", { status: 503 });
  }
}
