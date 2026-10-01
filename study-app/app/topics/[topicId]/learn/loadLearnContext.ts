"use client";

import { supabase } from "../../../../lib/supabase";
import type { ChatMessage, ChatSession, Island, Topic } from "../../../lib/types";

// Snapshot of the island step state to restore on resume. Fields are optional
// because each restore path only ever wrote a subset of them.
export interface IslandRestore {
  islandStep: "teach" | "assess" | "remediation";
  teachRound?: number;
  teachConceptIndex?: number;
  assessRound?: number;
  proven?: string[];
  weak?: string[];
  remediationCount?: number;
  nextFocus?: string;
}

export interface LoadedLearnContext {
  topic: Topic;
  materialsCount: number | null;
  session: ChatSession | null;
  islands: Island[];
  // Deduplicated rows (read-time collapse of the old double-stream bug).
  messages: ChatMessage[];
  displayMessages: { role: "ai" | "user"; text: string }[];
  restore: IslandRestore | null;
}

export type LoadLearnContextResult =
  | { kind: "aborted" }
  | { kind: "no-auth" }
  | { kind: "topic-error" }
  | ({ kind: "loaded" } & LoadedLearnContext);

const isIslandsMessage = (m: ChatMessage) => m.content.startsWith("__ISLANDS__:");

// Loads everything the learn page needs: topic, material count, the
// resumable session with its messages and island plan, plus the teach/assess
// snapshot to resume from. Returns a discriminated result — the caller maps
// it onto page state. `isStale()` aborts between steps when a newer load
// (topicId change, manual retry) has already started.
export async function loadLearnContext(
  topicId: string,
  isStale: () => boolean,
): Promise<LoadLearnContextResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (isStale()) return { kind: "aborted" };
  if (!user) return { kind: "no-auth" };

  const { data: t, error: topicErr } = await supabase
    .from("topics")
    .select("*")
    .eq("id", topicId)
    .single();
  if (isStale()) return { kind: "aborted" };
  if (topicErr || !t) return { kind: "topic-error" };

  const { count } = await supabase
    .from("study_materials")
    .select("*", { count: "exact", head: true })
    .eq("topic_id", topicId);
  if (isStale()) return { kind: "aborted" };

  const base = {
    topic: t as Topic,
    materialsCount: count,
    session: null as ChatSession | null,
    islands: [] as Island[],
    messages: [] as ChatMessage[],
    displayMessages: [] as { role: "ai" | "user"; text: string }[],
    restore: null as IslandRestore | null,
  };

  let activeSession: ChatSession | null = null;
  const res = await fetch(`/api/sessions?topic_id=${topicId}`);
  if (isStale()) return { kind: "aborted" };
  if (res.ok) {
    const existing: ChatSession | null = await res.json();
    if (existing && existing.status === "in_progress") {
      activeSession = existing;
      const msgRes = await fetch(`/api/sessions/${existing.id}`);
      if (isStale()) return { kind: "aborted" };
      if (msgRes.ok) {
        const { session: sessionData, messages } = await msgRes.json();
        if (isStale()) return { kind: "aborted" };

        // Load islands from plan column (new) or fallback to __ISLANDS__:
        // message (old).
        let loadedIslands: Island[] = [];
        if (sessionData?.plan && Array.isArray(sessionData.plan) && sessionData.plan.length > 0) {
          loadedIslands = sessionData.plan;
        } else {
          const islandMsg = (messages as ChatMessage[]).find(
            (m) => m.role === "assistant" && isIslandsMessage(m),
          );
          if (islandMsg) {
            try {
              loadedIslands = JSON.parse(islandMsg.content.slice(11));
            } catch { /* ignore */ }
          }
        }

        if (loadedIslands.length === 0) {
          // Unusable leftover (e.g. created before the plan column existed):
          // it can never start and would render as instant completion.
          // Abandon it so a fresh plan gets generated.
          try {
            await fetch(`/api/sessions/${existing.id}/checkpoint`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ current_checkpoint: 0, status: "abandoned" }),
            });
          } catch (err) {
            console.error("Failed to abandon plan-less session:", err);
          }
          if (isStale()) return { kind: "aborted" };
          return { kind: "loaded", ...base };
        }

        // Read-time cleanup of the duplicate-turn bug (retry loop ran every
        // stream twice): collapse consecutive same-role identical messages.
        // DB rows are left untouched — this only affects what is displayed
        // and sent as AI context from now on.
        const dedupedMessages = (messages as ChatMessage[]).filter(
          (m, i, arr) => i === 0 || m.role !== arr[i - 1].role || m.content !== arr[i - 1].content,
        );

        return {
          kind: "loaded",
          ...base,
          session: activeSession,
          islands: loadedIslands,
          messages: dedupedMessages,
          displayMessages: dedupedMessages
            .filter((m) => !isIslandsMessage(m))
            .map((m) => ({
              role: m.role === "assistant" ? ("ai" as const) : ("user" as const),
              text: m.content,
            })),
          restore: await loadIslandRestore(
            sessionData,
            existing,
            loadedIslands,
            topicId,
            isStale,
          ),
        };
      }
    }
  }
  if (isStale()) return { kind: "aborted" };

  // No resumable session: a completed session's plan still enables island
  // review (?island=N). Messages are not restored — review starts fresh.
  if (!activeSession) {
    try {
      const anyRes = await fetch(`/api/sessions?topic_id=${topicId}&status=any`);
      if (isStale()) return { kind: "aborted" };
      if (anyRes.ok) {
        const latest: (ChatSession & { plan?: unknown }) | null = await anyRes.json();
        if (latest && Array.isArray(latest.plan) && (latest.plan as Island[]).length > 0) {
          return {
            kind: "loaded",
            ...base,
            session: latest,
            islands: latest.plan as Island[],
          };
        }
      }
    } catch (err) {
      console.error("Failed to load latest session:", err);
    }
  }

  return { kind: "loaded", ...base };
}

