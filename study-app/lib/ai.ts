import OpenAI from "openai";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "gpt-4o";

function getGroqClient() {
  return new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY!,
  });
}

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

async function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    console.error("Primary AI call failed, falling back:", err);
    if (!process.env.OPENAI_API_KEY) throw err;
    return await fallback();
  }
}

export async function completeJson(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<unknown> {
  const result = await withFallback(
    async () => {
      const groq = getGroqClient();
      const completion = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        response_format: { type: "json_object" },
      });
      return completion.choices[0]?.message?.content ?? "";
    },
    async () => {
      const openai = getOpenAIClient();
      const completion = await openai.chat.completions.create({
        model: FALLBACK_MODEL,
        messages,
        response_format: { type: "json_object" },
      });
      return completion.choices[0]?.message?.content ?? "";
    },
  );

  if (!result) throw new Error("Empty response from AI");
  return JSON.parse(result);
}

export async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<ReadableStream> {
  try {
    const groq = getGroqClient();
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      stream: true,
    });

    return new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) controller.enqueue(text);
        }
        controller.close();
      },
    });
  } catch (groqError) {
    console.error("Groq stream error, falling back:", groqError);
    if (!process.env.OPENAI_API_KEY) throw groqError;
    const openai = getOpenAIClient();
    const stream = await openai.chat.completions.create({
      model: FALLBACK_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      stream: true,
    });

    return new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) controller.enqueue(text);
        }
        controller.close();
      },
    });
  }
}
