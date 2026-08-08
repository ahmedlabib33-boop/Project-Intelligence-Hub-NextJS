import { NextRequest, NextResponse } from "next/server";
import { askConfiguredAI } from "../../../lib/ai/gateway";
import { buildProjectContext, contextToPrompt } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { withSamcoDirectorPrompt } from "../../../lib/ai/samco-director";
import { aiRequestFailure, aiTextList, formatAiText, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

const PROMPT = withSamcoDirectorPrompt(`You are a controlled Time Impact Analysis evidence reviewer.
Use only the selected project's controlled TIA run. The run status is authoritative.
Return ONLY valid JSON with keys: runStatus, evidenceDecision, sourceIntegrity, scheduleCpm, eventAndFragnet, concurrencyAndEntitlement, eotPosition, reconciliationItems, missingEvidence, nextActions.
If the controlled run is SETUP_REQUIRED, CONDITIONAL_RESULT, or RECONCILIATION_REQUIRED, preserve that status and explain only the documented gaps or controls.
Do not calculate, sum, grant, infer, or invent EOT days, delay days, criticality, float, concurrency, fragnet logic, entitlement, or compensation.
Set evidenceDecision to "ready_with_gates", "awaiting_evidence", or "blocked". Never use information from another project.`);

function parseDelay(answer: string) {
  try {
    const parsed = JSON.parse(answer);
    return {
      runStatus: formatAiText(parsed.runStatus) || "awaiting_evidence",
      evidenceDecision: formatAiText(parsed.evidenceDecision) || "awaiting_evidence",
      sourceIntegrity: formatAiText(parsed.sourceIntegrity) || "Not enough source evidence to confirm integrity.",
      scheduleCpm: formatAiText(parsed.scheduleCpm) || "Not enough schedule evidence to confirm CPM conclusions.",
      eventAndFragnet: formatAiText(parsed.eventAndFragnet) || "No fragnet conclusion may be made without controlled evidence.",
      concurrencyAndEntitlement: formatAiText(parsed.concurrencyAndEntitlement) || "Not enough evidence to confirm concurrency or entitlement.",
      eotPosition: formatAiText(parsed.eotPosition) || "No final EOT position is publishable.",
      reconciliationItems: aiTextList(parsed.reconciliationItems),
      missingEvidence: aiTextList(parsed.missingEvidence),
      nextActions: aiTextList(parsed.nextActions)
    };
  } catch {
    return {
      runStatus: "awaiting_evidence",
      evidenceDecision: "awaiting_evidence",
      sourceIntegrity: "Not enough source evidence to confirm integrity.",
      scheduleCpm: "Not enough schedule evidence to confirm CPM conclusions.",
      eventAndFragnet: "No fragnet conclusion may be made without controlled evidence.",
      concurrencyAndEntitlement: "Not enough evidence to confirm concurrency or entitlement.",
      eotPosition: "No final EOT position is publishable.",
      reconciliationItems: [answer],
      missingEvidence: [],
      nextActions: []
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


