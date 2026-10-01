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
  resumeFrom: (checkpoint: number) => void;
  goToNextStep: () => void;
  setSubPhase: (phase: SessionSubPhase) => void;
}

export function useSessionPhaseManager(
  islandTitles: string[] = [],
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

  const [stepIndex, setStepIndex] = useState(0);
  const [subPhase, setSubPhase] = useState<SessionSubPhase>("idle");

  const currentStep = useMemo(
    () => (structure.length > 0 ? structure[Math.min(stepIndex, maxIndex)] ?? null : null),
    [stepIndex, structure, maxIndex],
  );

  const totalCheckpoints = islandTitles.length;

  const isStarted = subPhase !== "idle";
  // With no islands the structure is a lone [complete] step — that must not
  // read as finished, otherwise an unloadable plan shows instant completion.
  const isComplete = islandTitles.length > 0 && currentStep?.phase === "complete";

  const phaseName = currentStep?.phase ?? "explain";
  const phaseBadge = useMemo(() => {
    if (phaseName === "complete") return "Befejezés";
    if (stepIndex >= 0 && stepIndex < islandTitles.length) {
      return islandTitles[stepIndex];
    }
    return "Tanulás";
  }, [phaseName, stepIndex, islandTitles]);

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
    resumeFrom,
    goToNextStep,
    setSubPhase,
  };
}
