import Groq from "groq-sdk";
import type { AiResponse } from "./provider";
import { getServerEnv } from "./env";

const apiKey = getServerEnv("GROQ_API_KEY");

export const GROQ_MODEL_PRIMARY =
  getServerEnv("GROQ_MODEL_PRIMARY") || "llama-3.1-8b-instant";

export const GROQ_MODEL_FALLBACK =
  getServerEnv("GROQ_MODEL_FALLBACK") || "llama-3.1-8b-instant";

export const groq = apiKey
  ? new Groq({
      apiKey,
      timeout: Number(getServerEnv("GROQ_TIMEOUT_MS") || 18000),
      maxRetries: 0
    })
  : null;

function publicError(status?: number): string {
  if (status === 429) return "AI rate limit reached. Please retry shortly.";
  if (status === 401 || status === 403) return "AI provider is not authorized. Check server configuration.";
  return "AI service temporarily unavailable. Please retry.";
}

export async function askGroq(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
  }
): Promise<AiResponse> {
  if (!groq) {
    return {
      answer: "AI provider is not configured. Set GROQ_API_KEY on the server.",
      provider: "groq",
      model: "none",
      status: "error",
      error: "GROQ_API_KEY missing"
    };
  }

  const modelsToTry = Array.from(new Set([options?.model || GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK]));
  let lastStatus: number | undefined;
  const started = Date.now();

  for (const model of modelsToTry) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: options?.temperature ?? 0.25,
        max_tokens: options?.maxTokens ?? 1600,
        response_format: options?.json ? { type: "json_object" } : undefined
      });
      const answer = response.choices[0]?.message?.content?.trim() || "";
      if (!answer) throw new Error("Empty model response");
      return {
        answer,
        provider: "groq",
        model,
        status: "success",
        latencyMs: Date.now() - started
      };
    } catch (error) {
      const err = error as { status?: number };
      lastStatus = err.status;
      if (err.status === 429 && model !== GROQ_MODEL_FALLBACK) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
      if (model !== GROQ_MODEL_FALLBACK) continue;
    }
  }

  return {
    answer: publicError(lastStatus),
    provider: "groq",
    model: modelsToTry[0] || GROQ_MODEL_PRIMARY,
    status: "error",
    error: publicError(lastStatus),
    latencyMs: Date.now() - started
  };
}

export async function checkGroqHealth() {
  if (!groq) {
    return { name: "groq", available: false, error: "GROQ_API_KEY not configured" };
  }
  const started = Date.now();
  try {
    await groq.chat.completions.create({
      model: GROQ_MODEL_FALLBACK,
      messages: [{ role: "user", content: "Say ok" }],
      max_tokens: 5,
      temperature: 0
    });
    return {
      name: "groq",
      available: true,
      latency_ms: Date.now() - started,
      model: GROQ_MODEL_FALLBACK
    };
  } catch {
    return { name: "groq", available: false, error: "AI health check failed" };
  }
}
