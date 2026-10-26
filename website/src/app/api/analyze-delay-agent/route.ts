import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { aiRequestFailure, aiTextList, formatAiText, readAiJson } from "../../../lib/ai/request";
import { runReactAgent } from "../../../lib/agent/reactLoop";
import { buildTiaAgentTools } from "../../../lib/agent/tiaAgentTools";

/**
 * Schema 2 (Agent Core <-> Tool Sandbox) sibling of `analyze-delay`.
 *
 * `analyze-delay` narrates the controlled TIA run from one JSON dump that
 * `contextToPrompt` truncates to 4500 characters shared across every
 * feature area of the project -- on a project with a large letters/contract
 * payload, the delay section can be cut short or dropped entirely before
 * the model ever sees it. This route instead lets the agent pull each TIA
 * section on demand, in full, via `buildTiaAgentTools`, only reading what
 * it decides it needs.
 *
 * This is additive: `analyze-delay` is unchanged. The authoritative
 * `runStatus`/`approvalStatus` values are always read back from the real
 * controlled run after the agent finishes, never taken from the model's own
 * words -- the same "run status is authoritative" rule the existing route's
 * prompt already states is enforced here in code, not just in the prompt.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type AgentFinalAnswer = {
  runStatus?: unknown;
  evidenceDecision?: unknown;
  sourceIntegrity?: unknown;
  scheduleCpm?: unknown;
  eventAndFragnet?: unknown;
  concurrencyAndEntitlement?: unknown;
  eotPosition?: unknown;
  reconciliationItems?: unknown;
  missingEvidence?: unknown;
  nextActions?: unknown;
};

function fallbackAnswer(message: string) {
  return {
    runStatus: "awaiting_evidence",
    evidenceDecision: "awaiting_evidence",
    sourceIntegrity: "Not enough source evidence to confirm integrity.",
    scheduleCpm: "Not enough schedule evidence to confirm CPM conclusions.",
    eventAndFragnet: "No fragnet conclusion may be made without controlled evidence.",
    concurrencyAndEntitlement: "Not enough evidence to confirm concurrency or entitlement.",
    eotPosition: "No final EOT position is publishable.",
    reconciliationItems: [message],
    missingEvidence: [],
    nextActions: [],
  };
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`delay-agent:${req.headers.get("x-forwarded-for") || "local"}`, 5);
  if (!limit.allowed) return NextResponse.json({ error: "Too many AI requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    if (!projectKey) return NextResponse.json({ error: "projectKey is required." }, { status: 400 });
    const project = await getProjectData(projectKey);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const { tools, controlledTia } = buildTiaAgentTools(project);
    const authoritativeStatus = String(controlledTia.status || "SETUP_REQUIRED");
    const authoritativeApproval = String(controlledTia.approval_status || "not_submitted");

    const run = await runReactAgent<AgentFinalAnswer>({
      goal: `Explain this project's controlled Time Impact Analysis run for a claims reviewer. Pull each section you need with the available tools before answering. Final answer shape: {"runStatus": "", "evidenceDecision": "ready_with_gates|awaiting_evidence|blocked", "sourceIntegrity": "", "scheduleCpm": "", "eventAndFragnet": "", "concurrencyAndEntitlement": "", "eotPosition": "", "reconciliationItems": [""], "missingEvidence": [""], "nextActions": [""]}.`,
      systemPrompt:
        "You are a controlled Time Impact Analysis evidence reviewer. The run status returned by get_run_status is authoritative and you must restate it, not reinterpret it. You may restate an approved submitted EOT, event movement, or concurrency adjustment only when a tool observation already returned that exact value. Do not calculate, sum, alter, grant, infer, or invent any EOT days, delay days, criticality, float, concurrency, fragnet logic, entitlement, or compensation. Treat historic reconciliation-only values as conflicts, never as active results. Do not present an indicative P6-pending position as final contractual approval.",
      tools,
      maxSteps: 8,
    });

    if (run.status !== "completed" || !run.finalAnswer) {
      return NextResponse.json({
        ...fallbackAnswer(run.message || "The agent did not reach a conclusion."),
        runStatus: authoritativeStatus,
        transcript: run.steps,
      });
    }

    const answer = run.finalAnswer;
    return NextResponse.json({
      // Authoritative fields are read from the real run, never from the model.
      runStatus: authoritativeStatus,
      approvalStatus: authoritativeApproval,
      evidenceDecision: formatAiText(answer.evidenceDecision) || "awaiting_evidence",
      sourceIntegrity: formatAiText(answer.sourceIntegrity) || "Not enough source evidence to confirm integrity.",
      scheduleCpm: formatAiText(answer.scheduleCpm) || "Not enough schedule evidence to confirm CPM conclusions.",
      eventAndFragnet: formatAiText(answer.eventAndFragnet) || "No fragnet conclusion may be made without controlled evidence.",
      concurrencyAndEntitlement: formatAiText(answer.concurrencyAndEntitlement) || "Not enough evidence to confirm concurrency or entitlement.",
      eotPosition: formatAiText(answer.eotPosition) || "No final EOT position is publishable.",
      reconciliationItems: aiTextList(answer.reconciliationItems),
      missingEvidence: aiTextList(answer.missingEvidence),
      nextActions: aiTextList(answer.nextActions),
      transcript: run.steps,
    });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "Agent-assisted delay analysis failed." }, { status: 500 });
  }
}
