import { createClient, getAdminClient } from "../../../lib/supabase-server";

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: materials } = await supabase
    .from("study_materials")
    .select("file_url")
    .eq("user_id", user.id)
    .not("file_url", "is", null);

  if (materials && materials.length > 0) {
    const filePaths: string[] = [];
    for (const mat of materials) {
      if (mat.file_url) {
        const match = mat.file_url.match(/\/materials\/(.+)$/);
        if (match) filePaths.push(match[1]);
      }
    }
    if (filePaths.length > 0) {
      await supabase.storage.from("materials").remove(filePaths);
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Server not configured for account deletion", { status: 500 });
  }

  const adminSupabase = getAdminClient();
  const { error } = await adminSupabase.auth.admin.deleteUser(user.id);
  if (error) return new Response(error.message, { status: 500 });

  return Response.json({ success: true });
}
