"use client";

import { useState, useRef, useEffect } from "react";

interface ResponseInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export default function ResponseInput({
  onSend,
  disabled,
  placeholder = "✏️ Írd a válaszod...",
}: ResponseInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const focusedOnceRef = useRef(false);

  // Focus on first appearance only — refocusing every turn pops the mobile
  // keyboard while the user is still reading Lumi's answer.
  useEffect(() => {
    if (!disabled && !focusedOnceRef.current && inputRef.current) {
      focusedOnceRef.current = true;
      inputRef.current.focus();
    }
  }, [disabled]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || composingRef.current) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !composingRef.current) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:border-accent/50 focus:ring-2 focus:ring-accent/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-accent/50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="cursor-pointer rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        Küldés
      </button>
    </div>
  );
}
