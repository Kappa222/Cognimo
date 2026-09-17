"use client";

import { useState, useCallback, useMemo } from "react";
import type { SessionPhase, SessionSubPhase, SessionStep } from "./types";

export interface PhaseManagerState {
  stepIndex: number;
  currentStep: SessionStep | null;
  currentCheckpoint: number;
  totalCheckpoints: number;
  subPhase: SessionSubPhase;
  isStarted: boolean;
  isComplete: boolean;
  phaseName: string;
  phaseBadge: string;
  islandCount: number;
}

export interface PhaseManagerActions {
  start: () => void;
  resumeFrom: (checkpoint: number) => void;
  goToNextStep: () => void;
  setSubPhase: (phase: SessionSubPhase) => void;
  reset: () => void;
}

export function useSessionPhaseManager(
  islandTitles: string[] = [],
  initialCheckpoint = 0,
): PhaseManagerState & PhaseManagerActions {
  const structure = useMemo(() => {
    const steps: SessionStep[] = islandTitles.map((_, i) => ({
      phase: "explain" as SessionPhase,
      checkpoint: i,
    }));
    steps.push({ phase: "complete" as SessionPhase, checkpoint: islandTitles.length });
    return steps;
  }, [islandTitles]);

  const maxIndex = structure.length - 1;

  const [stepIndex, setStepIndex] = useState(
    Math.min(initialCheckpoint, maxIndex),
  );
  const [subPhase, setSubPhase] = useState<SessionSubPhase>(
    initialCheckpoint > 0 ? "waiting-response" : "idle",
  );

  const currentStep = useMemo(
    () => (structure.length > 0 ? structure[Math.min(stepIndex, maxIndex)] ?? null : null),
    [stepIndex, structure, maxIndex],
  );

  const totalCheckpoints = islandTitles.length;

  const isStarted = subPhase !== "idle";
  const isComplete = currentStep?.phase === "complete";

  const phaseName = currentStep?.phase ?? "explain";
  const phaseBadge = useMemo(() => {
    if (phaseName === "complete") return "Befejezés";
    if (stepIndex >= 0 && stepIndex < islandTitles.length) {
      return islandTitles[stepIndex];
    }
    return "Tanulás";
  }, [phaseName, stepIndex, islandTitles]);

  const start = useCallback(() => {
    // Empty islands would build a lone [complete] step and flash the
    // completion screen with a stuck thinking indicator.
    if (islandTitles.length === 0 || structure.length === 0) return;
    setStepIndex(0);
    setSubPhase("ai-responding");
  }, [structure.length, islandTitles.length]);

  const resumeFrom = useCallback((checkpoint: number) => {
    if (islandTitles.length === 0 || structure.length === 0) return;
    const idx = Math.min(Math.max(0, Math.floor(checkpoint)), maxIndex);
    const step = structure[idx];
    setStepIndex(idx);
    if (step?.phase === "complete") {
      setSubPhase("complete");
    } else {
      setSubPhase("ai-responding");
    }
  }, [structure, maxIndex, islandTitles.length]);

  const goToNextStep = useCallback(() => {
    if (structure.length === 0) return;
    const nextIndex = Math.min(stepIndex + 1, maxIndex);
    setStepIndex(nextIndex);
    const nextStep = structure[nextIndex];
    if (nextStep) {
      if (nextStep.phase === "complete") {
        setSubPhase("complete");
      } else {
        setSubPhase("ai-responding");
      }
    }
  }, [stepIndex, structure, maxIndex]);

  const reset = useCallback(() => {
    setStepIndex(0);
    setSubPhase("idle");
  }, []);

  return {
    stepIndex,
    currentStep,
    currentCheckpoint: currentStep?.checkpoint ?? 0,
    totalCheckpoints,
    subPhase,
    isStarted,
    isComplete,
    phaseName,
    phaseBadge,
    islandCount: islandTitles.length,
    start,
    resumeFrom,
    goToNextStep,
    setSubPhase,
    reset,
  };
}
