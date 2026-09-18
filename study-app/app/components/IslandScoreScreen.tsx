"use client";

import type {
  QuizAttemptBreakdown,
  QuizRunnerQuestion,
} from "../lib/types";

interface IslandScoreScreenProps {
  title: string;
  subtitle?: string;
  result: QuizAttemptBreakdown;
  questions: QuizRunnerQuestion[];
  primaryLabel?: string;
  onPrimary: () => void;
}

function verdictStyle(verdict: "correct" | "partial" | "wrong"): string {
  if (verdict === "correct") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
  if (verdict === "partial") return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
}

function verdictLabel(verdict: "correct" | "partial" | "wrong"): string {
  if (verdict === "correct") return "✅ Helyes";
  if (verdict === "partial") return "🟡 Részben jó";
  return "❌ Helytelen";
}

export default function IslandScoreScreen({
  title,
  subtitle,
  result,
  questions,
  primaryLabel = "Tovább a szigetekre →",
  onPrimary,
}: IslandScoreScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-zinc-200/60 bg-white p-8 text-center shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <p className="mb-1 text-sm text-zinc-500">{title}</p>
        {subtitle && <p className="mb-3 text-xs text-zinc-400">{subtitle}</p>}
        <p className="text-5xl font-bold tracking-tight text-accent">
          {result.blended}
          <span className="text-2xl text-zinc-400">%</span>
        </p>
        <div className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
            <p className="text-xl font-bold text-zinc-700 dark:text-zinc-200">
              {result.quiz_pct}%
            </p>
            <p className="text-xs text-zinc-500">
              Kvíz ({result.correct_count}/{result.total} helyes)
            </p>
          </div>
          <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
            <p className="text-xl font-bold text-zinc-700 dark:text-zinc-200">
              {result.teaching_pct}%
            </p>
            <p className="text-xs text-zinc-500">Tanítás Lumi szerint</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPrimary}
          className="mt-6 cursor-pointer rounded-lg bg-accent px-8 py-3 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98]"
        >
          {primaryLabel}
        </button>
      </div>

      <h3 className="mt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Kérdésenkénti áttekintés
      </h3>
      <div className="grid gap-2">
        {result.results.map((r) => {
          const q = questions[r.index];
          return (
            <div
              key={r.index}
              className="rounded-xl border border-zinc-200/60 bg-white px-4 py-3 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {r.index + 1}. {q?.text ?? ""}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${verdictStyle(r.verdict)}`}
                >
                  {verdictLabel(r.verdict)}
                </span>
              </div>
              {r.type === "mcq" && q?.options && (
                <div className="mt-2 flex flex-col gap-1">
                  {q.options.map((option, oi) => {
                    const isCorrect = oi === r.correctIndex;
                    const isUser =
                      r.userAnswer !== null && option === r.userAnswer;
                    return (
                      <p
                        key={oi}
                        className={`rounded-lg px-3 py-1.5 text-xs ${
                          isCorrect
                            ? "bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : isUser
                              ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                              : "text-zinc-500"
                        }`}
                      >
                        {isCorrect ? "✅ " : isUser ? "❌ " : "· "}
                        {option}
                      </p>
                    );
                  })}
                </div>
              )}
              {r.type === "typed" && (
                <div className="mt-2 flex flex-col gap-1 text-xs">
                  {r.userAnswer && (
                    <p className="text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium">Te válaszod:</span> {r.userAnswer}
                    </p>
                  )}
                  {r.explanation && (
                    <p className="text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium">Lumi:</span> {r.explanation}
                    </p>
                  )}
                  {r.referenceAnswer && r.verdict !== "correct" && (
                    <p className="text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium">Mintaválasz:</span> {r.referenceAnswer}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
