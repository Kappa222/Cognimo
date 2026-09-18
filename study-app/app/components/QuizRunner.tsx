"use client";

import { useState } from "react";
import TypedQuestion from "./TypedQuestion";
import type {
  QuizAttemptBreakdown,
  QuizRunnerQuestion,
  QuizSubmittedAnswer,
} from "../lib/types";

interface QuizRunnerProps {
  heading: string;
  subheading?: string;
  questions: QuizRunnerQuestion[];
  submitLabel?: string;
  onSubmit: (answers: QuizSubmittedAnswer[]) => Promise<QuizAttemptBreakdown>;
  onDone: (result: QuizAttemptBreakdown) => void;
}

export default function QuizRunner({
  heading,
  subheading,
  questions,
  submitLabel = "Beküldés",
  onSubmit,
  onDone,
}: QuizRunnerProps) {
  const [mcqChoices, setMcqChoices] = useState<(number | null)[]>(
    questions.map(() => null),
  );
  const [typedTexts, setTypedTexts] = useState<string[]>(questions.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const answeredCount = questions.filter((q, i) =>
    q.type === "mcq" ? mcqChoices[i] !== null : typedTexts[i].trim().length > 0,
  ).length;
  const complete = answeredCount === questions.length;

  const handleSubmit = async () => {
    if (!complete || submitting) return;
    setSubmitting(true);
    setError("");
    const answers: QuizSubmittedAnswer[] = questions.map((q, i) => ({
      index: i,
      mcqChoice: q.type === "mcq" ? mcqChoices[i] : null,
      typedText: q.type === "typed" ? typedTexts[i].trim() : null,
    }));
    try {
      const result = await onSubmit(answers);
      onDone(result);
    } catch (err) {
      console.error("Quiz submit failed:", err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Nem sikerült beküldeni. Próbáld újra!",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">{heading}</h2>
        <span
          aria-live="polite"
          className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800"
        >
          {answeredCount}/{questions.length} megválaszolva
        </span>
      </div>
      {subheading && <p className="-mt-2 text-sm text-zinc-500">{subheading}</p>}

      {questions.map((q, i) =>
        q.type === "mcq" ? (
          <div
            key={i}
            role="radiogroup"
            aria-label={`${i + 1}. kérdés: ${q.text}`}
            className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
          >
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
              {i + 1}. kérdés — feleletválasztós
            </p>
            <p className="mb-4 text-base font-medium text-zinc-800 dark:text-zinc-200">
              {q.text}
            </p>
            <div className="flex flex-col gap-2">
              {(q.options ?? []).map((option, oi) => {
                const selected = mcqChoices[i] === oi;
                return (
                  <button
                    key={oi}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={submitting}
                    onClick={() =>
                      setMcqChoices((prev) => {
                        const next = [...prev];
                        next[i] = oi;
                        return next;
                      })
                    }
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 ${
                      selected
                        ? "border-accent/50 bg-accent/5 dark:border-accent/40 dark:bg-accent/10"
                        : "border-zinc-200/60 hover:border-accent/30 dark:border-zinc-700 dark:hover:border-accent/40"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                        selected
                          ? "border-accent bg-accent"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    />
                    <span className="flex-1 text-zinc-700 dark:text-zinc-300">
                      {option}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <TypedQuestion
            key={i}
            questionNumber={i + 1}
            text={q.text}
            value={typedTexts[i]}
            disabled={submitting}
            onChange={(text) =>
              setTypedTexts((prev) => {
                const next = [...prev];
                next[i] = text;
                return next;
              })
            }
          />
        ),
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!complete || submitting}
          className="cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {submitting ? "Értékelés…" : submitLabel}
        </button>
      </div>
      {!complete && (
        <p className="text-right text-xs text-zinc-400">
          Válaszolj minden kérdésre a beküldéshez.
        </p>
      )}
    </div>
  );
}
