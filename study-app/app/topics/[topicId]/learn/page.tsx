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

  const islandTitles = islands.map((i) => i.title);
  const phase = useSessionPhaseManager(islandTitles);
  const abortRef = useRef<AbortController | null>(null);
  const storedMessagesRef = useRef(storedMessages);
  const hasUserRespondedRef = useRef(false);
  const streamFailCountRef = useRef(0);
  const prevPhaseRef = useRef("");
  const contentEndRef = useRef<HTMLDivElement>(null);
  const autoStartRef = useRef(false);
  const assessQuestionRef = useRef("");
  const evaluateResultRef = useRef<EvaluateResult | null>(null);
  const forceFarewellRef = useRef(false);

  const MAX_ASSESS_ROUNDS = 4;
  const MAX_REMEDIATION = 2;

  useEffect(() => {
    contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingText]);

  useEffect(() => { storedMessagesRef.current = storedMessages; }, [storedMessages]);

  useEffect(() => { hasUserRespondedRef.current = false; }, [phase.stepIndex]);

  const initPage = useCallback(async () => {
    setPageLoading(true);
    setError("");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: t, error: topicErr } = await supabase
      .from("topics")
      .select("*")
      .eq("id", topicId)
      .single();
    if (topicErr || !t) { setError("Nem sikerült betölteni a témát."); setPageLoading(false); return; }
    setTopic(t);
    setSubjectId(t.subject_id);

    const { count } = await supabase
      .from("study_materials")
      .select("*", { count: "exact", head: true })
      .eq("topic_id", topicId);
    if (count !== null) setMaterialsCount(count);

    const res = await fetch(`/api/sessions?topic_id=${topicId}`);
    if (res.ok) {
      const existing: ChatSession | null = await res.json();
      if (existing && existing.status === "in_progress") {
        setSession(existing);
        const msgRes = await fetch(`/api/sessions/${existing.id}`);
        if (msgRes.ok) {
          const { session: sessionData, messages } = await msgRes.json();
          setStoredMessages(messages);

          // Load islands from plan column (new) or fallback to __ISLANDS__: message (old)
          if (sessionData?.plan && Array.isArray(sessionData.plan) && sessionData.plan.length > 0) {
            setIslands(sessionData.plan);
          } else {
            const islandMsg = messages.find(
              (m: ChatMessage) => m.role === "assistant" && m.content.startsWith("__ISLANDS__:"),
            );
            if (islandMsg) {
              try {
                const data: Island[] = JSON.parse(islandMsg.content.slice(11));
                setIslands(data);
              } catch { /* ignore */ }
            }
          }

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
            }
          }

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

    setPageLoading(false);
  }, [topicId, router]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { initPage(); }, [initPage]);

  const saveMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    if (!session) return;
    const res = await fetch(`/api/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
    if (!res.ok) {
      console.error("Failed to save message:", await res.text());
      setSaveError("Nem sikerült menteni az üzenetet.");
    }
  }, [session]);

  const saveCheckpoint = useCallback(async (
    checkpoint: number,
    status?: string,
    extra?: { island_step?: string; assess_state?: unknown },
  ) => {
    if (!session) return;
    const body: Record<string, unknown> = { current_checkpoint: checkpoint };
    if (status) body.status = status;
    if (extra?.island_step) body.island_step = extra.island_step;
    if (extra?.assess_state) body.assess_state = extra.assess_state;
    const res = await fetch(`/api/sessions/${session.id}/checkpoint`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Failed to save checkpoint:", await res.text());
      setSaveError("Nem sikerült menteni az előrehaladást.");
    }
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
      await saveCheckpoint(islands.length);
      phase.goToNextStep();
    } else {
      await saveCheckpoint(nextCheckpoint);
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
    abortRef.current = new AbortController();
    // Retry count persists across calls; reset on new user action below

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

      if (fullText) {
        await saveMessage("assistant", fullText);
        setStoredMessages((prev) => [...prev, { role: "assistant", content: fullText, id: "", session_id: session!.id, created_at: new Date().toISOString() }]);
        setDisplayMessages((prev) => [...prev, { role: "ai", text: fullText }]);
        setStreamingText("");

        const stepPhase = phase.currentStep?.phase;

        if (stepPhase === "explain" && islandStep === "teach") {
          // End of teach → enter assess
          const currentIsland = islands[phase.stepIndex];
          const firstFocus = currentIsland?.key_concepts[0] ?? "";
          assessQuestionRef.current = firstFocus;
          setAssessRound(1);
          setIslandStep("assess");
          phase.setSubPhase("waiting-response");
        } else if (islandStep === "assess" || islandStep === "remediation") {
          // After Lumi's reaction stream
          const result = evaluateResultRef.current;
          evaluateResultRef.current = null;

          if (result && result.next_focus === null) {
            // All concepts proven → success gate
            saveAssessState();
            proceedToNextIsland();
          } else if (result && assessRound >= MAX_ASSESS_ROUNDS) {
            // Max rounds reached → check gate
            const currentIsland = islands[phase.stepIndex];
            const allProven = currentIsland?.key_concepts.every(
              (k) => provenConcepts.includes(k),
            ) ?? false;

            if (allProven) {
              saveAssessState();
              proceedToNextIsland();
            } else if (remediationCount < MAX_REMEDIATION && islandStep === "assess") {
              // Enter remediation
              const newCount = remediationCount + 1;
              setRemediationCount(newCount);
              setIslandStep("remediation");
              setAssessRound(1);
              saveAssessState();
              // Trigger remediation micro-lesson immediately
              setTimeout(() => phase.setSubPhase("ai-responding"), 100);
            } else {
              // Force proceed — send farewell first
              forceFarewellRef.current = true;
              saveAssessState();
              setTimeout(() => phase.setSubPhase("ai-responding"), 100);
            }
          } else if (result && result.next_focus) {
            // Ask next question
            assessQuestionRef.current = result.next_focus;
            setAssessRound((r) => r + 1);
            saveAssessState();
            setTimeout(() => phase.setSubPhase("ai-responding"), 100);
          } else {
            phase.setSubPhase("waiting-response");
          }
        } else if (forceFarewellRef.current) {
          // Farewell message was just sent — now proceed
          forceFarewellRef.current = false;
          proceedToNextIsland();
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
        // Empty response — auto-retry up to 2 times, show error only after
        streamFailCountRef.current++;
        if (streamFailCountRef.current >= 2) {
          setStreamingText("");
          setError("Az AI nem tudott választ adni. Próbáld újra!");
          streamFailCountRef.current = 0;
          if (phase.subPhase === "ai-responding") {
            phase.setSubPhase("waiting-response");
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("AI stream error:", err);
      streamFailCountRef.current++;
      if (streamFailCountRef.current >= 2) {
        setError("Nem sikerült kapcsolódni a mesterséges intelligenciához. Próbáld újra!");
        streamFailCountRef.current = 0;
        phase.setSubPhase("waiting-response");
      }
    } finally {
      setIsStreaming(false);
    }
  }, [session, phase, saveMessage, islandStep]);

  const triggerAIResponse = useCallback(async () => {
    const currentMessages = storedMessagesRef.current;
    const stepPhase = phase.currentStep?.phase;
    const currentIsland = islands[phase.stepIndex];

    const filteredMessages = currentMessages.filter(
      (m) => !m.content.startsWith("__ISLANDS__:"),
    );

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

    const apiMessages = filteredMessages.length > 0
      ? filteredMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
      : [{
          role: "user" as const,
          content: `A felhasználó ezt a témát szeretné megtanulni: "${topic?.name ?? "ismeretlen téma"}". Kezdd el a tanulást a tananyag és a fázis-instrukció alapján, magyarul.`,
        }];
    await streamAIResponse(apiMessages, instruction, currentIsland?.title);
  }, [streamAIResponse, topic, phase, islands, islandStep]);

  useEffect(() => {
    if (phase.subPhase !== "ai-responding") return;
    if (isStreaming) return;
    if (phase.currentStep?.phase === "complete") return;

    triggerAIResponse();
  }, [phase.subPhase, phase.currentStep?.phase, isStreaming, triggerAIResponse]);

  // Auto-start when islands are loaded
  useEffect(() => {
    if (autoStartRef.current && phase.subPhase === "idle" && islands.length > 0) {
      autoStartRef.current = false;
      phase.start();
    }
  }, [islands, phase.subPhase, phase]);

  // Assess phase: reset state when entering a new island
  useEffect(() => {
    if (islandStep === "teach") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssessRound(0);
      setProvenConcepts([]);
      setWeakConcepts([]);
    }
  }, [phase.stepIndex, islandStep]);

  // Save checkpoint after each island completes
  useEffect(() => {
    if (phase.isStarted && !phase.isComplete && phase.currentCheckpoint > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      saveCheckpoint(phase.currentCheckpoint);
    }
  }, [phase.currentCheckpoint, phase.isStarted, phase.isComplete, saveCheckpoint]);

  // Mark session as completed when reaching the end
  useEffect(() => {
    if (phase.isComplete && session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      saveCheckpoint(phase.currentCheckpoint, "completed");
    }
  }, [phase.isComplete, phase.currentCheckpoint, session, saveCheckpoint]);

  // Track phase for cleanup
  useEffect(() => {
    prevPhaseRef.current = phase.currentStep?.phase ?? "";
  }, [phase.currentStep?.phase]);

  const generateIslandsAndStart = async () => {
    if (!topic || !subjectId || !topicId) return;

    setIsGeneratingIslands(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });

      if (!res.ok) throw new Error("Island generation failed");

      const islandsData: Island[] = await res.json();
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

      setIslands(islandsData);
      autoStartRef.current = true;
    } catch (err) {
      console.error("Failed to start learning:", err);
      setError("Nem sikerült elindítani a tanulást. Próbáld újra!");
    } finally {
      setIsGeneratingIslands(false);
    }
  };

  const handleStart = async () => {
    if (isGeneratingIslands) return;

    if (session && session.status === "in_progress" && session.current_checkpoint > 0) {
      setIslandStep("teach");
      phase.resumeFrom(session.current_checkpoint);
    } else if (session && session.status === "in_progress") {
      setIslandStep("teach");
      phase.start();
    } else {
      await generateIslandsAndStart();
    }
  };

  const handleAssessResponse = async (answer: string) => {
    if (!session) return;
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
        const errText = await res.text();
        console.error("Evaluate error:", res.status, errText);
        setError("Értékelési hiba. Próbáld újra!");
        setIsEvaluating(false);
        return;
      }

      const result: EvaluateResult = await res.json();

      const newProven = new Set(provenConcepts);
      const newWeak = new Set(weakConcepts);
      for (const v of result.verdicts) {
        if (v.verdict === "correct") newProven.add(v.concept);
        else if (v.verdict === "wrong" || v.verdict === "partial") newWeak.add(v.concept);
      }
      setProvenConcepts(Array.from(newProven));
      setWeakConcepts(Array.from(newWeak));

      evaluateResultRef.current = result;
      hasUserRespondedRef.current = true;
      phase.setSubPhase("ai-responding");
    } catch (err) {
      console.error("Evaluate error:", err);
      setError("Értékelési hiba. Próbáld újra!");
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleUserResponse = async (text: string) => {
    streamFailCountRef.current = 0;
    setDisplayMessages((prev) => [...prev, { role: "user", text }]);
    await saveMessage("user", text);
    setStoredMessages((prev) => [...prev, { role: "user", content: text, id: "", session_id: session!.id, created_at: new Date().toISOString() }]);

    if (islandStep === "assess" || islandStep === "remediation") {
      await handleAssessResponse(text);
    } else {
      hasUserRespondedRef.current = true;
      phase.setSubPhase("ai-responding");
    }
  };

  const handleRestart = () => {
    phase.reset();
    setSession(null);
    setDisplayMessages([]);
    setStoredMessages([]);
    setIslands([]);
    setIslandStep("teach");
  };

  const handleBack = async () => {
    if (session && phase.isStarted && !phase.isComplete) {
      const confirmed = window.confirm("Biztosan kilépsz a tanulásból? Az előrehaladásod elmentjük.");
      if (!confirmed) return;
      if (islandStep === "assess" || islandStep === "remediation") {
        await saveAssessState();
      } else {
        await saveCheckpoint(phase.currentCheckpoint);
      }
    }
    if (isGeneratingIslands) {
      abortRef.current?.abort();
    }
    router.push(`/topics/${topicId}`);
  };

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
  const characterAvatar = "/avatars/lumi.svg";

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

        {/* Idle — pre-start */}
        {phase.subPhase === "idle" && !isGeneratingIslands && (
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

        {/* Waiting for AI to start responding */}
        {phase.subPhase === "ai-responding" && isStreaming && !streamingText && phase.isStarted && (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4 dark:border-zinc-800/60 dark:bg-zinc-900/50">
            <div className="h-3 w-3 animate-pulse rounded-full bg-accent" />
            <p className="text-sm text-zinc-500">Lumi válaszát várjuk...</p>
          </div>
        )}

        {/* Thinking indicator — AI is processing before streaming starts */}
        {phase.subPhase === "ai-responding" && !isStreaming && phase.isStarted && (
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

        {/* Completion */}
        {phase.isComplete && (
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
      const probe = currentIsland.probe_questions[0]
        ? ` Kiindulásnak használhatod ezt a kérdést: "${currentIsland.probe_questions[0]}".`
        : "";
      return `Fázis: Ellenőrzés — fordított tanár. Te most egy lelkes, de értetlen diák vagy, a felhasználó a tanárod. A(z) "${currentIsland.title}" témából a következő fogalmat NEM érted: "${focus}". Tegyél fel EGYETLEN természetes, diákos kérdést erről a fogalomról — olyat, amire csak valódi megértéssel lehet jól válaszolni, bemagolt definícióval nem. Ne magyarázz, ne segíts, csak kérdezz. Beszélj magyarul.${probe}`;
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
