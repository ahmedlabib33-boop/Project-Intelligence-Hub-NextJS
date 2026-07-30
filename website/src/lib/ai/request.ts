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
