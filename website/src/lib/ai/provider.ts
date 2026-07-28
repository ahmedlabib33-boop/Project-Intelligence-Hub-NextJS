export type AiStatus = "success" | "fallback" | "error";

export type AiResponse = {
  answer: string;
  provider: string;
  model: string;
  status: AiStatus;
  error?: string;
  latencyMs?: number;
};

export type StructuredAiResponse<T> = T & {
  provider: string;
  model: string;
  status: AiStatus;
  latencyMs?: number;
};

export function sanitizeText(value: unknown, maxLength = 2000): string {
  const text = String(value ?? "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

export function safeErrorMessage(message = "AI service temporarily unavailable. Please retry."): AiResponse {
  return {
    answer: message,
    provider: "none",
    model: "none",
    status: "error",
    error: message
  };
}
