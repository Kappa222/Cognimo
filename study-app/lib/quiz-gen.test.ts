import { describe, expect, it } from "vitest";
import {
  isCompleteAttempt,
  isValidSubmission,
  scoreAttempt,
} from "./quiz-gen";
import type { AttemptResult, SubmittedAnswer } from "./quiz-gen";

function mcqResult(verdict: "correct" | "wrong"): AttemptResult {
  return {
    index: 0,
    type: "mcq",
    concept: "c",
    points: verdict === "correct" ? 1 : 0,
    maxPoints: 1,
    verdict,
    explanation: null,
    correctIndex: 0,
    referenceAnswer: null,
    userAnswer: "a",
  };
}

describe("isValidSubmission", () => {
  it("accepts well-formed MCQ and typed answers", () => {
    expect(isValidSubmission({ index: 0, mcqChoice: 2, typedText: null })).toBe(true);
    expect(isValidSubmission({ index: 1, mcqChoice: null, typedText: "válasz" })).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isValidSubmission(null)).toBe(false);
    expect(isValidSubmission({})).toBe(false);
    expect(isValidSubmission({ index: -1, mcqChoice: null, typedText: null })).toBe(false);
    expect(isValidSubmission({ index: 1.5, mcqChoice: null, typedText: null })).toBe(false);
    expect(isValidSubmission({ index: 0, mcqChoice: "1", typedText: null })).toBe(false);
    expect(isValidSubmission({ index: 0, mcqChoice: null, typedText: 42 })).toBe(false);
  });

  it("rejects oversized typed answers", () => {
    expect(
      isValidSubmission({ index: 0, mcqChoice: null, typedText: "x".repeat(5001) }),
    ).toBe(false);
    expect(
      isValidSubmission({ index: 0, mcqChoice: null, typedText: "x".repeat(5000) }),
    ).toBe(true);
  });
});

describe("isCompleteAttempt", () => {
  const full: SubmittedAnswer[] = [
    { index: 0, mcqChoice: 1, typedText: null },
    { index: 1, mcqChoice: null, typedText: "a" },
  ];

  it("accepts every question answered exactly once", () => {
    expect(isCompleteAttempt(2, full)).toBe(true);
  });

  it("rejects gaps and duplicate indices", () => {
    expect(isCompleteAttempt(2, [full[0]])).toBe(false);
    expect(isCompleteAttempt(2, [full[0], full[0]])).toBe(false);
    expect(isCompleteAttempt(3, full)).toBe(false);
  });
});

describe("scoreAttempt", () => {
  it("blends 60% quiz with 40% teaching", () => {
    const results = [mcqResult("correct"), mcqResult("wrong")];
    // quiz 50%, teaching 100% -> round(30 + 40) = 70
    const scores = scoreAttempt(results, 2, 2);
    expect(scores.quizPct).toBe(50);
    expect(scores.teachingPct).toBe(100);
    expect(scores.blended).toBe(70);
    expect(scores.correctCount).toBe(1);
  });

  it("falls back to the quiz score without teaching evidence", () => {
    const results = [mcqResult("correct"), mcqResult("correct")];
    const scores = scoreAttempt(results, 0, 0);
    expect(scores.quizPct).toBe(100);
    expect(scores.teachingPct).toBe(100);
    expect(scores.blended).toBe(100);
  });
});
