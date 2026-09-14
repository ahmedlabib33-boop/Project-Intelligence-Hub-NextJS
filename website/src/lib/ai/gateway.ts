import type { AiResponse } from "./provider";
import { askGroq } from "./groq";
import { askOpenAI } from "./openai";

/**
 * Tries Groq first, then OpenAI on ANY Groq failure — not only a missing key.
 * A configured-but-broken Groq (a retired model, an outage, exhausted rate
 * limits) must fail over the same way an unconfigured one does; it must not
 * silently stop every AI feature until someone notices and redeploys.
 */
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

  const openaiResult = await askOpenAI(systemPrompt, userPrompt, options);
  if (openaiResult.status === "success") return openaiResult;

  // Both failed — surface whichever provider is actually configured, so the
  // error names a real problem (bad model, outage, quota) rather than
  // "not configured" for a key that is in fact set.
  const groqConfigured = groqResult.error !== "GROQ_API_KEY missing";
  return groqConfigured ? groqResult : openaiResult;
}
