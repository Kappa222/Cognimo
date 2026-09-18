import { createClient } from "../../../../lib/supabase-server";
import { getIslandContext } from "../../../../lib/chunks";
import { generateQuizQuestions, type QuizItem } from "../../../../lib/quiz-gen";

const MCQ_COUNT = 6;
const TYPED_COUNT = 4;

interface PlanIsland {
  title?: unknown;
  key_concepts?: unknown;
}

export interface FinaleQuestion {
  type: "mcq" | "typed";
  text: string;
  options: string[] | null;
  concept: string | null;
}

function planConcepts(plan: unknown): string[] {
  if (!Array.isArray(plan)) return [];
  const concepts: string[] = [];
  for (const island of plan as PlanIsland[]) {
    const list = island?.key_concepts;
    if (!Array.isArray(list)) continue;
    for (const c of list as unknown[]) {
      if (typeof c === "string" && c.trim()) concepts.push(c.trim());
    }
  }
  return [...new Set(concepts)];
}

function toFinaleItem(row: {
  question_type: string;
  question: string;
  options: unknown;
  correct_answer: string;
  reference_answer: string | null;
  concept: string | null;
}): FinaleQuestion | null {
  if (row.question_type === "typed") {
    if (!row.reference_answer) return null;
    return { type: "typed", text: row.question, options: null, concept: row.concept };
  }
  if (!Array.isArray(row.options)) return null;
  const options = (row.options as unknown[]).filter(
    (o): o is string => typeof o === "string",
  );
  if (options.length !== 4 || !options.includes(row.correct_answer)) return null;
  return { type: "mcq", text: row.question, options, concept: row.concept };
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
  const { topicId } = body;
  if (typeof topicId !== "string" || !topicId) {
    return new Response("topicId required", { status: 400 });
  }

  const { data: topic } = await supabase
    .from("topics")
    .select("id, name, subject_id")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .single();
  if (!topic) return new Response("Topic not found", { status: 404 });

  // Determinism: once generated, the finale quiz is served as-is forever.
  const { data: stored } = await supabase
    .from("quiz_questions")
    .select("question_type, question, options, correct_answer, reference_answer, concept")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  if (stored && stored.length > 0) {
    const questions = stored
      .map((r) =>
        toFinaleItem(r as {
          question_type: string;
          question: string;
          options: unknown;
          correct_answer: string;
          reference_answer: string | null;
          concept: string | null;
        }),
      )
      .filter((q): q is FinaleQuestion => q !== null);
    if (questions.length === stored.length) {
      return new Response(JSON.stringify({ questions, cached: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    // Corrupt legacy set: fall through and regenerate below.
  }

  const { data: planSession } = await supabase
    .from("chat_sessions")
    .select("plan")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .not("plan", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const plan = (planSession as { plan?: unknown } | null)?.plan;
  const keyConcepts = planConcepts(plan);
  if (keyConcepts.length === 0) {
    return new Response("No learning plan for this topic yet", { status: 404 });
  }

  // Whole-topic scope: capped full text across all materials.
  const materialText = await getIslandContext(supabase, topicId, {
    keyConcepts,
    plan,
  });

  let generated: QuizItem[];
  try {
    generated = await generateQuizQuestions({
      materialText,
      topicName: topic.name ?? "ez a téma",
      scopeLabel: "teljes téma",
      keyConcepts,
      mcqCount: MCQ_COUNT,
      typedCount: TYPED_COUNT,
    });
  } catch {
    return new Response("AI service unavailable", { status: 503 });
  }

  const rows = generated.map((q) => ({
    user_id: user.id,
    subject_id: topic.subject_id,
    topic_id: topicId,
    material_id: null,
    question: q.text,
    options: q.type === "mcq" ? q.options : [],
    // correct_answer is NOT NULL: MCQ stores the correct option text so the
    // stored set stays self-describing; typed stores "" (reference lives in
    // reference_answer).
    correct_answer:
      q.type === "mcq" && q.options && q.correctIndex !== null
        ? q.options[q.correctIndex]
        : "",
    question_type: q.type,
    reference_answer: q.referenceAnswer,
    concept: q.concept,
  }));

  const { error: insertError } = await supabase.from("quiz_questions").insert(rows);
  if (insertError) {
    // Lost a generation race: serve the winner's set.
    const { data: raced } = await supabase
      .from("quiz_questions")
      .select("question_type, question, options, correct_answer, reference_answer, concept")
      .eq("user_id", user.id)
      .eq("topic_id", topicId)
      .order("created_at", { ascending: true });
    if (raced && raced.length > 0) {
      return new Response(JSON.stringify({ questions: raced, cached: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Finale quiz insert failed:", insertError);
    return new Response("Failed to save quiz", { status: 500 });
  }

  const questions: FinaleQuestion[] = generated.map((q) => ({
    type: q.type,
    text: q.text,
    options: q.options,
    concept: q.concept,
  }));
  return new Response(JSON.stringify({ questions, cached: false }), {
    headers: { "Content-Type": "application/json" },
  });
}
