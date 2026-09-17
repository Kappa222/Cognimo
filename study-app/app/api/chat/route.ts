import { createClient } from "../../../lib/supabase-server";
import { streamChat } from "../../../lib/ai";
import { getIslandContext } from "../../../lib/chunks";

const LUMI_SYSTEM_PROMPT =
  "Te vagy Lumi, egy barátságos és bátorító tanulótárs. A célod, hogy segíts a felhasználónak megérteni a tanult témát. Magyarázd el a fogalmakat érthetően, tegyél fel kérdéseket a megértés ellenőrzésére, és adj példákat. Légy türelmes, támogató, és alkalmazkodj a felhasználó tudásszintjéhez. Válaszolj magyarul.";

// Client-tunable prompt fragment bounds (server-enforced, Hungarian UI).
const MAX_PHASE_INSTRUCTION_CHARS = 2000;
const MAX_ISLAND_TITLE_CHARS = 200;
const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 10000;

async function buildSystemPrompt(
  userId: string,
  sessionId: string,
  islandTitle?: string,
): Promise<{ prompt: string; hasMaterials: boolean } | null> {
  const supabase = await createClient();

  const parts: string[] = [LUMI_SYSTEM_PROMPT];

  // Ownership gate: only the session owner's rows are visible. A foreign
  // sessionId yields no row → caller gets 404, never free tutoring.
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("topic_id, plan")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (!session) return null;

  let hasMaterials = false;
  if (session.topic_id) {
    // Scoped retrieval: only the current island's chunks on large documents,
    // capped full text otherwise (small docs and legacy sessions).
    const materialText = await getIslandContext(supabase, session.topic_id, {
      islandTitle,
      plan: (session as { plan?: unknown }).plan,
    });
    if (materialText) {
      hasMaterials = true;
      parts.push(
        "Használd a következő tananyagokat elsődleges információforrásként. A magyarázataidat, példáidat és válaszaidat ezekre az anyagokra alapozd. Részesítsd előnyben őket az általános tudásoddal szemben.\n\n" +
        materialText
      );
    }
  }

  if (!hasMaterials) {
    parts.push(
      "Figyelem: ehhez a témához most nem érhető el olvasható tananyag. Magyarul, röviden közöld a felhasználóval, hogy nem látod a tananyagot, és kérd meg, hogy adjon hozzá tananyagot a Téma oldal Tananyagok fülén. Ne találj ki tananyag-specifikus állításokat."
    );
  }

  return { prompt: parts.join("\n\n"), hasMaterials };
}

function isValidHistory(messages: unknown): messages is { role: string; content: string }[] {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_HISTORY_MESSAGES) {
    return false;
  }
  return messages.every(
    (m) =>
      m !== null &&
      typeof m === "object" &&
      ((m as { role?: unknown }).role === "user" ||
        (m as { role?: unknown }).role === "assistant") &&
      typeof (m as { content?: unknown }).content === "string" &&
      ((m as { content: string }).content.trim().length > 0) &&
      (m as { content: string }).content.length <= MAX_MESSAGE_CHARS,
  );
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    sessionId?: unknown;
    messages?: unknown;
    phaseInstruction?: unknown;
    islandTitle?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { sessionId, messages, phaseInstruction, islandTitle } = body;

  if (typeof sessionId !== "string" || !sessionId || !isValidHistory(messages)) {
    return new Response("sessionId and messages required", { status: 400 });
  }

  // Server-side clamps: phaseInstruction/islandTitle are client-built hints,
  // never trusted verbatim for prompt injection.
  const safeInstruction =
    typeof phaseInstruction === "string"
      ? phaseInstruction.slice(0, MAX_PHASE_INSTRUCTION_CHARS)
      : "";
  const safeIslandTitle =
    typeof islandTitle === "string"
      ? islandTitle.slice(0, MAX_ISLAND_TITLE_CHARS)
      : undefined;

  const built = await buildSystemPrompt(user.id, sessionId, safeIslandTitle);
  if (!built) return new Response("Session not found", { status: 404 });

  let systemPrompt = built.prompt;
  if (safeInstruction) {
    systemPrompt += `\n\n${safeInstruction}`;
  }

  try {
    const stream = await streamChat(messages, systemPrompt);
    return new Response(stream, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    console.error("Chat stream error:", err);
    return new Response("AI service unavailable", { status: 503 });
  }
}
