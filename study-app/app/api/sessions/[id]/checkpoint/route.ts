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
  const { current_checkpoint, status, island_step, assess_state } = await req.json();

  if (current_checkpoint === undefined) {
    return NextResponse.json({ error: "current_checkpoint required" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    current_checkpoint,
    updated_at: new Date().toISOString(),
  };

  if (status) {
    updateData.status = status;
  }

  if (island_step) {
    updateData.island_step = island_step;
  }

  if (assess_state) {
    updateData.assess_state = assess_state;
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
