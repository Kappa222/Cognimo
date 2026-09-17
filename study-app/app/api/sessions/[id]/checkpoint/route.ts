import { createClient } from "../../../../../lib/supabase-server";
import { NextResponse } from "next/server";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: {
    current_checkpoint?: unknown;
    status?: unknown;
    island_step?: unknown;
    assess_state?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { current_checkpoint, status, island_step, assess_state } = body;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // current_checkpoint is required for progress advances, but optional for
  // pure assess-state writes (e.g. saving round results without moving).
  if (current_checkpoint !== undefined) {
    if (
      typeof current_checkpoint !== "number" ||
      !Number.isInteger(current_checkpoint) ||
      current_checkpoint < 0
    ) {
      return NextResponse.json(
        { error: "current_checkpoint must be a non-negative integer" },
        { status: 400 },
      );
    }
    updateData.current_checkpoint = current_checkpoint;
  }

  if (status !== undefined) {
    if (
      status !== "in_progress" &&
      status !== "completed" &&
      status !== "abandoned"
    ) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updateData.status = status;
  }

  if (island_step !== undefined) {
    // Explicit null clears back to teach for the next island.
    if (
      island_step !== null &&
      island_step !== "teach" &&
      island_step !== "assess" &&
      island_step !== "remediation"
    ) {
      return NextResponse.json({ error: "Invalid island_step" }, { status: 400 });
    }
    updateData.island_step = island_step ?? "teach";
  }

  if (assess_state !== undefined) {
    // Explicit null clears stale assess state when advancing islands.
    updateData.assess_state = assess_state;
  }

  if (Object.keys(updateData).length <= 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chat_sessions")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
