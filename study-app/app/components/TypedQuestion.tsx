"use client";

interface TypedQuestionProps {
  questionNumber: number;
  text: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}

const MAX_CHARS = 2000;

export default function TypedQuestion({
  questionNumber,
  text,
  value,
  disabled,
  onChange,
}: TypedQuestionProps) {
  return (
    <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
        {questionNumber}. kérdés — kifejtős
      </p>
      <p className="mb-4 text-base font-medium text-zinc-800 dark:text-zinc-200">
        {text}
      </p>
      <label htmlFor={`typed-answer-${questionNumber}`} className="sr-only">
        Válasz a(z) {questionNumber}. kérdésre
      </label>
      <textarea
        id={`typed-answer-${questionNumber}`}
        rows={3}
        maxLength={MAX_CHARS}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="✏️ Írd le a saját szavaiddal…"
        className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:border-accent/50 focus:ring-2 focus:ring-accent/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      <p className="mt-1 text-right text-xs text-zinc-400">
        {value.trim().length} / {MAX_CHARS} karakter
      </p>
    </div>
  );
}
