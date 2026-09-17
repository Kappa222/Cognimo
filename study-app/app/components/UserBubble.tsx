"use client";

interface UserBubbleProps {
  message: string;
}

export default function UserBubble({ message }: UserBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/10 px-4 py-3">
        <p className="mb-1 text-xs font-semibold text-accent">Te</p>
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
          {message}
        </p>
      </div>
    </div>
  );
}
