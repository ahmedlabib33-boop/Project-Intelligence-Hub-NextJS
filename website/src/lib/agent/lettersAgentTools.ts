import type { AgentTool } from "./reactLoop";
import {
  clauseByNumber,
  clauses,
  correspondence,
  findIncomingLetter,
  incomingLetters,
  scoreClausesByKeywords,
  scoreHistoryByKeywords,
  valueOf,
  type CorrespondenceSheet,
  type JsonRecord,
} from "../letters/lettersData";

function compactLetter(row: JsonRecord) {
  return {
    reference: valueOf(row, ["Ref No", "Reference", "reference"]),
    date: valueOf(row, ["Date", "date"]),
    subject: valueOf(row, ["Subject", "subject", "Main Purpose"]),
  };
}

function compactClause(clause: JsonRecord, score?: number) {
  return {
    clause_number: valueOf(clause, ["clause_number", "Clause No", "Location"]),
    clause_title: valueOf(clause, ["clause_title", "Clause / Topic", "title"]),
    exact_clause_text: valueOf(clause, ["exact_clause_text", "Clause Text"]),
    required_evidence: valueOf(clause, ["required_evidence", "Practical Action / Evidence"]),
    notice_required: valueOf(clause, ["notice_required", "Notice / Time Bar"]),
    ...(score !== undefined ? { match_score: score } : {}),
  };
}

function compactHistoryRow(row: JsonRecord, score?: number) {
  return {
    reference: valueOf(row, ["Ref No", "Reference"]),
    date: valueOf(row, ["Date", "date"]),
    subject: valueOf(row, ["Subject", "subject", "Main Purpose"]),
    required_action: valueOf(row, ["Required Actions", "Required Action"]),
    ...(score !== undefined ? { match_score: score } : {}),
  };
}

function keywordArgs(args: Record<string, unknown>): string[] {
  const raw = args.keywords;
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20);
}

/** Builds the Tool Sandbox for one project's letters register + clause
 * knowledge base. Every tool is read-only over data already published for
 * this project -- nothing here writes, fetches externally, or executes
 * arbitrary code. */
export function buildLettersAgentTools(project: JsonRecord): { tools: AgentTool[]; sheets: CorrespondenceSheet[]; sourceClauses: JsonRecord[] } {
  const sheets = correspondence(project);
  const sourceClauses = clauses(project);

  const tools: AgentTool[] = [
    {
      name: "list_incoming_letters",
      description: "List published consultant/ACE letters for this project (reference, date, subject only).",
      argsHint: "{}",
      execute: () => incomingLetters(sheets).map(compactLetter).slice(0, 100),
    },
    {
      name: "get_letter",
      description: "Get the full published record for one incoming consultant/ACE letter by its reference.",
      argsHint: '{"reference": "<exact reference>"}',
      execute: (args) => {
        const reference = String(args.reference || "").trim();
        const found = reference ? findIncomingLetter(sheets, reference) : undefined;
        return found ?? { found: false, reference };
      },
    },
    {
      name: "search_contract_clauses",
      description: "Search the published contract clause knowledge base by keywords (try several word choices if the first search finds nothing).",
      argsHint: '{"keywords": ["word1", "word2"]}',
      execute: (args) => {
        const keywords = keywordArgs(args);
        if (!keywords.length) return { error: "keywords is required and must be a non-empty array of strings." };
        return scoreClausesByKeywords(sourceClauses, keywords)
          .sort((left, right) => right.score - left.score)
          .slice(0, 5)
          .map((item) => compactClause(item.clause, item.score));
      },
    },
    {
      name: "search_correspondence_history",
      description: "Search this project's outgoing (SAMCO/contractor) correspondence history by keywords, optionally scoped to a reference.",
      argsHint: '{"keywords": ["word1", "word2"], "reference": "<optional exact reference>"}',
      execute: (args) => {
        const keywords = keywordArgs(args);
        const reference = args.reference ? String(args.reference).trim() : undefined;
        if (!keywords.length) return { error: "keywords is required and must be a non-empty array of strings." };
        const outbound = sheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows);
        return scoreHistoryByKeywords(outbound, keywords, reference)
          .sort((left, right) => right.score - left.score)
          .slice(0, 8)
          .map((item) => compactHistoryRow(item.row, item.score));
      },
    },
    {
      name: "get_clause_text",
      description: "Look up the exact stored text of one contract clause by its clause number, to confirm a quote before using it.",
      argsHint: '{"clause_number": "<exact clause number>"}',
      execute: (args) => {
        const clauseNumber = String(args.clause_number || "").trim();
        const found = clauseNumber ? clauseByNumber(sourceClauses, clauseNumber) : undefined;
        return found ? compactClause(found) : { found: false, clause_number: clauseNumber };
      },
    },
  ];

  return { tools, sheets, sourceClauses };
}
