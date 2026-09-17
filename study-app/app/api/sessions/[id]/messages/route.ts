import { createClient } from "../../../../../lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { role?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
