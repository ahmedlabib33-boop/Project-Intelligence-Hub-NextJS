import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";

export const runtime = "nodejs";

const SYSTEM_PROMPT = withSamcoDirectorPrompt(`You are SAMCO's Executive Project Intelligence Analyst.
Analyze only the provided Project Intelligence Hub data. Answer in concise executive language.
If data is missing or insufficient, say that clearly. Do not invent project facts, dates, money, delay days, clauses, or risks.
Cite the source scope as portfolio or selected project, and mention relevant source files/tables when available.
Support English and Arabic based on the user's question.`);

function rateKey(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`ask:${rateKey(req)}`, 10);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many AI requests. Please retry shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) }
    });
  }

  try {
    const body = await req.json();
    const question = sanitizeText(body?.question, 2000);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const sector = sanitizeText(body?.sector, 120);
    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const context = await buildProjectContext(projectKey || undefined, sector ? `general:${sector}` : "general");
    if (!context) {
      return NextResponse.json({ error: "No project data available for this AI request." }, { status: 404 });
    }

    const userPrompt = `Project data context:\n${contextToPrompt(context)}\n\nQuestion:\n${question}`;
    const result = await askConfiguredAI(SYSTEM_PROMPT, userPrompt, { maxTokens: 1400, temperature: 0.25 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "AI request failed. Please retry." }, { status: 500 });
  }
}


