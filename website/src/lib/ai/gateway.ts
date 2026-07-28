import type { AiResponse } from "./provider";
import { askGroq } from "./groq";
import { askOpenAI } from "./openai";

export async function askConfiguredAI(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
  }
): Promise<AiResponse> {
  const groqResult = await askGroq(systemPrompt, userPrompt, options);
  if (groqResult.status === "success") return groqResult;
  if (groqResult.error && !groqResult.error.toLowerCase().includes("missing")) return groqResult;

  const openaiResult = await askOpenAI(systemPrompt, userPrompt, options);
  if (openaiResult.status === "success") return openaiResult;
  return openaiResult.error?.toLowerCase().includes("missing") ? groqResult : openaiResult;
}
