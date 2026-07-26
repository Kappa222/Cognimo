"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

interface ConceptStat {
  concept: string;
  status: string;
  correct_count: number;
  wrong_count: number;
}

interface AssessmentRound {
  island_title: string;
  round: number;
  question: string;
  created_at: string;
}

export default function StatisticsTab({ topicId }: { topicId: string }) {
  const [concepts, setConcepts] = useState<ConceptStat[]>([]);
  const [rounds, setRounds] = useState<AssessmentRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: c } = await supabase
        .from("concept_mastery")
        .select("concept, status, correct_count, wrong_count")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("updated_at", { ascending: false });
      if (c) setConcepts(c);

      const { data: r } = await supabase
        .from("assessment_rounds")
        .select("island_title, round, question, created_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (r) setRounds(r);

      setLoading(false);
    };
    fetch();
  }, [topicId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 animate-fade-in-up">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
      </div>
    );
  }

  const grouped = {
    solid: concepts.filter((c) => c.status === "solid"),
    seen: concepts.filter((c) => c.status === "seen"),
    shaky: concepts.filter((c) => c.status === "shaky"),
    unseen: concepts.filter((c) => c.status === "unseen"),
  };

  return (
    <div key="statisztika" className="animate-fade-in-up">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{grouped.solid.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Elsajátított (solid)</p>
        </div>
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{grouped.seen.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Megértett (seen)</p>
        </div>
        <div className="rounded-2xl border border-red-200/60 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/30">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{grouped.shaky.length}</p>
          <p className="mt-1 text-xs text-zinc-500">Gyakorlandó (shaky)</p>
        </div>
      </div>

      {concepts.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">Fogalmak státusz szerint</h3>
          <div className="grid gap-2">
            {grouped.solid.map((c) => (
              <div key={c.concept} className="flex items-center justify-between rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-4 py-2 dark:border-emerald-800 dark:bg-emerald-950/20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.concept}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">solid</span>
              </div>
            ))}
            {grouped.seen.map((c) => (
              <div key={c.concept} className="flex items-center justify-between rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.concept}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">seen</span>
              </div>
            ))}
            {grouped.shaky.map((c) => (
              <div key={c.concept} className="flex items-center justify-between rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2 dark:border-red-800 dark:bg-red-950/20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.concept}</span>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">shaky</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rounds.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">Legutóbbi tanítási fordulók</h3>
          <div className="grid gap-2">
            {rounds.map((r, i) => (
              <div key={i} className="rounded-xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{r.island_title}</span>
                  <span className="text-xs text-zinc-400">{new Date(r.created_at).toLocaleDateString("hu-HU")}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{r.question}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {concepts.length === 0 && rounds.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-500">Még nincs statisztikai adat.</p>
          <p className="text-xs text-zinc-400">Tanulj egy témát az adatok megjelenítéséhez.</p>
        </div>
      )}
    </div>
  );
}
