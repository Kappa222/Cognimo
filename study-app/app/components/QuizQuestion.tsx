"use client";

interface QuizQuestionData {
  text: string;
  options: string[];
  correctIndex: number;
}

interface QuizQuestionProps {
  question: QuizQuestionData;
  selectedAnswer?: number;
  showResult: boolean;
  onSelect: (index: number) => void;
  onCheck: () => void;
  onNext: () => void;
}

export default function QuizQuestion({
  question,
  selectedAnswer,
  showResult,
  onSelect,
  onCheck,
  onNext,
}: QuizQuestionProps) {
  return (
    <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
        Kvíz
      </p>
      <p className="mb-4 text-base font-medium text-zinc-800 dark:text-zinc-200">
        {question.text}
      </p>

      <div role="radiogroup" aria-label={question.text} className="flex flex-col gap-2">
        {question.options.map((option, i) => {
          let borderStyle =
            "border-zinc-200/60 hover:border-accent/30 dark:border-zinc-700 dark:hover:border-accent/40";
          let indicator = (
            <span className="h-4 w-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
          );

          if (showResult) {
            if (i === question.correctIndex) {
              borderStyle =
                "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30";
              indicator = <span className="text-sm font-bold text-emerald-600">✅</span>;
            } else if (i === selectedAnswer) {
              borderStyle =
                "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-950/30";
              indicator = <span className="text-sm font-bold text-red-500">❌</span>;
            } else {
              borderStyle = "border-zinc-200/60 opacity-50 dark:border-zinc-700";
            }
          } else if (i === selectedAnswer) {
            borderStyle =
              "border-accent/50 bg-accent/5 dark:border-accent/40 dark:bg-accent/10";
            indicator = (
              <span className="h-4 w-4 rounded-full border-2 border-accent bg-accent" />
            );
          }

          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={selectedAnswer === i}
              onClick={() => !showResult && onSelect(i)}
              disabled={showResult}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                showResult
                  ? "cursor-default"
                  : "cursor-pointer hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98]"
              } ${borderStyle}`}
            >
              {indicator}
              <span className="flex-1 text-zinc-700 dark:text-zinc-300">
                {option}
              </span>
              {showResult && i === question.correctIndex && (
                <span className="text-xs font-medium text-emerald-600">
                  Helyes válasz
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!showResult ? (
        <div className="mt-4 flex justify-end">
          <button
            onClick={onCheck}
            disabled={selectedAnswer === undefined}
            className="cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            Ellenőrzés
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {selectedAnswer === question.correctIndex
              ? "✅ Igen, ez a helyes válasz!"
              : `❌ Nem, a helyes válasz: ${question.options[question.correctIndex]}`}
          </p>
          <button
            onClick={onNext}
            className="cursor-pointer rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
          >
            Következő
          </button>
        </div>
      )}
    </div>
  );
}
