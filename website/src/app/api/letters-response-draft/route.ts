import { NextRequest, NextResponse } from "next/server";
import { getProjectData } from "../../../lib/ai/project-context";
import { checkRateLimit } from "../../../lib/ai/rate-limit";
import { sanitizeText } from "../../../lib/ai/provider";
import { aiRequestFailure, readAiJson } from "../../../lib/ai/request";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function valueOf(row: JsonRecord, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function unique(values: string[], limit = 12) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function meaningfulWords(value: string) {
  const ignored = new Set(["about", "after", "before", "from", "have", "into", "letter", "that", "this", "with", "your", "were", "shall", "will", "been", "under", "subject", "response", "notice", "samco", "contractor", "consultant"]);
  return unique((value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((word) => !ignored.has(word)), 30);
}

function correspondence(project: JsonRecord) {
  const features = record(project.features);
  const letters = record(features.letters_intelligence);
  const workbook = record(letters.workbook_tables);
  const sheets = rows(workbook.sheets);
  return sheets.map((sheet) => ({ name: String(sheet.name || ""), rows: rows(sheet.rows) }));
}

function clauses(project: JsonRecord) {
  const features = record(project.features);
  const claims = record(features.contract_claims);
  const knowledge = record(claims.knowledge_base);
  const tables = record(knowledge.tables);
  return rows(record(tables.contract_clauses).rows);
}

function relevantClauses(selected: JsonRecord, sourceClauses: JsonRecord[]) {
  const selectedText = ["Subject", "Main Purpose", "Key Requests", "Required Actions", "Risk Type", "Affected Activities"]
    .map((field) => valueOf(selected, [field]))
    .join(" ");
  const keywords = meaningfulWords(selectedText);
  return sourceClauses
    .map((clause) => {
      const text = ["clause_number", "clause_title", "exact_clause_text", "plain_english_meaning", "claim_type", "required_evidence", "notice_required"]
        .map((field) => valueOf(clause, [field]))
        .join(" ")
        .toLowerCase();
      const score = keywords.filter((word) => text.includes(word)).length;
      return { clause, score };
    })
    .filter((item) => item.score > 0 && valueOf(item.clause, ["exact_clause_text"]))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.clause);
}

function relatedHistory(selected: JsonRecord, allSheets: Array<{ name: string; rows: JsonRecord[] }>) {
  const selectedReference = valueOf(selected, ["Ref No", "Reference", "reference"]);
  const selectedWords = meaningfulWords(["Subject", "Main Purpose", "Risk Type", "Affected Activities"].map((field) => valueOf(selected, [field])).join(" "));
  const outbound = allSheets
    .filter((sheet) => /from (contractor|samco)/i.test(sheet.name))
    .flatMap((sheet) => sheet.rows);
  const scored = outbound
    .map((row) => {
      const text = ["Subject", "Main Purpose", "Risk Type", "Affected Activities", "Required Actions", "Related ACE Ref No(s)"].map((field) => valueOf(row, [field])).join(" ").toLowerCase();
      const referenceMention = selectedReference && text.includes(selectedReference.toLowerCase()) ? 8 : 0;
      const sharedWords = selectedWords.filter((word) => text.includes(word)).length;
      return { row, score: referenceMention + sharedWords };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const seen = new Set<string>();
  return scored
    .filter((item) => {
      const reference = valueOf(item.row, ["Ref No", "Reference"]);
      const key = reference || `${valueOf(item.row, ["Date", "date"])}|${valueOf(item.row, ["Subject", "subject", "Main Purpose"])}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((item) => item.row);
}

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

    const letterSheets = correspondence(project);
    const incoming = letterSheets
      .filter((sheet) => /from (consultant|ace)/i.test(sheet.name))
      .flatMap((sheet) => sheet.rows)
      .find((row) => valueOf(row, ["Ref No", "Reference", "reference"]) === reference);
    if (!incoming) return NextResponse.json({ error: "The selected reference is not a published consultant letter for this project." }, { status: 404 });

    const matchedClauses = relevantClauses(incoming, clauses(project));
    const history = relatedHistory(incoming, letterSheets);
    const contractEvidence = matchedClauses.map((clause) => ({
      clause_number: valueOf(clause, ["clause_number", "Clause No", "Location"]),
      clause_title: valueOf(clause, ["clause_title", "Clause / Topic", "title"]),
      exact_clause_text: valueOf(clause, ["exact_clause_text", "Clause Text"]),
      required_evidence: valueOf(clause, ["required_evidence", "Practical Action / Evidence"]),
      notice_required: valueOf(clause, ["notice_required", "Notice / Time Bar"])
    }));
    const priorCorrespondence = history.map((row) => ({
      reference: valueOf(row, ["Ref No", "Reference"]),
      date: valueOf(row, ["Date", "date"]),
      subject: valueOf(row, ["Subject", "subject", "Main Purpose"]),
      required_action: valueOf(row, ["Required Actions", "Required Action"])
    }));
    if (!contractEvidence.length) {
      return NextResponse.json({
        status: "evidence_required",
        selected_letter: incoming,
        prior_correspondence: priorCorrespondence,
        contract_evidence: [],
        notice: "No matching published clause text was found for this letter. No response draft is produced because the controlled engine must quote a project contract clause rather than invent one. Review the Contract & Claims Intelligence Center and add or correct clause evidence first."
      });
    }

    const selectedDate = valueOf(incoming, ["Date", "date"]);
    const selectedSubject = valueOf(incoming, ["Subject", "subject", "Main Purpose"]);
    const clauseParagraphs = contractEvidence.map((clause) => {
      const label = [clause.clause_number, clause.clause_title].filter(Boolean).join(" — ") || "Published contract clause";
      return `Contract evidence — ${label}: “${clause.exact_clause_text}”`;
    });
    const historyParagraph = priorCorrespondence.length
      ? `The controlled correspondence register was screened for potentially related SAMCO communications before this draft. The relevant references are ${priorCorrespondence.map((item) => item.reference || item.subject).filter(Boolean).join(", ")}. This draft does not alter, withdraw, or contradict those records.`
      : "The controlled SAMCO correspondence register was screened. No related published outgoing reference was identified automatically; authorised review is required before issue.";
    const draft = [
      `Subject: Response to ${reference}${selectedSubject ? ` — ${selectedSubject}` : ""}`,
      "Dear Sirs,",
      `We acknowledge receipt of your correspondence ${reference}${selectedDate ? ` dated ${selectedDate}` : ""}${selectedSubject ? ` concerning ${selectedSubject}` : ""}. This response is issued without prejudice to SAMCO's rights, remedies, notices, claims, defences, and entitlements under the Contract and at law. Nothing in this draft is an admission of liability, delay, responsibility, waiver, or agreement to any instruction, valuation, time consequence, or cost consequence unless expressly confirmed by an authorised SAMCO signatory.`,
      "SAMCO is reviewing the matters raised against the contemporaneous project records, the approved programme, and the Contract. SAMCO reserves all rights arising from any Employer, Engineer, Consultant, interface, information, instruction, approval, payment, access, variation, or other event that may affect the Works.",
      historyParagraph,
      ...clauseParagraphs,
      "Accordingly, please provide or confirm any outstanding instruction, factual basis, programme basis, required deliverable, and contractual basis relied upon. SAMCO will respond substantively after the required record and contract review. SAMCO expressly reserves its right to submit further notice, particulars, programme analysis, and claim documentation within the applicable contractual time limits.",
      "Yours faithfully,\nFor SAMCO National Construction Company\n\nControlled draft only — not issued; authorised commercial and legal review is required before signature or transmission."
    ].join("\n\n");
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
