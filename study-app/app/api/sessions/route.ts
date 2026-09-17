import { createClient } from "../../../lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topic_id");

  if (!topicId) {
    return NextResponse.json({ error: "topic_id query parameter required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("topic_id", topicId)
    .eq("status", "in_progress")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? null);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { topic_id?: unknown; subject_id?: unknown; plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { topic_id, subject_id, plan } = body;

  if (typeof topic_id !== "string" || !topic_id || typeof subject_id !== "string" || !subject_id) {
    return NextResponse.json({ error: "topic_id and subject_id required" }, { status: 400 });
  }

  // The topic must belong to the caller — otherwise plans could be attached
  // to anyone's topic.
  const { data: topic } = await supabase
    .from("topics")
    .select("id")
    .eq("id", topic_id)
    .eq("user_id", user.id)
    .single();
  if (!topic) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

  // Validate plan shape instead of storing it verbatim (unbounded garbage
  // would break island rendering and chunk mapping downstream).
  let totalCheckpoints = 7;
  let safePlan: unknown = null;
  if (plan !== undefined) {
    if (!Array.isArray(plan) || plan.length === 0 || plan.length > 50) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    for (const island of plan) {
      if (
        !island || typeof island !== "object" ||
        typeof (island as { title?: unknown }).title !== "string" ||
        !Array.isArray((island as { key_concepts?: unknown }).key_concepts)
      ) {
        return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
      }
    }
    totalCheckpoints = plan.length;
    safePlan = plan;
  }

  // One in-progress session per topic: abandon stale ones so resume never
  // picks the wrong session.
  await supabase
    .from("chat_sessions")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("topic_id", topic_id)
    .eq("status", "in_progress");

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    subject_id,
    topic_id,
    method: "study",
    current_checkpoint: 0,
    total_checkpoints: totalCheckpoints,
    status: "in_progress",
  };

  if (safePlan) {
    insertData.plan = safePlan;
  }

  const { data, error } = await supabase
    .from("chat_sessions")
    .insert(insertData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
