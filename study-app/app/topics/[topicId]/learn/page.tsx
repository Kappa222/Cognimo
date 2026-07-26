"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";
import { useSessionPhaseManager } from "../../../lib/useSessionPhaseManager";
import type { Topic, QuizQuestionData, ChatSession, ChatMessage, Island } from "../../../lib/types";
import ProgressBar from "../../../components/ProgressBar";
import AIBubble from "../../../components/AIBubble";
import UserBubble from "../../../components/UserBubble";
import ResponseInput from "../../../components/ResponseInput";
import QuizQuestion from "../../../components/QuizQuestion";
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
  const [quizResults, setQuizResults] = useState<{ correct: boolean }[]>([]);
  const [quizSelected, setQuizSelected] = useState<number | undefined>();
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGeneratingIslands, setIsGeneratingIslands] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionData[]>([]);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [islands, setIslands] = useState<Island[]>([]);
  const [islandStep, setIslandStep] = useState<"teach" | "probe" | "mini-quiz">("teach");
  const [quizSubPhase, setQuizSubPhase] = useState<"idle" | "answering" | "result">("idle");

  const islandTitles = islands.map((i) => i.title);
  const phase = useSessionPhaseManager(islandTitles);
  const abortRef = useRef<AbortController | null>(null);
  const storedMessagesRef = useRef(storedMessages);
  const hasUserRespondedRef = useRef(false);
  const streamFailCountRef = useRef(0);
  const prevPhaseRef = useRef("");
  const contentEndRef = useRef<HTMLDivElement>(null);
  const autoStartRef = useRef(false);

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
          const { messages } = await msgRes.json();
          setStoredMessages(messages);

          const islandMsg = messages.find(
            (m: ChatMessage) => m.role === "assistant" && m.content.startsWith("__ISLANDS__:"),
          );
          if (islandMsg) {
            try {
              const data: Island[] = JSON.parse(islandMsg.content.slice(11));
              setIslands(data);
            } catch { /* ignore */ }
          }

          setDisplayMessages(
            messages
              .filter((m: ChatMessage) => !m.content.startsWith("__ISLANDS__:") && !m.content.startsWith("__QUIZ__:"))
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

  const saveCheckpoint = useCallback(async (checkpoint: number, status?: string) => {
    if (!session) return;
    const body: Record<string, unknown> = { current_checkpoint: checkpoint };
    if (status) body.status = status;
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

  const streamAIResponse = useCallback(async (
    history: { role: string; content: string }[],
    phaseInstruction?: string,
  ) => {
    if (!session) return;
    setIsStreaming(true);
    setStreamingText("");
    abortRef.current = new AbortController();
    streamFailCountRef.current = 0;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, messages: history, phaseInstruction }),
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
          setIslandStep("probe");
          phase.setSubPhase("waiting-response");
        } else if (stepPhase === "explain" && islandStep === "probe") {
          setIslandStep("mini-quiz");
          setQuizSubPhase("idle");
          phase.setSubPhase("waiting-response");
        } else if (stepPhase === "quiz") {
          phase.setSubPhase("quiz-answering");
        } else {
          if (hasUserRespondedRef.current) {
            hasUserRespondedRef.current = false;
            phase.goToNextStep();
          } else {
            phase.setSubPhase("waiting-response");
          }
        }
      } else {
        setStreamingText("");
        setError("Az AI nem tudott választ adni. Próbáld újra!");
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
      (m) => !m.content.startsWith("__ISLANDS__:") && !m.content.startsWith("__QUIZ__:"),
    );

    const instruction = getPhaseInstruction(stepPhase || "", hasUserRespondedRef.current, currentIsland, islandStep);

    const apiMessages = filteredMessages.length > 0
      ? filteredMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }))
      : [{
          role: "user" as const,
          content: `A felhasználó ezt a témát szeretné megtanulni: "${topic?.name ?? "ismeretlen téma"}". Kezdd el a tanulást a tananyag és a fázis-instrukció alapján, magyarul.`,
        }];
    await streamAIResponse(apiMessages, instruction);
  }, [streamAIResponse, topic, phase, islands, islandStep]);

  useEffect(() => {
    if (phase.subPhase !== "ai-responding") return;
    if (isStreaming) return;
    if (phase.currentStep?.phase === "complete") return;
    if (phase.currentStep?.phase === "quiz") return;

    triggerAIResponse();
  }, [phase.subPhase, phase.currentStep?.phase, isStreaming, triggerAIResponse]);

  // Auto-start when islands are loaded
  useEffect(() => {
    if (autoStartRef.current && phase.subPhase === "idle" && islands.length > 0) {
      autoStartRef.current = false;
      phase.start();
    }
  }, [islands, phase.subPhase, phase]);

  // Generate mini-quiz when entering island's quiz phase
  useEffect(() => {
    if (islandStep !== "mini-quiz") return;
    if (isGeneratingQuiz) return;
    if (quizQuestions.length > 0) return;
    if (!session) return;

    const island = islands[phase.stepIndex];
    if (!island) return;

    const generate = async () => {
      setIsGeneratingQuiz(true);
      try {
        const res = await fetch("/api/quiz/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicId,
            islandTitle: island.title,
            keyConcepts: island.key_concepts,
            questionCount: 6,
          }),
        });
        if (!res.ok) throw new Error("Mini-quiz generation failed");
        const questions: QuizQuestionData[] = await res.json();
        if (questions.length === 0) throw new Error("No questions");
        setQuizQuestions(questions);
        setCurrentQuestionIndex(0);
        setQuizSubPhase("answering");
      } catch (err) {
        console.error("Mini-quiz generation error:", err);
        setError("Nem sikerült a kvíz előkészítése.");
      } finally {
        setIsGeneratingQuiz(false);
      }
    };
    generate();
  }, [islandStep, isGeneratingQuiz, quizQuestions.length, session, islands, phase.stepIndex, topicId]);

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
        body: JSON.stringify({ topic_id: topicId, subject_id: subjectId }),
      });
      if (!sessionRes.ok) throw new Error("Session creation failed");

      const newSession: ChatSession = await sessionRes.json();
      setSession(newSession);

      await saveMessage("assistant", `__ISLANDS__:${JSON.stringify(islandsData)}`);

      const islandMsg: ChatMessage = { role: "assistant", content: `__ISLANDS__:${JSON.stringify(islandsData)}`, id: "", session_id: newSession.id, created_at: new Date().toISOString() };
      setStoredMessages([islandMsg]);
      setDisplayMessages([]);
      setQuizResults([]);
      setQuizSelected(undefined);
      setQuizQuestions([]);
      setCurrentQuestionIndex(0);
      setIslandStep("teach");
      setQuizSubPhase("idle");

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
      setQuizResults([]);
      setQuizSelected(undefined);
      setCurrentQuestionIndex(0);
      setQuizQuestions([]);
      setQuizSubPhase("idle");
      setIslandStep("teach");
      phase.resumeFrom(session.current_checkpoint);
    } else if (session && session.status === "in_progress") {
      setQuizResults([]);
      setQuizSelected(undefined);
      setCurrentQuestionIndex(0);
      setQuizQuestions([]);
      setQuizSubPhase("idle");
      setIslandStep("teach");
      phase.start();
    } else {
      setQuizResults([]);
      setQuizSelected(undefined);
      setCurrentQuestionIndex(0);
      setQuizQuestions([]);
      setQuizSubPhase("idle");
      await generateIslandsAndStart();
    }
  };

  const handleUserResponse = async (text: string) => {
    setDisplayMessages((prev) => [...prev, { role: "user", text }]);
    await saveMessage("user", text);
    setStoredMessages((prev) => [...prev, { role: "user", content: text, id: "", session_id: session!.id, created_at: new Date().toISOString() }]);
    hasUserRespondedRef.current = true;
    phase.setSubPhase("ai-responding");
  };

  const handleQuizSelect = (index: number) => {
    setQuizSelected(index);
  };

  const handleQuizCheck = () => {
    if (quizSelected === undefined) return;
    const q = quizQuestions[currentQuestionIndex];
    if (!q) return;
    const correct = quizSelected === q.correctIndex;
    setQuizResults((prev) => [...prev, { correct }]);
    setQuizSubPhase("result");
  };

  const handleQuizNext = async () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setQuizSelected(undefined);
      setQuizSubPhase("answering");
    } else {
      // Mini-quiz done for this island
      setQuizSubPhase("idle");
      const nextCheckpoint = phase.currentCheckpoint + 1;
      if (nextCheckpoint >= islands.length) {
        // Last island → completion
        await saveCheckpoint(islands.length);
        phase.goToNextStep();
      } else {
        await saveCheckpoint(nextCheckpoint);
        router.push(`/topics/${topicId}`);
      }
    }
  };

  const handleRestart = () => {
    phase.reset();
    setSession(null);
    setDisplayMessages([]);
    setStoredMessages([]);
    setQuizResults([]);
    setQuizSelected(undefined);
    setQuizQuestions([]);
    setCurrentQuestionIndex(0);
    setIslands([]);
    setIslandStep("teach");
    setQuizSubPhase("idle");
  };

  const handleBack = async () => {
    if (session && phase.isStarted && !phase.isComplete) {
      const confirmed = window.confirm("Biztosan kilépsz a tanulásból? Az előrehaladásod elmentjük.");
      if (!confirmed) return;
      await saveCheckpoint(phase.currentCheckpoint);
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

  const currentQuizQuestion = quizQuestions[currentQuestionIndex] ?? null;

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
            <span className="whitespace-nowrap rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800">{phase.phaseBadge}</span>
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

        {/* Text input for user — hidden during mini-quiz */}
        {phase.subPhase === "waiting-response" && !isStreaming && islandStep !== "mini-quiz" && (
          <ResponseInput onSend={handleUserResponse} disabled={false} />
        )}

        {/* Mini-quiz — loading */}
        {islandStep === "mini-quiz" && isGeneratingQuiz && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
            <p className="text-sm text-zinc-500">Lumi összeállítja a kvíz kérdéseket...</p>
          </div>
        )}

        {/* Mini-quiz — answer phase */}
        {islandStep === "mini-quiz" && !isGeneratingQuiz && quizSubPhase === "answering" && currentQuizQuestion && (
          <QuizQuestion
            question={currentQuizQuestion}
            selectedAnswer={quizSelected}
            showResult={false}
            onSelect={handleQuizSelect}
            onCheck={handleQuizCheck}
            onNext={() => {}}
          />
        )}

        {/* Mini-quiz — result phase */}
        {islandStep === "mini-quiz" && !isGeneratingQuiz && quizSubPhase === "result" && currentQuizQuestion && (
          <QuizQuestion
            question={currentQuizQuestion}
            selectedAnswer={quizSelected}
            showResult={true}
            onSelect={handleQuizSelect}
            onCheck={handleQuizCheck}
            onNext={handleQuizNext}
          />
        )}

        {/* Completion */}
        {phase.isComplete && (
          <CompletionScreen
            topicName={topic.name}
            stats={{
              score: quizResults.filter((r) => r.correct).length,
              totalQuestions: quizResults.length,
              exercisesCompleted: Math.min(phase.currentCheckpoint, islands.length),
              totalExercises: islands.length,
              xpEarned: quizResults.length * 15,
            }}
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
  islandStep?: "teach" | "probe" | "mini-quiz",
): string {
  if (currentIsland) {
    if (islandStep === "probe") {
      return `Most használd az Inverted Teacher módszert. Tégy úgy, mintha nem értenéd ezt a részt. Tegyél fel egy próbakérdést az alábbiak közül (vagy ehhez hasonlót): ${currentIsland.probe_questions.join(", ")}. Várd meg a válaszát, és ne adj megoldást!`;
    }
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
  if (phase === "explain") {
    return isFollowUp
      ? "A felhasználó reagált a magyarázatodra. Válaszolj a kérdésére vagy nyugtázd röviden, majd folytasd a téma következő részével. Beszélj magyarul."
      : "Fázis: Gyakorlatok — Magyarázd el a témát lépésről lépésre a tananyag alapján. Részletes és érthető magyarázatot adj.";
  }
  return "";
}
