import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const MODEL = "gemini-3.5-flash";

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

function getGeminiClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
}

function toGeminiMessages(
  messages: { role: string; content: string }[],
): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : ("user" as "user" | "model"),
    parts: [{ text: m.content }],
  }));
}

export async function completeJson(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<unknown> {
  const genAI = getGeminiClient();
  const firstIsSystem = messages[0]?.role === "system";

  let systemMessage: string | undefined;
  let geminiMessages: { role: "user" | "model"; parts: { text: string }[] }[];

  if (firstIsSystem) {
    systemMessage = messages[0].content;
    geminiMessages = toGeminiMessages(messages.slice(1));
  } else {
    geminiMessages = toGeminiMessages(messages);
  }

  if (geminiMessages.length === 0) {
    geminiMessages = [{ role: "user", parts: [{ text: systemMessage! }] }];
    systemMessage = undefined;
  }

  const model = genAI.getGenerativeModel({
    model: MODEL,
    ...(systemMessage ? { systemInstruction: systemMessage } : {}),
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  let result;
  try {
    result = await model.generateContent({ contents: geminiMessages });
  } catch (e) {
    console.error("Gemini API error:", e);
    throw new Error(`AI service error: ${(e as Error).message}`);
  }

  let text: string;
  try {
    text = result.response.text();
  } catch {
    const feedback = result.response.promptFeedback;
    const blockReason = feedback?.blockReason;
    const finishReason = result.response.candidates?.[0]?.finishReason;
    console.error("Gemini response blocked", { blockReason, finishReason });
    throw new Error(`AI response blocked: ${blockReason ?? finishReason ?? "unknown"}`);
  }

  if (!text) throw new Error("Empty response from AI");

  try {
    return JSON.parse(text);
  } catch {
    console.error("Gemini JSON parse error:", text.substring(0, 200));
    throw new Error("AI response was not valid JSON");
  }
}

export async function streamChat(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<ReadableStream> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
    safetySettings: SAFETY_SETTINGS,
  });

  const geminiMessages = toGeminiMessages(messages);
  const streamResult = await model.generateContentStream({ contents: geminiMessages });

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) controller.enqueue(text);
      }
      controller.close();
    },
  });
}
