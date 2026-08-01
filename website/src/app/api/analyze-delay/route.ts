import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";
import { aiRequestFailure, aiTextList, formatAiText, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a senior delay analyst and project controls advisor.
Use only the selected project's Delay Analysis / Time Impact Analysis context.
Return ONLY valid JSON with keys: evidenceDecision, automationStatus, delayEvents, criticalPathImpact, fragnetRecommendation, logicRecommendation, recoveryOptions, riskExposure, evidenceGaps.
Use "ready_with_gates", "awaiting_evidence", or "blocked" for evidenceDecision.
Set automationStatus to "recommendation_only" unless validated source evidence supports the recommendation.
Do not fabricate EOT days, criticality, float, concurrency, entitlement, or compensation when data is missing.
Never use information from another project.`);

function parseDelay(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      evidenceDecision: formatAiText(parsed.evidenceDecision) || "awaiting_evidence",
      automationStatus: formatAiText(parsed.automationStatus) || "recommendation_only",
      delayEvents: aiTextList(parsed.delayEvents),
      criticalPathImpact: formatAiText(parsed.criticalPathImpact) || "Not enough data to confirm critical path impact.",
      fragnetRecommendation: aiTextList(parsed.fragnetRecommendation),
      logicRecommendation: aiTextList(parsed.logicRecommendation),
      recoveryOptions: aiTextList(parsed.recoveryOptions),
      riskExposure: formatAiText(parsed.riskExposure) || "Not enough data",
      evidenceGaps: aiTextList(parsed.evidenceGaps)
    };
  } catch {
    return {
      evidenceDecision: "awaiting_evidence",
      automationStatus: "recommendation_only",
      delayEvents: [answer],
      criticalPathImpact: "Not enough data to confirm critical path impact.",
      fragnetRecommendation: [],
      logicRecommendation: [],
      recoveryOptions: [],
      riskExposure: "Not enough data",
      evidenceGaps: []
    };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`delay:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "delay");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const result = await askConfiguredAI(PROMPT, contextToPrompt(context), { json: true, maxTokens: 1600, temperature: 0.2 });
    return NextResponse.json({ ...parseDelay(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Delay analysis failed." }, { status: 500 });
  }
}


