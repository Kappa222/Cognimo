import { createClient } from "../../../lib/supabase-server";
import { streamChat } from "../../../lib/ai";

const LUMI_SYSTEM_PROMPT =
  "You are Lumi, a friendly and encouraging study partner. Your goal is to help the user understand the topic they are studying. Explain concepts clearly, ask questions to check understanding, and provide examples. Be patient, supportive, and adapt to the user's level of knowledge. Respond in Hungarian.";

async function buildSystemPrompt(sessionId: string): Promise<string> {
  const supabase = await createClient();

  const parts: string[] = [LUMI_SYSTEM_PROMPT];

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("topic_id")
    .eq("id", sessionId)
    .single();

  if (!session) return parts.join("\n\n");

  if (session.topic_id) {
    const { data: materials } = await supabase
      .from("study_materials")
      .select("content")
      .eq("topic_id", session.topic_id)
      .not("content", "is", null);

    if (materials && materials.length > 0) {
      const materialText = materials
        .map((m) => m.content)
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (materialText) {
        parts.push(
          "Use the following study materials as the primary source of information. Base your explanations, examples, and answers on these materials. Prioritize them over your general knowledge.\n\n" +
          materialText
        );
      }
    }
  }

  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { sessionId, messages, phaseInstruction } = await req.json();

  if (!sessionId || !messages) {
    return new Response("sessionId and messages required", { status: 400 });
  }

  let systemPrompt = await buildSystemPrompt(sessionId);
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
