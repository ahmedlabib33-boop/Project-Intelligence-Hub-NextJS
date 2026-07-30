import { NextResponse } from "next/server";
import { checkGroqHealth } from "../../../../lib/ai/groq";
import { checkOpenAIHealth } from "../../../../lib/ai/openai";

export const runtime = "nodejs";

export async function GET() {
  const providers = await Promise.all([checkGroqHealth(), checkOpenAIHealth()]);
  return NextResponse.json({ providers }, { headers: { "Cache-Control": "private, max-age=300" } });
}
