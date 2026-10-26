/**
 * Schema 1's "LLM Worker (Async Task)" box for the Next.js/Vercel side.
 *
 * Drop-in replacement for `askConfiguredAI` (same signature, same return
 * shape) that routes the call through `runThroughQueue` first, so every
 * evidence-analyzer / letters-intelligence / delay-analysis AI call gets a
 * durable attempt log and a bounded retry on a thrown (network-level)
 * error. A graceful `{status: "error"}` response from the gateway -- e.g.
 * both Groq and OpenAI rejecting the request -- is not retried; only an
 * unexpected exception is.
 */

import { askConfiguredAI } from "../ai/gateway";
import type { AiResponse } from "../ai/provider";
import { runThroughQueue } from "./queue";

export async function askConfiguredAIJob(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
  }
): Promise<AiResponse> {
  const { result } = await runThroughQueue(
    "llm_task",
    { systemPrompt, userPrompt, options },
    (payload) => askConfiguredAI(payload.systemPrompt, payload.userPrompt, payload.options),
    {
      describePayload: (payload) => ({
        systemPromptPreview: payload.systemPrompt.slice(0, 120),
        userPromptPreview: payload.userPrompt.slice(0, 120),
        model: payload.options?.model,
      }),
    }
  );
  return result;
}
