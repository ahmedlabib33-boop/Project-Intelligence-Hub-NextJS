import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a construction claims correspondence analyst.
Review only the selected project's letters intelligence context.
Return ONLY valid JSON with keys: themes, criticalLetters, actionItems, deadlines.
Each key must be an array of concise strings. If no letters exist, return empty arrays and explain in themes.`);

function parseListResponse(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      themes: Array.isArray(parsed.themes) ? parsed.themes.map(String).slice(0, 8) : [],
      criticalLetters: Array.isArray(parsed.criticalLetters) ? parsed.criticalLetters.map(String).slice(0, 8) : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(String).slice(0, 8) : [],
      deadlines: Array.isArray(parsed.deadlines) ? parsed.deadlines.map(String).slice(0, 8) : []
    };
  } catch {
    return { themes: [answer], criticalLetters: [], actionItems: [], deadlines: [] };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`letters:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await req.json();
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "letters");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const result = await askConfiguredAI(PROMPT, contextToPrompt(context), { json: true, maxTokens: 1400, temperature: 0.2 });
    return NextResponse.json({ ...parseListResponse(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch {
    return NextResponse.json({ error: "Letters analysis failed." }, { status: 500 });
  }
}


