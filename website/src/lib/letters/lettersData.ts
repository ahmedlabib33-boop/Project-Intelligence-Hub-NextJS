/** Shared, deterministic data access over one project's published letters
 * register and contract clause knowledge base. Used by both the controlled
 * (non-AI) response draft route and the Schema 2 agent-based one, so the two
 * never drift into different ideas of what a "match" is. */

export type JsonRecord = Record<string, unknown>;

export function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function valueOf(row: JsonRecord, names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function unique(values: string[], limit = 12): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

export function meaningfulWords(value: string): string[] {
  const ignored = new Set(["about", "after", "before", "from", "have", "into", "letter", "that", "this", "with", "your", "were", "shall", "will", "been", "under", "subject", "response", "notice", "samco", "contractor", "consultant"]);
  return unique((value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((word) => !ignored.has(word)), 30);
}

export type CorrespondenceSheet = { name: string; rows: JsonRecord[] };

export function correspondence(project: JsonRecord): CorrespondenceSheet[] {
  const features = record(project.features);
  const letters = record(features.letters_intelligence);
  const workbook = record(letters.workbook_tables);
  const sheets = rows(workbook.sheets);
  return sheets.map((sheet) => ({ name: String(sheet.name || ""), rows: rows(sheet.rows) }));
}

export function clauses(project: JsonRecord): JsonRecord[] {
  const features = record(project.features);
  const claims = record(features.contract_claims);
  const knowledge = record(claims.knowledge_base);
  const tables = record(knowledge.tables);
  return rows(record(tables.contract_clauses).rows);
}

const CLAUSE_TEXT_FIELDS = ["clause_number", "clause_title", "exact_clause_text", "plain_english_meaning", "claim_type", "required_evidence", "notice_required"];

/** Score every clause against a keyword list; the caller decides the cutoff. */
export function scoreClausesByKeywords(sourceClauses: JsonRecord[], keywords: string[]): Array<{ clause: JsonRecord; score: number }> {
  return sourceClauses
    .map((clause) => {
      const text = CLAUSE_TEXT_FIELDS.map((field) => valueOf(clause, [field])).join(" ").toLowerCase();
      const score = keywords.filter((word) => text.includes(word.toLowerCase())).length;
      return { clause, score };
    })
    .filter((item) => item.score > 0 && valueOf(item.clause, ["exact_clause_text"]));
}

export function relevantClauses(selected: JsonRecord, sourceClauses: JsonRecord[]): JsonRecord[] {
  const selectedText = ["Subject", "Main Purpose", "Key Requests", "Required Actions", "Risk Type", "Affected Activities"]
    .map((field) => valueOf(selected, [field]))
    .join(" ");
  const keywords = meaningfulWords(selectedText);
  return scoreClausesByKeywords(sourceClauses, keywords)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.clause);
}

const HISTORY_TEXT_FIELDS = ["Subject", "Main Purpose", "Risk Type", "Affected Activities", "Required Actions", "Related ACE Ref No(s)"];

export function scoreHistoryByKeywords(outbound: JsonRecord[], keywords: string[], reference?: string): Array<{ row: JsonRecord; score: number }> {
  return outbound
    .map((row) => {
      const text = HISTORY_TEXT_FIELDS.map((field) => valueOf(row, [field])).join(" ").toLowerCase();
      const referenceMention = reference && text.includes(reference.toLowerCase()) ? 8 : 0;
      const sharedWords = keywords.filter((word) => text.includes(word.toLowerCase())).length;
      return { row, score: referenceMention + sharedWords };
    })
    .filter((item) => item.score > 0);
}

function dedupeHistoryRows(scored: Array<{ row: JsonRecord; score: number }>): JsonRecord[] {
  const seen = new Set<string>();
  return scored
    .sort((left, right) => right.score - left.score)
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

export function relatedHistory(selected: JsonRecord, allSheets: CorrespondenceSheet[]): JsonRecord[] {
  const selectedReference = valueOf(selected, ["Ref No", "Reference", "reference"]);
  const selectedWords = meaningfulWords(["Subject", "Main Purpose", "Risk Type", "Affected Activities"].map((field) => valueOf(selected, [field])).join(" "));
  const outbound = allSheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows);
  return dedupeHistoryRows(scoreHistoryByKeywords(outbound, selectedWords, selectedReference));
}

export function searchCorrespondenceHistory(allSheets: CorrespondenceSheet[], keywords: string[], reference?: string): JsonRecord[] {
  const outbound = allSheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows);
  return dedupeHistoryRows(scoreHistoryByKeywords(outbound, keywords, reference));
}

