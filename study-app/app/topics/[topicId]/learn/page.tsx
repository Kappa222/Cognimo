"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { useSessionPhaseManager } from "../../../lib/useSessionPhaseManager";
import type {
  Topic,
  ChatSession,
  ChatMessage,
  Island,
  EvaluateResult,
  QuizAttemptBreakdown,
  QuizRunnerQuestion,
  QuizSubmittedAnswer,
} from "../../../lib/types";
import ProgressBar from "../../../components/ProgressBar";
import AIBubble from "../../../components/AIBubble";
import UserBubble from "../../../components/UserBubble";
import ResponseInput from "../../../components/ResponseInput";
import QuizRunner from "../../../components/QuizRunner";
import IslandScoreScreen from "../../../components/IslandScoreScreen";
import FinaleRunner from "../../../components/FinaleRunner";
import { LearnSkeleton } from "../../../components/LoadingSkeleton";

interface DisplayMessage {
  role: "ai" | "user";
  text: string;
}

export default function LearnPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [materialsCount, setMaterialsCount] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");

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
  const [saveError, setSaveError] = useState("");
  const [islands, setIslands] = useState<Island[]>([]);
  const [islandStep, setIslandStep] = useState<"teach" | "assess" | "remediation">("teach");
  const [assessRound, setAssessRound] = useState(0);
  const [provenConcepts, setProvenConcepts] = useState<string[]>([]);
  const [weakConcepts, setWeakConcepts] = useState<string[]>([]);
  const [remediationCount, setRemediationCount] = useState(0);
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Inline (non-fatal) chat errors: transient AI/evaluate failures show a
  // retry panel instead of hijacking the whole page like `error` does.
  const [chatError, setChatError] = useState<{
    message: string;
    retry: "ai" | "evaluate";
  } | null>(null);

  const islandTitles = islands.map((i) => i.title);
  const phase = useSessionPhaseManager(islandTitles);
  const abortRef = useRef<AbortController | null>(null);
  const storedMessagesRef = useRef(storedMessages);
  const hasUserRespondedRef = useRef(false);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const assessQuestionRef = useRef("");
  const evaluateResultRef = useRef<EvaluateResult | null>(null);
  // Per-visit teaching evidence for the blended island score: decisive
  // assess verdicts (not_required excluded) since entering this island.
  const visitTeachingRef = useRef({ correct: 0, partial: 0, total: 0 });
  // Mutual-exclusion guard: state updates lag rapid double-Enters, so a ref
  // (not state) is the only reliable double-submit barrier.
  const sendingRef = useRef(false);
  // Last assess answer for error-panel retries.
  const lastAnswerRef = useRef("");
  // initPage run id: stale runs after a topicId change bail out early.
  const initRunRef = useRef(0);

  const MAX_ASSESS_ROUNDS = 4;
  const MAX_REMEDIATION = 2;

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingText]);

  useEffect(() => { storedMessagesRef.current = storedMessages; }, [storedMessages]);

  useEffect(() => { hasUserRespondedRef.current = false; }, [phase.stepIndex]);

  const initPage = useCallback(async () => {
    const runId = ++initRunRef.current;
    const isStale = () => runId !== initRunRef.current;
    setPageLoading(true);
    setError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (isStale()) return;
    if (!user) { router.push("/login"); return; }

    const { data: t, error: topicErr } = await supabase
      .from("topics")
      .select("*")
      .eq("id", topicId)
      .single();
    if (isStale()) return;
    if (topicErr || !t) { setError("Nem sikerült betölteni a témát."); setPageLoading(false); return; }
    setTopic(t);

    const { count } = await supabase
      .from("study_materials")
      .select("*", { count: "exact", head: true })
      .eq("topic_id", topicId);
    if (isStale()) return;
    if (count !== null) setMaterialsCount(count);

    let activeSession: ChatSession | null = null;
    const res = await fetch(`/api/sessions?topic_id=${topicId}`);
    if (isStale()) return;
    if (res.ok) {
      const existing: ChatSession | null = await res.json();
      if (existing && existing.status === "in_progress") {
        activeSession = existing;
        const msgRes = await fetch(`/api/sessions/${existing.id}`);
        if (isStale()) return;
        if (msgRes.ok) {
          const { session: sessionData, messages } = await msgRes.json();
          if (isStale()) return;

          // Load islands from plan column (new) or fallback to __ISLANDS__: message (old)
          let loadedIslands: Island[] = [];
          if (sessionData?.plan && Array.isArray(sessionData.plan) && sessionData.plan.length > 0) {
            loadedIslands = sessionData.plan;
          } else {
            const islandMsg = messages.find(
              (m: ChatMessage) => m.role === "assistant" && m.content.startsWith("__ISLANDS__:"),
            );
            if (islandMsg) {
              try {
                loadedIslands = JSON.parse(islandMsg.content.slice(11));
              } catch { /* ignore */ }
            }
          }

          if (loadedIslands.length === 0) {
            // Unusable leftover (e.g. created before the plan column
            // existed): it can never start and would render as instant
            // completion. Abandon it so a fresh plan gets generated.
            try {
              await fetch(`/api/sessions/${existing.id}/checkpoint`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current_checkpoint: 0, status: "abandoned" }),
              });
            } catch (err) {
              console.error("Failed to abandon plan-less session:", err);
            }
            if (isStale()) return;
            setSession(null);
            setStoredMessages([]);
            setDisplayMessages([]);
          } else {
            setSession(activeSession);
            setStoredMessages(messages);
            setIslands(loadedIslands);

          // Restore assess state from session
          const sData = sessionData as { island_step?: string; assess_state?: { round: number; proven: string[]; weak: string[]; remediationCount: number; nextFocus: string } } | undefined;
          if (sData?.island_step && (sData.island_step === "assess" || sData.island_step === "remediation")) {
            setIslandStep(sData.island_step);
            if (sData.assess_state) {
              setAssessRound(sData.assess_state.round);
              setProvenConcepts(sData.assess_state.proven ?? []);
              setWeakConcepts(sData.assess_state.weak ?? []);
              setRemediationCount(sData.assess_state.remediationCount ?? 0);
              assessQuestionRef.current = sData.assess_state.nextFocus ?? "";
            } else {
              // assess_state lost (e.g. save failed) but mastery survived:
              // rebuild proven/weak for the current island from mastery.
              const island = loadedIslands[existing.current_checkpoint];
              if (island) {
                const { data: mastery } = await supabase
                  .from("concept_mastery")
                  .select("concept, status")
                  .eq("topic_id", topicId);
                if (isStale()) return;
                const byConcept = new Map(
                  ((mastery ?? []) as { concept: string; status: string }[]).map((m) => [m.concept, m.status]),
                );
                setProvenConcepts(
                  island.key_concepts.filter((c) => {
                    const s = byConcept.get(c);
                    return s === "solid" || s === "seen";
                  }),
                );
                setWeakConcepts(
                  island.key_concepts.filter((c) => byConcept.get(c) === "shaky"),
                );
                setAssessRound(1);
                assessQuestionRef.current = island.key_concepts[0] ?? "";
              }
            }
          }

          if (isStale()) return;
          setDisplayMessages(
            messages
              .filter((m: ChatMessage) => !m.content.startsWith("__ISLANDS__:"))
              .map((m: ChatMessage) => ({
                role: m.role === "assistant" ? "ai" : "user",
                text: m.content,
              })),
          );
          }
        }
      }
    }

    // No resumable session: a completed session's plan still enables island
    // review (?island=N). Messages are not restored — review starts fresh.
    if (!activeSession) {
      try {
        const anyRes = await fetch(`/api/sessions?topic_id=${topicId}&status=any`);
        if (isStale()) return;
        if (anyRes.ok) {
          const latest: (ChatSession & { plan?: unknown }) | null = await anyRes.json();
          if (
            latest &&
            Array.isArray(latest.plan) &&
            (latest.plan as Island[]).length > 0
          ) {
            activeSession = latest;
            setSession(latest);
            setIslands(latest.plan as Island[]);
          }
        }
      } catch (err) {
        console.error("Failed to load latest session:", err);
      }
    }

    if (isStale()) return;
    setPageLoading(false);
  }, [topicId, router]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { initPage(); }, [initPage]);

  const saveMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    if (!session) return false;
    // Review replays persist nothing — conversation stays local to the visit.
    if (isReview) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`/api/sessions/${session.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content }),
        });
        if (res.ok) {
          setSaveError("");
          return true;
        }
        console.error("Failed to save message:", res.status, await res.text());
      } catch (err) {
        console.error("Failed to save message:", err);
      }
    }
    setSaveError("Nem sikerült menteni az üzenetet. Újratöltéskor elveszhet.");
    return false;
  }, [session, isReview]);

  const saveCheckpoint = useCallback(async (
    checkpoint: number,
    status?: string,
    extra?: { island_step?: string | null; assess_state?: unknown },
  ) => {
    if (!session) {
      console.warn("saveCheckpoint dropped: no session");
      return false;
    }
    // Review replays must never move the saved checkpoint or status.
    if (isReview) return true;
    const body: Record<string, unknown> = { current_checkpoint: checkpoint };
    if (status) body.status = status;
    if (extra && "island_step" in extra) body.island_step = extra.island_step;
    if (extra && "assess_state" in extra) body.assess_state = extra.assess_state;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`/api/sessions/${session.id}/checkpoint`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setSaveError("");
          return true;
        }
        console.error("Failed to save checkpoint:", res.status, await res.text());
      } catch (err) {
        console.error("Failed to save checkpoint:", err);
      }
    }
    setSaveError("Nem sikerült menteni az előrehaladást. Újratöltéskor elveszhet.");
    return false;
  }, [session, isReview]);

  const saveAssessState = useCallback(async () => {
    await saveCheckpoint(phase.currentCheckpoint, undefined, {
      island_step: islandStep,
      assess_state: {
        round: assessRound,
        proven: provenConcepts,
        weak: weakConcepts,
        remediationCount,
        nextFocus: assessQuestionRef.current,
      },
    });
  }, [phase.currentCheckpoint, saveCheckpoint, islandStep, assessRound, provenConcepts, weakConcepts, remediationCount]);

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
      const res = await fetch("/api/islands/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, islandTitle: island.title }),
      });
      if (!res.ok) {
        const serverMessage = (await res.text()).trim();
        throw new Error(serverMessage || "Nem sikerült betölteni a kvízt. Próbáld újra!");
      }
      const body = await res.json();
      const questions = (body.questions ?? []) as QuizRunnerQuestion[];
      if (questions.length === 0) throw new Error("Üres kvíz érkezett. Próbáld újra!");
      setQuizQuestions(questions);
      setQuizStage("ready");
    } catch (err) {
      console.error("Island quiz load failed:", err);
      const message = err instanceof Error && err.message ? err.message : "";
      setQuizError(message || "Nem sikerült betölteni a kvízt. Próbáld újra!");
      setQuizStage("error");
    }
  }, [islands, phase, session, saveAssessState, topicId]);

  const submitQuiz = useCallback(
    async (answers: QuizSubmittedAnswer[]): Promise<QuizAttemptBreakdown> => {
      const island = islands[phase.currentCheckpoint];
      if (!island || !session) throw new Error("Hiányzó sziget. Töltsd újra az oldalt!");
      const visit = visitTeachingRef.current;
      const teachingCorrect = Math.round(visit.correct + 0.5 * visit.partial);
      const res = await fetch("/api/islands/quiz/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          islandTitle: island.title,
          answers,
          teachingCorrect,
          teachingTotal: visit.total,
        }),
      });
      if (!res.ok) {
        const serverMessage = (await res.text()).trim();
        throw new Error(serverMessage || "Nem sikerült beküldeni. Próbáld újra!");
      }
      const result = (await res.json()) as QuizAttemptBreakdown;
      setQuizResult(result);
      return result;
    },
    [islands, phase, session, topicId],
  );

  // Clear local assess state when leaving an island, so a revisit or a
  // back-navigation can't reuse stale questions and verdicts.
  const clearIslandLocals = useCallback(() => {
    assessQuestionRef.current = "";
    evaluateResultRef.current = null;
    hasUserRespondedRef.current = false;
    setAssessRound(0);
    setProvenConcepts([]);
    setWeakConcepts([]);
    setRemediationCount(0);
    setIslandStep("teach");
    visitTeachingRef.current = { correct: 0, partial: 0, total: 0 };
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
    if (!session) return;
    setIsStreaming(true);
    setStreamingText("");

    // One automatic retry with backoff; final failure becomes an inline
    // retry panel (chatError), never a full-page error.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        setStreamingText("");
        await new Promise((r) => setTimeout(r, 1500));
      }
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, messages: history, phaseInstruction, islandTitle }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) { const errText = await res.text(); throw new Error(`API error: ${res.status} ${errText}`); }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          setStreamingText(fullText);
        }
      // Flush any trailing multi-byte character.
      fullText += decoder.decode();

      if (fullText.trim()) {
        await saveMessage("assistant", fullText);
        setStoredMessages((prev) => [...prev, { role: "assistant", content: fullText, id: "", session_id: session.id, created_at: new Date().toISOString() }]);
        setDisplayMessages((prev) => [...prev, { role: "ai", text: fullText }]);
        setStreamingText("");
        setChatError(null);

        const stepPhase = phase.currentStep?.phase;

        if (stepPhase === "explain" && islandStep === "teach") {
          // End of teach → enter assess
          const currentIsland = islands[phase.stepIndex];
          const firstFocus = currentIsland?.key_concepts[0] ?? "";
          assessQuestionRef.current = firstFocus;
          hasUserRespondedRef.current = false;
          setAssessRound(1);
          setIslandStep("assess");
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
              setTimeout(() => phase.setSubPhase("ai-responding"), 100);
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
            setTimeout(() => phase.setSubPhase("ai-responding"), 100);
          } else {
            phase.setSubPhase("waiting-response");
          }
        } else if (stepPhase === "complete") {
          // No-op, completion screen handles it
        } else {
          if (hasUserRespondedRef.current) {
            hasUserRespondedRef.current = false;
            phase.goToNextStep();
          } else {
            phase.setSubPhase("waiting-response");
          }
        }
      } else {
        // Empty response counts as a failed attempt — throw to retry.
        throw new Error("Empty response from AI");
      }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setIsStreaming(false);
          return;
        }
        console.error(`AI stream error (attempt ${attempt + 1}/2):`, err);
        // Drop partial text so a phantom bubble never lingers.
        setStreamingText("");
        if (attempt === 1) {
          setChatError({
            message: "Nem sikerült kapcsolódni Lumihoz. Ellenőrizd az internetet, majd próbáld újra!",
            retry: "ai",
          });
        }
      }
    }
    setIsStreaming(false);
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
    const instruction = getPhaseInstruction(
      stepPhase || "",
      hasUserRespondedRef.current,
      currentIsland,
      islandStep,
      assessRound,
      assessQuestionRef.current,
      provenConcepts,
      feedbackHint,
    );

    const apiMessages = recentMessages.length > 0
      ? recentMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
      : [{
          role: "user" as const,
          content: `A felhasználó ezt a témát szeretné megtanulni: "${topic?.name ?? "ismeretlen téma"}". Kezdd el a tanulást a tananyag és a fázis-instrukció alapján, magyarul.`,
        }];
    await streamAIResponse(apiMessages, instruction, currentIsland?.title);
  }, [streamAIResponse, topic, phase, islands, islandStep, assessRound, provenConcepts]);

  useEffect(() => {
    if (phase.subPhase !== "ai-responding") return;
    if (isStreaming) return;
    if (chatError) return;
    if (phase.currentStep?.phase === "complete") return;

    triggerAIResponse();
  }, [phase.subPhase, phase.currentStep?.phase, isStreaming, chatError, triggerAIResponse]);

  // Abort any in-flight stream when leaving the page.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
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
      setSaveError("");
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
      setSaveError("");
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

      const res = await fetch("/api/evaluate", {
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
      });

      if (!res.ok) {
        // 409 = this round was already recorded (double-submit that slipped
        // through). The first request already advanced the flow — stay quiet.
        if (res.status === 409) {
          setIsEvaluating(false);
          return;
        }
        const errText = await res.text();
        console.error("Evaluate error:", res.status, errText);
        setChatError({
          message: "Az értékelés nem sikerült. Próbáld újra, vagy írj új választ!",
          retry: "evaluate",
        });
        setIsEvaluating(false);
        return;
      }

      const result: EvaluateResult = await res.json();

      if (!Array.isArray(result.verdicts)) {
        console.error("Evaluate error: malformed verdicts", result);
        setChatError({
          message: "Az értékelés nem sikerült. Próbáld újra, vagy írj új választ!",
          retry: "evaluate",
        });
        setIsEvaluating(false);
        return;
      }

      const newProven = new Set(provenConcepts);
      const newWeak = new Set(weakConcepts);
      const visit = visitTeachingRef.current;
      for (const v of result.verdicts) {
        const concept = v.concept?.trim();
        if (!concept) continue;
        // Decisive verdicts feed the blended island score (not_required
        // carries no evidence either way).
        if (v.verdict !== "not_required") {
          visit.total += 1;
          if (v.verdict === "correct") visit.correct += 1;
          else if (v.verdict === "partial") visit.partial += 1;
        }
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
      console.error("Evaluate error:", err);
      setChatError({
        message: "Az értékelés nem sikerült. Próbáld újra, vagy írj új választ!",
        retry: "evaluate",
      });
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

        {/* Text input for user — hidden during evaluate */}
        {phase.subPhase === "waiting-response" && !isStreaming && !isEvaluating && (
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
            onDone={() => {}}
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


function getPhaseInstruction(
  phase: string,
  isFollowUp: boolean,
  currentIsland?: Island,
  islandStep?: "teach" | "assess" | "remediation",
  assessRound?: number,
  assessQuestionRef?: string,
  provenConcepts?: string[],
  feedbackHint?: string,
): string {
  if (currentIsland) {
    if (islandStep === "teach") {
      const approachGuides: Record<string, { guide: string; closing: string }> = {
        scenario: {
          guide: "Mutass be egy valós életből vett szituációt vagy problémát, és vezesd végig a felhasználót a megértésén.",
          closing: "A szituáció végén EGYETLEN nyitott kérdéssel add át a szót a felhasználónak.",
        },
        socratic: {
          guide: "Tegyél fel irányított kérdéseket, amelyek segítenek a felhasználónak magától felfedezni a választ. Ne mondd ki a választ előre.",
          closing: "Egyszerre csak EGY kérdést tegyél fel, és várd meg a felhasználó válaszát.",
        },
        conversational: {
          guide: "Magyarázd el természetes, beszélgetős stílusban a témát.",
          closing: "A magyarázat végén rövid, egyetlen kérdéssel ellenőrizd, hogy követhető volt-e.",
        },
      };
      const a = approachGuides[currentIsland.approach] ?? approachGuides.conversational;
      return `Fázis: Tanulás — ${a.guide} Csak a(z) "${currentIsland.title}" részhez tartozó kulcsfogalmakat fedd le: ${currentIsland.key_concepts.join(", ")}. NE említs más szigeteket vagy későbbi témákat. ${a.closing} Beszélj magyarul.`;
    }

    if (islandStep === "assess" && !isFollowUp) {
      const focus = assessQuestionRef || currentIsland.key_concepts[0] || "";
      // Prefer a probe question about the focus concept; a mismatched hint
      // would steer Lumi at the wrong concept.
      const focusWords = focus.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const probe =
        currentIsland.probe_questions.find((q) => {
          const lower = q.toLowerCase();
          return focusWords.some((w) => lower.includes(w));
        }) ?? null;
      const probeHint = probe ? ` Kiindulásnak használhatod ezt a kérdést: "${probe}".` : "";
      return `Fázis: Ellenőrzés — fordított tanár. Te most egy lelkes, de értetlen diák vagy, a felhasználó a tanárod. A(z) "${currentIsland.title}" témából a következő fogalmat NEM érted: "${focus}". Tegyél fel EGYETLEN természetes, diákos kérdést erről a fogalomról — olyat, amire csak valódi megértéssel lehet jól válaszolni, bemagolt definícióval nem. Ne magyarázz, ne segíts, csak kérdezz. Beszélj magyarul.${probeHint}`;
    }

    if ((islandStep === "assess" || islandStep === "remediation") && isFollowUp) {
      const hint = feedbackHint || "A felhasználó válaszolt a kérdésedre.";
      return `Fázis: Ellenőrzés — fordított tanár, reakció. A tanárod (a felhasználó) most magyarázott neked. Értékelési támpont: ${hint}. Diákként reagálj erre 2-3 mondatban: ha jól magyarázott, mutasd meg, hogy megértetted (mondd vissza SAJÁT példával); ha hibázott vagy hiányos volt, diákos értetlenséggel kérdezz vissza pont a problémás részre. Ne oktasd ki, ne javítsd ki tanárosan — te a diák vagy. Beszélj magyarul.`;
    }

    if (islandStep === "remediation" && !isFollowUp) {
      const weakList = provenConcepts?.length
        ? currentIsland.key_concepts.filter((k) => !provenConcepts.includes(k)).join(", ")
        : currentIsland.key_concepts.join(", ");
      return `Fázis: Felzárkóztatás. A felhasználónak a következő fogalmak mentek gyengén: ${weakList}. Most rövid időre lépj ki a diák-szerepből: tanulópartnerként adj fogalmanként egy rövid (3-4 mondatos), az eddigitől ELTÉRŐ megközelítésű magyarázatot — hétköznapi analógiával vagy konkrét példával. Zárásként jelezd, hogy mindjárt visszaváltasz diáknak, és újra kérdezni fogsz. Beszélj magyarul.`;
    }
  }
  if (phase === "explain") {
    return isFollowUp
      ? "A felhasználó reagált a magyarázatodra. Válaszolj a kérdésére vagy nyugtázd röviden, majd folytasd a téma következő részével. Beszélj magyarul."
      : "Fázis: Gyakorlatok — Magyarázd el a témát lépésről lépésre a tananyag alapján. Részletes és érthető magyarázatot adj.";
  }
  return "";
}
