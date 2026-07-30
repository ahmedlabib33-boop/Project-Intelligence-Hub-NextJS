import type { AiResponse } from "./provider";
import { getServerEnv } from "./env";

export const OPENAI_MODEL = getServerEnv("OPENAI_MODEL") || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(getServerEnv("OPENAI_TIMEOUT_MS") || 22000);

function publicError(status?: number, code?: string): string {
  if (status === 429 && code === "insufficient_quota") return "OpenAI API quota is unavailable. Check API billing or credits.";
  if (status === 429) return "AI rate limit reached. Please retry shortly.";
  if (status === 401 || status === 403) return "OpenAI provider is not authorized. Check server configuration.";
  return "OpenAI service temporarily unavailable. Please retry.";
}

function extractOutputText(payload: unknown): string {
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  if (record.output_text) return record.output_text.trim();
  for (const item of record.output || []) {
    for (const content of item.content || []) {
      if (content.text) return content.text.trim();
    }
  }
  return "";
}

export async function askOpenAI(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
  }
): Promise<AiResponse> {
  const apiKey = getServerEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return {
      answer: "OpenAI provider is not configured. Set OPENAI_API_KEY on the server.",
      provider: "openai",
      model: "none",
      status: "error",
      error: "OPENAI_API_KEY missing"
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const model = options?.model || OPENAI_MODEL;
  const formatInstruction = options?.json
    ? "\n\nReturn only valid JSON. Do not wrap the JSON in Markdown."
    : "";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${userPrompt}${formatInstruction}` }
        ],
        temperature: options?.temperature ?? 0.25,
        max_output_tokens: options?.maxTokens ?? 1600
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      let errorCode = "";
      try {
        const errorPayload = await response.json();
        errorCode = String(errorPayload?.error?.code || "");
      } catch {
        errorCode = "";
      }
      return {
        answer: publicError(response.status, errorCode),
        provider: "openai",
        model,
        status: "error",
        error: publicError(response.status, errorCode),
        latencyMs: Date.now() - started
      };
    }
    const payload = await response.json();
    const answer = extractOutputText(payload);
    if (!answer) throw new Error("Empty OpenAI response");
    return {
      answer,
      provider: "openai",
      model,
      status: "success",
      latencyMs: Date.now() - started
    };
  } catch {
    clearTimeout(timeout);
    return {
      answer: "OpenAI service temporarily unavailable. Please retry.",
      provider: "openai",
      model,
      status: "error",
      error: "OpenAI request failed",
      latencyMs: Date.now() - started
    };
  }
}

export async function checkOpenAIHealth() {
  const apiKey = getServerEnv("OPENAI_API_KEY");
  if (!apiKey) return { name: "openai", available: false, error: "OPENAI_API_KEY not configured" };
  // Configuration status is enough for the public UI. Provider reachability is
  // confirmed by the real user request, avoiding an avoidable paid API call.
  return { name: "openai", available: true, configured: true, model: OPENAI_MODEL };
}
