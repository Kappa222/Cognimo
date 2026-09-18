"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { StatisticsSkeleton } from "./LoadingSkeleton";

interface ConceptStat {
  concept: string;
  status: string;
  correct_count: number;
  wrong_count: number;
}

interface AssessmentRound {
  id: string;
  island_title: string;
  round: number;
  question: string;
  verdicts: { concept: string; verdict: string }[];
  created_at: string;
}

interface IslandAttempt {
  island_title: string;
  blended: number;
  answers: { concept: string; verdict: string }[];
  created_at: string;
}

interface PlanIsland {
  title: string;
  key_concepts: string[];
}

interface FinaleAttempt {
  blended: number | null;
  score: number;
  total_questions: number;
  created_at: string;
}

export default function StatisticsTab({ topicId }: { topicId: string }) {
  const [concepts, setConcepts] = useState<ConceptStat[]>([]);
  const [rounds, setRounds] = useState<AssessmentRound[]>([]);
  const [islandAttempts, setIslandAttempts] = useState<IslandAttempt[]>([]);
  const [plan, setPlan] = useState<PlanIsland[]>([]);
  const [finale, setFinale] = useState<FinaleAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: c, error: cErr } = await supabase
        .from("concept_mastery")
        .select("concept, status, correct_count, wrong_count")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (cErr) {
        setLoadError(true);
      } else if (c) {
        setConcepts(c);
      }

      const { data: r, error: rErr } = await supabase
        .from("assessment_rounds")
        .select("id, island_title, round, question, verdicts, created_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (cancelled) return;
      if (!rErr && r) setRounds(r as AssessmentRound[]);

      const { data: ia } = await supabase
        .from("island_quiz_attempts")
        .select("island_title, blended, answers, created_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (ia) setIslandAttempts(ia as IslandAttempt[]);

      const { data: planSession } = await supabase
        .from("chat_sessions")
        .select("plan")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .not("plan", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const maybePlan = (planSession as { plan?: unknown } | null)?.plan;
      if (Array.isArray(maybePlan)) {
        setPlan(
          (maybePlan as PlanIsland[]).filter(
            (i) => i && typeof i.title === "string" && Array.isArray(i.key_concepts),
          ),
        );
      }

      const { data: fa } = await supabase
        .from("quiz_attempts")
        .select("blended, score, total_questions, created_at")
        .eq("user_id", user.id)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (fa) setFinale(fa as FinaleAttempt);

      setLoading(false);
    };
    fetch();
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  if (loading) {
    return (
      <div className="animate-fade-in-up">
        <StatisticsSkeleton />
      </div>
    );
  }

  const grouped = {
    solid: concepts.filter((c) => c.status === "solid"),
    seen: concepts.filter((c) => c.status === "seen"),
    shaky: concepts.filter((c) => c.status === "shaky"),
    unseen: concepts.filter((c) => c.status === "unseen"),
  };
  const assessedCount = grouped.solid.length + grouped.seen.length + grouped.shaky.length;

  // Per-island quiz history: best blended + attempt count, in plan order.
  const islandStats = plan.map((island, i) => {
    const rows = islandAttempts.filter((a) => a.island_title === island.title);
    const best =
      rows.length > 0 ? Math.max(...rows.map((a) => a.blended)) : null;
    return { index: i, title: island.title, best, attempts: rows.length };
  });
  const hasIslandData = islandAttempts.length > 0;

  // "Amit még gyakorolnod kell": weak concepts per island — shaky/unseen
  // mastery plus concepts answered wrong/partial in island quizzes.
  const masteryByConcept = new Map(concepts.map((c) => [c.concept, c.status]));
  const islandGaps = plan
    .map((island, i) => {
      const wrong = new Set<string>();
      for (const a of islandAttempts) {
        if (a.island_title !== island.title || !Array.isArray(a.answers)) continue;
        for (const ans of a.answers) {
          if (
            ans &&
            typeof ans.concept === "string" &&
            (ans.verdict === "wrong" || ans.verdict === "partial")
          ) {
            wrong.add(ans.concept);
          }
        }
      }
      const weak = island.key_concepts.filter((concept) => {
        if (wrong.has(concept)) return true;
        const status = masteryByConcept.get(concept);
        return status === "shaky" || status === "unseen";
      });
      return { index: i, title: island.title, weak: [...new Set(weak)] };
    })
    .filter((g) => g.weak.length > 0);
  const hasKnowledgeData = assessedCount > 0 || hasIslandData;

  if (loadError) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p className="text-zinc-500">A statisztika most nem tölthető be.</p>
        <p className="text-xs text-zinc-400">Próbáld újra később.</p>
      </div>
    );
  }

  return (
    <div key="statisztika" className="animate-fade-in-up">
      {finale && typeof finale.blended === "number" && (
        <div className="mb-6 rounded-2xl border border-emerald-200/60 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            🏁 {finale.blended}%
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Záróvizsga ({finale.score}/{finale.total_questions} helyes) ·{" "}
            {new Date(finale.created_at).toLocaleDateString("hu-HU")}
          </p>
        </div>
      )}

      {hasIslandData && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">Szigetek pontszámai</h3>
          <div className="grid gap-2">
            {islandStats.map((s) => (
              <div
                key={`${s.title}-${s.index}`}
                className="flex items-center justify-between rounded-xl border border-zinc-200/60 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {s.index + 1}. {s.title}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">{s.attempts}×</span>
                  {s.best !== null ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                      {s.best}%
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasKnowledgeData && (
        <div className="mb-6 rounded-2xl border border-amber-200/60 bg-amber-50/50 p-6 dark:border-amber-800 dark:bg-amber-950/20">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            📌 Amit még gyakorolnod kell
          </h3>
          {islandGaps.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Minden eddig érintett fogalmat stabilan tudsz! 🎉
            </p>
          ) : (
            <div className="grid gap-2">
              {islandGaps.map((g) => (
                <div key={`${g.title}-${g.index}`} className="text-sm">
                  <p className="font-medium text-zinc-700 dark:text-zinc-300">
                    {g.index + 1}. sziget ({g.title}):
                  </p>
                  <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">
                    {g.weak.map((concept) => (
                      <li key={concept}>{concept}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="mt-1 text-xs text-zinc-500">
                Tipp: kattints a szigetre a roadmapon az újratanuláshoz — a kvíz ugyanazokkal a kérdésekkel vár.
              </p>
            </div>
          )}
        </div>
      )}

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

      {assessedCount > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-500 uppercase tracking-wide">Fogalmak státusz szerint</h3>
          <div className="grid gap-2">
            {grouped.solid.map((c, i) => (
              <div key={`${c.concept}-${i}`} className="flex items-center justify-between rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-4 py-2 dark:border-emerald-800 dark:bg-emerald-950/20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.concept}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">solid</span>
              </div>
            ))}
            {grouped.seen.map((c, i) => (
              <div key={`${c.concept}-${i}`} className="flex items-center justify-between rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{c.concept}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">seen</span>
              </div>
            ))}
            {grouped.shaky.map((c, i) => (
              <div key={`${c.concept}-${i}`} className="flex items-center justify-between rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2 dark:border-red-800 dark:bg-red-950/20">
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
            {rounds.map((r) => {
              const verdicts = Array.isArray(r.verdicts) ? r.verdicts : [];
              const correct = verdicts.filter((v) => v.verdict === "correct").length;
              return (
                <div key={r.id} className="rounded-xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{r.island_title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {verdicts.length > 0 && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {correct}/{verdicts.length} helyes
                        </span>
                      )}
                      <span className="text-xs text-zinc-400">{new Date(r.created_at).toLocaleDateString("hu-HU")}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{r.question}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {assessedCount === 0 && rounds.length === 0 && !hasIslandData && !finale && (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-500">Még nincs statisztikai adat.</p>
          <p className="text-xs text-zinc-400">Tanulj egy témát az adatok megjelenítéséhez.</p>
        </div>
      )}
    </div>
  );
}
