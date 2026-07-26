"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

interface ConceptStat {
  concept: string;
  status: string;
}

interface CompletionScreenProps {
  topicName: string;
  topicId: string;
  onRestart: () => void;
  onBack: () => void;
}

export default function CompletionScreen({
  topicName,
  topicId,
  onRestart,
  onBack,
}: CompletionScreenProps) {
  const [concepts, setConcepts] = useState<ConceptStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConcepts = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("concept_mastery")
        .select("concept, status")
        .eq("user_id", user.id)
        .eq("topic_id", topicId);
      if (data) setConcepts(data);
      setLoading(false);
    };
    fetchConcepts();
  }, [topicId]);

  const solid = concepts.filter((c) => c.status === "solid").length;
  const seen = concepts.filter((c) => c.status === "seen").length;
  const shaky = concepts.filter((c) => c.status === "shaky").length;
  const shakyConcepts = concepts.filter((c) => c.status === "shaky").map((c) => c.concept);
  const total = concepts.length;

  const xpEarned = solid * 15 + seen * 8 + shaky * 3;

  return (
    <div className="mx-auto max-w-lg animate-fade-in-up text-center">
      <div className="rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <p className="mb-2 text-4xl">🎉</p>
        <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
          Gratulálunk!
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Befejezted a &ldquo;{topicName}&rdquo; tanulást!
        </p>

        {loading ? (
          <div className="mt-6 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3">
              <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                <p className="text-xs uppercase tracking-wide text-zinc-400">
                  Kulcsfogalmak
                </p>
                <p className="text-lg font-bold text-accent">{total}</p>
              </div>
              <div className="rounded-xl border border-emerald-200/60 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                <p className="text-xs uppercase tracking-wide text-emerald-500">
                  Elsajátított (solid)
                </p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {solid} {solid === 1 ? "fogalom" : "fogalom"} &middot; +{solid * 15} XP
                </p>
              </div>
              <div className="rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
                <p className="text-xs uppercase tracking-wide text-amber-500">
                  Megértett (seen)
                </p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  {seen} {seen === 1 ? "fogalom" : "fogalom"} &middot; +{seen * 8} XP
                </p>
              </div>
              <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/30">
                <p className="text-xs uppercase tracking-wide text-red-500">
                  Gyakorlandó (shaky)
                </p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                  {shaky} {shaky === 1 ? "fogalom" : "fogalom"} &middot; +{shaky * 3} XP
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
                <p className="text-xs uppercase tracking-wide text-zinc-400">
                  Összes megszerzett XP
                </p>
                <p className="text-lg font-bold text-amber-500">+{xpEarned}</p>
              </div>
            </div>

            {shakyConcepts.length > 0 && (
              <div className="mt-4 rounded-xl border border-dashed border-red-200 bg-red-50/50 px-4 py-3 text-left dark:border-red-800 dark:bg-red-950/20">
                <p className="text-xs font-medium text-red-500">
                  Ehhez érdemes visszatérned:
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-zinc-600 dark:text-zinc-400">
                  {shakyConcepts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={onRestart}
            className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            🔄 Újratanulás
          </button>
          <button
            onClick={onBack}
            className="cursor-pointer rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
          >
            ← Vissza a témához
          </button>
        </div>
      </div>
    </div>
  );
}
