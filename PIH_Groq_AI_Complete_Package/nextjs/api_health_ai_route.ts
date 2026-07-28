import { NextResponse } from "next/server";
import { groq, GROQ_MODEL_FALLBACK } from "@/lib/groq";

export async function GET() {
  if (!groq) {
    return NextResponse.json({
      providers: [
        { name: "groq", available: false, error: "GROQ_API_KEY not configured" },
      ],
    });
  }

  try {
    const start = Date.now();
    await groq.chat.completions.create({
      model: GROQ_MODEL_FALLBACK,
      messages: [{ role: "user", content: "Say ok" }],
      max_tokens: 5,
      temperature: 0,
    });
    const latency = Date.now() - start;

    return NextResponse.json({
      providers: [
        { name: "groq", available: true, latency_ms: latency, model: GROQ_MODEL_FALLBACK },
      ],
    });
  } catch (err: any) {
    return NextResponse.json({
      providers: [{ name: "groq", available: false, error: err.message }],
    });
  }
}
