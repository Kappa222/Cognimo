import { createClient } from "../../../lib/supabase-server";
import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { chunkText, MAX_PDF_BYTES, MAX_PDF_PAGES, MIN_READABLE_CHARS } from "../../../lib/chunks";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const topicId = searchParams.get("topic_id");

  let query = supabase
    .from("study_materials")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (topicId) {
    query = query.eq("topic_id", topicId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const subjectId = formData.get("subject_id") as string;
    const topicId = formData.get("topic_id") as string;
    const title = formData.get("title") as string;
    const file = formData.get("file") as File;

    if (!subjectId || !topicId || !title || !file) {
      return NextResponse.json({ error: "Hiányzó mezők" }, { status: 400 });
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Csak PDF fájl tölthető fel" }, { status: 400 });
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "A PDF túl nagy (maximum 25 MB)" }, { status: 413 });
    }

    const filePath = `${user.id}/${topicId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("materials")
      .upload(filePath, file, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from("materials")
      .getPublicUrl(filePath);

    let extractedText = "";
    let pageCount = 0;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfInstance = new PDFParse({ data: buffer });
      const result = await pdfInstance.getText();
      pageCount = result.pages.length;
      extractedText = result.pages.map((p: { text: string }) => p.text).join("\n\n");
    } catch (err) {
      console.error("PDF text extraction failed:", err);
    }

    if (pageCount > MAX_PDF_PAGES) {
      await supabase.storage.from("materials").remove([filePath]);
      return NextResponse.json({ error: "A PDF túl hosszú (maximum 300 oldal)" }, { status: 413 });
    }

    const { data, error } = await supabase
      .from("study_materials")
      .insert({
        user_id: user.id,
        subject_id: subjectId,
        topic_id: topicId,
        title,
        file_url: urlData.publicUrl,
        file_type: "pdf",
        content: extractedText || null,
      })
      .select()
      .single();

    if (error) {
      await supabase.storage.from("materials").remove([filePath]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Chunk the extracted text for per-island retrieval. Chunking is pure
    // string splitting; a failure here must not fail the upload since the
    // full text in `content` keeps the legacy path working.
    try {
      const chunks = chunkText(extractedText);
      if (chunks.length > 0) {
        const { error: chunkError } = await supabase
          .from("material_chunks")
          .insert(chunks.map((content, idx) => ({
            material_id: data.id,
            user_id: user.id,
            idx,
            content,
          })));
        if (chunkError) console.error("Chunk insert failed:", chunkError);
      }
    } catch (err) {
      console.error("Chunking failed:", err);
    }

    const warning = extractedText.trim().length < MIN_READABLE_CHARS
      ? "SHORT_EXTRACTION"
      : null;

    return NextResponse.json({ material: data, warning }, { status: 201 });
  }

  const { subject_id, topic_id, title, content } = await req.json();

  if (!subject_id || !topic_id || !title || !content) {
    return NextResponse.json({ error: "Hiányzó mezők" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("study_materials")
    .insert({
      user_id: user.id,
      subject_id,
      topic_id,
      title,
      content,
      file_type: "text",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Single chunk so per-island retrieval works uniformly for pasted text.
  try {
    const chunks = chunkText(content);
    if (chunks.length > 0) {
      const { error: chunkError } = await supabase
        .from("material_chunks")
        .insert(chunks.map((chunk, idx) => ({
          material_id: data.id,
          user_id: user.id,
          idx,
          content: chunk,
        })));
      if (chunkError) console.error("Chunk insert failed:", chunkError);
    }
  } catch (err) {
    console.error("Chunking failed:", err);
  }

  return NextResponse.json({ material: data, warning: null }, { status: 201 });
}
