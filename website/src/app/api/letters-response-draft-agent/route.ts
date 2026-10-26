import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";
import { runReactAgent } from "../../../lib/agent/reactLoop";
import { buildLettersAgentTools } from "../../../lib/agent/lettersAgentTools";
import { assembleControlledDraft, clauseByNumber, findIncomingLetter, toContractEvidence, toPriorCorrespondence, valueOf, type JsonRecord } from "../../../lib/letters/lettersData";

/**
 * Schema 2 (Agent Core <-> Tool Sandbox) sibling of `letters-response-draft`.
 *
 * The deterministic route stays exactly as it was: a single fixed
 * keyword-overlap pass over clauses/history. This route instead lets an LLM
 * agent actively search the same evidence -- retrying with different
 * keywords, checking a specific clause, following up on the letter's own
 * fields -- before deciding whether usable evidence exists. It is additive,
 * not a replacement: nothing about the original route changed to make room
 * for this.
 *
 * The agent only ever *chooses which real records to cite*. The actual
 * quoted clause text and the legal draft template are assembled here from
 * `lettersData.ts`, the exact same single source of truth the deterministic
 * route uses -- the agent's own prose is never inserted into the draft, so
 * a hallucinated clause number simply fails the lookup below and is dropped.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type AgentFinalAnswer = {
  evidence_found?: boolean;
  clause_numbers?: unknown;
  history_references?: unknown;
  reasoning?: string;
};

function stringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`letters-response-agent:${req.headers.get("x-forwarded-for") || "local"}`, 6);
  if (!limit.allowed) return NextResponse.json({ error: "Too many draft requests." }, { status: 429 });

  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const reference = sanitizeText(body?.reference, 180);
    if (!projectKey || !reference) return NextResponse.json({ error: "projectKey and consultant letter reference are required." }, { status: 400 });
    const project = await getProjectData(projectKey);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const { tools, sheets, sourceClauses } = buildLettersAgentTools(project as JsonRecord);
    const incoming = findIncomingLetter(sheets, reference);
    if (!incoming) return NextResponse.json({ error: "The selected reference is not a published consultant letter for this project." }, { status: 404 });

    const run = await runReactAgent<AgentFinalAnswer>({
      goal: `Find published contract clauses and prior SAMCO correspondence relevant to consultant letter "${reference}" (subject: ${valueOf(incoming, ["Subject", "subject", "Main Purpose"]) || "not stated"}), so a controlled rights-reservation response can quote real evidence. Try more than one keyword search before concluding nothing matches. Final answer shape: {"evidence_found": boolean, "clause_numbers": string[], "history_references": string[], "reasoning": string}.`,
      systemPrompt:
        "You are a controlled evidence-gathering agent for construction claims correspondence. You never draft or quote text yourself -- you only identify which published clause numbers and correspondence references are relevant. A human-owned template assembles the actual letter afterward from the exact records you cite. Never claim a clause or correspondence reference exists unless a tool observation returned it.",
      tools,
      maxSteps: 6,
    });

    if (run.status !== "completed" || !run.finalAnswer) {
      return NextResponse.json({
        status: "agent_incomplete",
        selected_letter: incoming,
        message: run.message || "The agent could not reach a conclusion.",
        transcript: run.steps,
      });
    }

    const claimedClauseNumbers = stringArray(run.finalAnswer.clause_numbers);
    const claimedHistoryReferences = stringArray(run.finalAnswer.history_references);

    // Never trust the agent's own text: re-resolve every citation against the
    // real records. A clause number the agent invented simply finds nothing.
    const contractEvidence = claimedClauseNumbers
      .map((clauseNumber) => clauseByNumber(sourceClauses, clauseNumber))
      .filter((clause): clause is JsonRecord => Boolean(clause))
      .map(toContractEvidence);

    const historySheetsFlat = sheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows);
    const priorCorrespondence = claimedHistoryReferences
      .map((ref) => historySheetsFlat.find((row) => valueOf(row, ["Ref No", "Reference"]) === ref))
      .filter((row): row is JsonRecord => Boolean(row))
      .map(toPriorCorrespondence);

    if (!contractEvidence.length) {
      return NextResponse.json({
        status: "evidence_required",
        selected_letter: incoming,
        prior_correspondence: priorCorrespondence,
        contract_evidence: [],
        agent_reasoning: run.finalAnswer.reasoning || null,
        transcript: run.steps,
        notice: "The agent did not identify a published clause it could verify. No response draft is produced because the controlled engine must quote a real project contract clause rather than invent one.",
      });
    }

    const draft = assembleControlledDraft(reference, incoming, contractEvidence, priorCorrespondence);
    return NextResponse.json({
      status: "controlled_draft",
      selected_letter: incoming,
      prior_correspondence: priorCorrespondence,
      contract_evidence: contractEvidence,
      draft,
      agent_reasoning: run.finalAnswer.reasoning || null,
      transcript: run.steps,
      notice: "This source-backed controlled draft is not sent by the application. An agent selected which published evidence to cite; the quoted text itself comes only from verified project records. An authorised SAMCO reviewer must approve it before issue.",
    });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "The agent-assisted response draft could not be produced." }, { status: 500 });
  }
}
