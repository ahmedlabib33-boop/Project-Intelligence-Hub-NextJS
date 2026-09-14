/**
 * Evidence intelligence — turns what was read from every uploaded document
 * into project master data, requirements, milestones and parties.
 *
 * Each item keeps the document, location and exact quote it came from.
 * Different values for the same field across documents surface as conflicts
 * for the user to decide; required project data that no document states is
 * listed as missing — never filled in.
 */

export type DocKind = "pdf" | "word" | "excel" | "powerpoint" | "xer" | "json" | "text" | "image" | "legacy-office" | "archive" | "unknown";

export type EvidenceChunk = { id: string; docId: string; docName: string; location: string; text: string };

export type ItemKind = "fact" | "requirement" | "milestone" | "party";

export type ExtractedItem = {
  id: string;
  kind: ItemKind;
  /** Fact category, requirement type, "milestone" or party role. */
  category: string;
  /** Fact field; for requirements, milestones and parties a normalised key. */
  field: string;
  value: string;
  /** Milestone date. */
  date?: string;
  quote: string;
  confidence: number;
  /** The quote was found in the source text. */
  verified: boolean;
  docId: string;
  docName: string;
  location: string;
  source: "ai" | "parser";
  model: string;
};

export type EvidenceDoc = {
  id: string;
  name: string;
  size: number;
  kind: DocKind;
  status: "read" | "partial" | "not-read";
  /** What was read, or why it was not. */
  reason: string;
  /** Pages, sheets, slides or sections read. */
  units: number;
  chars: number;
  chunks: EvidenceChunk[];
  /** Facts read deterministically (XER). */
  parserItems: ExtractedItem[];
};

export type Review = { status: "confirmed" | "rejected" | "edited"; value?: string; at: string };
export type ReviewMap = Record<string, Review>;

export type Candidate = { value: string; items: ExtractedItem[]; score: number };

export type MasterRow = {
  field: string;
  label: string;
  category: string;
  required: boolean;
  value: string;
  /** "multiple": a field that is not main project data carries several values (for example rows of a table). */
  status: "confirmed" | "edited" | "extracted" | "conflict" | "missing" | "multiple";
  candidates: Candidate[];
};

export type GroupedItem = {
  key: string;
  kind: ItemKind;
  category: string;
  text: string;
  date?: string;
  status: "confirmed" | "edited" | "extracted" | "rejected";
  items: ExtractedItem[];
};

/** Main project data a planner expects the evidence to state. */
export const REQUIRED_FIELDS: { field: string; label: string; category: string; aliases: string[] }[] = [
  { field: "project_name", label: "Project name", category: "identity", aliases: ["project", "project_title", "name_of_project", "works_name"] },
  { field: "project_code", label: "Project / contract no.", category: "identity", aliases: ["contract_number", "contract_no", "tender_number", "reference_number"] },
  { field: "employer", label: "Employer / client", category: "parties", aliases: ["client", "owner", "employer_name"] },
  { field: "contractor", label: "Contractor", category: "parties", aliases: ["main_contractor", "contractor_name"] },
  { field: "consultant", label: "Engineer / consultant", category: "parties", aliases: ["engineer", "supervision_consultant", "project_manager"] },
  { field: "contract_type", label: "Contract form", category: "contract", aliases: ["form_of_contract", "contract_form", "conditions_of_contract"] },
  { field: "contract_value", label: "Contract value", category: "commercial", aliases: ["contract_price", "contract_sum", "tender_price", "accepted_contract_amount"] },
  { field: "currency", label: "Currency", category: "commercial", aliases: [] },
  { field: "commencement_date", label: "Commencement date", category: "dates", aliases: ["start_date", "notice_to_proceed", "ntp_date", "site_possession_date"] },
  { field: "completion_date", label: "Completion date", category: "dates", aliases: ["time_for_completion", "contract_completion_date", "finish_date", "end_date"] },
  { field: "contract_duration", label: "Contract duration", category: "duration", aliases: ["duration", "project_duration", "time_for_completion_days"] },
  { field: "site_location", label: "Site / location", category: "location", aliases: ["location", "project_location", "site"] },
  { field: "scope_summary", label: "Scope of works", category: "scope", aliases: ["scope", "scope_of_work", "scope_of_works", "description_of_works"] },
  { field: "delay_damages", label: "Delay damages", category: "commercial", aliases: ["liquidated_damages", "delay_penalty", "penalty"] },
  { field: "advance_payment", label: "Advance payment", category: "commercial", aliases: ["down_payment"] },
  { field: "retention", label: "Retention", category: "commercial", aliases: ["retention_money", "retention_percentage"] },
  { field: "performance_bond", label: "Performance security", category: "commercial", aliases: ["performance_guarantee", "performance_security"] },
  { field: "payment_terms", label: "Payment terms", category: "commercial", aliases: ["payment", "interim_payments"] },
  { field: "defects_liability_period", label: "Defects liability period", category: "contract", aliases: ["defects_notification_period", "maintenance_period", "dlp"] },
  { field: "working_calendar", label: "Working days / hours", category: "schedule", aliases: ["working_hours", "working_days", "working_week"] },
];