export function incomingLetters(allSheets: CorrespondenceSheet[]): JsonRecord[] {
  return allSheets.filter((sheet) => /from (consultant|ace)/i.test(sheet.name)).flatMap((sheet) => sheet.rows);
}

export function findIncomingLetter(allSheets: CorrespondenceSheet[], reference: string): JsonRecord | undefined {
  return incomingLetters(allSheets).find((row) => valueOf(row, ["Ref No", "Reference", "reference"]) === reference);
}

export function clauseByNumber(sourceClauses: JsonRecord[], clauseNumber: string): JsonRecord | undefined {
  return sourceClauses.find((clause) => valueOf(clause, ["clause_number", "Clause No", "Location"]) === clauseNumber);
}

export type ContractEvidenceItem = {
  clause_number: string;
  clause_title: string;
  exact_clause_text: string;
  required_evidence: string;
  notice_required: string;
};

export function toContractEvidence(clause: JsonRecord): ContractEvidenceItem {
  return {
    clause_number: valueOf(clause, ["clause_number", "Clause No", "Location"]),
    clause_title: valueOf(clause, ["clause_title", "Clause / Topic", "title"]),
    exact_clause_text: valueOf(clause, ["exact_clause_text", "Clause Text"]),
    required_evidence: valueOf(clause, ["required_evidence", "Practical Action / Evidence"]),
    notice_required: valueOf(clause, ["notice_required", "Notice / Time Bar"]),
  };
}

export type PriorCorrespondenceItem = {
  reference: string;
  date: string;
  subject: string;
  required_action: string;
};

export function toPriorCorrespondence(row: JsonRecord): PriorCorrespondenceItem {
  return {
    reference: valueOf(row, ["Ref No", "Reference"]),
    date: valueOf(row, ["Date", "date"]),
    subject: valueOf(row, ["Subject", "subject", "Main Purpose"]),
    required_action: valueOf(row, ["Required Actions", "Required Action"]),
  };
}

/** The one, single-source-of-truth controlled rights-reservation draft
 * template. Both the deterministic route and the Schema 2 agent route
 * produce this exact text from real, already-verified clause/history
 * records -- never from anything a language model writes. */
export function assembleControlledDraft(
  reference: string,
  incoming: JsonRecord,
  contractEvidence: ContractEvidenceItem[],
  priorCorrespondence: PriorCorrespondenceItem[]
): string {
  const selectedDate = valueOf(incoming, ["Date", "date"]);
  const selectedSubject = valueOf(incoming, ["Subject", "subject", "Main Purpose"]);
  const clauseParagraphs = contractEvidence.map((clause) => {
    const label = [clause.clause_number, clause.clause_title].filter(Boolean).join(" — ") || "Published contract clause";
    return `Contract evidence — ${label}: “${clause.exact_clause_text}”`;
  });
  const historyParagraph = priorCorrespondence.length
    ? `The controlled correspondence register was screened for potentially related SAMCO communications before this draft. The relevant references are ${priorCorrespondence.map((item) => item.reference || item.subject).filter(Boolean).join(", ")}. This draft does not alter, withdraw, or contradict those records.`
    : "The controlled SAMCO correspondence register was screened. No related published outgoing reference was identified automatically; authorised review is required before issue.";
  return [
    `Subject: Response to ${reference}${selectedSubject ? ` — ${selectedSubject}` : ""}`,
    "Dear Sirs,",
    `We acknowledge receipt of your correspondence ${reference}${selectedDate ? ` dated ${selectedDate}` : ""}${selectedSubject ? ` concerning ${selectedSubject}` : ""}. This response is issued without prejudice to SAMCO's rights, remedies, notices, claims, defences, and entitlements under the Contract and at law. Nothing in this draft is an admission of liability, delay, responsibility, waiver, or agreement to any instruction, valuation, time consequence, or cost consequence unless expressly confirmed by an authorised SAMCO signatory.`,
    "SAMCO is reviewing the matters raised against the contemporaneous project records, the approved programme, and the Contract. SAMCO reserves all rights arising from any Employer, Engineer, Consultant, interface, information, instruction, approval, payment, access, variation, or other event that may affect the Works.",
    historyParagraph,
    ...clauseParagraphs,
    "Accordingly, please provide or confirm any outstanding instruction, factual basis, programme basis, required deliverable, and contractual basis relied upon. SAMCO will respond substantively after the required record and contract review. SAMCO expressly reserves its right to submit further notice, particulars, programme analysis, and claim documentation within the applicable contractual time limits.",
    "Yours faithfully,\nFor SAMCO National Construction Company\n\nControlled draft only — not issued; authorised commercial and legal review is required before signature or transmission.",
  ].join("\n\n");
}
