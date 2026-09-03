import { createClient } from "../../../lib/supabase-server";
import { completeJson } from "../../../lib/ai";
import { getIslandContext } from "../../../lib/chunks";

const EVALUATE_SYSTEM_PROMPT = `Te egy szigorú, de igazságos szakmai értékelő vagy. A felhasználó egy "fordított tanár" gyakorlatban tanít: elmagyaráz valamit egy tanuló AI-nak. A feladatod: minősítsd a magyarázatot KIZÁRÓLAG a megadott kulcsfogalmak szempontjából.

Kulcsfogalmak: {keyConcepts}
Már igazolt fogalmak (ezekre nem kell figyelni): {provenConcepts}
A tanuló AI kérdése: {question}
A felhasználó magyarázata: {userAnswer}

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
  } else if (verdict === "missing" || verdict === "not_required") {
    if (status === "unseen") status = "seen";
  }

  return { status, correct_count, wrong_count };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json();
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
    sessionId: string;
    topicId: string;
    islandTitle: string;
    keyConcepts: string[];
    question: string;
    userAnswer: string;
    round: number;
    isRemediation?: boolean;
    provenConcepts?: string[];
  };

  if (!sessionId || !topicId || !islandTitle || !keyConcepts || !question || !userAnswer || round === undefined) {
    return new Response("Missing required fields", { status: 400 });
  }

  const systemPromptBase = EVALUATE_SYSTEM_PROMPT
    .replace("{keyConcepts}", JSON.stringify(keyConcepts))
    .replace("{provenConcepts}", JSON.stringify(provenConcepts ?? []))
    .replace("{question}", question)
    .replace("{userAnswer}", userAnswer);

  // Scoped reference: the island's chunks ground the verdicts on large
  // documents; capped full text otherwise. Absent on failure (judge on
  // concepts alone, as before).
  let systemPrompt = systemPromptBase;
  try {
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("plan")
      .eq("id", sessionId)
      .single();
    const reference = await getIslandContext(supabase, topicId, {
      islandTitle,
      keyConcepts,
      plan: (session as { plan?: unknown } | null)?.plan,
    });
    if (reference) {
      systemPrompt += "\n\nReferencia tananyagrészlet a döntéshez (erre alapozd az ítéleteket):\n\n" + reference;
    }
  } catch (err) {
    console.error("Evaluate context load failed:", err);
  }

  const messages = [{ role: "system" as const, content: systemPrompt }];

  let evaluateResult: EvaluateResponse;
  try {
    const raw = await completeJson(messages);
    evaluateResult = raw as EvaluateResponse;

    if (!evaluateResult.verdicts || !Array.isArray(evaluateResult.verdicts)) {
      throw new Error("Invalid evaluate response format");
    }
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
      .eq("concept", v.concept)
      .maybeSingle();

    const current = existing ?? { status: "unseen", correct_count: 0, wrong_count: 0 };
    const updated = computeStatus(current, v.verdict);

    await supabase
      .from("concept_mastery")
      .upsert({
        user_id: user.id,
        topic_id: topicId,
        concept: v.concept,
        status: updated.status,
        correct_count: updated.correct_count,
        wrong_count: updated.wrong_count,
        last_source: isRemediation ? "remediation" : "assessment",
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id, topic_id, concept",
      });
  }

  // Insert assessment_rounds row
  const { error: roundError } = await supabase
    .from("assessment_rounds")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      topic_id: topicId,
      island_title: islandTitle,
      round,
      is_remediation: isRemediation ?? false,
      question,
      user_answer: userAnswer,
      verdicts: evaluateResult.verdicts as unknown as Record<string, unknown>,
    });

  if (roundError) {
    console.error("Failed to save assessment round:", roundError);
  }

  return new Response(JSON.stringify(evaluateResult), {
    headers: { "Content-Type": "application/json" },
  });
}
