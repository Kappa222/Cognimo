"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import ProgressRoadmap from "../../components/ProgressRoadmap";
import StatisticsTab from "../../components/StatisticsTab";

const FALLBACK_TOTAL_CHECKPOINTS = 7;

interface Topic {
  id: string;
  name: string;
  description: string | null;
  subject_id: string;
}

interface Subject {
  id: string;
  name: string;
}

interface Material {
  id: string;
  title: string;
  file_type: "text" | "pdf";
}

const tabs = ["Tanulj", "Kvíz", "Statisztika"] as const;
type Tab = (typeof tabs)[number];

export default function TopicDetailPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Tanulj");
  const [currentCheckpoint, setCurrentCheckpoint] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");
  const [islandTitles, setIslandTitles] = useState<string[] | undefined>(undefined);

  const loadData = useCallback(async (userId?: string) => {
    const { data: t, error: topicErr } = await supabase
      .from("topics")
      .select("*")
      .eq("id", topicId)
      .single();
    if (topicErr) { setError("Nem sikerült betölteni a témát."); return; }
    setTopic(t);

    const { data: s, error: subjErr } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("id", t.subject_id)
      .single();
    if (subjErr) { setError("Nem sikerült betölteni a tantárgyat."); return; }
    if (s) setSubject(s);

    const { data: m } = await supabase
      .from("study_materials")
      .select("id, title, file_type")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: false });
    if (m) setMaterials(m);

    const { data: latestSession } = await supabase
      .from("chat_sessions")
      .select("id, current_checkpoint, plan")
      .eq("topic_id", topicId)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (latestSession) {
      setCurrentCheckpoint(latestSession.current_checkpoint);

      const ls = latestSession as { id: string; current_checkpoint: number; plan?: unknown };
      // Load islands from plan column (new) or fallback to __ISLANDS__: message (old)
      if (ls.plan && Array.isArray(ls.plan) && ls.plan.length > 0) {
        const islands = ls.plan as { title: string }[];
        setIslandTitles(islands.map((i: { title: string }) => i.title));
      } else {
        const msgRes = await fetch(`/api/sessions/${ls.id}`);
        if (msgRes.ok) {
          const { messages } = await msgRes.json();
          const islandMsg = messages.find(
            (m: { role: string; content: string }) =>
              m.role === "assistant" && m.content.startsWith("__ISLANDS__:"),
          );
          if (islandMsg) {
            try {
              const islands: { title: string }[] = JSON.parse(islandMsg.content.slice(11));
              setIslandTitles(islands.map((i) => i.title));
            } catch { /* ignore */ }
          }
        }
      }
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single();
    if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
  }, [topicId]);

  const initPage = useCallback(async () => {
    setPageLoading(true);
    setError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    await loadData(user.id);
    setPageLoading(false);
  }, [router, loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initPage();
  }, [initPage]);

  const totalCheckpoints = islandTitles ? islandTitles.length : FALLBACK_TOTAL_CHECKPOINTS;

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

  if (!topic || !subject) return null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href={`/subjects/${subject.id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent"
      >
        ← Vissza a témákhoz
      </Link>

      <div className="mb-6">
        <p className="text-sm text-zinc-400">{subject.name}</p>
        <h1 className="text-2xl font-bold tracking-tight">{topic.name}</h1>
        {topic.description && (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {topic.description}
          </p>
        )}
      </div>

      {materials.length > 0 && avatarUrl && (
        <div className="mb-10">
          <ProgressRoadmap
            topicName={topic.name}
            currentCheckpoint={currentCheckpoint}
            totalCheckpoints={totalCheckpoints}
            avatarUrl={avatarUrl}
            topicId={topicId}
            islandTitles={islandTitles}
          />
        </div>
      )}

      <div className="mb-6">
        <Link
          href={`/topics/${topicId}/materials`}
          className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
        >
          Tananyagok kezelése
        </Link>
      </div>

      <div className="mb-8 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === t
                ? "border-b-2 border-accent text-accent"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Tanulj" && (
        <div key="tanulj" className="flex flex-col gap-6 animate-fade-in-up">
          {materials.length > 0 ? (
            <>
              <div>
                <h2 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                  Tananyagok ({materials.length})
                </h2>
                <div className="grid gap-2">
                  {materials.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
                    >
                      <span>{m.file_type === "pdf" ? "📄" : "📝"}</span>
                      <span className="text-sm font-medium">{m.title}</span>
                    </div>
                  ))}
                </div>
              </div>

              {currentCheckpoint === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
                  <p className="mb-1 text-zinc-500">Készen állsz tanulni?</p>
                  <p className="mb-4 text-xs text-zinc-400">
                    Lumi elemzi a tananyagot, és egyedi tanulási tervet készít.
                  </p>
                  <Link
                    href={`/topics/${topicId}/learn`}
                    className="inline-block cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
                  >
                    📚 Indíts tanulást
                  </Link>
                </div>
              )}

              {currentCheckpoint > 0 && currentCheckpoint < totalCheckpoints && islandTitles && (
                <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
                  <p className="text-sm text-zinc-500">
                    <span className="font-medium text-accent">Folytatás</span> — következő rész:
                  </p>
                  <p className="mt-1 text-base font-semibold">
                    {islandTitles[currentCheckpoint]}
                  </p>
                </div>
              )}

              {currentCheckpoint === totalCheckpoints && (
                <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
                  <p className="text-sm text-zinc-500">Minden részt teljesítettél! 🎉</p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
              <p className="mb-1 text-zinc-500">Még nincs tananyagod</p>
              <p className="mb-4 text-xs text-zinc-400">
                Adj hozzá tananyagot a témához a tanulás megkezdéséhez.
              </p>
              <Link
                href={`/topics/${topicId}/materials`}
                className="inline-block cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
              >
                Tananyag hozzáadása
              </Link>
            </div>
          )}
        </div>
      )}

      {activeTab === "Kvíz" && (
        <div key="kviz" className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700 animate-fade-in-up">
          <p className="mb-1 text-zinc-500">Kvíz funkció</p>
          <p className="text-xs text-zinc-400">Hamarosan elérhető...</p>
        </div>
      )}

      {activeTab === "Statisztika" && (
        <StatisticsTab topicId={topicId} />
      )}
    </div>
  );
}
