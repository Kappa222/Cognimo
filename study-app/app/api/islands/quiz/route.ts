import { createClient } from "../../../../lib/supabase-server";
import { getIslandContext, normalizeTitle } from "../../../../lib/chunks";
import { generateQuizQuestions, type QuizItem } from "../../../../lib/quiz-gen";

const MCQ_COUNT = 4;
const TYPED_COUNT = 2;
const MAX_TITLE_CHARS = 200;

interface PlanIsland {
  title: string;
  key_concepts?: unknown;
}

function islandConcepts(plan: unknown, islandTitle: string): string[] {
  if (!Array.isArray(plan)) return [];
  const wanted = normalizeTitle(islandTitle);
  const island = (plan as PlanIsland[]).find(
    (i) => i && typeof i.title === "string" && normalizeTitle(i.title) === wanted,
  );
  const concepts = island?.key_concepts;
  if (!Array.isArray(concepts)) return [];
  return (concepts as unknown[])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());
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
  const { topicId, islandTitle } = body;
  if (
    typeof topicId !== "string" || !topicId ||
    typeof islandTitle !== "string" || !islandTitle.trim() ||
    islandTitle.length > MAX_TITLE_CHARS
  ) {
    return new Response("topicId and islandTitle required", { status: 400 });
  }
  const title = islandTitle.trim();

  const { data: topic } = await supabase
    .from("topics")
    .select("id, name")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .single();
  if (!topic) return new Response("Topic not found", { status: 404 });

  // Determinism: a stored quiz is served as-is on every later visit.
  const { data: stored } = await supabase
    .from("island_quizzes")
    .select("questions")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .eq("island_title", title)
    .maybeSingle();
  if (stored && Array.isArray(stored.questions)) {
    return new Response(
      JSON.stringify({ questions: stored.questions as QuizItem[], cached: true }),
      { headers: { "Content-Type": "application/json" } },
    );
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
  const keyConcepts = islandConcepts(plan, title);
  if (keyConcepts.length === 0) {
    return new Response("Island not found in plan", { status: 404 });
  }

  const materialText = await getIslandContext(supabase, topicId, {
    islandTitle: title,
    keyConcepts,
    plan,
  });

  let questions: QuizItem[];
  try {
    questions = await generateQuizQuestions({
      materialText,
      topicName: topic.name ?? "ez a téma",
      scopeLabel: title,
      keyConcepts,
      mcqCount: MCQ_COUNT,
      typedCount: TYPED_COUNT,
    });
  } catch {
    return new Response("AI service unavailable", { status: 503 });
  }

  const { error: insertError } = await supabase.from("island_quizzes").insert({
    user_id: user.id,
    topic_id: topicId,
    island_title: title,
    questions: questions as unknown as Record<string, unknown>[],
  });
  if (insertError) {
    // Lost a generation race (unique constraint): serve the winner's set so
    // concurrent first-entries still converge on one identical quiz.
    const { data: raced } = await supabase
      .from("island_quizzes")
      .select("questions")
      .eq("user_id", user.id)
      .eq("topic_id", topicId)
      .eq("island_title", title)
      .maybeSingle();
    if (raced && Array.isArray(raced.questions)) {
      return new Response(
        JSON.stringify({ questions: raced.questions as QuizItem[], cached: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    console.error("Island quiz insert failed:", insertError);
    return new Response("Failed to save quiz", { status: 500 });
  }

  return new Response(JSON.stringify({ questions, cached: false }), {
    headers: { "Content-Type": "application/json" },
  });
}
