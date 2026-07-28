import { promises as fs } from "fs";
import path from "path";

export type KnowledgeRecord = {
  id: string;
  department: string;
  section: string;
  level: string;
  question: string;
  keywords: string[];
  source_file: string;
  score?: number;
};

const STOPWORDS = new Set([
  "the", "and", "or", "to", "of", "in", "on", "for", "with", "is", "are", "a", "an",
  "what", "which", "how", "do", "does", "i", "we", "it", "this", "that", "be", "by",
  "from", "into", "as", "at", "can", "should", "must", "user", "project"
]);

const SYNONYMS: Record<string, string[]> = {
  delay: ["late", "delayed", "behind", "impact", "time", "schedule", "critical", "path", "eot"],
  claim: ["claims", "entitlement", "notice", "contract", "dispute", "eot", "commercial"],
  mep: ["mechanical", "electrical", "plumbing", "sleeves", "openings", "embedded", "coordination"],
  steel: ["reinforcement", "rebar", "bars", "diameter", "delivery", "supply"],
  letter: ["letters", "correspondence", "rfi", "reply", "response", "notice"],
  risk: ["hazard", "exposure", "issue", "mitigation", "escalation", "audit"],
  quality: ["qa", "qc", "inspection", "ncr", "defect", "test", "acceptance"],
  procurement: ["material", "supplier", "submittal", "purchase", "delivery", "lead"]
};

function tokenize(text: string) {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const expanded = new Set<string>();
  for (const token of tokens) {
    if (STOPWORDS.has(token) || token.length < 2) continue;
    expanded.add(token);
    for (const [key, values] of Object.entries(SYNONYMS)) {
      if (token === key || values.includes(token)) {
        expanded.add(key);
        values.forEach((value) => expanded.add(value));
      }
    }
  }
  return expanded;
}

export async function loadQuestionBank() {
  const filePath = path.join(process.cwd(), "public", "data", "technical_question_bank.json");
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as {
    generated_at: string;
    source_file: string;
    record_count: number;
    departments: string[];
    records: KnowledgeRecord[];
  };
}

export function searchQuestionBank(
  records: KnowledgeRecord[],
  question: string,
  options?: { department?: string; limit?: number }
) {
  const queryTokens = tokenize(question);
  const departmentFilter = options?.department?.trim().toLowerCase();
  const scored = records
    .filter((record) => !departmentFilter || record.department.toLowerCase().includes(departmentFilter))
    .map((record) => {
      const recordTokens = new Set(record.keywords);
      let overlap = 0;
      queryTokens.forEach((token) => {
        if (recordTokens.has(token)) overlap += 1;
      });
      const departmentBonus = Array.from(queryTokens).some((token) => record.department.toLowerCase().includes(token)) ? 1 : 0;
      const sectionBonus = Array.from(queryTokens).some((token) => record.section.toLowerCase().includes(token)) ? 1 : 0;
      return { ...record, score: (overlap * 3) + departmentBonus + sectionBonus };
    })
    .filter((record) => (record.score || 0) > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  return scored.slice(0, options?.limit || 8);
}

export function localTechnicalAnswer(args: {
  question: string;
  matched: KnowledgeRecord[];
  sourceScope: string;
}) {
  const departments = Array.from(new Set(args.matched.map((item) => item.department))).slice(0, 6);
  const lead = args.matched[0]?.question;
  return {
    answer: lead
      ? `The closest technical guidance is: ${lead}. Use this as ${args.sourceScope} guidance and confirm the facts from project evidence before acting.`
      : "No close technical-bank question was found. Treat this as a new issue and collect source evidence before decision-making.",
    matchedQuestions: args.matched,
    departments,
    evidenceRequired: [
      "Latest approved drawings, submittals, RFIs, inspections, logs, schedules, and source registers relevant to the issue.",
      "Owner, deadline, impact, decision required, and closure evidence."
    ],
    owners: departments.slice(0, 4),
    impactAreas: ["time", "cost", "quality", "HSE", "contract", "handover"],
    recommendedActions: [
      "Confirm the affected workfront, activity, or system.",
      "Collect source evidence before making a management or claim decision.",
      "Escalate unresolved blockers with owner and deadline."
    ],
    followUpQuestions: [
      "Which activity, workfront, or system is affected?",
      "What source evidence confirms the issue?",
      "Who owns the next decision and by when?"
    ],
    sourceScope: args.sourceScope,
    provider: "local",
    model: "technical-question-bank",
    status: "fallback"
  };
}
