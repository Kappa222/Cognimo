"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import type { ChatSession, Island } from "../../../lib/types";
import { parseIslands } from "../../../lib/islands";
import AnalysisProgressRing from "../../../components/AnalysisProgressRing";

type AnalyzeStatus = "checking" | "working" | "done" | "error";

// The AI call is a single opaque request with no measurable milestones, so
// the ring simulates progress until the response lands — then jumps to 100.
// Phase A: fast eased climb to FAST_PHASE_END (rate tuned so it lands there
// in ~8s at 10 ticks/sec). Phase B: slow linear creep to CREEP_CAP (~one
// visible integer every 5s). 100 is never simulated.
const TICK_MS = 100;
const FAST_PHASE_END = 90;
const FAST_PHASE_RATE = 0.065;
const CREEP_PER_TICK = 0.02;
const CREEP_CAP = 99;
// Generous backstop only: island analysis on large corpora can take minutes.
const ANALYZE_TIMEOUT_MS = 6 * 60 * 1000;
const SUCCESS_PAUSE_MS = 1400;

const STAGE_LABELS = [
  "Lumi olvassa a tananyagot…",
  "Összefüggéseket keres…",
  "Szigeteket épít…",
];

function stageForElapsed(ms: number): string {
  if (ms < 8000) return STAGE_LABELS[0];
  if (ms < 20000) return STAGE_LABELS[1];
  return STAGE_LABELS[2];
}

