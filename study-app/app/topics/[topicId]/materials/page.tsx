"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import ConfirmModal from "../../../components/ConfirmModal";

interface Material {
  id: string;
  title: string;
  file_type: "text" | "pdf";
  content: string | null;
  file_url: string | null;
  created_at: string;
}

type QueuedPdfStatus = "pending" | "uploading" | "done" | "error";

interface QueuedPdf {
  id: string;
  file: File;
  title: string;
  size: number;
  status: QueuedPdfStatus;
  error: string;
  warning: boolean;
}

const MAX_BATCH_FILES = 10;
const MAX_PDF_BYTES_CLIENT = 25 * 1024 * 1024;
const MAX_TITLE_CHARS = 80;

function sanitizePdfTitle(filename: string): string {
  const withoutExt = filename.replace(/\.pdf$/i, "").trim();
  const cleaned = withoutExt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Névtelen PDF";
  return cleaned.length > MAX_TITLE_CHARS
    ? cleaned.slice(0, MAX_TITLE_CHARS).trimEnd()
    : cleaned;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let queuedPdfCounter = 0;
function nextQueuedPdfId(): string {
  queuedPdfCounter += 1;
  return `pdf-${Date.now()}-${queuedPdfCounter}`;
}

interface Topic {
  id: string;
  name: string;
  subject_id: string;
}

export default function MaterialsPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tab, setTab] = useState<"text" | "pdf">("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [queue, setQueue] = useState<QueuedPdf[]>([]);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfResult, setPdfResult] = useState<{ success: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteMatId, setDeleteMatId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [uploadWarning, setUploadWarning] = useState(false);
  const [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const { data: t, error: topicErr } = await supabase
      .from("topics")
      .select("id, name, subject_id")
      .eq("id", topicId)
      .single();
    if (topicErr) { setError("Nem sikerült betölteni a témát."); return; }
    if (t) setTopic(t);

    const { data: m, error: matErr } = await supabase
      .from("study_materials")
      .select("*")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: false });
    if (matErr) { setError("Nem sikerült betölteni a tananyagokat."); return; }
    if (m) setMaterials(m);
  }, [topicId]);

  const initPage = useCallback(async () => {
    setPageLoading(true);
    setError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    await loadData();
    setPageLoading(false);
  }, [router, loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initPage();
  }, [initPage]);

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || !topic) return;
    setLoading(true);

    const res = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_id: topic.subject_id,
        topic_id: topicId,
        title: title.trim(),
        content: content.trim(),
      }),
    });

    setTitle("");
    setContent("");
    setLoading(false);
    setUploadWarning(false);
    if (res.ok) {
      setFormError("");
      setJustAdded(true);
    } else {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      setFormError(body?.error ?? "Nem sikerült menteni a tananyagot.");
    }
    await loadData();
  };

  const addPdfFiles = (files: File[]) => {
    if (files.length === 0) return;
    const room = Math.max(0, MAX_BATCH_FILES - queue.length);
    if (room <= 0) {
      setFormError(`Maximum ${MAX_BATCH_FILES} fájl tölthető fel egyszerre.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (files.length > room) {
      setFormError(`Maximum ${MAX_BATCH_FILES} fájl tölthető fel egyszerre — az első ${room} lett hozzáadva.`);
    } else {
      setFormError("");
    }
    setPdfResult(null);
    const next: QueuedPdf[] = files.slice(0, room).map((file) => {
      const nameOk = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      if (!nameOk) {
        return {
          id: nextQueuedPdfId(),
          file,
          title: sanitizePdfTitle(file.name),
          size: file.size,
          status: "error" as QueuedPdfStatus,
          error: "Csak PDF fájl tölthető fel",
          warning: false,
        };
      }
      if (file.size > MAX_PDF_BYTES_CLIENT) {
        return {
          id: nextQueuedPdfId(),
          file,
          title: sanitizePdfTitle(file.name),
          size: file.size,
          status: "error" as QueuedPdfStatus,
          error: "A PDF túl nagy (maximum 25 MB)",
          warning: false,
        };
      }
      return {
        id: nextQueuedPdfId(),
        file,
        title: sanitizePdfTitle(file.name),
        size: file.size,
        status: "pending" as QueuedPdfStatus,
        error: "",
        warning: false,
      };
    });
    setQueue((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateQueuedTitle = useCallback((id: string, newTitle: string) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, title: newTitle } : q)));
  }, []);

  const removeQueuedPdf = useCallback((id: string) => {
    setQueue((prev) => {
      const target = prev.find((q) => q.id === id);
      if (!target || target.status === "uploading") return prev;
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const clearFinishedQueue = useCallback(() => {
    setQueue((prev) => prev.filter((q) => q.status === "pending" || q.status === "uploading"));
    setPdfResult(null);
  }, []);

  const uploadSinglePdf = useCallback(async (
    item: QueuedPdf,
    subjectId: string,
  ): Promise<{ ok: boolean; warning: boolean; error: string }> => {
    const resolvedTitle = item.title.trim() || sanitizePdfTitle(item.file.name);
    const formData = new FormData();
    formData.append("subject_id", subjectId);
    formData.append("topic_id", topicId as string);
    formData.append("title", resolvedTitle);
    formData.append("file", item.file);
    try {
      const res = await fetch("/api/materials", { method: "POST", body: formData });
      if (res.ok) {
        const body = await res.json().catch(() => null) as { warning?: string } | null;
        return { ok: true, warning: body?.warning === "SHORT_EXTRACTION", error: "" };
      }
      const body = await res.json().catch(() => null) as { error?: string } | null;
      return { ok: false, warning: false, error: body?.error ?? "Nem sikerült feltölteni a PDF-et." };
    } catch {
      return { ok: false, warning: false, error: "Nem sikerült feltölteni a PDF-et. Próbáld újra!" };
    }
  }, [topicId]);

  const handlePdfUpload = useCallback(async () => {
    if (!topic || pdfUploading) return;
    // Client-invalid rows stay as errors; retry only server failures plus pending.
    const pendingIds = new Set(queue.filter((q) => q.status === "pending").map((q) => q.id));
    const retryIds = new Set(
      queue
        .filter((q) => q.status === "error" && q.error !== "Csak PDF fájl tölthető fel" && q.error !== "A PDF túl nagy (maximum 25 MB)")
        .map((q) => q.id),
    );
    const idsToRun = new Set([...pendingIds, ...retryIds]);
    if (idsToRun.size === 0 || !topic) return;

    setPdfUploading(true);
    setFormError("");
    setPdfResult(null);
    setUploadWarning(false);

    // Reset retryable errors back to pending for a clean run.
    setQueue((prev) => prev.map((q) => (retryIds.has(q.id) ? { ...q, status: "pending" as QueuedPdfStatus, error: "" } : q)));

    let success = 0;
    let failed = 0;
    let warned = false;

    const runIds = Array.from(idsToRun);
    const snapshot = new Map(queue.map((q) => [q.id, q]));

    for (const id of runIds) {
      const item = snapshot.get(id);
      if (!item) continue;
      setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "uploading" as QueuedPdfStatus, error: "" } : q)));
      const result = await uploadSinglePdf(item, topic.subject_id);
      if (result.ok) {
        success += 1;
        if (result.warning) warned = true;
        const finalTitle = item.title.trim() || sanitizePdfTitle(item.file.name);
        setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "done" as QueuedPdfStatus, title: finalTitle, warning: result.warning, error: "" } : q)));
      } else {
        failed += 1;
        setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "error" as QueuedPdfStatus, error: result.error } : q)));
      }
    }

    setPdfUploading(false);
    setPdfResult({ success, failed });
    setUploadWarning(warned);
    if (success > 0) {
      setFormError("");
      setJustAdded(true);
    }
    await loadData();
  }, [topic, pdfUploading, queue, uploadSinglePdf, loadData]);

  const retryQueuedPdf = useCallback(async (id: string) => {
    if (!topic || pdfUploading) return;
    const item = queue.find((q) => q.id === id);
    if (!item || item.status !== "error") return;
    if (item.error === "Csak PDF fájl tölthető fel" || item.error === "A PDF túl nagy (maximum 25 MB)") return;
    setPdfUploading(true);
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "uploading" as QueuedPdfStatus, error: "" } : q)));
    const result = await uploadSinglePdf(item, topic.subject_id);
    if (result.ok) {
      const finalTitle = item.title.trim() || sanitizePdfTitle(item.file.name);
      setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "done" as QueuedPdfStatus, title: finalTitle, warning: result.warning, error: "" } : q)));
      setPdfResult((prev) => ({ success: (prev?.success ?? 0) + 1, failed: prev?.failed ?? 0 }));
      setJustAdded(true);
      if (result.warning) setUploadWarning(true);
    } else {
      setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: "error" as QueuedPdfStatus, error: result.error } : q)));
      setPdfResult((prev) => ({ success: prev?.success ?? 0, failed: (prev?.failed ?? 0) + 1 }));
    }
    setPdfUploading(false);
    await loadData();
  }, [topic, pdfUploading, queue, uploadSinglePdf, loadData]);

  const handleDelete = async () => {
    if (!deleteMatId) return;
    await fetch(`/api/materials/${deleteMatId}`, { method: "DELETE" });
    setDeleteMatId(null);
    await loadData();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
          <p className="text-sm text-zinc-500">Betöltés...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => initPage()}
            className="mt-4 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all hover:bg-violet-700"
          >
            Újra
          </button>
        </div>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">A téma nem található.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href={`/topics/${topicId}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent"
      >
        ← Vissza a témához
      </Link>

      <h1 className="mb-2 text-2xl font-bold tracking-tight">{topic.name}</h1>
      <p className="mb-8 text-sm text-zinc-500">Tananyagok</p>

      <div className="mb-8 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setTab("text")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "text"
              ? "border-b-2 border-accent text-accent"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Szöveg
        </button>
        <button
          onClick={() => setTab("pdf")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "pdf"
              ? "border-b-2 border-accent text-accent"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          PDF
        </button>
      </div>

      {formError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {formError}
        </div>
      )}

      {uploadWarning && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          ⚠️ A PDF szövege nem vagy alig kinyerhető (pl. szkennelt dokumentum). Lumi nem fogja tudni használni a tanuláshoz — érdemes szövegként bemásolni a tartalmat.
        </div>
      )}

      {tab === "text" ? (
        <form
          onSubmit={handleTextSubmit}
          className="mb-10 rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
        >
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Cím"
              required
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              placeholder="Illeszd be a tananyag szövegét..."
              rows={8}
              required
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="self-start cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Mentés..." : "Hozzáadás"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-10 rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addPdfFiles(Array.from(e.dataTransfer.files ?? []));
              }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all duration-200 ${
                dragOver
                  ? "border-accent bg-accent/5 shadow-md"
                  : "border-zinc-300 hover:border-accent/50 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
              }`}
            >
              <p className="mb-1 text-2xl">📄</p>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Húzd ide a PDF-eket vagy kattints a kiválasztáshoz
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Több fájl is választható (max {MAX_BATCH_FILES}, egyenként max 25 MB). A cím automatikus, szerkeszthető.
              </p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => addPdfFiles(Array.from(e.target.files ?? []))}
            />

            {queue.length > 0 && (
              <div className="flex flex-col gap-2">
                {(() => {
                  const done = queue.filter((q) => q.status === "done").length;
                  const total = queue.length;
                  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
                  return (
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-medium text-zinc-500">
                        {pdfUploading ? `Feltöltés: ${done}/${total}` : `${done}/${total} kész`}
                      </p>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-300"
                          style={{ width: `${pdfUploading || done > 0 ? pct : 0}%` }}
                        />
                      </div>
                      {!pdfUploading && queue.some((q) => q.status === "done" || q.status === "error") && (
                        <button
                          type="button"
                          onClick={clearFinishedQueue}
                          className="cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                        >
                          Lista törlése
                        </button>
                      )}
                    </div>
                  );
                })()}

                {queue.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                      item.status === "done"
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                        : item.status === "error"
                          ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                          : item.status === "uploading"
                            ? "border-accent/40 bg-accent/5"
                            : "border-zinc-200/60 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-sm dark:bg-violet-950/50">
                      {item.status === "done" ? "✅" : item.status === "uploading" ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
                      ) : item.status === "error" ? "❌" : "📄"}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <input
                        type="text"
                        value={item.title}
                        disabled={item.status === "uploading" || item.status === "done"}
                        onChange={(e) => updateQueuedTitle(item.id, e.target.value)}
                        aria-label="PDF címe"
                        className="w-full truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium outline-none transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 disabled:opacity-70 dark:focus:bg-zinc-800"
                      />
                      <p className="px-1 text-xs text-zinc-400">
                        {formatFileSize(item.size)}
                        {item.status === "uploading" && " · Feltöltés..."}
                        {item.status === "done" && " · Feltöltve"}
                        {item.warning && item.status === "done" && " · ⚠️ alig kinyerhető szöveg"}
                      </p>
                      {item.status === "uploading" && (
                        <div className="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className="h-full w-1/2 animate-pulse rounded-full bg-accent" />
                        </div>
                      )}
                      {item.status === "error" && (
                        <p className="px-1 text-xs text-red-600 dark:text-red-400">{item.error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.status === "error" &&
                        item.error !== "Csak PDF fájl tölthető fel" &&
                        item.error !== "A PDF túl nagy (maximum 25 MB)" && (
                          <button
                            type="button"
                            onClick={() => retryQueuedPdf(item.id)}
                            disabled={pdfUploading}
                            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition-all hover:bg-violet-50 disabled:opacity-50 dark:hover:bg-violet-950/50"
                          >
                            Újra
                          </button>
                        )}
                      {item.status !== "uploading" && (
                        <button
                          type="button"
                          onClick={() => removeQueuedPdf(item.id)}
                          aria-label="Eltávolítás a listáról"
                          className="cursor-pointer rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pdfResult && !pdfUploading && (
              <div className={`rounded-xl border px-4 py-2 text-sm ${
                pdfResult.failed === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : pdfResult.success === 0
                    ? "border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              }`}>
                {pdfResult.failed === 0
                  ? `✅ ${pdfResult.success} PDF sikeresen feltöltve.`
                  : pdfResult.success === 0
                    ? `❌ ${pdfResult.failed} PDF feltöltése sikertelen.`
                    : `✅ ${pdfResult.success} sikeres · ❌ ${pdfResult.failed} sikertelen.`}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePdfUpload}
                disabled={pdfUploading || !queue.some((q) => q.status === "pending" || (q.status === "error" && q.error !== "Csak PDF fájl tölthető fel" && q.error !== "A PDF túl nagy (maximum 25 MB)"))}
                className="cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {pdfUploading
                  ? "Feltöltés..."
                  : `Feltöltés (${queue.filter((q) => q.status === "pending").length})`}
              </button>
              {queue.length > 0 && !pdfUploading && (
                <p className="text-xs text-zinc-400">A címek a fájlnevekből jönnek, kattints a címre a szerkesztéshez.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {materials.length === 0 && !justAdded ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-500 dark:text-zinc-400">
            Még nincs tananyagod ehhez a témához.
          </p>
        </div>
      ) : (
        <>
          {justAdded && (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
              <p className="mb-1 font-medium text-green-700 dark:text-green-300">Tananyag elmentve!</p>
              <p className="mb-3 text-xs text-green-600 dark:text-green-400">
                Most már elkezdheted a tanulást ezzel az anyaggal.
              </p>
              <Link
                href={`/topics/${topicId}/learn`}
                className="inline-block cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
              >
                📚 Indíts tanulást
              </Link>
            </div>
          )}
          {materials.length > 0 && (
            <div className="grid gap-3">
              {materials.map((material) => (
                <div key={material.id}>
                  <div className="flex items-center justify-between rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md dark:border-zinc-800/60 dark:bg-zinc-900 dark:hover:border-accent/40">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-sm dark:bg-violet-950/50">
                        {material.file_type === "pdf" ? "📄" : "📝"}
                      </span>
                      <div>
                        <h3 className="font-medium">
                          {material.title}{" "}
                          {(!material.content || material.content.trim().length < 500) && (
                            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              ⚠️ Nem olvasható
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-zinc-400">
                          {material.file_type === "pdf" ? "PDF" : "Szöveg"} ·{" "}
                          {formatDate(material.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {material.file_type === "text" ? (
                        <button
                          onClick={() =>
                            setExpandedId(
                              expandedId === material.id ? null : material.id,
                            )
                          }
                          className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-50 hover:shadow-sm active:scale-[0.98] dark:hover:bg-violet-950/50"
                        >
                          {expandedId === material.id ? "Elrejt" : "Megtekint"}
                        </button>
                      ) : material.file_url ? (
                        <a
                          href={material.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-50 hover:shadow-sm active:scale-[0.98] dark:hover:bg-violet-950/50"
                        >
                          Megnyitás
                        </a>
                      ) : null}
                      <button
                        onClick={() => setDeleteMatId(material.id)}
                        aria-label="Törlés"
                        className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-50 hover:shadow-sm active:scale-[0.98] dark:hover:bg-red-950/50"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      expandedId === material.id && material.content
                        ? "max-h-[2000px] opacity-100"
                        : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="mt-1 rounded-b-xl border-x border-b border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900/50">
                      {material.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={!!deleteMatId}
        title="Tananyag törlése"
        message="Biztosan törlöd ezt a tananyagot? Ez a művelet nem vonható vissza."
        confirmLabel="Törlés"
        onConfirm={handleDelete}
        onCancel={() => setDeleteMatId(null)}
      />
    </div>
  );
}
