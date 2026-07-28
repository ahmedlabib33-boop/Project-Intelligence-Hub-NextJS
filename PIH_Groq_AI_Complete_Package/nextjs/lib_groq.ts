import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;

export const groq = apiKey ? new Groq({ apiKey }) : null;

export const GROQ_MODEL_PRIMARY =
  process.env.GROQ_MODEL_PRIMARY ||
  "meta-llama/llama-4-maverick-17b-128e-instruct";

export const GROQ_MODEL_FALLBACK =
  process.env.GROQ_MODEL_FALLBACK || "llama-3.1-8b-instant";

export interface AiResponse {
  answer: string;
  provider: string;
  model: string;
  status: "success" | "fallback" | "error";
  error?: string;
}

export async function askGroq(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<AiResponse> {
  if (!groq) {
    return {
      answer: "AI provider not configured. Please set GROQ_API_KEY.",
      provider: "none",
      model: "none",
      status: "error",
      error: "GROQ_API_KEY missing",
    };
  }

  const modelsToTry = [model || GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK];

  for (const m of modelsToTry) {
    try {
      const response = await groq.chat.completions.create({
        model: m,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      });
      const answer = response.choices[0]?.message?.content?.trim() || "";
      return { answer, provider: "groq", model: m, status: "success" };
    } catch (err: any) {
      if (err.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error(`Groq error with ${m}:`, err.message);
      continue;
    }
  }

  return {
    answer: "AI service temporarily unavailable. Please retry.",
    provider: "groq",
    model: GROQ_MODEL_PRIMARY,
    status: "error",
    error: "All models failed",
  };
}
