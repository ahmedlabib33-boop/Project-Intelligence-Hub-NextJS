import Groq from "groq-sdk";
import type { AiResponse } from "./provider";
import { getServerEnv } from "./env";

const apiKey = getServerEnv("GROQ_API_KEY");

/**
 * Groq retires models: the Llama 3 models this module defaulted to now answer
 * 404 model_not_found. A retired name — as a default or in configuration — is
 * replaced by its current equivalent instead of failing every request.
 */
const RETIRED_MODELS: Record<string, string> = {
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "mixtral-8x7b-32768": "openai/gpt-oss-20b",
};

export function currentGroqModel(name: string): string {
  return RETIRED_MODELS[name.trim()] || name.trim();
}

export const GROQ_MODEL_PRIMARY = currentGroqModel(getServerEnv("GROQ_MODEL_PRIMARY") || "openai/gpt-oss-20b");

export const GROQ_MODEL_FALLBACK = currentGroqModel(getServerEnv("GROQ_MODEL_FALLBACK") || "openai/gpt-oss-120b");

export const groq = apiKey
  ? new Groq({
      apiKey,
      timeout: Number(getServerEnv("GROQ_TIMEOUT_MS") || 18000),
      maxRetries: 0
    })
  : null;

function publicError(status?: number, model?: string): string {
  if (status === 429) return "AI rate limit reached. Please retry shortly.";
  if (status === 401 || status === 403) return "AI provider is not authorized. Check server configuration.";
  if (status === 404) return `The AI model ${model || ""} is not available on this Groq account. Set GROQ_MODEL_PRIMARY to an available model.`.replace("  ", " ");
  return "AI service temporarily unavailable. Please retry.";
}

type LooseCreate = (params: Record<string, unknown>) => Promise<{ choices: { message?: { content?: string | null } }[] }>;

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

  const modelsToTry = Array.from(new Set([currentGroqModel(options?.model || GROQ_MODEL_PRIMARY), GROQ_MODEL_FALLBACK]));
  let lastStatus: number | undefined;
  let lastModel: string | undefined;
  // gpt-oss models spend output tokens on reasoning first; keep that short so the answer fits.
  const create = groq.chat.completions.create.bind(groq.chat.completions) as unknown as LooseCreate;
  const started = Date.now();

  for (const model of modelsToTry) {
    try {
      const response = await create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: options?.temperature ?? 0.25,
        max_tokens: options?.maxTokens ?? 1600,
        response_format: options?.json ? { type: "json_object" } : undefined,
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {})
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
      lastModel = model;
      if (err.status === 429 && model !== GROQ_MODEL_FALLBACK) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
      if (model !== GROQ_MODEL_FALLBACK) continue;
    }
  }

  return {
    answer: publicError(lastStatus, lastModel),
    provider: "groq",
    model: modelsToTry[0] || GROQ_MODEL_PRIMARY,
    status: "error",
    error: publicError(lastStatus, lastModel),
    latencyMs: Date.now() - started
  };
}

export async function checkGroqHealth() {
  if (!groq) {
    return { name: "groq", available: false, error: "GROQ_API_KEY not configured" };
  }
  // This public endpoint must never spend model tokens just to render the chat UI.
  return { name: "groq", available: true, configured: true, model: GROQ_MODEL_PRIMARY, fallback: GROQ_MODEL_FALLBACK };
}
