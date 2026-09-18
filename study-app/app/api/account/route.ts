import { createClient, getAdminClient } from "../../../lib/supabase-server";

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Fail fast before any destructive work: without the service key the auth
  // user cannot be deleted, and removing Storage files first would leave a
  // half-deleted account.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Account deletion unavailable: SUPABASE_SERVICE_ROLE_KEY missing");
    return new Response(
      "A fióktörlés most nem elérhető (szerver nincs beállítva). Próbáld újra később!",
      { status: 503 },
    );
  }

  const { data: materials } = await supabase
    .from("study_materials")
    .select("file_url")
    .eq("user_id", user.id)
    .not("file_url", "is", null);

  if (materials && materials.length > 0) {
    const filePaths: string[] = [];
    for (const mat of materials) {
      if (!mat.file_url) continue;
      // Defensive parse (same as DELETE /api/materials/[id]): old rows may
      // contain spaces, accents, or percent-encoded segments.
      try {
        const urlObj = new URL(mat.file_url);
        const rawPath = urlObj.pathname.split("/materials/")[1];
        if (rawPath) {
          try {
            filePaths.push(decodeURIComponent(rawPath));
          } catch {
            filePaths.push(rawPath);
          }
        }
      } catch {
        const match = mat.file_url.match(/\/materials\/(.+)$/);
        if (match) filePaths.push(match[1]);
      }
    }
    if (filePaths.length > 0) {
      // Best-effort: Storage leftovers must not block account deletion.
      // Per-row app-layer cleanup (DELETE /api/materials/[id]) and DB
      // cascade remain the primary paths; no pg_net trigger required.
      const { error: removeError } = await supabase.storage
        .from("materials")
        .remove(filePaths);
      if (removeError) console.error("Account deletion storage cleanup failed:", removeError);
    }
  }

  const adminSupabase = getAdminClient();
  const { error } = await adminSupabase.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("Account deletion failed:", error);
    return new Response("Nem sikerült törölni a fiókot. Próbáld újra később!", { status: 500 });
  }

  return Response.json({ success: true });
}
