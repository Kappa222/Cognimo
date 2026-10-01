"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { loadLearnContext } from "./loadLearnContext";
import { useIslandFlow } from "./useIslandFlow";
import type { Topic } from "../../../lib/types";
import ProgressBar from "../../../components/ProgressBar";
import AIBubble from "../../../components/AIBubble";
import UserBubble from "../../../components/UserBubble";
import ResponseInput from "../../../components/ResponseInput";
import QuizRunner from "../../../components/QuizRunner";
import IslandScoreScreen from "../../../components/IslandScoreScreen";
import FinaleRunner from "../../../components/FinaleRunner";
import { LearnSkeleton } from "../../../components/LoadingSkeleton";

export default function LearnPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [materialsCount, setMaterialsCount] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");

  const {
    applyLoadedContext,
    phase,
    session,
    islands,
    displayMessages,
    streamingText,
    isStreaming,
    isReview,
    islandStep,
    teachRound,
    teachConceptIndex,
    isEvaluating,
    chatError,
    saveError,
    quizStage,
    quizTitle,
    quizQuestions,
    quizError,
    quizResult,
    contentEndRef,
    MAX_TEACH_TURNS,
    handleStart,
    handleBack,
    handleUserResponse,
    handleTeachReady,
    handleTeachNext,
    handleTeachIntent,
    handleChatRetry,
    enterQuiz,
    submitQuiz,
    proceedToNextIsland,
  } = useIslandFlow({ topicId, router, topicName: topic?.name });

  const initRunRef = useRef(0);

  const initPage = useCallback(async () => {
    const runId = ++initRunRef.current;
    const isStale = () => runId !== initRunRef.current;
    setPageLoading(true);
    setError("");

    const result = await loadLearnContext(topicId, isStale);
    if (result.kind === "aborted" || isStale()) return;
    if (result.kind === "no-auth") {
      router.push("/login");
      return;
    }
    if (result.kind === "topic-error") {
      setError("Nem sikerült betölteni a témát.");
      setPageLoading(false);
      return;
    }

    setTopic(result.topic);
    if (result.materialsCount !== null) setMaterialsCount(result.materialsCount);
    applyLoadedContext({
      session: result.session,
      islands: result.islands,
      messages: result.messages,
      displayMessages: result.displayMessages,
      restore: result.restore,
    });
    setPageLoading(false);
  }, [topicId, router, applyLoadedContext]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { initPage(); }, [initPage]);

  // Finale deep-link (?finale=1). Read lazily at mount (no effect needed);
  // eligibility is checked below — ineligible visits bounce to the roadmap.
  const [finaleRequested] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("finale") === "1",
  );

  const finaleEligible =
    !!session &&
    session.status === "in_progress" &&
    islands.length > 0 &&
    session.current_checkpoint >= islands.length;

  useEffect(() => {
    if (!finaleRequested || pageLoading || !topic) return;
    if (!finaleEligible) router.push(`/topics/${topicId}`);
  }, [finaleRequested, pageLoading, topic, finaleEligible, router, topicId]);

  if (pageLoading) {
    return <LearnSkeleton />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">{error}</p>
          <button onClick={() => initPage()} className="mt-4 cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all hover:bg-violet-700">Újra</button>
        </div>
      </div>
    );
  }

  if (!topic) return null;

  if (materialsCount === 0) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <Link href={`/topics/${topicId}`} className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent">← Vissza</Link>
        <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="mb-1 text-zinc-500">Még nincs tananyagod</p>
          <p className="mb-4 text-xs text-zinc-400">Adj hozzá tananyagot a témához a tanulás megkezdéséhez.</p>
          <Link href={`/topics/${topicId}/materials`} className="inline-block cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]">Tananyag hozzáadása</Link>
        </div>
      </div>
    );
  }

  if (finaleRequested) {
    if (!finaleEligible || !session) return <LearnSkeleton />;
    return (
      <FinaleRunner
        sessionId={session.id}
        topicId={topicId as string}
        totalIslands={islands.length}
        onExit={() => router.push(`/topics/${topicId}`)}
      />
    );
  }

  const characterName = "Lumi";
  const characterAvatar = "/avatars/lumi.png";

  const allMessages = [
    ...displayMessages,
    ...(streamingText ? [{ role: "ai" as const, text: streamingText }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      {/* Top bar */}
      <div className="mb-6">
        <button onClick={handleBack} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent">← Vissza</button>
        <h1 className="mb-3 mt-2 text-lg font-bold tracking-tight">{topic.name}</h1>
        {phase.isStarted && !phase.isComplete && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar current={Math.min(phase.currentCheckpoint, phase.totalCheckpoints)} total={phase.totalCheckpoints} />
            </div>
            <span className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
              {isReview ? "🔁 Ismétlés — " : ""}
              {islandStep === "assess" || islandStep === "remediation"
                ? `Tanítsd Lumit — ${phase.phaseBadge}`
                : islandStep === "teach" && phase.isStarted
                  ? `Lumi magyaráz — ${phase.phaseBadge}`
                  : phase.phaseBadge}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-4">
        {allMessages.map((msg, i) =>
          msg.role === "ai" ? (
            <AIBubble
              key={`ai-${i}`}
              avatarUrl={characterAvatar}
              characterName={characterName}
              message={msg.text}
              isStreaming={i === allMessages.length - 1 && isStreaming}
            />
          ) : (
            <UserBubble key={`user-${i}`} message={msg.text} />
          )
        )}

        {/* Idle — pre-start (hidden once complete) */}
        {phase.subPhase === "idle" && !phase.isComplete && islands.length > 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="mb-1 text-lg font-medium text-zinc-600 dark:text-zinc-400">📚 Készen állsz tanulni?</p>
            <p className="mb-6 text-sm text-zinc-400">
              {session?.status === "completed"
                ? "Ez a téma már be van fejezve — válassz egy szigetet a roadmapon az ismétléshez, vagy indítsd innen az aktuálisat."
                : "Lumi a szigetek sorrendjében vezet végig a tananyagon."}
            </p>
            <button onClick={() => handleStart()} className="cursor-pointer rounded-lg bg-accent px-8 py-3 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]">
              {session && session.status === "in_progress" ? "▶️ Folytatás" : "🚀 Kezdés"}
            </button>
          </div>
        )}

        {/* No plan yet — analysis lives on the dedicated analyze page */}
        {phase.subPhase === "idle" && !phase.isComplete && islands.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="mb-1 text-lg font-medium text-zinc-600 dark:text-zinc-400">📚 Még nincs tanulási terv</p>
            <p className="mb-6 text-sm text-zinc-400">Lumi először elemzi a tananyagot, és szigetekre bontja.</p>
            <button onClick={() => router.push(`/topics/${topicId}/analyze`)} className="cursor-pointer rounded-lg bg-accent px-8 py-3 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]">
              🔍 Elemzés indítása
            </button>
          </div>
        )}

        {/* Save error toast */}
        {saveError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {saveError}
          </div>
        )}

        {/* Inline chat error with retry — transient AI/evaluate failures */}
        {chatError && !isStreaming && !isEvaluating && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            <p>{chatError.message}</p>
            <button
              onClick={handleChatRetry}
              className="shrink-0 cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-violet-600 active:scale-[0.98]"
            >
              Újra
            </button>
          </div>
        )}

        {/* Waiting for AI to start responding */}
        {phase.subPhase === "ai-responding" && isStreaming && !streamingText && phase.isStarted && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi válaszát várjuk...</p>
          </div>
        )}

        {/* Thinking indicator — AI is processing before streaming starts */}
        {phase.subPhase === "ai-responding" && !isStreaming && !chatError && phase.isStarted && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi gondolkodik...</p>
          </div>
        )}

        {/* Teach bites: one concept per message + quick taps, or handover on last */}
        {phase.subPhase === "waiting-response" && islandStep === "teach" && !isStreaming && !isEvaluating && (() => {
          const island = islands[phase.currentCheckpoint];
          const total = island?.key_concepts.length ?? 0;
          const isLast = total <= 0 || teachConceptIndex >= total - 1;
          return (
            <div className="flex flex-col gap-2">
              {total > 0 && (
                <p className="text-xs text-zinc-400">{Math.min(teachConceptIndex + 1, total)}/{total} fogalom</p>
              )}
              {isLast ? (
                <button
                  onClick={() => handleTeachReady()}
                  className="cursor-pointer rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
                >
                  Értem, jöhet a kikérdezés →
                </button>
              ) : (
                <button
                  onClick={() => handleTeachNext()}
                  className="cursor-pointer rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
                >
                  Értem, tovább →
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleTeachIntent("example")}
                  className="flex-1 cursor-pointer rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  🧪 Példát kérek
                </button>
                <button
                  onClick={() => handleTeachIntent("simpler")}
                  className="flex-1 cursor-pointer rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  🪶 Egyszerűbben
                </button>
              </div>
              {teachRound >= MAX_TEACH_TURNS && (
                <p className="text-xs text-zinc-400">Ha elakadtál, kérdezz bátran — egyébként nyomd meg a fenti gombot a folytatáshoz.</p>
              )}
              <ResponseInput onSend={handleUserResponse} disabled={false} placeholder="Kérdezz bátran, ha valami nem világos..." />
            </div>
          );
        })()}

        {/* Text input for assess/remediation — hidden during evaluate */}
        {phase.subPhase === "waiting-response" && islandStep !== "teach" && !isStreaming && !isEvaluating && (
          <ResponseInput onSend={handleUserResponse} disabled={false} />
        )}

        {/* Evaluate loading indicator */}
        {isEvaluating && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi gondolkodik...</p>
          </div>
        )}

        {/* Island quiz — entered after teach/assess, before checkpoint */}
        {phase.subPhase === "quiz" && quizStage === "loading" && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
            <p className="text-sm text-zinc-500">Lumi összeállítja a kvízt…</p>
          </div>
        )}

        {phase.subPhase === "quiz" && quizStage === "error" && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="mb-1 text-red-500">{quizError}</p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => enterQuiz()}
                className="cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all hover:bg-violet-700"
              >
                Újra
              </button>
              <button
                onClick={handleBack}
                className="cursor-pointer rounded-lg border border-zinc-200 px-5 py-2 text-sm text-zinc-600 transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Vissza
              </button>
            </div>
          </div>
        )}

        {phase.subPhase === "quiz" && quizStage === "ready" && !quizResult && (
          <QuizRunner
            heading={`Kvíz — ${quizTitle}`}
            subheading="4 feleletválasztós + 2 kifejtős kérdés ebből a részből."
            questions={quizQuestions}
            submitLabel="Beküldés"
            onSubmit={submitQuiz}
          />
        )}

        {phase.subPhase === "quiz" && quizResult && (
          <IslandScoreScreen
            title={`Sziget teljesítve — ${quizTitle}`}
            subtitle={isReview ? "Ismétlés — az előrehaladásod változatlan." : undefined}
            result={quizResult}
            questions={quizQuestions}
            onPrimary={() => proceedToNextIsland()}
          />
        )}

        <div ref={contentEndRef} />
      </div>
    </div>
  );
}
