import { requireUser } from "../../../../../lib/api-auth";
import { readJsonBody, jsonBodyError } from "../../../../../lib/http";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id } = await params;

  const read = await readJsonBody(req);
  if (!read.ok) return jsonBodyError(read.reason);
  const body = read.body;

  const { role, content } = body;

  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ error: "role must be 'user' or 'assistant'" }, { status: 400 });
  }

  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > 10000
  ) {
    return NextResponse.json(
      { error: "content must be 1-10000 characters" },
      { status: 400 },
    );
  }

  // Ownership gate: messages can only attach to the caller's own session.
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  // Simple per-session rate limit: max 30 messages per minute.
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id)
    .gt("created_at", minuteAgo);
  if ((count ?? 0) >= 30) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: id,
      role,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error("Message insert failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
