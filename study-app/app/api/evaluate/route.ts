import { createClient } from "../../../lib/supabase-server";
import { completeJson } from "../../../lib/ai";
import { getIslandContext } from "../../../lib/chunks";

const EVALUATE_SYSTEM_PROMPT = `Te egy szigorú, de igazságos szakmai értékelő vagy. A felhasználó egy "fordított tanár" gyakorlatban tanít: elmagyaráz valamit egy tanuló AI-nak. A feladatod: minősítsd a magyarázatot KIZÁRÓLAG a megadott kulcsfogalmak szempontjából.

<kulcsfogalmak>
{keyConcepts}
</kulcsfogalmak>
<már-igazolt>
{provenConcepts}
</már-igazolt>
<tanuló-kérdése>
{question}
</tanuló-kérdése>
<felhasználó-magyarázata>
{userAnswer}
</felhasználó-magyarázata>

Minden MÉG NEM IGAZOLT kulcsfogalomhoz adj ítéletet:
- "correct": helyesen és érthetően magyarázta
- "partial": említette, de hiányosan vagy pontatlanul
- "wrong": tévesen magyarázta
- "not_required": a feltett kérdés nem kívánta meg ezt a fogalmat, és a felhasználó nem is tért ki rá (ez NEM hiba)
- "missing": a kérdés megkívánta volna, de a felhasználó nem tért ki rá

Szigorúsági szabályok:
- A helyes VÉGEREDMÉNY önmagában nem elég — a magyarázatnak az OKOT/MŰKÖDÉST is tartalmaznia kell
- Bemagolt definíció szó szerinti visszamondása legfeljebb "partial"
- Ha a magyarázat helyes, de más szavakkal/példával mondja el, mint a tananyag, az teljes értékű "correct"

Adj továbbá:
- "feedback_hint": max. 2 mondat magyarul — mire reagáljon a tanuló AI (mit értett meg jól, hol a hiba)
- "next_focus": a még nem igazolt fogalmak közül az, amelyikre a következő kérdésnek irányulnia kell (vagy null, ha minden igazolt)

Csak érvényes JSON-t adj vissza:
{"verdicts":[{"concept":"...","verdict":"correct|partial|wrong|missing|not_required"}],
 "feedback_hint":"...", "next_focus":"...|null"}`;

interface Verdict {
  concept: string;
  verdict: "correct" | "partial" | "wrong" | "missing" | "not_required";
}

interface EvaluateResponse {
  verdicts: Verdict[];
  feedback_hint: string;
  next_focus: string | null;
}

function computeStatus(
  current: { status: string; correct_count: number; wrong_count: number },
  verdict: string,
): { status: string; correct_count: number; wrong_count: number } {
  let { status, correct_count, wrong_count } = current;

  if (verdict === "correct") {
    correct_count++;
    status = correct_count >= 2 ? "solid" : "seen";
  } else if (verdict === "wrong" || verdict === "partial") {
    wrong_count++;
    status = "shaky";
  }
  // "missing" / "not_required" carry no evidence: leave status and counts
  // untouched instead of inflating unseen → seen.

  return { status, correct_count, wrong_count };
}

