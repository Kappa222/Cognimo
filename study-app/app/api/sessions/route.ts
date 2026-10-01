import { requireUser } from "../../../lib/api-auth";
import { readJsonBody, jsonBodyError } from "../../../lib/http";
import { validatePlan } from "../../../lib/plan";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topic_id");
  // Optional status filter; defaults to in_progress (resume flow). The learn
  // page passes status=any to also find completed sessions for island review.
  const statusParam = searchParams.get("status");
  const statusFilter =
    statusParam === "any" || statusParam === null ? statusParam : "in_progress";

  if (!topicId) {
    return NextResponse.json({ error: "topic_id query parameter required" }, { status: 400 });
  }

  let query = supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("topic_id", topicId);
  if (statusFilter !== "any") {
    query = query.eq("status", statusFilter);
  }
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Session query failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(data ?? null);
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const read = await readJsonBody(req);
  if (!read.ok) return jsonBodyError(read.reason);
  const body = read.body;
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
    const checked = validatePlan(plan);
    if (!checked) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    totalCheckpoints = checked.length;
    safePlan = checked;
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

  if (error) {
    console.error("Session insert failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
