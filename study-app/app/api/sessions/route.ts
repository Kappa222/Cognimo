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

  const { topic_id, subject_id, plan } = await req.json();

  if (!topic_id || !subject_id) {
    return NextResponse.json({ error: "topic_id and subject_id required" }, { status: 400 });
  }

  const insertData: Record<string, unknown> = {
    user_id: user.id,
    subject_id,
    topic_id,
    method: "study",
    current_checkpoint: 0,
    total_checkpoints: Array.isArray(plan) ? plan.length : 7,
    status: "in_progress",
  };

  if (plan) {
    insertData.plan = plan;
  }

  const { data, error } = await supabase
    .from("chat_sessions")
    .insert(insertData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
