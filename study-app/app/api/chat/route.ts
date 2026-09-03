import { createClient } from "../../../lib/supabase-server";
import { streamChat } from "../../../lib/ai";
import { getIslandContext } from "../../../lib/chunks";

const LUMI_SYSTEM_PROMPT =
  "Te vagy Lumi, egy barátságos és bátorító tanulótárs. A célod, hogy segíts a felhasználónak megérteni a tanult témát. Magyarázd el a fogalmakat érthetően, tegyél fel kérdéseket a megértés ellenőrzésére, és adj példákat. Légy türelmes, támogató, és alkalmazkodj a felhasználó tudásszintjéhez. Válaszolj magyarul.";

async function buildSystemPrompt(sessionId: string, islandTitle?: string): Promise<string> {
  const supabase = await createClient();

  const parts: string[] = [LUMI_SYSTEM_PROMPT];

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("topic_id, plan")
    .eq("id", sessionId)
    .single();

  if (!session) return parts.join("\n\n");

  if (session.topic_id) {
    // Scoped retrieval: only the current island's chunks on large documents,
    // capped full text otherwise (small docs and legacy sessions).
    const materialText = await getIslandContext(supabase, session.topic_id, {
      islandTitle,
      plan: (session as { plan?: unknown }).plan,
    });
    if (materialText) {
      parts.push(
        "Használd a következő tananyagokat elsődleges információforrásként. A magyarázataidat, példáidat és válaszaidat ezekre az anyagokra alapozd. Részesítsd előnyben őket az általános tudásoddal szemben.\n\n" +
        materialText
      );
    }
  }

  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { sessionId, messages, phaseInstruction, islandTitle } = await req.json();

  if (!sessionId || !messages) {
    return new Response("sessionId and messages required", { status: 400 });
  }

  let systemPrompt = await buildSystemPrompt(sessionId, islandTitle);
  if (phaseInstruction) {
    systemPrompt += `\n\n${phaseInstruction}`;
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
