import type { EvaluateVerdict } from "./types";

// Teaching tally for one island visit — feeds the 40% teaching half of the
// blended island score. Accumulated client-side as verdicts come in.
export interface TeachingTally {
  correct: number;
  partial: number;
  total: number;
}

export function createTeachingTally(): TeachingTally {
  return { correct: 0, partial: 0, total: 0 };
}

// Counts decisive verdicts only: not_required and malformed rows (blank
// concept) carry no evidence either way.
export function accumulateTeachingVerdicts(
  tally: TeachingTally,
  verdicts: EvaluateVerdict[],
): void {
  for (const v of verdicts) {
    if (!v.concept?.trim()) continue;
    if (v.verdict === "not_required") continue;
    tally.total += 1;
    if (v.verdict === "correct") tally.correct += 1;
    else if (v.verdict === "partial") tally.partial += 1;
  }
}

// correct = 1, partial = 0.5 — the integer sent to the attempt endpoints.
export function teachingScore(tally: TeachingTally): number {
  return Math.round(tally.correct + 0.5 * tally.partial);
}