// Rebuilds the teach/assess snapshot from the saved session row. When the
// snapshot is lost but mastery survived, proven/weak are reconstructed from
// concept_mastery instead.
async function loadIslandRestore(
  sessionData: {
    island_step?: string;
    assess_state?: {
      round: number;
      proven: string[];
      weak: string[];
      remediationCount: number;
      nextFocus: string;
      teachRound?: number;
      teachConceptIndex?: number;
    };
  },
  session: ChatSession,
  islands: Island[],
  topicId: string,
  isStale: () => boolean,
): Promise<IslandRestore | null> {
  if (sessionData?.island_step === "teach" && sessionData.assess_state) {
    const island = islands[session.current_checkpoint];
    const maxIdx = Math.max(0, (island?.key_concepts.length ?? 1) - 1);
    return {
      islandStep: "teach",
      teachRound: sessionData.assess_state.teachRound ?? 0,
      teachConceptIndex: Math.min(
        Math.max(0, sessionData.assess_state.teachConceptIndex ?? 0),
        maxIdx,
      ),
    };
  }

  if (sessionData?.island_step && (sessionData.island_step === "assess" || sessionData.island_step === "remediation")) {
    const islandStep = sessionData.island_step;
    if (sessionData.assess_state) {
      return {
        islandStep,
        assessRound: sessionData.assess_state.round,
        proven: sessionData.assess_state.proven ?? [],
        weak: sessionData.assess_state.weak ?? [],
        remediationCount: sessionData.assess_state.remediationCount ?? 0,
        teachRound: sessionData.assess_state.teachRound ?? 0,
        teachConceptIndex: sessionData.assess_state.teachConceptIndex ?? 0,
        nextFocus: sessionData.assess_state.nextFocus ?? "",
      };
    }
    // assess_state lost (e.g. save failed) but mastery survived: rebuild
    // proven/weak for the current island from mastery.
    const island = islands[session.current_checkpoint];
    if (island) {
      const { data: mastery } = await supabase
        .from("concept_mastery")
        .select("concept, status")
        .eq("topic_id", topicId);
      if (isStale()) return null;
      const byConcept = new Map(
        ((mastery ?? []) as { concept: string; status: string }[]).map((m) => [m.concept, m.status]),
      );
      return {
        islandStep,
        assessRound: 1,
        proven: island.key_concepts.filter((c) => {
          const s = byConcept.get(c);
          return s === "solid" || s === "seen";
        }),
        weak: island.key_concepts.filter((c) => byConcept.get(c) === "shaky"),
        remediationCount: 0,
        nextFocus: island.key_concepts[0] ?? "",
      };
    }
  }

  return null;
}
