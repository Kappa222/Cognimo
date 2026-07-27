"use client";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "default";
  disabled?: boolean;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Megerősítés",
  cancelLabel = "Mégse",
  onConfirm,
  onCancel,
  variant = "danger",
  disabled = false,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-lg dark:border-zinc-800/60 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-400/30 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none ${
              variant === "danger"
                ? "bg-red-600 hover:bg-red-700 dark:hover:bg-red-500 focus:ring-red-500/50"
                : "bg-accent hover:bg-violet-600 hover:shadow-md focus:ring-accent/50"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
