"use client";

interface AnalysisProgressRingProps {
  /** 0–100. Display-only; the caller owns the (simulated) value. */
  progress: number;
  status: "working" | "done" | "error";
}

const SIZE = 264;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const RING_COLORS: Record<AnalysisProgressRingProps["status"], string> = {
  working: "#7c3aed",
  done: "#10b981",
  error: "#ef4444",
};

export default function AnalysisProgressRing({
  progress,
  status,
}: AnalysisProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={status === "done" ? 100 : clamped}
      aria-label="Elemzés előrehaladása"
      className="relative h-60 w-60 sm:h-72 sm:w-72"
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-zinc-200 dark:stroke-zinc-800"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={RING_COLORS[status]}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={status === "done" ? 0 : offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {status === "done" ? (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl font-bold text-white">
            ✓
          </span>
        ) : status === "error" ? (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500 text-4xl font-bold text-white">
            !
          </span>
        ) : (
          <span className="text-5xl font-bold tracking-tight text-zinc-800 tabular-nums dark:text-zinc-100">
            {clamped}
            <span className="text-2xl text-zinc-400">%</span>
          </span>
        )}
      </div>
    </div>
  );
}
