import { normalizeTitle } from "./chunks";

// Shape tolerances for island plans read from chat_sessions.plan — rows may
// predate strict validation, so reads never throw, they degrade to [].
export interface PlanIsland {
  title?: unknown;
  key_concepts?: unknown;
}

const MAX_PLAN_ISLANDS = 50;

/**
 * Validate a client-supplied plan before persisting. Returns the plan when
 * usable, null otherwise (bounded length, string title, key_concepts array).
 */
export function validatePlan(plan: unknown): unknown[] | null {
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > MAX_PLAN_ISLANDS) {
    return null;
  }
  for (const island of plan) {
    if (
      !island || typeof island !== "object" ||
      typeof (island as PlanIsland).title !== "string" ||
      !Array.isArray((island as PlanIsland).key_concepts)
    ) {
      return null;
    }
  }
  return plan;
}

/**
 * Key concepts of one island, matched by normalized title. Returns [] when
 * the plan is missing/malformed or the island is not in it.
 */
export function islandConcepts(plan: unknown, islandTitle: string): string[] {
  if (!Array.isArray(plan)) return [];
  const wanted = normalizeTitle(islandTitle);
  const island = (plan as PlanIsland[]).find(
    (i) => i && typeof i.title === "string" && normalizeTitle(i.title) === wanted,
  );
  const concepts = island?.key_concepts;
  if (!Array.isArray(concepts)) return [];
  return (concepts as unknown[])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());
}

/** Distinct key concepts across every island of a plan (whole-topic scope). */
export function planConcepts(plan: unknown): string[] {
  if (!Array.isArray(plan)) return [];
  const concepts: string[] = [];
  for (const island of plan as PlanIsland[]) {
    const list = island?.key_concepts;
    if (!Array.isArray(list)) continue;
    for (const c of list as unknown[]) {
      if (typeof c === "string" && c.trim()) concepts.push(c.trim());
    }
  }
  return [...new Set(concepts)];
}
