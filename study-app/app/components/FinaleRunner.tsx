"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import AIBubble from "./AIBubble";
import UserBubble from "./UserBubble";
import ResponseInput from "./ResponseInput";
import QuizRunner from "./QuizRunner";
import IslandScoreScreen from "./IslandScoreScreen";
import { readTextStream } from "../lib/stream";
import {
  aiFetch,
  withAiRetry,
  failureFromError,
  makeAiFailure,
  withHint,
  ApiCallError,
} from "../lib/aiErrors";
import {
  accumulateTeachingVerdicts,
  createTeachingTally,
  teachingScore,
} from "../lib/teaching";
import type {
  EvaluateResult,
  QuizAttemptBreakdown,
  QuizRunnerQuestion,
  QuizSubmittedAnswer,
} from "../lib/types";

interface FinaleRunnerProps {
  sessionId: string;
  topicId: string;
  totalIslands: number;
  onExit: () => void;
}

interface DisplayMessage {
  role: "ai" | "user";
  text: string;
}

type FinaleStage = "loading" | "assess" | "quiz-loading" | "quiz" | "done";
type AssessPhase = "asking" | "waiting" | "grading" | "reacting";

const FINALE_ROUNDS = 3;
const MAX_FOCUS = 6;
const CHARACTER_NAME = "Lumi";
const CHARACTER_AVATAR = "/avatars/lumi.png";

