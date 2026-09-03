import { createClient } from "../../../../lib/supabase-server";
import { NextResponse } from "next/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: material, error: fetchError } = await supabase
    .from("study_materials")
    .select("file_url")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError) {
    console.error("Material fetch failed:", fetchError);
    return NextResponse.json({ error: "Nem sikerült betölteni a tananyagot." }, { status: 500 });
  }

  if (material?.file_url) {
    // Derive the storage key defensively: old rows may contain raw spaces,
    // accents, or percent-encoded segments in the filename part.
    try {
      const urlObj = new URL(material.file_url);
      const marker = "/materials/";
      const rawPath = urlObj.pathname.split(marker)[1];
      if (rawPath) {
        let filePath = rawPath;
        try {
          filePath = decodeURIComponent(rawPath);
        } catch {
          // Keep the raw path if it is not valid percent-encoding.
        }
        const { error: removeError } = await supabase.storage.from("materials").remove([filePath]);
        if (removeError) console.error("Storage remove failed:", removeError);
      }
    } catch (err) {
      console.error("Storage cleanup skipped (unparseable file_url):", err);
    }
  }

  const { error } = await supabase
    .from("study_materials")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Material delete failed:", error);
    return NextResponse.json({ error: "Nem sikerült törölni a tananyagot." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