export default function AnalyzePage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();

  const [topicName, setTopicName] = useState("");
  const [status, setStatus] = useState<AnalyzeStatus>("checking");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(STAGE_LABELS[0]);
  const [error, setError] = useState("");

  // StrictMode remounts effects in dev — the ref keeps analysis single-flight.
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Islands surviving a failed session-creation can be reused on retry
  // without paying for a second analysis.
  const islandsRef = useRef<Island[] | null>(null);
  const subjectIdRef = useRef("");

  const stopSimulation = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startSimulation = useCallback(
    (startedAt: number) => {
      stopSimulation();
      // Interval (not rAF): robust against frame-throttling and third-party
      // rAF interference. Two phases: a fast eased climb to 90 (~8s), then a
      // slow linear creep toward 99 — visibly alive, never faking completion
      // (100 is set explicitly only when the API actually returns).
      const tick = () => {
        const elapsed = Date.now() - startedAt;
        setStage(stageForElapsed(elapsed));
        setProgress((prev) => {
          if (prev < FAST_PHASE_END) {
            const next = prev + (FAST_PHASE_END - prev) * FAST_PHASE_RATE;
            return next >= FAST_PHASE_END ? FAST_PHASE_END : next;
          }
          const next = prev + CREEP_PER_TICK;
          return next >= CREEP_CAP ? CREEP_CAP : next;
        });
      };
      tick();
      timerRef.current = window.setInterval(tick, TICK_MS);
    },
    [stopSimulation],
  );

  const fail = useCallback(
    (message: string) => {
      stopSimulation();
      abortRef.current?.abort();
      setError(message);
      setStatus("error");
    },
    [stopSimulation],
  );

  const runAnalysis = useCallback(async () => {
    if (!topicId) return;
    startedRef.current = true;
    setStatus("working");
    setError("");
    setProgress(0);
    setStage(STAGE_LABELS[0]);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const startedAt = Date.now();
    startSimulation(startedAt);

    const onTimeout = () =>
      fail("Lumi elemzése túl sokáig tartott. Próbáld újra!");
    timeoutRef.current = setTimeout(onTimeout, ANALYZE_TIMEOUT_MS);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (signal.aborted) return;
      if (!userData.user) {
        router.push("/login");
        return;
      }

      const { data: topic, error: topicErr } = await supabase
        .from("topics")
        .select("id, name, subject_id")
        .eq("id", topicId)
        .single();
      if (signal.aborted) return;
      if (topicErr || !topic) {
        fail("Nem sikerült betölteni a témát. Próbáld újra!");
        return;
      }
      setTopicName(topic.name);
      subjectIdRef.current = topic.subject_id;

      // A plan that already exists needs no re-analysis — bounce to roadmap.
      const sessionRes = await fetch(`/api/sessions?topic_id=${topicId}`, {
        signal,
      });
      if (signal.aborted) return;
      if (sessionRes.ok) {
        const existing: ChatSession & { plan?: unknown } | null =
          await sessionRes.json();
        if (
          existing &&
          existing.status === "in_progress" &&
          Array.isArray(existing.plan) &&
          existing.plan.length > 0
        ) {
          stopSimulation();
          router.push(`/topics/${topicId}`);
          return;
        }
        // Unusable leftover without a plan can never start — abandon it so
        // a fresh plan gets generated below.
        if (existing && existing.status === "in_progress") {
          try {
            await fetch(`/api/sessions/${existing.id}/checkpoint`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                current_checkpoint: 0,
                status: "abandoned",
              }),
              signal,
            });
          } catch (err) {
            if ((err as Error).name !== "AbortError") {
              console.error("Failed to abandon plan-less session:", err);
            }
          }
          if (signal.aborted) return;
        }
      }

      let islands = islandsRef.current;
      if (!islands) {
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId }),
          signal,
        });
        if (signal.aborted) return;
        if (!analyzeRes.ok) {
          // Server messages are already user-facing Hungarian.
          const serverMessage = (await analyzeRes.text()).trim();
          fail(serverMessage || "Nem sikerült elemezni a tananyagot. Próbáld újra!");
          return;
        }
        try {
          islands = parseIslands(await analyzeRes.json());
        } catch {
          fail("Lumi válasza most nem volt feldolgozható. Próbáld újra!");
          return;
        }
        islandsRef.current = islands;
      }

      const createRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic_id: topicId,
          subject_id: subjectIdRef.current,
          plan: islands,
        }),
        signal,
      });
      if (signal.aborted) return;
      if (!createRes.ok) {
        fail("Nem sikerült elmenteni a tanulási tervet. Próbáld újra!");
        return;
      }

      stopSimulation();
      setProgress(100);
      setStatus("done");
      setStage("Kész! Átirányítás a szigetekre…");
      setTimeout(() => {
        if (!signal.aborted) router.push(`/topics/${topicId}`);
      }, SUCCESS_PAUSE_MS);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Analysis failed:", err);
      fail("Nem sikerült kapcsolódni. Ellenőrizd az internetet, majd próbáld újra!");
    }
  }, [topicId, router, startSimulation, stopSimulation, fail]);

  useEffect(() => {
    if (startedRef.current) return;
    runAnalysis();
    return () => {
      // An aborted run must not block the next one: StrictMode remounts this
      // effect in dev, and without the reset the remount would return early
      // while the first attempt lies aborted — stuck at 0% forever.
      startedRef.current = false;
      abortRef.current?.abort();
      stopSimulation();
    };
    // Single-flight on mount; retries go through the Újra button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = () => {
    startedRef.current = false;
    islandsRef.current = null;
    runAnalysis();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full flex-col items-center">
        {topicName && (
          <p className="mb-2 text-sm text-zinc-400">{topicName}</p>
        )}
        <h1 className="mb-10 text-center text-2xl font-bold tracking-tight">
          {status === "done"
            ? "Tanulási terv kész!"
            : status === "error"
              ? "Hiba történt"
              : "Lumi elemzi a tananyagot"}
        </h1>

        <AnalysisProgressRing
          progress={status === "done" ? 100 : progress}
          status={status === "checking" ? "working" : status}
        />

        {status === "error" ? (
          <div className="mt-10 flex w-full flex-col items-center gap-4 text-center">
            <p className="max-w-md text-sm text-red-500">{error}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRetry}
                className="cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98]"
              >
                Újra
              </button>
              <Link
                href={`/topics/${topicId}`}
                className="cursor-pointer rounded-lg border border-zinc-200 px-6 py-2.5 text-sm font-medium text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/50 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Vissza
              </Link>
            </div>
          </div>
        ) : (
          <p aria-live="polite" className="mt-10 text-sm text-zinc-500">
            {status === "done" ? "Sikeres elemzés ✓" : stage}
          </p>
        )}


      </div>
    </div>
  );
}
