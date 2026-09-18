"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { useSessionPhaseManager } from "../../../lib/useSessionPhaseManager";
import type { Topic, ChatSession, ChatMessage, Island, EvaluateResult } from "../../../lib/types";
import ProgressBar from "../../../components/ProgressBar";
import AIBubble from "../../../components/AIBubble";
import UserBubble from "../../../components/UserBubble";
import ResponseInput from "../../../components/ResponseInput";
import CompletionScreen from "../../../components/CompletionScreen";
import { LearnSkeleton } from "../../../components/LoadingSkeleton";

interface DisplayMessage {
  role: "ai" | "user";
  text: string;
}

export default function LearnPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const router = useRouter();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [materialsCount, setMaterialsCount] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState("");

  const [session, setSession] = useState<ChatSession | null>(null);
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [storedMessages, setStoredMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingIslands, setIsGeneratingIslands] = useState(false);
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
  const autoStartRef = useRef(false);
  const assessQuestionRef = useRef("");
  const evaluateResultRef = useRef<EvaluateResult | null>(null);
  const forceFarewellRef = useRef(false);
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
    setSubjectId(t.subject_id);

    const { count } = await supabase
      .from("study_materials")
      .select("*", { count: "exact", head: true })
      .eq("topic_id", topicId);
    if (isStale()) return;
    if (count !== null) setMaterialsCount(count);

    const res = await fetch(`/api/sessions?topic_id=${topicId}`);
    if (isStale()) return;
    if (res.ok) {
      const existing: ChatSession | null = await res.json();
      if (existing && existing.status === "in_progress") {
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
            setSession(existing);
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

    if (isStale()) return;
    setPageLoading(false);
  }, [topicId, router]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { initPage(); }, [initPage]);

  const saveMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    if (!session) return false;
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
  }, [session]);

  const saveCheckpoint = useCallback(async (
    checkpoint: number,
    status?: string,
    extra?: { island_step?: string | null; assess_state?: unknown },
  ) => {
    if (!session) {
      console.warn("saveCheckpoint dropped: no session");
      return false;
    }
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
  }, [session]);

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

  const proceedToNextIsland = useCallback(async () => {
    const nextCheckpoint = phase.currentCheckpoint + 1;
    if (nextCheckpoint >= islands.length) {
      // Final island: single PUT marks completion, then show completion screen.
      await saveCheckpoint(islands.length, "completed", {
        island_step: "teach",
        assess_state: null,
      });
      phase.goToNextStep();
    } else {
      // Save progress + clear stale assess state BEFORE leaving Learn,
      // so a reload on the roadmap never restores the old island's state.
      await saveCheckpoint(nextCheckpoint, undefined, {
        island_step: "teach",
        assess_state: null,
      });
      // Clear local assess state so a back-navigation can't reuse it.
      assessQuestionRef.current = "";
      evaluateResultRef.current = null;
      forceFarewellRef.current = false;
      hasUserRespondedRef.current = false;
      setAssessRound(0);
      setProvenConcepts([]);
      setWeakConcepts([]);
      setRemediationCount(0);
      setIslandStep("teach");
      router.push(`/topics/${topicId}`);
    }
  }, [phase, islands.length, saveCheckpoint, router, topicId]);

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

        // Farewell was just streamed — now advance. Checked first because
        // islandStep is still assess/remediation while farewelling.
        if (forceFarewellRef.current) {
          forceFarewellRef.current = false;
          await proceedToNextIsland();
          setIsStreaming(false);
          return;
        }

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
            // All concepts proven → success gate
            await saveAssessState();
            await proceedToNextIsland();
          } else if (result && assessRound >= MAX_ASSESS_ROUNDS) {
            // Max rounds reached → check gate
            const currentIsland = islands[phase.stepIndex];
            const allProven = currentIsland?.key_concepts.every(
              (k) => provenConcepts.includes(k),
            ) ?? false;

            if (allProven) {
              await saveAssessState();
              await proceedToNextIsland();
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
              // Force proceed — send farewell first
              forceFarewellRef.current = true;
              hasUserRespondedRef.current = false;
              await saveAssessState();
              setTimeout(() => phase.setSubPhase("ai-responding"), 100);
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
  }, [session, phase, saveMessage, saveAssessState, proceedToNextIsland, islandStep, islands, assessRound, provenConcepts, remediationCount]);

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

    let instruction: string;
    if (forceFarewellRef.current) {
      const weakList = currentIsland?.key_concepts
        .filter((k) => !provenConcepts.includes(k))
        .join(", ") ?? "";
      instruction = `Fázis: Befejezés. A felhasználó most fejezte be a(z) "${currentIsland?.title ?? ""}" rész tanulását. Adj rövid, bátorító összefoglalót (2-3 mondat), ami megnevezi, hogy mely fogalmakhoz érdemes később visszatérni: ${weakList}. Beszélj magyarul.`;
    } else {
      const feedbackHint = evaluateResultRef.current?.feedback_hint;
      instruction = getPhaseInstruction(
        stepPhase || "",
        hasUserRespondedRef.current,
        currentIsland,
        islandStep,
        assessRound,
        assessQuestionRef.current,
        provenConcepts,
        feedbackHint,
      );
    }

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

  // Auto-start when islands are loaded
  useEffect(() => {
    if (autoStartRef.current && phase.subPhase === "idle" && islands.length > 0) {
      autoStartRef.current = false;
      phase.start();
    }
  }, [islands, phase.subPhase, phase]);

  // Assess state is reset explicitly in proceedToNextIsland,
  // generateIslandsAndStart and handleRestart — no blanket effect here,
  // so resuming a saved assess/remediation is never wiped.

  // Completion is saved once by proceedToNextIsland (single PUT with
  // status completed). This effect is a safety net for sessions that
  // reach complete without it (e.g. legacy flows).
  const completionSavedRef = useRef(false);
  useEffect(() => {
    if (phase.isComplete && session && islands.length > 0 && !completionSavedRef.current) {
      completionSavedRef.current = true;
      saveCheckpoint(phase.currentCheckpoint, "completed", {
        island_step: "teach",
        assess_state: null,
      });
    }
    if (!phase.isComplete) {
      completionSavedRef.current = false;
    }
  }, [phase.isComplete, phase.currentCheckpoint, session, saveCheckpoint, islands.length]);

  const generateIslandsAndStart = async () => {
    if (!topic || !subjectId || !topicId) return;

    setIsGeneratingIslands(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });

      if (!res.ok) {
        // Surface the server's message (Hungarian, specific) instead of a
        // generic failure so the next error diagnoses itself.
        const serverMessage = (await res.text()).trim();
        throw new Error(
          serverMessage || `Island generation failed (${res.status})`,
        );
      }

      const raw: unknown = await res.json();
      // Validate AI output shape before it touches session state — malformed
      // islands crash phase instructions (key_concepts.join etc.).
      const islandsData: Island[] = (Array.isArray(raw) ? raw : [])
        .filter(
          (i): i is Island =>
            !!i &&
            typeof i === "object" &&
            typeof (i as { title?: unknown }).title === "string" &&
            ((i as { title: string }).title.trim().length > 0) &&
            Array.isArray((i as { key_concepts?: unknown }).key_concepts) &&
            ((i as { key_concepts: unknown[] }).key_concepts.length > 0) &&
            Array.isArray((i as { probe_questions?: unknown }).probe_questions),
        )
        .map((i) => ({
          title: (i as { title: string }).title,
          approach: (["scenario", "socratic", "conversational"] as const).includes(
            (i as { approach?: string }).approach as "scenario",
          )
            ? ((i as { approach: "scenario" | "socratic" | "conversational" }).approach)
            : ("conversational" as const),
          key_concepts: ((i as { key_concepts: unknown[] }).key_concepts as unknown[]).filter(
            (c): c is string => typeof c === "string" && c.trim().length > 0,
          ),
          probe_questions: ((i as { probe_questions: unknown[] }).probe_questions as unknown[]).filter(
            (q): q is string => typeof q === "string" && q.trim().length > 0,
          ),
          ...("chunk_indices" in (i as object) ? { chunk_indices: (i as Island).chunk_indices } : {}),
          ...("chunk_refs" in (i as object) ? { chunk_refs: (i as Island).chunk_refs } : {}),
        }))
        .filter((i) => i.key_concepts.length > 0);
      if (islandsData.length === 0) throw new Error("No islands generated");

      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId, subject_id: subjectId, plan: islandsData }),
      });
      if (!sessionRes.ok) throw new Error("Session creation failed");

      const newSession: ChatSession = await sessionRes.json();
      setSession(newSession);

      setStoredMessages([]);
      setDisplayMessages([]);
      setIslandStep("teach");
      setAssessRound(0);
      setProvenConcepts([]);
      setWeakConcepts([]);
      setRemediationCount(0);
      assessQuestionRef.current = "";
      evaluateResultRef.current = null;
      forceFarewellRef.current = false;
      hasUserRespondedRef.current = false;
      setSaveError("");
      setChatError(null);
      lastAnswerRef.current = "";

      setIslands(islandsData);
      autoStartRef.current = true;
    } catch (err) {
      console.error("Failed to start learning:", err);
      const message = err instanceof Error ? err.message : "";
      // Server messages are already user-facing Hungarian; anything else
      // (network failure, 503) gets the generic retry prompt.
      setError(
        message && !message.startsWith("Island generation failed")
          ? message
          : "Nem sikerült elindítani a tanulást. Próbáld újra!",
      );
    } finally {
      setIsGeneratingIslands(false);
    }
  };

  const handleStart = async () => {
    if (isGeneratingIslands) return;

    if (islands.length === 0) {
      // No usable plan (shouldn't happen after init cleanup) — generate fresh.
      await generateIslandsAndStart();
      return;
    }

    if (session && session.status === "in_progress" && session.current_checkpoint > 0) {
      // Resume: keep the restored islandStep (teach/assess/remediation from
      // initPage) — never force back to teach. Clamp stale checkpoints
      // (e.g. saved against an older, longer plan) into the current plan
      // instead of landing on the completion screen.
      const safeCheckpoint = Math.min(session.current_checkpoint, islands.length - 1);
      if (safeCheckpoint !== session.current_checkpoint) {
        setSession({ ...session, current_checkpoint: safeCheckpoint });
      }
      phase.resumeFrom(safeCheckpoint);
    } else if (session && session.status === "in_progress") {
      setIslandStep("teach");
      phase.start();
    } else {
      await generateIslandsAndStart();
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

  const handleRestart = async () => {
    // Stop any in-flight AI stream so it can't write into the fresh state.
    abortRef.current?.abort();
    // Abandon the DB session so the next visit never resumes stale progress.
    if (session) {
      try {
        await fetch(`/api/sessions/${session.id}/checkpoint`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_checkpoint: 0, status: "abandoned" }),
        });
      } catch (err) {
        console.error("Failed to abandon session:", err);
      }
    }
    phase.reset();
    setSession(null);
    setDisplayMessages([]);
    setStoredMessages([]);
    setStreamingText("");
    setIsStreaming(false);
    setIsEvaluating(false);
    setSaveError("");
    setChatError(null);
    lastAnswerRef.current = "";
    setIslands([]);
    setIslandStep("teach");
    setAssessRound(0);
    setProvenConcepts([]);
    setWeakConcepts([]);
    setRemediationCount(0);
    assessQuestionRef.current = "";
    evaluateResultRef.current = null;
    forceFarewellRef.current = false;
    hasUserRespondedRef.current = false;
    autoStartRef.current = false;
    sendingRef.current = false;
  };

  const handleBack = async () => {
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

        {/* Island generation — loading */}
        {isGeneratingIslands && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
            <p className="text-sm text-zinc-500">Lumi elemzi a tananyagot...</p>
          </div>
        )}

        {/* Idle — pre-start (hidden once complete) */}
        {phase.subPhase === "idle" && !phase.isComplete && !isGeneratingIslands && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="mb-1 text-lg font-medium text-zinc-600 dark:text-zinc-400">📚 Készen állsz tanulni?</p>
            <p className="mb-6 text-sm text-zinc-400">Lumi először elemzi a tananyagot, majd egyéni tanulási tervet készít.</p>
            <button onClick={handleStart} className="cursor-pointer rounded-lg bg-accent px-8 py-3 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]">
              {session && session.status === "in_progress" ? "▶️ Folytatás" : "🚀 Kezdés"}
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

        {/* Completion — only with a real plan; empty islands can never complete */}
        {phase.isComplete && islands.length > 0 && (
          <CompletionScreen
            topicName={topic.name}
            topicId={topicId}
            onRestart={handleRestart}
            onBack={() => router.push(`/topics/${topicId}`)}
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
