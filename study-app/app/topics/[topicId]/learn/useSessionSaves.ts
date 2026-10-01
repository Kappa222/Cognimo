"use client";

import { useCallback, useState } from "react";
import type { ChatSession } from "../../../lib/types";

// Persistence for the learn session: chat message rows and checkpoint/resume
// writes, each retried once. Review mode never touches the server — the
// helpers resolve successfully so the UI flow is unchanged.
export function useSessionSaves(session: ChatSession | null, isReview: boolean) {
  const [saveError, setSaveError] = useState("");

  const clearSaveError = useCallback(() => setSaveError(""), []);

  const saveMessage = useCallback(async (role: "user" | "assistant", content: string) => {
    if (!session) return false;
    // Review replays persist nothing — conversation stays local to the visit.
    if (isReview) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`/api/sessions/${session.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content }),
        });
        if (res.ok) {
          setSaveError("");
          return true;
        }
        console.error("Failed to save message:", res.status, await res.text());
      } catch (err) {
        console.error("Failed to save message:", err);
      }
    }
    setSaveError("Nem sikerült menteni az üzenetet. Újratöltéskor elveszhet.");
    return false;
  }, [session, isReview]);

  const saveCheckpoint = useCallback(async (
    checkpoint: number,
    status?: string,
    extra?: { island_step?: string | null; assess_state?: unknown },
  ) => {
    if (!session) {
      console.warn("saveCheckpoint dropped: no session");
      return false;
    }
    // Review replays must never move the saved checkpoint or status.
    if (isReview) return true;
    const body: Record<string, unknown> = { current_checkpoint: checkpoint };
    if (status) body.status = status;
    if (extra && "island_step" in extra) body.island_step = extra.island_step;
    if (extra && "assess_state" in extra) body.assess_state = extra.assess_state;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`/api/sessions/${session.id}/checkpoint`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setSaveError("");
          return true;
        }
        console.error("Failed to save checkpoint:", res.status, await res.text());
      } catch (err) {
        console.error("Failed to save checkpoint:", err);
      }
    }
    setSaveError("Nem sikerült menteni az előrehaladást. Újratöltéskor elveszhet.");
    return false;
  }, [session, isReview]);

  return { saveError, clearSaveError, saveMessage, saveCheckpoint };
}
