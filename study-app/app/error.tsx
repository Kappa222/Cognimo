'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function Error({ error, unstable_retry }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200/60 bg-white p-12 text-center shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <p className="mb-1 text-lg font-semibold text-zinc-700 dark:text-zinc-200">
          Valami hiba történt
        </p>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Próbáld újra, vagy térj vissza később.
        </p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98]"
        >
          Újra
        </button>
      </div>
    </div>
  );
}
