"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

interface ProgressRoadmapProps {
  topicName: string;
  currentCheckpoint: number;
  totalCheckpoints: number;
  avatarUrl: string;
  topicId: string;
  islandTitles?: string[];
}

const VISIBLE_COUNT = 5;

export default function ProgressRoadmap({
  topicName,
  currentCheckpoint,
  totalCheckpoints,
  avatarUrl,
  topicId,
  islandTitles,
}: ProgressRoadmapProps) {
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, totalCheckpoints - VISIBLE_COUNT);
  const isCompleted = totalCheckpoints > 0 && currentCheckpoint >= totalCheckpoints;

  // Keep the current island visible and the offset in range when the
  // checkpoint or island count changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset((prev) => {
      const clampedMax = Math.max(0, totalCheckpoints - VISIBLE_COUNT);
      let next = Math.min(prev, clampedMax);
      if (currentCheckpoint < next) next = currentCheckpoint;
      if (currentCheckpoint >= next + VISIBLE_COUNT) {
        next = currentCheckpoint - VISIBLE_COUNT + 1;
      }
      return Math.max(0, Math.min(next, clampedMax));
    });
  }, [currentCheckpoint, totalCheckpoints]);

  const visibleIslands = Array.from({ length: totalCheckpoints }, (_, i) => ({
    index: i,
    isCompleted: i < currentCheckpoint,
    isCurrent: i === currentCheckpoint,
    isLocked: i > currentCheckpoint,
  }));

  const visible = visibleIslands.slice(offset, offset + VISIBLE_COUNT);

  if (totalCheckpoints === 0) {
    return (
      <div className="w-full">
        <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
          {topicName}
        </h2>
        <div className="rounded-3xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-zinc-500">Még nincs tanulási terv.</p>
          <p className="text-xs text-zinc-400">Indíts tanulást a terv elkészítéséhez.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h2 className="mb-6 text-center text-2xl font-bold tracking-tight">
        {topicName}
      </h2>

      {isCompleted && (
        <p className="mb-4 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
          🎉 Minden részt teljesítettél!
        </p>
      )}

      <div className="relative rounded-3xl border border-zinc-200/60 bg-gradient-to-b from-zinc-50/50 to-white p-6 pt-16 shadow-sm dark:border-zinc-800/60 dark:from-zinc-900/50 dark:to-zinc-900">
        <div className="relative flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - 1))}
            disabled={offset === 0}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
            aria-label="Előző"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto px-1 py-1 sm:gap-3">
            {visible.map((island) => {
              const unlocked = island.isCompleted || island.isCurrent;
              const islandTitle =
                islandTitles && island.index < islandTitles.length
                  ? islandTitles[island.index]
                  : undefined;
              const stateLabel = island.isCompleted
                ? "befejezett"
                : island.isCurrent
                  ? "aktuális"
                  : "zárolt";
              const label = `${island.index + 1}. sziget${islandTitle ? `: ${islandTitle}` : ""} — ${stateLabel}`;
              const node = (
                <>
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-base font-bold transition-all sm:h-[68px] sm:w-[68px] sm:text-lg ${
                      island.isCompleted
                        ? "border-accent bg-accent text-white shadow-sm"
                        : island.isCurrent
                          ? "border-accent bg-white text-accent ring-2 ring-accent/30 shadow-md dark:bg-zinc-800"
                          : "border-zinc-200 bg-zinc-50 text-zinc-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-600"
                    }`}
                  >
                    {island.isCompleted ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    ) : island.isLocked ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <span>{island.index + 1}</span>
                    )}
                  </div>

                  {islandTitle ? (
                    <span
                      title={islandTitle}
                      className="mt-1 max-w-12 truncate text-center text-[10px] font-medium text-zinc-500 sm:max-w-[68px] dark:text-zinc-400"
                    >
                      {islandTitle}
                    </span>
                  ) : null}
                </>
              );
              return (
                <div key={island.index} className="relative flex flex-col items-center">
                  {(island.isCurrent || (isCompleted && island.index === totalCheckpoints - 1)) && (
                    <div className="absolute -top-14 z-10">
                      <div className="relative">
                        <div className="absolute inset-0 animate-ping rounded-full bg-accent/30" style={{ animationDuration: "2s" }} />
                        <Image
                          src={avatarUrl}
                          alt=""
                          width={48}
                          height={48}
                          className="relative h-12 w-12 drop-shadow-md"
                        />
                      </div>
                    </div>
                  )}

                  {unlocked ? (
                    <Link
                      href={`/topics/${topicId}/learn?island=${island.index + 1}`}
                      aria-label={`${label} — megnyitás`}
                      className="flex cursor-pointer flex-col items-center rounded-2xl transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-[0.98]"
                    >
                      {node}
                    </Link>
                  ) : (
                    <div aria-label={label} title="Előbb fejezd be az aktuális szigetet" className="flex flex-col items-center">
                      {node}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setOffset(Math.min(maxOffset, offset + 1))}
            disabled={offset >= maxOffset}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
            aria-label="Következő"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mt-6 flex justify-center">
          <Link
            href={`/topics/${topicId}/learn`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-8 py-3 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
          >
            {currentCheckpoint === 0
              ? "Kezdés"
              : isCompleted
                ? "Visszanézés"
                : "Folytatás"}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
