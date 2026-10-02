"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSessionPhaseManager } from "../../../lib/useSessionPhaseManager";
import { readTextStream } from "../../../lib/stream";
import { getPhaseInstruction } from "../../../lib/prompts";
import { useSessionSaves } from "./useSessionSaves";
import {
  aiFetch,
  withAiRetry,
  failureFromError,
  makeAiFailure,
  withHint,
  ApiCallError,
} from "../../../lib/aiErrors";
import {
  accumulateTeachingVerdicts,
  createTeachingTally,
  teachingScore,
} from "../../../lib/teaching";
import type {
  ChatSession,
  ChatMessage,
  Island,
  EvaluateResult,
  QuizAttemptBreakdown,
  QuizRunnerQuestion,
  QuizSubmittedAnswer,
} from "../../../lib/types";
import type { IslandRestore } from "./loadLearnContext";

export interface DisplayMessage {
  role: "ai" | "user";
  text: string;
}

interface IslandFlowArgs {
  topicId: string;
  router: ReturnType<typeof useRouter>;
  topicName?: string;
}

// Island engine: owns the chat/teach/assess/quiz state machine, streaming,
// persistence calls and the roadmap deep-link start logic. The learn page
// keeps only the load layer (topic, materials, initPage) and rendering.
export function useIslandFlow({ topicId, router, topicName }: IslandFlowArgs) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [storedMessages, setStoredMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  // Review mode: replaying a completed island (?island=N below the saved
  // checkpoint). The full island flow runs, but nothing is persisted —
  // no checkpoints, no messages, no mastery writes.
  const [isReview, setIsReview] = useState(false);
  // Island quiz sub-state (entered after teach/assess, before checkpoint).
  const [quizStage, setQuizStage] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quizTitle, setQuizTitle] = useState("");
  const [quizQuestions, setQuizQuestions] = useState<QuizRunnerQuestion[]>([]);
  const [quizError, setQuizError] = useState("");
  const [quizResult, setQuizResult] = useState<QuizAttemptBreakdown | null>(null);
  const [islands, setIslands] = useState<Island[]>([]);
  const [islandStep, setIslandStep] = useState<"teach" | "assess" | "remediation">("teach");
  const [assessRound, setAssessRound] = useState(0);
  const [provenConcepts, setProvenConcepts] = useState<string[]>([]);
  const [weakConcepts, setWeakConcepts] = useState<string[]>([]);
  const [remediationCount, setRemediationCount] = useState(0);
  // Teach-first: counts completed teach exchanges in this island visit.
  // Drives the gentle nudge after many turns; the button is the handover.
  const [teachRound, setTeachRound] = useState(0);
  // Bite-size: index into currentIsland.key_concepts — one concept per message.
  const [teachConceptIndex, setTeachConceptIndex] = useState(0);
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Inline (non-fatal) chat errors: transient AI/evaluate failures show a
  // retry panel instead of hijacking the whole page like `error` does.
  // `hint` is the self-describing diagnostic ("HTTP 429 · ai_quota").
  const [chatError, setChatError] = useState<{
    message: string;
    hint: string;
    retry: "ai" | "evaluate";
  } | null>(null);

  const { saveError, clearSaveError, saveMessage, saveCheckpoint } =
    useSessionSaves(session, isReview);
  const islandTitles = islands.map((i) => i.title);
  const phase = useSessionPhaseManager(islandTitles);
  const abortRef = useRef<AbortController | null>(null);
  const storedMessagesRef = useRef(storedMessages);
  const hasUserRespondedRef = useRef(false);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const assessQuestionRef = useRef("");
  const evaluateResultRef = useRef<EvaluateResult | null>(null);
  // Bite-size intent for the next teach turn: example/simpler re-explain of
  // the same concept. Cleared after the stream (like evaluateResultRef).
  const teachIntentRef = useRef<"example" | "simpler" | null>(null);
  // In-flight stream guard: state updates lag re-renders, so a ref (not
  // state) is the only reliable barrier against a second parallel stream
  // when the ai-responding effect refires with a fresh callback identity.
  const streamingRef = useRef(false);
  const visitTeachingRef = useRef(createTeachingTally());
  // Mutual-exclusion guard: state updates lag rapid double-Enters, so a ref
  // (not state) is the only reliable double-submit barrier.
  const sendingRef = useRef(false);
  // Last assess answer for error-panel retries.
  const lastAnswerRef = useRef("");
  // Tracked deferred subPhase flip — cleared on unmount so navigation can't
  // start a stream on an unmounted page.
  const subPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAX_ASSESS_ROUNDS = 4;
  const MAX_REMEDIATION = 2;
  const MAX_TEACH_TURNS = 6;

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingText]);

  useEffect(() => { storedMessagesRef.current = storedMessages; }, [storedMessages]);

  useEffect(() => { hasUserRespondedRef.current = false; }, [phase.stepIndex]);

  const saveAssessState = useCallback(async () => {
    await saveCheckpoint(phase.currentCheckpoint, undefined, {
      island_step: islandStep,
      assess_state: {
        round: assessRound,
        proven: provenConcepts,
        weak: weakConcepts,
        remediationCount,
        nextFocus: assessQuestionRef.current,
        teachRound,
        teachConceptIndex,
      },
    });
  }, [phase.currentCheckpoint, saveCheckpoint, islandStep, assessRound, provenConcepts, weakConcepts, remediationCount, teachRound, teachConceptIndex]);

  // Explicit teach -> assess handover via the "Értem" button. Starts the
  // inverted-teacher probe with a gentle recap question (no prior grading).
  const handleTeachReady = useCallback(async () => {
    const island = islands[phase.currentCheckpoint];
    if (!session || !island || isStreaming || streamingRef.current || isEvaluating || sendingRef.current) return;
    sendingRef.current = true;
    try {
      setChatError(null);
      teachIntentRef.current = null;
      assessQuestionRef.current = island.key_concepts[0] ?? "";
      hasUserRespondedRef.current = false;
      setAssessRound(1);
      setProvenConcepts([]);
      setWeakConcepts([]);
      setRemediationCount(0);
      setIslandStep("assess");
      phase.setSubPhase("ai-responding");
    } finally {
      sendingRef.current = false;
    }
  }, [islands, phase, session, isStreaming, isEvaluating]);

  // Bite-size: advance to the next concept silently (no user bubble saved).
  const handleTeachNext = useCallback(() => {
    const island = islands[phase.currentCheckpoint];
    if (!session || !island || isStreaming || streamingRef.current || isEvaluating || sendingRef.current) return;
    if (phase.subPhase !== "waiting-response" || islandStep !== "teach") return;
    sendingRef.current = true;
    try {
      setChatError(null);
      teachIntentRef.current = null;
      hasUserRespondedRef.current = false;
      setTeachConceptIndex((i) => Math.min(i + 1, Math.max(0, island.key_concepts.length - 1)));
      phase.setSubPhase("ai-responding");
    } finally {
      sendingRef.current = false;
    }
  }, [islands, phase, session, isStreaming, isEvaluating, islandStep]);

  // Bite-size: re-explain the same concept (example / simpler). Saves a small
  // user bubble with the tap label so history stays readable.
  const handleTeachIntent = useCallback(async (kind: "example" | "simpler") => {
    if (!session || isStreaming || streamingRef.current || isEvaluating || sendingRef.current) return;
    if (phase.subPhase !== "waiting-response" || islandStep !== "teach") return;
    sendingRef.current = true;
    try {
      setChatError(null);
      const label = kind === "example" ? "🧪 Példát kérek" : "🪶 Egyszerűbben";
      teachIntentRef.current = kind;
      hasUserRespondedRef.current = true;
      setDisplayMessages((prev) => [...prev, { role: "user", text: label }]);
      await saveMessage("user", label);
      setStoredMessages((prev) => [...prev, { role: "user", content: label, id: "", session_id: session.id, created_at: new Date().toISOString() }]);
      phase.setSubPhase("ai-responding");
    } finally {
      sendingRef.current = false;
    }
  }, [session, isStreaming, isEvaluating, phase, islandStep, saveMessage]);

  // Enter the island quiz after teach/assess: assess state is persisted
  // first (quitting mid-quiz resumes at assess), then the persisted quiz
  // set is loaded (generated once on first entry, identical afterwards).
  const enterQuiz = useCallback(async () => {
    const island = islands[phase.currentCheckpoint];
    if (!island || !session) return;
    await saveAssessState();
    setQuizTitle(island.title);
    setQuizQuestions([]);
    setQuizResult(null);
    setQuizError("");
    setQuizStage("loading");
    phase.setSubPhase("quiz");
    try {
      const res = await aiFetch(
        "/api/islands/quiz",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId, islandTitle: island.title }),
        },
        120_000,
      );
      const body = await res.json();
      const questions = (body.questions ?? []) as QuizRunnerQuestion[];
      if (questions.length === 0) throw new Error("Üres kvíz érkezett. Próbáld újra!");
      setQuizQuestions(questions);
      setQuizStage("ready");
    } catch (err) {
      const failure = failureFromError(err);
      console.error(`Island quiz load failed: code=${failure.code} status=${failure.status}`, err);
      setQuizError(withHint(failure));
      setQuizStage("error");
    }
  }, [islands, phase, session, saveAssessState, topicId]);

  const submitQuiz = useCallback(
    async (answers: QuizSubmittedAnswer[]): Promise<QuizAttemptBreakdown> => {
      const island = islands[phase.currentCheckpoint];
      if (!island || !session) throw new Error("Hiányzó sziget. Töltsd újra az oldalt!");
      const visit = visitTeachingRef.current;
      const teachingCorrect = teachingScore(visit);
      let res: Response;
      try {
        res = await aiFetch(
          "/api/islands/quiz/attempt",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topicId,
              islandTitle: island.title,
              answers,
              teachingCorrect,
              teachingTotal: visit.total,
              isReview,
            }),
          },
          120_000,
        );
      } catch (err) {
        const failure = failureFromError(err);
        console.error(`Quiz attempt failed: code=${failure.code} status=${failure.status}`, err);
        throw new Error(withHint(failure));
      }
      const result = (await res.json()) as QuizAttemptBreakdown;
      setQuizResult(result);
      return result;
    },
    [islands, phase, session, topicId, isReview],
  );

  // Clear local assess/teach state when leaving an island, so a revisit or a
  // back-navigation can't reuse stale questions and verdicts.
  const clearIslandLocals = useCallback(() => {
    assessQuestionRef.current = "";
    evaluateResultRef.current = null;
    teachIntentRef.current = null;
    hasUserRespondedRef.current = false;
    setAssessRound(0);
    setProvenConcepts([]);
    setWeakConcepts([]);
    setRemediationCount(0);
    setTeachRound(0);
    setTeachConceptIndex(0);
    setIslandStep("teach");
    visitTeachingRef.current = createTeachingTally();
    setQuizStage("idle");
    setQuizQuestions([]);
    setQuizResult(null);
    setQuizError("");
  }, []);

  const proceedToNextIsland = useCallback(async () => {
    const nextCheckpoint = phase.currentCheckpoint + 1;
    if (isReview) {
      // Review never touches saved progress: roam within completed
      // territory, then return to the roadmap (never into uncompleted
      // islands — those are entered normally from the roadmap).
      const completedCount =
        session?.status === "completed"
          ? islands.length
          : (session?.current_checkpoint ?? islands.length);
      if (nextCheckpoint < islands.length && nextCheckpoint < completedCount) {
        clearIslandLocals();
        phase.goToNextStep();
      } else {
        router.push(`/topics/${topicId}`);
      }
      return;
    }
    if (nextCheckpoint >= islands.length) {
      // Final island quiz done: islands complete, but the topic stays
      // in_progress until the gated finale (🏁) is finished.
      await saveCheckpoint(islands.length, undefined, {
        island_step: "teach",
        assess_state: null,
      });
      clearIslandLocals();
      router.push(`/topics/${topicId}`);
    } else {
      // Save progress + clear stale assess state BEFORE leaving Learn,
      // so a reload on the roadmap never restores the old island's state.
      await saveCheckpoint(nextCheckpoint, undefined, {
        island_step: "teach",
        assess_state: null,
      });
      clearIslandLocals();
      router.push(`/topics/${topicId}`);
    }
  }, [phase, islands.length, saveCheckpoint, router, topicId, isReview, session, clearIslandLocals]);

  const streamAIResponse = useCallback(async (
    history: { role: string; content: string }[],
    phaseInstruction?: string,
    islandTitle?: string,
  ) => {
    if (!session || streamingRef.current) return;
    streamingRef.current = true;
    setIsStreaming(true);
    setStreamingText("");

    // Deferred subPhase flip: lets React commit islandStep/assessRound before
    // the next AI turn reads them.
    const scheduleAiResponding = () => {
      if (subPhaseTimerRef.current) clearTimeout(subPhaseTimerRef.current);
      subPhaseTimerRef.current = setTimeout(() => phase.setSubPhase("ai-responding"), 100);
    };

    // Class-aware retry (F45): backoff honors Retry-After, only retryable
    // failures loop (max 3 attempts), and both the request and the backoff
    // sleep abort on unmount/navigation — no retry fires after leaving the
    // page. Final failure becomes an inline retry panel (chatError), never a
    // full-page error.
    try {
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      const fullText = await withAiRetry(
        async () => {
          const res = await aiFetch(
            "/api/chat",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: session.id, messages: history, phaseInstruction, islandTitle }),
              signal,
            },
            60_000,
          );

          if (!res.body) throw new ApiCallError(makeAiFailure("ai_empty"));
          const text = await readTextStream(res.body, setStreamingText);

          if (!text.trim()) {
            // The server-side first-chunk gate (F44) should make this
            // impossible — kept as fallback so an empty turn never renders.
            throw new ApiCallError(makeAiFailure("ai_empty"));
          }
          return text;
        },
        {
          attempts: 3,
          signal,
          onRetry: (failure, attempt, delayMs) => {
            console.warn(`AI retry ${attempt + 2}/3 in ${delayMs}ms: ${failure.code}`);
            setStreamingText("");
          },
        },
      );

      await saveMessage("assistant", fullText);
      setStoredMessages((prev) => [...prev, { role: "assistant", content: fullText, id: "", session_id: session.id, created_at: new Date().toISOString() }]);
      setDisplayMessages((prev) => [...prev, { role: "ai", text: fullText }]);
      setStreamingText("");
      setChatError(null);

      const stepPhase = phase.currentStep?.phase;

      if (stepPhase === "explain" && islandStep === "teach") {
        // Bite-size: stay in teach after every bite. Taps or free text
        // drive the next bite; the handover button enters assess.
        teachIntentRef.current = null;
        setTeachRound((r) => r + 1);
        hasUserRespondedRef.current = false;
        phase.setSubPhase("waiting-response");
      } else if (islandStep === "assess" || islandStep === "remediation") {
        // After Lumi's reaction stream
        const result = evaluateResultRef.current;
        evaluateResultRef.current = null;

        if (result && result.next_focus === null) {
          // All concepts proven → island quiz
          await enterQuiz();
        } else if (result && assessRound >= MAX_ASSESS_ROUNDS) {
          // Max rounds reached → check gate
          const currentIsland = islands[phase.stepIndex];
          const allProven = currentIsland?.key_concepts.every(
            (k) => provenConcepts.includes(k),
          ) ?? false;

          if (allProven) {
            await enterQuiz();
          } else if (remediationCount < MAX_REMEDIATION && islandStep === "assess") {
            // Enter remediation
            const newCount = remediationCount + 1;
            setRemediationCount(newCount);
            setIslandStep("remediation");
            setAssessRound(1);
            hasUserRespondedRef.current = false;
            await saveAssessState();
            // Trigger remediation micro-lesson immediately
            scheduleAiResponding();
          } else {
            // Assessment exhausted — the quiz measures what stuck.
            await enterQuiz();
          }
        } else if (result && result.next_focus) {
          // Ask next question — clear follow-up flag so the next AI turn
          // asks (not reacts).
          assessQuestionRef.current = result.next_focus;
          setAssessRound((r) => r + 1);
          hasUserRespondedRef.current = false;
          await saveAssessState();
          scheduleAiResponding();
        } else {
          phase.setSubPhase("waiting-response");
        }
      } else if (stepPhase === "complete") {
        // No-op, completion screen handles it
      } else {
        // Defensive fallback: no current step (empty/out-of-range plan).
        // Settle instead of spinning — never leave ai-responding hanging.
        if (hasUserRespondedRef.current) {
          hasUserRespondedRef.current = false;
          phase.goToNextStep();
        } else {
          phase.setSubPhase("waiting-response");
        }
      }
      // Success: the turn is generated, saved and rendered exactly once.
      streamingRef.current = false;
      setIsStreaming(false);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        streamingRef.current = false;
        setIsStreaming(false);
        return;
      }
      const failure = failureFromError(err);
      // Structured one-liner so reports identify the real cause (F44/F45).
      console.error(`AI stream failed: code=${failure.code} status=${failure.status} hint=${failure.hint}`, err);
      // Drop partial text so a phantom bubble never lingers.
      setStreamingText("");
      streamingRef.current = false;
      setIsStreaming(false);
      setChatError({ message: failure.message, hint: failure.hint, retry: "ai" });
    }
  }, [session, phase, saveMessage, saveAssessState, enterQuiz, islandStep, islands, assessRound, provenConcepts, remediationCount]);

  const triggerAIResponse = useCallback(async () => {
    const currentMessages = storedMessagesRef.current;
    const stepPhase = phase.currentStep?.phase;
    const currentIsland = islands[phase.stepIndex];

    const filteredMessages = currentMessages.filter(
      (m) => !m.content.startsWith("__ISLANDS__:"),
    );
    // Bound token cost: the server also caps, but sending less keeps
    // sessions fast and far from model limits.
    const recentMessages = filteredMessages.slice(-30);

    const feedbackHint = evaluateResultRef.current?.feedback_hint;
    const teachIntent = teachIntentRef.current;
    const instruction = getPhaseInstruction(
      stepPhase || "",
      hasUserRespondedRef.current,
      currentIsland,
      islandStep,
      assessRound,
      assessQuestionRef.current,
      provenConcepts,
      feedbackHint,
      teachConceptIndex,
      teachIntent,
    );

    const apiMessages = recentMessages.length > 0
      ? recentMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
      : [{
          role: "user" as const,
          content: `A felhasználó ezt a témát szeretné megtanulni: "${topicName ?? "ismeretlen téma"}". Kezdd el a tanulást a tananyag és a fázis-instrukció alapján, magyarul.`,
        }];
    await streamAIResponse(apiMessages, instruction, currentIsland?.title);
  }, [streamAIResponse, topicName, phase, islands, islandStep, assessRound, provenConcepts, teachConceptIndex]);

  useEffect(() => {
    if (phase.subPhase !== "ai-responding") return;
    if (isStreaming || streamingRef.current) return;
    if (chatError) return;
    if (phase.currentStep?.phase === "complete") return;

    triggerAIResponse();
  }, [phase.subPhase, phase.currentStep?.phase, isStreaming, chatError, triggerAIResponse]);

  // Abort any in-flight stream when leaving the page.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (subPhaseTimerRef.current) clearTimeout(subPhaseTimerRef.current);
    };
  }, []);

  // Assess state is reset explicitly in proceedToNextIsland, handleStart
  // and handleRestart — no blanket effect here, so resuming a saved
  // assess/remediation is never wiped.

  // Completion is saved once by proceedToNextIsland (single PUT with
  // status completed). This effect is a safety net for sessions that
  // reach complete without it (e.g. legacy flows). Never in review mode.
  const completionSavedRef = useRef(false);
  useEffect(() => {
    if (phase.isComplete && session && islands.length > 0 && !isReview && !completionSavedRef.current) {
      completionSavedRef.current = true;
      saveCheckpoint(phase.currentCheckpoint, "completed", {
        island_step: "teach",
        assess_state: null,
      });
    }
    if (!phase.isComplete) {
      completionSavedRef.current = false;
    }
  }, [phase.isComplete, phase.currentCheckpoint, session, saveCheckpoint, islands.length, isReview]);

  // Island deep-link (?island=N, 1-based) from the roadmap. Returns the
  // 0-based index, or null when absent/invalid.
  const requestedIslandIndex = useCallback((): number | null => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("island");
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || n > islands.length) return null;
    return n - 1;
  }, [islands.length]);

  const handleStart = async () => {
    if (!session || islands.length === 0) {
      // No plan here — analysis lives on the dedicated analyze page now.
      router.push(`/topics/${topicId}/analyze`);
      return;
    }

    const requested = requestedIslandIndex();

    if (session.status === "completed") {
      // Review only: every island is completed territory.
      const idx = requested ?? 0;
      setIsReview(true);
      clearIslandLocals();
      setStoredMessages([]);
      setDisplayMessages([]);
      clearSaveError();
      setChatError(null);
      lastAnswerRef.current = "";
      phase.resumeFrom(idx);
      return;
    }

    // Clamp stale checkpoints (e.g. saved against an older, longer plan)
    // into the current plan instead of landing on the completion screen.
    const safeCheckpoint = Math.min(session.current_checkpoint, islands.length - 1);
    if (safeCheckpoint !== session.current_checkpoint) {
      setSession({ ...session, current_checkpoint: safeCheckpoint });
    }

    const idx =
      requested !== null && requested <= safeCheckpoint ? requested : safeCheckpoint;
    if (idx === safeCheckpoint) {
      // Current island: keep the restored islandStep (teach/assess/
      // remediation from initPage) — never force back to teach.
      setIsReview(false);
      phase.resumeFrom(safeCheckpoint);
    } else {
      // Completed island replay: fresh assess state, nothing persisted.
      setIsReview(true);
      clearIslandLocals();
      clearSaveError();
      setChatError(null);
      lastAnswerRef.current = "";
      phase.resumeFrom(idx);
    }
  };

  const handleAssessResponse = async (answer: string) => {
    if (!session || isEvaluating) return;
    setIsEvaluating(true);
    try {
      const currentIsland = islands[phase.stepIndex];
      if (!currentIsland) return;

      const result = await withAiRetry(
        async () => {
          const res = await aiFetch(
            "/api/evaluate",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: session.id,
                topicId,
                islandTitle: currentIsland.title,
                keyConcepts: currentIsland.key_concepts,
                question: assessQuestionRef.current,
                userAnswer: answer,
                round: assessRound,
                isRemediation: islandStep === "remediation",
                provenConcepts,
                isReview,
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
            console.warn(`Evaluate retry in ${delayMs}ms: ${failure.code}`);
          },
        },
      );

      // Decisive verdicts feed the blended island score (not_required
      // carries no evidence either way).
      accumulateTeachingVerdicts(visitTeachingRef.current, result.verdicts);

      const newProven = new Set(provenConcepts);
      const newWeak = new Set(weakConcepts);
      for (const v of result.verdicts) {
        const concept = v.concept?.trim();
        if (!concept) continue;
        if (v.verdict === "correct") {
          newProven.add(concept);
          newWeak.delete(concept);
        } else if (v.verdict === "wrong" || v.verdict === "partial") {
          newWeak.add(concept);
          newProven.delete(concept);
        }
      }
      setProvenConcepts(Array.from(newProven));
      setWeakConcepts(Array.from(newWeak));

      evaluateResultRef.current = result;
      hasUserRespondedRef.current = true;
      setChatError(null);
      phase.setSubPhase("ai-responding");
    } catch (err) {
      if (err instanceof ApiCallError && err.failure.status === 409) {
        // 409 = this round was already recorded (double-submit that slipped
        // through). The first request already advanced the flow — stay quiet.
        return;
      }
      const failure = failureFromError(err);
      console.error(`Evaluate failed: code=${failure.code} status=${failure.status}`, err);
      setChatError({ message: failure.message, hint: failure.hint, retry: "evaluate" });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleUserResponse = async (text: string) => {
    if (!session || isEvaluating || isStreaming || sendingRef.current) return;
    sendingRef.current = true;
    const trimmed = text.trim();
    if (!trimmed) {
      sendingRef.current = false;
      return;
    }
    setChatError(null);
    setDisplayMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    const sessionId = session.id;
    await saveMessage("user", trimmed);
    setStoredMessages((prev) => [...prev, { role: "user", content: trimmed, id: "", session_id: sessionId, created_at: new Date().toISOString() }]);

    try {
      if (islandStep === "assess" || islandStep === "remediation") {
        lastAnswerRef.current = trimmed;
        await handleAssessResponse(trimmed);
      } else {
        teachIntentRef.current = null;
        hasUserRespondedRef.current = true;
        phase.setSubPhase("ai-responding");
      }
    } finally {
      sendingRef.current = false;
    }
  };

  const handleChatRetry = async () => {
    if (!chatError || isStreaming || isEvaluating || sendingRef.current) return;
    const kind = chatError.retry;
    setChatError(null);
    if (kind === "ai") {
      await triggerAIResponse();
    } else if (lastAnswerRef.current) {
      await handleAssessResponse(lastAnswerRef.current);
    }
  };

  const handleBack = async () => {
    // Review persists nothing — leave without confirm or save.
    if (isReview) {
      abortRef.current?.abort();
      router.push(`/topics/${topicId}`);
      return;
    }
    if (session && phase.isStarted && !phase.isComplete) {
      const confirmed = window.confirm("Biztosan kilépsz a tanulásból? Az előrehaladásod elmentjük.");
      if (!confirmed) return;
      // Stop the stream first so it can't save after navigation.
      abortRef.current?.abort();
      try {
        if (islandStep === "assess" || islandStep === "remediation") {
          await saveAssessState();
        } else if (islandStep === "teach" && (teachRound > 0 || teachConceptIndex > 0)) {
          await saveCheckpoint(phase.currentCheckpoint, undefined, {
            island_step: "teach",
            assess_state: {
              round: 0,
              proven: [],
              weak: [],
              remediationCount: 0,
              nextFocus: "",
              teachRound,
              teachConceptIndex,
            },
          });
        } else {
          await saveCheckpoint(phase.currentCheckpoint);
        }
      } catch (err) {
        console.error("Failed to save on exit:", err);
      }
    } else {
      abortRef.current?.abort();
    }
    router.push(`/topics/${topicId}`);
  };

  // Applies a loaded session context (from loadLearnContext) onto the
  // engine: conversation, plan and the teach/assess snapshot to resume.
  const applyLoadedContext = useCallback((ctx: {
    session: ChatSession | null;
    islands: Island[];
    messages: ChatMessage[];
    displayMessages: DisplayMessage[];
    restore: IslandRestore | null;
  }) => {
    setSession(ctx.session);
    setStoredMessages(ctx.messages);
    setDisplayMessages(ctx.displayMessages);
    setIslands(ctx.islands);
    if (ctx.restore) {
      const r = ctx.restore;
      setIslandStep(r.islandStep);
      if (r.teachRound !== undefined) setTeachRound(r.teachRound);
      if (r.teachConceptIndex !== undefined) setTeachConceptIndex(r.teachConceptIndex);
      if (r.assessRound !== undefined) setAssessRound(r.assessRound);
      if (r.proven !== undefined) setProvenConcepts(r.proven);
      if (r.weak !== undefined) setWeakConcepts(r.weak);
      if (r.remediationCount !== undefined) setRemediationCount(r.remediationCount);
      if (r.nextFocus !== undefined) assessQuestionRef.current = r.nextFocus;
    }
  }, []);

  return {
    applyLoadedContext,
    phase,
    session,
    islands,
    displayMessages,
    storedMessages,
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
  };
}
