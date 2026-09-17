"use client";

import Image from "next/image";

interface AIBubbleProps {
  avatarUrl: string;
  characterName: string;
  message: string;
  isStreaming?: boolean;
}

export default function AIBubble({
  avatarUrl,
  characterName,
  message,
  isStreaming,
}: AIBubbleProps) {
  return (
    <div className="flex gap-3">
      <Image
        src={avatarUrl}
        alt={characterName}
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-zinc-200 dark:ring-zinc-700"
      />
      <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-zinc-200/60 bg-white px-4 py-3 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <p className="mb-1 text-xs font-semibold text-accent">{characterName}</p>
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {message}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle" />
          )}
        </p>
      </div>
    </div>
  );
}
