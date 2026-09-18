function PulseBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

function SkeletonShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Betöltés"
      className="mx-auto max-w-4xl px-6 py-12"
    >
      {children}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <SkeletonShell>
      <div className="mb-12 flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <PulseBlock className="h-7 w-32 rounded-lg" />
          <PulseBlock className="h-4 w-24 rounded" />
        </div>
      </div>
      <PulseBlock className="mb-4 h-5 w-44 rounded" />
      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
          >
            <PulseBlock className="h-3 w-20 rounded" />
            <PulseBlock className="mt-2 h-5 w-3/4 rounded" />
            <PulseBlock className="mt-2 h-3 w-1/2 rounded" />
            <div className="mt-3 flex items-center gap-1">
              {[0, 1, 2, 3, 4].map((d) => (
                <PulseBlock key={d} className="h-2 w-2 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <PulseBlock className="mb-3 h-3 w-32 rounded" />
      <div className="flex flex-wrap gap-3">
        {[0, 1, 2].map((i) => (
          <PulseBlock key={i} className="h-10 w-32 rounded-lg" />
        ))}
      </div>
    </SkeletonShell>
  );
}

export function SubjectDetailSkeleton() {
  return (
    <SkeletonShell>
      <PulseBlock className="mb-6 h-4 w-36 rounded" />
      <PulseBlock className="mb-8 h-8 w-56 rounded-lg" />
      <PulseBlock className="mb-8 h-4 w-full max-w-md rounded" />
      <div className="mb-6 flex items-center justify-between">
        <PulseBlock className="h-6 w-20 rounded" />
        <PulseBlock className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-2xl border border-zinc-200/60 bg-white p-5 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
          >
            <div className="flex flex-1 flex-col gap-2">
              <PulseBlock className="h-5 w-1/3 rounded" />
              <PulseBlock className="h-3 w-2/3 rounded" />
            </div>
            <PulseBlock className="h-7 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export function TopicDetailSkeleton() {
  return (
    <SkeletonShell>
      <PulseBlock className="mb-6 h-4 w-36 rounded" />
      <PulseBlock className="mb-2 h-4 w-24 rounded" />
      <PulseBlock className="mb-6 h-8 w-64 rounded-lg" />
      <div className="mb-10 rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          {[0, 1, 2, 3].map((i) => (
            <PulseBlock key={i} className="h-12 w-12 rounded-full" />
          ))}
        </div>
        <PulseBlock className="mx-auto mt-4 h-9 w-32 rounded-lg" />
      </div>
      <PulseBlock className="mb-6 h-9 w-44 rounded-lg" />
      <div className="mb-8 flex gap-2">
        {[0, 1, 2].map((i) => (
          <PulseBlock key={i} className="h-9 w-20 rounded" />
        ))}
      </div>
      <div className="grid gap-2">
        {[0, 1].map((i) => (
          <PulseBlock key={i} className="h-14 w-full rounded-2xl" />
        ))}
      </div>
    </SkeletonShell>
  );
}

export function MaterialsSkeleton() {
  return (
    <SkeletonShell>
      <PulseBlock className="mb-6 h-4 w-36 rounded" />
      <PulseBlock className="mb-2 h-8 w-56 rounded-lg" />
      <PulseBlock className="mb-8 h-4 w-24 rounded" />
      <div className="mb-8 flex gap-2">
        <PulseBlock className="h-9 w-20 rounded" />
        <PulseBlock className="h-9 w-20 rounded" />
      </div>
      <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <PulseBlock className="mb-3 h-4 w-32 rounded" />
        <PulseBlock className="mb-4 h-32 w-full rounded-lg" />
        <PulseBlock className="h-10 w-36 rounded-lg" />
      </div>
    </SkeletonShell>
  );
}

export function LearnSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Betöltés"
      className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8"
    >
      <PulseBlock className="mb-2 h-4 w-20 rounded" />
      <PulseBlock className="mb-3 h-6 w-48 rounded-lg" />
      <PulseBlock className="mb-6 h-2 w-full rounded-full" />
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <div className="mb-2 flex items-center gap-2">
            <PulseBlock className="h-8 w-8 rounded-full" />
            <PulseBlock className="h-4 w-16 rounded" />
          </div>
          <PulseBlock className="h-4 w-full rounded" />
          <PulseBlock className="mt-2 h-4 w-5/6 rounded" />
          <PulseBlock className="mt-2 h-4 w-2/3 rounded" />
        </div>
        <div className="self-end">
          <PulseBlock className="h-12 w-64 rounded-2xl" />
        </div>
        <div className="rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <PulseBlock className="h-4 w-full rounded" />
          <PulseBlock className="mt-2 h-4 w-3/4 rounded" />
        </div>
        <PulseBlock className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <SkeletonShell>
      <PulseBlock className="mb-6 h-4 w-44 rounded" />
      <PulseBlock className="mb-8 h-8 w-40 rounded-lg" />
      <div className="flex flex-col gap-8">
        <div className="rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <PulseBlock className="mb-4 h-6 w-24 rounded" />
          <PulseBlock className="h-11 w-full rounded-lg" />
        </div>
        <div className="rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <PulseBlock className="mb-4 h-6 w-24 rounded" />
          <div className="grid grid-cols-2 gap-3">
            <PulseBlock className="h-32 rounded-2xl" />
            <PulseBlock className="h-32 rounded-2xl" />
          </div>
        </div>
        <PulseBlock className="h-10 w-28 rounded-lg" />
      </div>
    </SkeletonShell>
  );
}

export function StatisticsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Betöltés"
      className="grid gap-4 sm:grid-cols-3"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900"
        >
          <PulseBlock className="mb-2 h-8 w-16 rounded-lg" />
          <PulseBlock className="h-4 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}
