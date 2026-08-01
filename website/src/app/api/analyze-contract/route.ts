import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";
import { aiRequestFailure, aiTextList, formatAiText, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a construction contract and claims analyst.
Use only the selected project's generated contract and evidence context.
Return ONLY valid JSON with keys: summary, keyClauses, claimExposure, recommendations.
Do not claim that a clause exists unless it appears in the provided context.`);

function parseContract(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      summary: formatAiText(parsed.summary) || "No contract summary available from current data.",
      keyClauses: aiTextList(parsed.keyClauses),
      claimExposure: formatAiText(parsed.claimExposure) || "Not enough data",
      recommendations: aiTextList(parsed.recommendations)
    };
  } catch {
    return { summary: answer, keyClauses: [], claimExposure: "Not enough data", recommendations: [] };
  }
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`contract:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const clauseQuery = sanitizeText(body?.clauseQuery, 600);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const context = await buildProjectContext(projectKey, "contract");
    if (!context) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    const prompt = `${contextToPrompt(context)}\n\nClause question, if any:\n${clauseQuery || "None"}`;
    const result = await askConfiguredAI(PROMPT, prompt, { json: true, maxTokens: 1600, temperature: 0.2 });
    return NextResponse.json({ ...parseContract(result.answer), provider: result.provider, model: result.model, status: result.status, latencyMs: result.latencyMs });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Contract analysis failed." }, { status: 500 });
  }
}


