import { sanitizeText } from "./provider";

type JsonBody = Record<string, unknown>;

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

export async function readAiJson(request: Request, maxBytes = 16_000): Promise<JsonBody> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiRequestError("Request is too large.", 413);
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new AiRequestError("Content-Type must be application/json.", 415);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new AiRequestError("Request is too large.", 413);
  }
  if (!raw.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AiRequestError("JSON request body must be an object.", 400);
    }
    return parsed as JsonBody;
  } catch (error) {
    if (error instanceof AiRequestError) throw error;
    throw new AiRequestError("Invalid JSON request body.", 400);
  }
}

export function aiRequestFailure(error: unknown) {
  if (error instanceof AiRequestError) return { error: error.message, status: error.status };
  return null;
}

/** Converts model-returned scalars or small objects into safe, readable UI text. */
export function formatAiText(value: unknown, maxLength = 480): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return sanitizeText(value, maxLength);
  }
  if (Array.isArray(value)) {
    return sanitizeText(
      value
        .map((item) => formatAiText(item, Math.max(80, Math.floor(maxLength / 2))))
        .filter(Boolean)
        .join("; "),
      maxLength
    );
  }
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined && String(item).trim())
      .slice(0, 5)
      .map(([key, item]) => {
        const label = key.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim();
        return `${label}: ${formatAiText(item, Math.max(80, Math.floor(maxLength / 2)))}`;
      });
    return sanitizeText(pairs.join("; "), maxLength);
  }
  return "";
}

export function aiTextList(value: unknown, maxItems = 8, maxLength = 480): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => formatAiText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}
