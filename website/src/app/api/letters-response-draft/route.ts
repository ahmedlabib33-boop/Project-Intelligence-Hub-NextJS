import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";
import { assembleControlledDraft, clauses, correspondence, findIncomingLetter, relatedHistory, relevantClauses, toContractEvidence, toPriorCorrespondence, type JsonRecord } from "../../../lib/letters/lettersData";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`letters-response:${req.headers.get("x-forwarded-for") || "local"}`, 8);
  if (!limit.allowed) return NextResponse.json({ error: "Too many draft requests." }, { status: 429 });
  try {
    const body = await readAiJson(req);
    const projectKey = sanitizeText(body?.projectKey || body?.projectId, 120);
    const reference = sanitizeText(body?.reference, 180);
    if (!projectKey || !reference) return NextResponse.json({ error: "projectKey and consultant letter reference are required." }, { status: 400 });
    const project = await getProjectData(projectKey);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

    const letterSheets = correspondence(project as JsonRecord);
    const incoming = findIncomingLetter(letterSheets, reference);
    if (!incoming) return NextResponse.json({ error: "The selected reference is not a published consultant letter for this project." }, { status: 404 });

    const matchedClauses = relevantClauses(incoming, clauses(project as JsonRecord));
    const history = relatedHistory(incoming, letterSheets);
    const contractEvidence = matchedClauses.map(toContractEvidence);
    const priorCorrespondence = history.map(toPriorCorrespondence);
    if (!contractEvidence.length) {
      return NextResponse.json({
        status: "evidence_required",
        selected_letter: incoming,
        prior_correspondence: priorCorrespondence,
        contract_evidence: [],
        notice: "No matching published clause text was found for this letter. No response draft is produced because the controlled engine must quote a project contract clause rather than invent one. Review the Contract & Claims Intelligence Center and add or correct clause evidence first."
      });
    }

    const draft = assembleControlledDraft(reference, incoming, contractEvidence, priorCorrespondence);
    return NextResponse.json({
      status: "controlled_draft",
      selected_letter: incoming,
      prior_correspondence: priorCorrespondence,
      contract_evidence: contractEvidence,
      draft,
      notice: "This source-backed controlled draft is not sent by the application. It preserves rights and quotes only clause text published for the selected project; an authorised SAMCO reviewer must approve it before issue."
    });
  } catch (error) {
    const failure = aiRequestFailure(error);
    if (failure) return NextResponse.json({ error: failure.error }, { status: failure.status });
    return NextResponse.json({ error: "The controlled response draft could not be produced." }, { status: 500 });
  }
}
