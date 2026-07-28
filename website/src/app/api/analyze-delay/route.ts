import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a senior delay analyst and project controls advisor.
Use only the selected project's Delay Analysis / Time Impact Analysis context.
Return ONLY valid JSON with keys: delayEvents, criticalPathImpact, recoveryOptions, riskExposure.
Do not fabricate EOT days, criticality, float, or concurrency when data is missing.`);

function parseDelay(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      delayEvents: Array.isArray(parsed.delayEvents) ? parsed.delayEvents.map(String).slice(0, 8) : [],
      criticalPathImpact: String(parsed.criticalPathImpact || "Not enough data to confirm critical path impact."),
      recoveryOptions: Array.isArray(parsed.recoveryOptions) ? parsed.recoveryOptions.map(String).slice(0, 8) : [],
      riskExposure: String(parsed.riskExposure || "Not enough data")
    };
  } catch {
    return { delayEvents: [answer], criticalPathImpact: "Not enough data to confirm critical path impact.", recoveryOptions: [], riskExposure: "Not enough data" };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`delay:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await req.json();
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "delay");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const result = await askConfiguredAI(PROMPT, contextToPrompt(context), { json: true, maxTokens: 1600, temperature: 0.2 });
    return NextResponse.json({ ...parseDelay(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch {
    return NextResponse.json({ error: "Delay analysis failed." }, { status: 500 });
  }
}