// Caller-controlled field bounds (server-enforced).
const MAX_TEXT_FIELD = 5000;
const MAX_CONCEPTS = 20;
const MAX_CONCEPT_CHARS = 200;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const {
    sessionId,
    topicId,
    islandTitle,
    keyConcepts,
    question,
    userAnswer,
    round,
    isRemediation,
    provenConcepts,
  } = body as {
    sessionId: unknown;
    topicId: unknown;
    islandTitle: unknown;
    keyConcepts: unknown;
    question: unknown;
    userAnswer: unknown;
    round: unknown;
    isRemediation?: unknown;
    provenConcepts?: unknown;
  };

  if (
    typeof sessionId !== "string" || !sessionId ||
    typeof topicId !== "string" || !topicId ||
    typeof islandTitle !== "string" || !islandTitle ||
    !Array.isArray(keyConcepts) || keyConcepts.length === 0 ||
    keyConcepts.length > MAX_CONCEPTS ||
    !keyConcepts.every((c) => typeof c === "string" && c.trim().length > 0 && c.length <= MAX_CONCEPT_CHARS) ||
    typeof question !== "string" || !question.trim() || question.length > MAX_TEXT_FIELD ||
    typeof userAnswer !== "string" || !userAnswer.trim() || userAnswer.length > MAX_TEXT_FIELD ||
    typeof round !== "number" || !Number.isInteger(round) || round < 0 || round > 100
  ) {
    return new Response("Missing required fields", { status: 400 });
  }

  const safeProven = Array.isArray(provenConcepts)
    ? (provenConcepts as unknown[]).filter(
        (c): c is string => typeof c === "string" && c.length <= MAX_CONCEPT_CHARS,
      )
    : [];
  const safeRemediation = isRemediation === true;

  // Ownership gate: the session must belong to the caller and to this topic.
  // Otherwise a user could attach assessment rows to anyone's session.
  const { data: ownedSession } = await supabase
    .from("chat_sessions")
    .select("id, topic_id, plan")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (!ownedSession || ownedSession.topic_id !== topicId) {
    return new Response("Session not found", { status: 404 });
  }

  // Duplicate guard: double-clicks/retries must not create two round rows.
  const { data: existingRound } = await supabase
    .from("assessment_rounds")
    .select("id")
    .eq("session_id", sessionId)
    .eq("round", round)
    .eq("is_remediation", safeRemediation)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingRound) {
    return new Response("Round already recorded", { status: 409 });
  }

  const systemPromptBase = EVALUATE_SYSTEM_PROMPT
    .replace("{keyConcepts}", JSON.stringify(keyConcepts))
    .replace("{provenConcepts}", JSON.stringify(safeProven))
    .replace("{question}", question)
    .replace("{userAnswer}", userAnswer);

  // Scoped reference: the island's chunks ground the verdicts. The session
  // row is already ownership-checked above, so its plan is safe to use.
  let systemPrompt = systemPromptBase;
  try {
    const reference = await getIslandContext(supabase, topicId, {
      islandTitle,
      keyConcepts,
      plan: (ownedSession as { plan?: unknown }).plan,
    });
    if (reference) {
      systemPrompt += "\n\nReferencia tananyagrészlet a döntéshez (erre alapozd az ítéleteket):\n\n" + reference;
    } else {
      systemPrompt += "\n\nReferencia nem elérhető — értékeld a válasz belső logikája és a kulcsfogalmak lefedettsége alapján.";
    }
  } catch (err) {
    console.error("Evaluate context load failed:", err);
  }

  const messages = [{ role: "system" as const, content: systemPrompt }];

  const VALID_VERDICTS = new Set(["correct", "partial", "wrong", "missing", "not_required"]);
  let evaluateResult: EvaluateResponse;
  try {
    const raw = await completeJson(messages);
    evaluateResult = raw as EvaluateResponse;

    if (!evaluateResult.verdicts || !Array.isArray(evaluateResult.verdicts)) {
      throw new Error("Invalid evaluate response format");
    }
    // Keep only verdicts for known key concepts with valid labels, so a
    // hallucinated concept can't create stray mastery rows.
    const allowed = new Set(
      (keyConcepts as string[]).map((c) => c.trim()).filter(Boolean),
    );
    evaluateResult.verdicts = (evaluateResult.verdicts as Verdict[]).filter(
      (v) =>
        v &&
        typeof v.concept === "string" &&
        allowed.has(v.concept.trim()) &&
        VALID_VERDICTS.has(v.verdict),
    );
    if (typeof evaluateResult.feedback_hint !== "string") {
      evaluateResult.feedback_hint = "";
    }
    const nextFocus = evaluateResult.next_focus;
    evaluateResult.next_focus =
      typeof nextFocus === "string" && allowed.has(nextFocus.trim())
        ? nextFocus
        : null;
  } catch (err) {
    console.error("Evaluate AI error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }

  // Update concept_mastery for each verdict
  for (const v of evaluateResult.verdicts) {
    const { data: existing } = await supabase
      .from("concept_mastery")
      .select("status, correct_count, wrong_count")
      .eq("user_id", user.id)
      .eq("topic_id", topicId)
      .eq("concept", v.concept.trim())
      .maybeSingle();

    const current = existing ?? { status: "unseen", correct_count: 0, wrong_count: 0 };
    const updated = computeStatus(current, v.verdict);

    await supabase
      .from("concept_mastery")
      .upsert({
        user_id: user.id,
        topic_id: topicId,
        concept: v.concept.trim(),
        status: updated.status,
        correct_count: updated.correct_count,
        wrong_count: updated.wrong_count,
        last_source: safeRemediation ? "remediation" : "assessment",
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id, topic_id, concept",
      });
  }

  // Insert assessment_rounds row (duplicate already rejected above with 409,
  // so a conflict here only races — surface it instead of hiding).
  const { error: roundError } = await supabase
    .from("assessment_rounds")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      topic_id: topicId,
      island_title: islandTitle,
      round,
      is_remediation: safeRemediation,
      question,
      user_answer: userAnswer,
      verdicts: evaluateResult.verdicts as unknown as Record<string, unknown>,
    });

  if (roundError) {
    console.error("Failed to save assessment round:", roundError);
    return new Response("Failed to save assessment round", { status: 500 });
  }

  return new Response(JSON.stringify(evaluateResult), {
    headers: { "Content-Type": "application/json" },
  });
}