export default function FinaleRunner({
  sessionId,
  topicId,
  totalIslands,
  onExit,
}: FinaleRunnerProps) {
  const [stage, setStage] = useState<FinaleStage>("loading");
  const [focusConcepts, setFocusConcepts] = useState<string[]>([]);
  const [round, setRound] = useState(1);
  const [assessPhase, setAssessPhase] = useState<AssessPhase>("asking");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGrading, setIsGrading] = useState(false);
  const [error, setError] = useState("");
  const [quizQuestions, setQuizQuestions] = useState<QuizRunnerQuestion[]>([]);
  const [quizResult, setQuizResult] = useState<QuizAttemptBreakdown | null>(null);

  const lastQuestionRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const teachingRef = useRef(createTeachingTally());
  const contentEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  // Chat history lives in a ref (never rendered): closures created earlier in
  // the same turn must see the answer that was just appended, otherwise the
  // reaction stream is sent without it.
  const historyRef = useRef<{ role: string; content: string }[]>([]);

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const pushAssistant = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "ai", text }]);
    historyRef.current = [...historyRef.current, { role: "assistant", content: text }];
  }, []);

  const streamChat = useCallback(
    async (phaseInstruction: string): Promise<string | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setStreamingText("");
      try {
        const history = historyRef.current;
        const fullText = await withAiRetry(
          async () => {
            const res = await aiFetch(
              "/api/chat",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  messages:
                    history.length > 0
                      ? history.slice(-30)
                      : [
                          {
                            role: "user",
                            content:
                              "Most kezdődik a záróvizsga előtti átfogó ismétlés. Kövesd a fázis-instrukciót, magyarul.",
                          },
                        ],
                  phaseInstruction,
                }),
                signal: controller.signal,
              },
              60_000,
            );
            if (!res.body) throw new ApiCallError(makeAiFailure("ai_empty"));
            const text = await readTextStream(res.body, setStreamingText);
            if (!text.trim()) {
              // Server-side first-chunk gate (F44) makes this unlikely —
              // kept as fallback so an empty turn never renders.
              throw new ApiCallError(makeAiFailure("ai_empty"));
            }
            return text;
          },
          {
            attempts: 3,
            signal: controller.signal,
            onRetry: (failure, attempt, delayMs) => {
              console.warn(`Finale chat retry ${attempt + 2}/3 in ${delayMs}ms: ${failure.code}`);
              setStreamingText("");
            },
          },
        );
        setStreamingText("");
        pushAssistant(fullText);
        return fullText;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return null;
        const failure = failureFromError(err);
        console.error(`Finale chat failed: code=${failure.code} status=${failure.status} hint=${failure.hint}`, err);
        setStreamingText("");
        setError(withHint(failure));
        return null;
      } finally {
        setIsStreaming(false);
      }
    },
    [sessionId, pushAssistant],
  );

  const askRound = useCallback(
    async (roundNumber: number, focus: string[]) => {
      if (focus.length === 0) return;
      setAssessPhase("asking");
      setError("");
      const concept = focus[(roundNumber - 1) % focus.length];
      const text = await streamChat(
        `Fázis: Záróvizsga előtti átfogó ismétlés — fordított tanár (${roundNumber}/${FINALE_ROUNDS} kör). ` +
          `Te most egy lelkes, de értetlen diák vagy, a felhasználó a tanárod. A következő fogalmat NEM érted: "${concept}". ` +
          `Tegyél fel EGYETLEN természetes, diákos kérdést erről a fogalomról — olyat, amire csak valódi megértéssel lehet jól válaszolni. ` +
          `Ne magyarázz, ne segíts, csak kérdezz. Beszélj magyarul.`,
      );
      if (text) {
        lastQuestionRef.current = concept;
        setAssessPhase("waiting");
      }
    },
    [streamChat],
  );

  const loadQuiz = useCallback(async () => {
    setStage("quiz-loading");
    setError("");
    try {
      const res = await aiFetch(
        "/api/topic/quiz",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId }),
        },
        120_000,
      );
      const body = await res.json();
      const questions = (body.questions ?? []) as QuizRunnerQuestion[];
      if (questions.length === 0) throw new Error("Üres kvíz érkezett.");
      setQuizQuestions(questions);
      setStage("quiz");
    } catch (err) {
      const failure = failureFromError(err);
      console.error(`Finale quiz load failed: code=${failure.code} status=${failure.status}`, err);
      setError(withHint(failure));
      setStage("quiz-loading");
    }
  }, [topicId]);

  // Init: weakest-first focus list from concept mastery, then start round 1.
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        onExit();
        return;
      }
      const { data: mastery } = await supabase
        .from("concept_mastery")
        .select("concept, status, wrong_count")
        .eq("user_id", user.id)
        .eq("topic_id", topicId);
      if (cancelled) return;
      const rows = ((mastery ?? []) as { concept: string; status: string; wrong_count: number }[]).filter(
        (m) => m.concept && m.concept.trim(),
      );
      const rank = (status: string) =>
        status === "shaky" ? 0 : status === "unseen" ? 1 : status === "seen" ? 2 : 3;
      const focus = rows
        .sort(
          (a, b) => rank(a.status) - rank(b.status) || b.wrong_count - a.wrong_count,
        )
        .map((m) => m.concept)
        .slice(0, MAX_FOCUS);
      if (focus.length === 0) {
        // No assessed concepts (shouldn't happen post-islands) — quiz only.
        setStage("quiz-loading");
        loadQuiz();
        return;
      }
      setFocusConcepts(focus);
      setStage("assess");
      // Start round 1 from the same tick that produced the focus list —
      // no second effect needed.
      askRound(1, focus);
    };
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = async (text: string) => {
    if (isStreaming || isGrading || sendingRef.current) return;
    sendingRef.current = true;
    const trimmed = text.trim();
    if (!trimmed) {
      sendingRef.current = false;
      return;
    }
    setError("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];
    setAssessPhase("grading");
    setIsGrading(true);
    try {
      const result = await withAiRetry(
        async () => {
          const res = await aiFetch(
            "/api/evaluate",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                topicId,
                islandTitle: "Záróvizsga",
                keyConcepts: focusConcepts,
                question: lastQuestionRef.current,
                userAnswer: trimmed,
                round,
                isRemediation: false,
                provenConcepts: [],
              }),
            },
            60_000,
          );
          const parsed = (await res.json()) as EvaluateResult;
          if (!Array.isArray(parsed.verdicts)) {
            // Malformed judge output is retryable — a reroll usually lands clean.
            throw new ApiCallError(makeAiFailure("ai_bad_response"));
          }
          return parsed;
        },
        {
          attempts: 2,
          onRetry: (failure, attempt, delayMs) => {
            console.warn(`Finale evaluate retry in ${delayMs}ms: ${failure.code}`);
          },
        },
      );
      accumulateTeachingVerdicts(teachingRef.current, result.verdicts);
      setAssessPhase("reacting");
      const hint = result.feedback_hint || "A felhasználó válaszolt a kérdésedre.";
      const reaction = await streamChat(
        `Fázis: Záróvizsga előtti ismétlés, reakció. A tanárod most magyarázott neked. Értékelési támpont: ${hint}. ` +
          `Diákként reagálj 2-3 mondatban: ha jól magyarázott, mondd vissza SAJÁT példával; ha hibázott, diákos értetlenséggel kérdezz vissza a problémás részre. ` +
          `Ne oktasd ki tanárosan — te a diák vagy. Beszélj magyarul.`,
      );
      // Null means aborted (leaving) or failed (error already set, with
      // an Újra button below) — either way stop here.
      if (reaction === null) return;
      if (round >= FINALE_ROUNDS) {
        loadQuiz();
      } else {
        setRound((r) => r + 1);
        askRound(round + 1, focusConcepts);
      }
    } catch (err) {
      if (err instanceof ApiCallError && err.failure.status === 409) {
        // Round already recorded (double-submit) — the first request already
        // advanced the flow; reopen the input without an error banner.
        setAssessPhase("waiting");
        return;
      }
      const failure = failureFromError(err);
      console.error(`Finale assess failed: code=${failure.code} status=${failure.status}`, err);
      setError(withHint(failure));
      setAssessPhase("waiting");
    } finally {
      setIsGrading(false);
      sendingRef.current = false;
    }
  };

  // Marking the topic completed is a separate step from grading: the attempt
  // is already persisted, so a failed save must not discard the score. Two
  // attempts, then the score screen renders with an inline retry banner.
  const markCompleted = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/checkpoint`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_checkpoint: totalIslands,
            status: "completed",
            island_step: "teach",
            assess_state: null,
          }),
        });
        if (!res.ok) throw new Error(`Checkpoint error: ${res.status}`);
        return true;
      } catch (err) {
        console.error("Finale completion save failed:", err);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return false;
  }, [sessionId, totalIslands]);

  const submitFinaleQuiz = useCallback(
    async (answers: QuizSubmittedAnswer[]): Promise<QuizAttemptBreakdown> => {
      const visit = teachingRef.current;
      const teachingCorrect = teachingScore(visit);
      let res: Response;
      try {
        res = await aiFetch(
          "/api/topic/quiz/attempt",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topicId,
              answers,
              teachingCorrect,
              teachingTotal: visit.total,
            }),
          },
          120_000,
        );
      } catch (err) {
        const failure = failureFromError(err);
        console.error(`Finale quiz submit failed: code=${failure.code} status=${failure.status}`, err);
        throw new Error(withHint(failure));
      }
      const result = (await res.json()) as QuizAttemptBreakdown;
      // Finale completion: single PUT marks the topic done.
      const saved = await markCompleted();
      if (!saved) {
        setError(
          "A kvíz eredménye megvan, de a téma lezárását nem sikerült menteni. Próbáld újra!",
        );
      }
      setQuizResult(result);
      setStage("done");
      return result;
    },
    [topicId, markCompleted],
  );

  const allMessages = [
    ...messages,
    ...(streamingText ? [{ role: "ai" as const, text: streamingText }] : []),
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <div className="mb-6">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent"
        >
          ← Vissza
        </button>
        <h1 className="mb-3 mt-2 text-lg font-bold tracking-tight">🏁 Záróvizsga</h1>
        {stage === "assess" && (
          <span className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
            Átfogó ismétlés — {round}/{FINALE_ROUNDS} kör
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {(stage === "assess" || stage === "loading") &&
          allMessages.map((msg, i) =>
            msg.role === "ai" ? (
              <AIBubble
                key={`ai-${i}`}
                avatarUrl={CHARACTER_AVATAR}
                characterName={CHARACTER_NAME}
                message={msg.text}
                isStreaming={i === allMessages.length - 1 && isStreaming}
              />
            ) : (
              <UserBubble key={`user-${i}`} message={msg.text} />
            ),
          )}

        {stage === "loading" && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi összeállítja az ismétlést…</p>
          </div>
        )}

        {stage === "assess" && assessPhase === "asking" && !streamingText && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi gondolkodik…</p>
          </div>
        )}

        {stage === "assess" && assessPhase === "waiting" && !isStreaming && !isGrading && (
          <ResponseInput onSend={handleAnswer} disabled={false} />
        )}

        {stage === "assess" && (isGrading || (assessPhase === "reacting" && isStreaming && !streamingText)) && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi gondolkodik…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            <p>{error}</p>
            <button
              onClick={async () => {
                setError("");
                if (stage === "done") {
                  // Score is already stored — only the completion save failed.
                  const saved = await markCompleted();
                  if (!saved) {
                    setError(
                      "A téma lezárását továbbra sem sikerült menteni. Próbáld újra később!",
                    );
                  }
                } else if (stage === "assess") {
                  askRound(round, focusConcepts);
                } else {
                  loadQuiz();
                }
              }}
              className="shrink-0 cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-violet-600 active:scale-[0.98]"
            >
              Újra
            </button>
          </div>
        )}

        {stage === "quiz-loading" && !error && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
            <p className="text-sm text-zinc-500">Lumi összeállítja a záróvizsgát…</p>
          </div>
        )}

        {stage === "quiz" && !quizResult && (
          <QuizRunner
            heading="Záróvizsga — teljes téma"
            subheading="6 feleletválasztós + 4 kifejtős kérdés az egész tananyagból."
            questions={quizQuestions}
            submitLabel="Beküldés"
            onSubmit={submitFinaleQuiz}
          />
        )}

        {stage === "done" && quizResult && (
          <IslandScoreScreen
            title="Záróvizsga teljesítve 🎉"
            subtitle="Ez a pontszám a teljes témára vonatkozik."
            result={quizResult}
            questions={quizQuestions}
            primaryLabel="Vissza a szigetekre →"
            onPrimary={onExit}
          />
        )}

        <div ref={contentEndRef} />
      </div>
    </div>
  );
}