const ALIAS: Record<string, string> = Object.fromEntries(
  REQUIRED_FIELDS.flatMap((f) => [[f.field, f.field], ...f.aliases.map((a) => [a, f.field])]),
);

export function normalizeField(field: string): string {
  const key = field.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return ALIAS[key] || key;
}

export function labelFor(field: string): string {
  const known = REQUIRED_FIELDS.find((f) => f.field === field);
  if (known) return known.label;
  const words = field.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Case, spacing, punctuation, Arabic letter variants, diacritics and tatweel. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[“”«»"'`]/g, "")
    .replace(/[.,;:()\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const itemScore = (i: ExtractedItem) => (i.verified ? 1 : 0.2) * (i.source === "parser" ? 1.2 : 1) * (0.5 + i.confidence / 2);

/** Master data: one row per field, with every value the documents give and where. */
export function buildMasterData(items: ExtractedItem[], reviews: ReviewMap, includeUnverified = false): MasterRow[] {
  const facts = items.filter((i) => i.kind === "fact" && (includeUnverified || i.verified));
  const byField = new Map<string, ExtractedItem[]>();
  for (const f of facts) {
    const key = normalizeField(f.field);
    const bucket = byField.get(key);
    if (bucket) bucket.push(f);
    else byField.set(key, [f]);
  }
  const fields = new Set<string>([...REQUIRED_FIELDS.map((f) => f.field), ...byField.keys()]);
  const rows: MasterRow[] = [];
  for (const field of fields) {
    const found = byField.get(field) || [];
    const groups = new Map<string, Candidate>();
    for (const item of found) {
      const key = normalizeText(item.value);
      const g = groups.get(key);
      if (g) {
        g.items.push(item);
        g.score += itemScore(item);
      } else {
        groups.set(key, { value: item.value, items: [item], score: itemScore(item) });
      }
    }
    const candidates = Array.from(groups.values()).sort((a, b) => b.score - a.score);
    const required = REQUIRED_FIELDS.find((f) => f.field === field);
    const review = reviews[`field:${field}`];
    let status: MasterRow["status"];
    let value = "";
    if (review && review.status === "rejected") {
      // A value the planner rejected is treated as not stated, while its candidates stay visible.
      status = "missing";
    } else if (review && review.value) {
      status = review.status === "edited" ? "edited" : "confirmed";
      value = review.value;
    } else if (!candidates.length) {
      status = "missing";
    } else if (candidates.filter((c) => c.items.some((i) => i.verified)).length > 1) {
      // Only main project data can conflict; elsewhere several values are simply several values.
      status = REQUIRED_FIELDS.some((f) => f.field === field) ? "conflict" : "multiple";
      value = candidates[0].value;
    } else {
      status = "extracted";
      value = candidates[0].value;
    }
    rows.push({
      field, label: labelFor(field), category: required?.category || found[0]?.category || "other",
      required: !!required, value, status, candidates,
    });
  }
  const order = (r: MasterRow) => {
    const index = REQUIRED_FIELDS.findIndex((f) => f.field === r.field);
    return index >= 0 ? index : 1000;
  };
  return rows.sort((a, b) => order(a) - order(b) || a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

/** Requirements, milestones or parties, merged across documents by normalised text. */
export function groupItems(items: ExtractedItem[], kind: ItemKind, reviews: ReviewMap, includeUnverified = false): GroupedItem[] {
  const groups = new Map<string, GroupedItem>();
  for (const item of items) {
    if (item.kind !== kind || (!includeUnverified && !item.verified)) continue;
    const key = `${kind}:${normalizeText(kind === "milestone" ? `${item.value} ${item.date || ""}` : kind === "party" ? `${item.category} ${item.value}` : item.value)}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, kind, category: item.category, text: item.value, date: item.date, status: "extracted", items: [item] });
  }
  return Array.from(groups.values()).map((g) => {
    const review = reviews[g.key];
    if (!review) return g;
    return { ...g, status: review.status, text: review.status === "edited" && review.value ? review.value : g.text };
  }).sort((a, b) => a.category.localeCompare(b.category) || b.items.length - a.items.length);
}

/* --------------------------------------------------------- retrieval */

function terms(text: string): string[] {
  return normalizeText(text).split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length > 2);
}

/** Excerpts most related to a question, by term overlap weighted by rarity. */
export function retrieve(chunks: EvidenceChunk[], question: string, max = 8, budgetChars = 36_000): EvidenceChunk[] {
  const q = Array.from(new Set(terms(question)));
  if (!q.length) return [];
  const df = new Map<string, number>();
  const tokenized = chunks.map((c) => {
    const set = new Set(terms(c.text));
    for (const w of q) if (set.has(w)) df.set(w, (df.get(w) || 0) + 1);
    return set;
  });
  const n = Math.max(1, chunks.length);
  const scored = chunks
    .map((c, i) => ({
      c,
      score: q.reduce((s, w) => s + (tokenized[i].has(w) ? Math.log(1 + n / (df.get(w) || 1)) : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: EvidenceChunk[] = [];
  let used = 0;
  for (const { c } of scored) {
    if (out.length >= max || used + c.text.length > budgetChars) break;
    out.push(c);
    used += c.text.length;
  }
  return out;
}
