import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are SAMCO's Executive Project Intelligence Analyst.
Return ONLY valid JSON with keys:
summary: string,
actions: string[],
risks: string[],
health: "Green" | "Yellow" | "Red".
Use only provided project data. Do not fabricate missing values.`);

function parseSummary(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      summary: String(parsed.summary || "No summary available from current data."),
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String).slice(0, 6) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 6) : [],
      health: ["Green", "Yellow", "Red"].includes(parsed.health) ? parsed.health : "Yellow"
    };
  } catch {
    return { summary: answer, actions: [], risks: [], health: "Yellow" };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`summary:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "summary");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const result = await askConfiguredAI(PROMPT, contextToPrompt(context), { json: true, maxTokens: 1200, temperature: 0.2 });
    return NextResponse.json({ ...parseSummary(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Project summary failed." }, { status: 500 });
  }
}


