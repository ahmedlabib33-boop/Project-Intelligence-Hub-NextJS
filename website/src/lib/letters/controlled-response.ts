type Row = Record<string, unknown>;
export type LetterSheet = { name: string; rows: Row[] };

type Role = "record_history" | "actual_effect_mitigation" | "notice_purpose_status" | "contract_basis_challenge" | "continuing_position_entitlement" | "requested_action" | "reservation_rights";
const TITLES: Record<Role, string> = {
  record_history: "Clarification of the Existing Record and Correspondence History",
  actual_effect_mitigation: "Factual Position, Actual Effects and Mitigation",
  notice_purpose_status: "Purpose and Status of Previous Notices",
  contract_basis_challenge: "Contractual Basis and Published Clause Wording",
  continuing_position_entitlement: "Continuing Notice, Evidence, Time and Cost Position",
  requested_action: "Requested Engineer Action",
  reservation_rights: "Reservation of Rights",
};
const ROLE_SEEDS: Record<Role, string[]> = {
  record_history: ["complete correspondence history earlier request later revision chronology notices instructions", "record existed before latest letter and remained continuing"],
  actual_effect_mitigation: ["actual effect experienced mitigation continued performance resequencing effort", "disruption delay procurement delivery progress affected activities"],
  notice_purpose_status: ["continuing notice early warning future consequences claim notice", "prior correspondence preserves event before consequences crystallise"],
  contract_basis_challenge: ["identify contract clause provision deadline obligation contractual basis", "unsupported interpretation document priority approved procedure"],
  continuing_position_entitlement: ["extension time additional payment entitlement causation substantiation programme analysis", "time impact critical path float concurrency cost records"],
  requested_action: ["engineer requested reconsider confirm acknowledge determine instruct respond", "required action dates responsibility next steps"],
  reservation_rights: ["without prejudice reserve rights remedies claims defences entitlements", "nothing waiver admission liability responsibility"],
};
const TOPIC_SEEDS: Record<string, string[]> = {
  notice_claim: ["notice claim time bar sub clause 20.1 particulars"],
  time_eot: ["extension time delay critical path programme float completion"],
  payment_cost: ["additional payment cost prolongation finance valuation invoice"],
  variation_instruction: ["variation instruction change scope additional work"],
  design_information: ["drawing ifc rfi information approval design submittal"],
  materials_procurement: ["material steel reinforcement procurement delivery free issue supplier batch"],
  quality_ncr: ["ncr nonconformity quality inspection rejection remedial"],
  progress_mitigation: ["mitigation accelerate resequence recovery maintain progress"],
  programme_logic: ["schedule logic relationship lag baseline update time impact analysis"],
  general_contract: ["contract obligation entitlement engineer employer determination"],
};
const FIDIC_2017_REFERENCE_PRINCIPLES: Row[] = [
  {
    clause_number: "FIDIC 2017 Sub-Clause 1.3",
    clause_title: "Notices and Other Communications",
    exact_clause_text: "Reference principle: a contractual notice or communication should be in writing, identify its purpose, and follow the agreed transmission procedure.",
    required_evidence: "Original communication, stated purpose, issue date, addressee, and proof of transmission.",
    notice_required: "Confirm the signed Contract's notice form, address, method, and deemed-receipt rules.",
    source_scope: "Secondary FIDIC reference only; applicability and Particular Conditions must be confirmed against the signed Contract.",
  },
  {
    clause_number: "FIDIC 2017 Sub-Clause 3.7",
    clause_title: "Agreement or Determination",
    exact_clause_text: "Reference principle: the Engineer's agreement or determination process should consult both Parties, assess relevant circumstances, and provide reasons and supporting particulars.",
    required_evidence: "Parties' submissions, relevant records, consultation record, determination, reasons, and supporting particulars.",
    notice_required: "Confirm the governing edition, Particular Conditions, and any amended determination procedure.",
    source_scope: "Secondary FIDIC reference only; it is not proof of the governing project clause.",
  },
  {
    clause_number: "FIDIC 2017 Sub-Clauses 8.4 and 8.5",
    clause_title: "Advance Warning and Extension of Time",
    exact_clause_text: "Reference principle: probable adverse events should be warned about promptly, while any extension-of-time position must be tied to a qualifying cause, the contractual claim procedure, and demonstrated effect on completion.",
    required_evidence: "Warning chronology, programme updates, affected activities, calendars, logic, float, critical path, mitigation, and finish movement.",
    notice_required: "Confirm the signed Contract's qualifying causes, notice periods, programme requirements, and amendments.",
    source_scope: "Secondary FIDIC reference only; no entitlement or EOT is established by this reference.",
  },
  {
    clause_number: "FIDIC 2017 Sub-Clauses 20.2.1 to 20.2.4",
    clause_title: "Notice, Contemporary Records and Detailed Claim",
    exact_clause_text: "Reference principle: a claim should be notified within the applicable period, supported by contemporary records, and developed with the event, contractual basis, cause-and-effect particulars, and substantiation.",
    required_evidence: "Notice, initial response, contemporary records, detailed particulars, cause-and-effect analysis, and time/cost substantiation.",
    notice_required: "The reference edition uses staged notice and submission periods; verify every period and amendment in the signed Contract before reliance.",
    source_scope: "Secondary FIDIC reference only; it is not a certified quotation or confirmation of incorporation.",
  },
];
const STOP = new Set(["about", "after", "before", "been", "being", "contractor", "consultant", "from", "have", "into", "letter", "samco", "shall", "subject", "that", "their", "there", "these", "this", "under", "were", "will", "with", "your"]);

function val(row: Row, names: string[]): string { for (const name of names) { const value = row[name]; if (value !== undefined && value !== null && String(value).trim()) return String(value).trim(); } return ""; }
function clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function unique(values: string[], limit = 30): string[] { return [...new Set(values.map(clean).filter(Boolean))].slice(0, limit); }
function words(value: string): string[] { const base = (value.toLowerCase().match(/[a-z0-9][a-z0-9.-]{2,}/g) || []).filter((word) => !STOP.has(word)); return [...base, ...base.slice(1).map((word, index) => `${base[index]}_${word}`)]; }
function cosine(left: string, right: string): number {
  const vector = (value: string) => { const map = new Map<string, number>(); for (const token of words(value)) map.set(token, (map.get(token) || 0) + 1); return map; };
  const a = vector(left); const b = vector(right); if (!a.size || !b.size) return 0;
  let dot = 0; let aa = 0; let bb = 0; for (const value of a.values()) aa += value * value; for (const value of b.values()) bb += value * value; for (const [token, value] of a) dot += value * (b.get(token) || 0);
  return dot / Math.sqrt(aa * bb);
}
// Probabilistic semantic prototype model: learned class centroids plus softmax posterior.
function classify(text: string, seeds: Record<string, string[]>) {
  const raw = Object.entries(seeds).map(([label, examples]) => ({ label, similarity: Math.max(0, ...examples.map((example) => cosine(text, example))) }));
  const max = Math.max(...raw.map((item) => item.similarity)); const weighted = raw.map((item) => ({ ...item, weight: Math.exp((item.similarity - max) / 0.18) })); const total = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  return weighted.map((item) => ({ label: item.label, probability: item.weight / total, similarity: item.similarity })).sort((a, b) => b.probability - a.probability);
}
function bounded(value: number): number { return Math.max(0, Math.min(0.99, value)); }
function normalizeRef(value: string): string { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function references(value: string): string[] { return unique((value.match(/\b[A-Z]{2,}(?:-[A-Z0-9]+){2,}\b|\bSTR[- ]?\d{2,4}\b|\b(?:LET|LTR)[- ]?\d{2,4}\b/gi) || []).map((item) => item.replace(/\s+/g, "-").toUpperCase())); }
function clauseNumbers(value: string): string[] { return unique([...value.matchAll(/\b(?:sub[- ]?clause|clause|sc)\s*([0-9]+(?:\.[0-9A-Za-z()]+)*)/gi)].map((match) => match[1])); }
function incomingText(row: Row): string { return clean(["Subject", "Main Purpose", "Plain English Meaning", "Key Requests", "Required Actions", "Risk Type", "Affected Activities", "Cause", "Effect", "Scope Impact", "Sequence Impact", "Commercial Impact", "Contractual Position", "Remarks", "Notes"].map((field) => val(row, [field])).join(" ")); }
function letterText(row: Row): string { return clean(["Ref No", "Reference", "Date", "Subject", "Main Purpose", "Plain English Meaning", "Key Requests", "Required Actions", "Risk Type", "Affected Activities", "Related ACE Ref No(s)", "Related SAMCO Ref No(s)", "Relationship", "Notes"].map((field) => val(row, [field])).join(" ")); }
function clauseText(row: Row): string { return clean(["clause_number", "Clause No", "Location", "clause_title", "Clause / Topic", "title", "exact_clause_text", "Clause Text", "published_contract_wording", "plain_english_meaning", "Plain English Meaning", "claim_type", "required_evidence", "Practical Action / Evidence", "notice_required", "Notice / Time Bar", "source_scope"].map((field) => val(row, [field])).join(" ")); }
function clauseLabel(row: Row): string {
  const direct = val(row, ["clause_number", "Clause No", "Location"]);
  if (direct) return direct;
  const text = val(row, ["exact_clause_text", "Clause Text"]);
  const location = text.match(/Location\s*:\s*((?:Appendix\s*\/\s*)?Clause\s+[0-9]+(?:\.[0-9A-Za-z()]+)?(?:\s*\/\s*Clause\s+[0-9]+(?:\.[0-9A-Za-z()]+)?)*)/i)?.[1];
  return clean(location || "");
}

function parseLetterDate(row: Row): number | null {
  const value = val(row, ["Date", "date", "letter_date", "issue_date"]); if (!value) return null;
  const dmy = value.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{4})$/); const months: Record<string, number> = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  if (dmy) { const month = months[dmy[2].toLowerCase()]; if (month !== undefined) return Date.UTC(Number(dmy[3]), month, Number(dmy[1])); }
  const ymd = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (ymd) return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null;
}

function rankHistory(incoming: Row, sheets: LetterSheet[], topics: ReturnType<typeof classify>, chronology: "prior" | "later" = "prior") {
  const incomingDate = parseLetterDate(incoming); if (incomingDate === null) return [];
  const selected = val(incoming, ["Ref No", "Reference", "reference"]); const selectedKey = normalizeRef(selected); const query = `${incomingText(incoming)} ${topics.slice(0, 3).flatMap((item) => TOPIC_SEEDS[item.label] || []).join(" ")}`;
  const linked = sheets.filter((sheet) => /link|relationship/i.test(sheet.name)).flatMap((sheet) => sheet.rows).filter((row) => normalizeRef(letterText(row)).includes(selectedKey)).flatMap((row) => references(letterText(row)));
  const wanted = new Set([...references(`${incomingText(incoming)} ${letterText(incoming)}`), ...linked].map(normalizeRef)); const seen = new Set<string>();
  const candidates = sheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows).filter((row) => { const rowDate = parseLetterDate(row); return rowDate !== null && (chronology === "prior" ? rowDate < incomingDate : rowDate > incomingDate); }).map((row) => {
    const text = letterText(row); const reference = val(row, ["Ref No", "Reference", "reference"]); const key = normalizeRef(reference); const direct = wanted.has(key) || Boolean(selectedKey && normalizeRef(text).includes(selectedKey)); const semantic = cosine(query, text);
    return { row, reference, direct, semantic, probability: bounded(0.25 + semantic * 0.75 + (wanted.has(key) ? 0.32 : 0) + (selectedKey && normalizeRef(text).includes(selectedKey) ? 0.25 : 0)) };
  }).sort((a, b) => b.probability - a.probability).filter((item) => { const key = item.reference || letterText(item.row); if (!key || seen.has(key)) return false; seen.add(key); return true; });
  const qualifying = candidates.filter((item) => item.direct || item.probability >= 0.45);
  return (qualifying.length ? qualifying : candidates.slice(0, 5)).slice(0, 12);
}

function rankClauses(incoming: Row, clauses: Row[], topics: ReturnType<typeof classify>) {
  const query = `${incomingText(incoming)} ${topics.slice(0, 3).flatMap((item) => TOPIC_SEEDS[item.label] || []).join(" ")}`; const explicit = new Set(clauseNumbers(`${incomingText(incoming)} ${letterText(incoming)}`).map((item) => item.toLowerCase()));
  return clauses.map((clause) => { const text = clauseText(clause); const label = clauseLabel(clause) || val(clause, ["Clause / Topic"]); const direct = clauseNumbers(`${label} ${text}`).some((number) => explicit.has(number.toLowerCase())); const semantic = cosine(query, text); const penalty = /force majeure|exceptional event/i.test(text) && !/force majeure|exceptional event/i.test(query) ? 0.35 : 0; return { clause, direct, semantic, probability: bounded(0.24 + semantic * 0.9 + (direct ? 0.38 : 0) - penalty) }; })
    .filter((item) => item.probability >= 0.45 && val(item.clause, ["exact_clause_text", "Clause Text"])).sort((a, b) => b.probability - a.probability).slice(0, 6);
}

function fallbackContractReferences(incoming: Row, topics: ReturnType<typeof classify>) {
  const query = `${incomingText(incoming)} ${topics.slice(0, 4).flatMap((item) => TOPIC_SEEDS[item.label] || []).join(" ")}`;
  return FIDIC_2017_REFERENCE_PRINCIPLES.map((clause) => {
    const text = clauseText(clause); const explicit = clauseNumbers(`${incomingText(incoming)} ${letterText(incoming)}`); const direct = clauseNumbers(text).some((number) => explicit.includes(number)); const semantic = cosine(query, text);
    return { clause, direct, semantic, probability: bounded(0.4 + semantic * 0.5 + (direct ? 0.1 : 0)) };
  }).sort((a, b) => b.probability - a.probability).slice(0, 3);
}

function rankApplicationContext(project: Row, incoming: Row, topics: ReturnType<typeof classify>) {
  const query = `${incomingText(incoming)} ${topics.slice(0, 4).flatMap((item) => TOPIC_SEEDS[item.label] || []).join(" ")}`;
  const projectCurrency = val(project, ["currency"]) || "EGP";
  const candidates: Array<{ area: string; record: string; relevance_probability: number; review_status: string }> = [];
  const coreAreas: Array<{ area: string; fields: Array<[string, string, "text" | "percent" | "currency" | "ratio" | "number"]> }> = [
    { area: "Project status and progress", fields: [["project_display_name", "Project", "text"], ["status", "Status", "text"], ["last_updated", "Reporting cut-off", "text"], ["planned_progress", "Planned progress", "percent"], ["actual_progress", "Actual progress", "percent"], ["forecast_progress", "Forecast progress", "percent"], ["progress_variance", "Progress variance", "percent"]] },
    { area: "Schedule position", fields: [["planned_start", "Planned start", "text"], ["planned_finish", "Planned finish", "text"], ["forecast_finish", "Forecast finish", "text"], ["delay_days", "Indexed delay-event days", "number"], ["schedule_health", "Schedule health", "text"], ["activity_count", "Activities", "number"], ["milestone_count", "Milestones", "number"]] },
    { area: "Commercial and earned value", fields: [["contract_value", "Contract value", "currency"], ["paid_amount", "Paid amount", "currency"], ["spent_amount", "Actual cost", "currency"], ["remaining_value", "Remaining value", "currency"], ["bac", "BAC", "currency"], ["pv", "PV", "currency"], ["ev", "EV", "currency"], ["ac", "AC", "currency"], ["spi", "SPI", "ratio"], ["cpi", "CPI", "ratio"], ["eac", "EAC", "currency"], ["etc", "ETC", "currency"], ["vac", "VAC", "currency"]] },
    { area: "Risk, delay and claims", fields: [["risk_score", "Risk score", "number"], ["high_risk_count", "High risks", "number"], ["delay_event_count", "Delay events", "number"], ["claims_exposure", "Claims exposure", "currency"], ["claimed_days", "Claimed days", "number"], ["risk_record_count", "Risk records", "number"], ["delay_exposure", "Delay exposure", "text"], ["claim_exposure_level", "Claim exposure level", "text"]] },
  ];
  const core = coreAreas.map(({ area, fields }) => {
    const record = clean(fields.map(([field, label, kind]) => {
      const raw = project[field]; if (raw === undefined || raw === null || String(raw).trim() === "") return "";
      const number = Number(raw); let display = clean(String(raw));
      if (Number.isFinite(number) && kind === "percent") display = `${((Math.abs(number) <= 1 ? number * 100 : number)).toFixed(1)}%`;
      else if (Number.isFinite(number) && kind === "currency") display = `${projectCurrency} ${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
      else if (Number.isFinite(number) && kind === "ratio") display = number.toFixed(2);
      else if (Number.isFinite(number) && kind === "number") display = number.toLocaleString("en-US", { maximumFractionDigits: 2 });
      return `${label}: ${display}`;
    }).filter(Boolean).join("; "));
    const probability = bounded(0.34 + cosine(query, `${area} ${record}`) * 0.66);
    return { area, record, relevance_probability: Number(probability.toFixed(3)), review_status: "selected-project snapshot - verify reporting cut-off" };
  }).filter((item) => item.record);
  const visited = new WeakSet<object>(); let inspected = 0;
  const walk = (value: unknown, path: string, depth: number) => {
    if (!value || typeof value !== "object" || depth > 6 || inspected >= 1200 || visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) { value.slice(0, 300).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1)); return; }
    inspected += 1;
    const row = value as Row;
    const scalar = Object.entries(row).filter(([key, item]) => !/(?:source|path|file|payload|html|image|attachment)/i.test(key) && ["string", "number", "boolean"].includes(typeof item) && clean(String(item)).length > 0 && clean(String(item)).length <= 240).slice(0, 12);
    if (scalar.length >= 2) {
      const record = clean(scalar.map(([key, item]) => `${key}: ${String(item)}`).join("; "));
      const semantic = cosine(query, `${path} ${record}`); const probability = bounded(0.2 + semantic * 0.8);
      candidates.push({ area: path || "project", record, relevance_probability: Number(probability.toFixed(3)), review_status: probability >= 0.45 ? "relevant project context" : "context only" });
    }
    Object.entries(row).forEach(([key, item]) => { if (!/(?:letters_intelligence|contract_claims|raw|source|lineage|attachment|universal_report_engine|chart_payloads|reports?|report_package|report_artifacts|data_quality|advanced_analytics|decision_reasons)/i.test(key)) walk(item, path ? `${path}.${key}` : key, depth + 1); });
  };
  walk(project, "project", 0);
  const ranked = candidates.sort((a, b) => b.relevance_probability - a.relevance_probability);
  const relevant = ranked.filter((item) => item.relevance_probability >= 0.3 && !core.some((base) => base.record === item.record));
  return [...core.sort((a, b) => b.relevance_probability - a.relevance_probability), ...relevant].slice(0, 8);
}

function fact(row: Row, fields: string[]): string { return clean(fields.map((field) => val(row, [field])).filter(Boolean).join("; ")); }
function findGaps(incoming: Row, history: ReturnType<typeof rankHistory>, clauses: ReturnType<typeof rankClauses>) {
  const result: Array<{ gap: string; impact: string; required_action: string }> = [];
  if (!val(incoming, ["Date", "date"])) result.push({ gap: "Selected consultant letter date is unavailable.", impact: "Chronology and notice deadlines cannot be confirmed.", required_action: "Verify the issue date from the original letter." });
  if (incomingText(incoming).length < 120) result.push({ gap: "The selected letter contains limited indexed text.", impact: "Every allegation, instruction, deadline, and reservation may not be captured.", required_action: "Complete OCR/manual verification of the full letter and attachments." });
  if (!history.length || history.every((item) => !item.direct && item.probability < 0.45)) result.push({ gap: "No sufficiently related outgoing SAMCO correspondence was identified.", impact: "Consistency with SAMCO's earlier position is not proven; any low-confidence records are context only.", required_action: "Verify the complete prior SAMCO history before issue." });
  if (!clauses.length) result.push({ gap: "No project Contract & Claims clause met the evidence threshold.", impact: "No project-specific contractual conclusion may be stated; the draft uses clearly labelled secondary FIDIC reference principles only.", required_action: "Confirm the signed Contract, Particular Conditions, governing edition, amendments, and document priority before issue." });
  if (clauses.length) result.push({ gap: "Published clause-library wording is not proven as a signed-Contract verbatim extract.", impact: "It cannot be issued as a certified Contract quotation.", required_action: "Compare every quotation with the signed Contract and confirm document priority." });
  const incomplete = history.filter((item) => !val(item.row, ["Date", "date"]) || !val(item.row, ["Subject", "subject", "Main Purpose"])); if (incomplete.length) result.push({ gap: `${incomplete.length} related SAMCO record(s) have a missing date or subject.`, impact: "History and potential conflict cannot be fully validated.", required_action: "Complete metadata and review the original documents." });
  return result;
}
function requestedActions(incoming: Row): string[] { const explicit = fact(incoming, ["Key Requests", "Required Actions", "Required Action"]).split(/\s*[;•]\s*|\.(?=\s+[A-Z])/).map(clean).filter((item) => item.length > 8); return unique([...explicit, "Reconsider the position against the complete correspondence and contemporaneous record", "Identify the exact signed Contract provision and document priority for each disputed requirement", "Confirm the chronology, responsibility, required action, and applicable dates", "Acknowledge SAMCO's valid prior and continuing notices", "Assess time, cost, or other entitlement only after reviewing the supporting records"], 8); }

export function buildControlledLetterResponse({ project, incoming, letterSheets, sourceClauses }: { project: Row; incoming: Row; letterSheets: LetterSheet[]; sourceClauses: Row[] }) {
  const topics = classify(incomingText(incoming), TOPIC_SEEDS); const roleProbabilities = classify(incomingText(incoming), ROLE_SEEDS); const history = rankHistory(incoming, letterSheets, topics, "prior"); const laterHistory = rankHistory(incoming, letterSheets, topics, "later"); const matched = rankClauses(incoming, sourceClauses, topics); const contractBasis = matched.length ? matched : fallbackContractReferences(incoming, topics); const applicationContext = rankApplicationContext(project, incoming, topics); const evidenceGaps = findGaps(incoming, history, matched);
  const reference = val(incoming, ["Ref No", "Reference", "reference"]); const date = val(incoming, ["Date", "date"]); const subject = val(incoming, ["Subject", "subject", "Main Purpose"]); const timeTopic = topics.slice(0, 4).some((item) => ["time_eot", "programme_logic", "progress_mitigation"].includes(item.label)); const costTopic = topics.slice(0, 4).some((item) => ["payment_cost", "variation_instruction"].includes(item.label));
  const priorCorrespondence = history.map((item) => ({ reference: item.reference, date: val(item.row, ["Date", "date"]), subject: val(item.row, ["Subject", "subject", "Main Purpose"]), required_action: val(item.row, ["Required Actions", "Required Action"]), chronology_status: "issued before the selected consultant letter", relevance_probability: Number(item.probability.toFixed(3)), review_status: item.probability >= 0.58 ? "accepted for context" : item.probability >= 0.45 ? "manual review" : "low-confidence context only" }));
  const laterCorrespondenceReview = laterHistory.map((item) => ({ reference: item.reference, date: val(item.row, ["Date", "date"]), subject: val(item.row, ["Subject", "subject", "Main Purpose"]), chronology_status: "issued after the selected consultant letter - conflict check only", relevance_probability: Number(item.probability.toFixed(3)), evidence_use: "not used as prior evidence" }));
  const contractEvidence = contractBasis.map((item) => ({ clause_number: clauseLabel(item.clause), clause_title: val(item.clause, ["clause_title", "Clause / Topic", "title"]), published_contract_wording: val(item.clause, ["exact_clause_text", "Clause Text", "published_contract_wording"]), required_evidence: val(item.clause, ["required_evidence", "Practical Action / Evidence"]), notice_required: val(item.clause, ["notice_required", "Notice / Time Bar"]), source_scope: val(item.clause, ["source_scope"]) || "Selected-project Contract & Claims library; verify against the signed Contract.", authority_status: matched.length ? "project record - signed-contract check required" : "secondary guidance - not a governing project clause", evidence_probability: Number(item.probability.toFixed(3)), review_status: matched.length ? (item.probability >= 0.58 ? "accepted subject to signed-contract check" : "manual review") : "reference only - incorporation check required" }));
  const professionalBasis = [{ basis: "Selected-project application facts", use: applicationContext.length ? `${applicationContext.length} relevant project context record(s) ranked` : "No structured project context was ranked", authority: "Context only; original project records control" }, { basis: "SAMCO correspondence history", use: `${history.length} dated-prior record(s) ranked; ${laterHistory.length} later record(s) separated for conflict review`, authority: date ? "Only letters issued before the consultant letter are used as prior evidence" : "No letter may be treated as prior until the consultant date is verified" }, { basis: "Contractual basis", use: matched.length ? `${matched.length} project Contract & Claims record(s) ranked` : `${contractBasis.length} FIDIC 2017 reference principle(s) used`, authority: matched.length ? "Signed-contract verification required" : "Non-governing secondary guidance only" }, { basis: "SAMCO rights control", use: "Non-admission, non-waiver, continuing-notice, substantiation, and document-priority controls", authority: "Authorised SAMCO review required before issue" }];
  const contentionMap = [{ issue: "Consultant position", incoming_position: subject || fact(incoming, ["Main Purpose", "Plain English Meaning"]) || "Source review required", samco_control: "Do not accept the conclusion before checking the complete record and Contract." }, { issue: "Requested action / deadline", incoming_position: fact(incoming, ["Key Requests", "Required Actions", "Required Action"]) || "Not completely indexed", samco_control: "Confirm instruction, deadline, responsibility, and contractual basis before commitment." }, { issue: "Time / programme", incoming_position: fact(incoming, ["Affected Activities", "Sequence Impact", "Schedule Impact"]) || "Not established", samco_control: timeTopic ? "Assess cause, activities, float, controlling path, and finish effect." : "Do not introduce EOT without programme evidence." }, { issue: "Cost / commercial", incoming_position: fact(incoming, ["Commercial Impact", "Cost Impact"]) || "Not established", samco_control: costTopic ? "Preserve supported valuation routes without double counting." : "Do not introduce cost entitlement without records." }];
  const outgoingRows = letterSheets.filter((sheet) => /from (contractor|samco)/i.test(sheet.name)).flatMap((sheet) => sheet.rows); const outgoingScreened = outgoingRows.length; const incomingTimestamp = parseLetterDate(incoming); const datedBeforeCount = incomingTimestamp === null ? 0 : outgoingRows.filter((row) => { const value = parseLetterDate(row); return value !== null && value < incomingTimestamp; }).length; const datedAfterCount = incomingTimestamp === null ? 0 : outgoingRows.filter((row) => { const value = parseLetterDate(row); return value !== null && value > incomingTimestamp; }).length; const unclassifiedDateCount = outgoingScreened - datedBeforeCount - datedAfterCount;
  const conflictReview = [{ check: "Chronology gate", result: incomingTimestamp === null ? "Consultant letter date missing: no SAMCO letter is treated as prior evidence" : `${datedBeforeCount} SAMCO record(s) are dated before the consultant letter; ${datedAfterCount} later record(s) are excluded from prior evidence; ${unclassifiedDateCount} same-date/undated record(s) require review`, status: incomingTimestamp === null ? "REVIEW" : "PASS" }, { check: "SAMCO correspondence history screened", result: `${outgoingScreened} outgoing record(s) screened; ${history.length} prior potentially related/context record(s) ranked; ${laterHistory.length} later record(s) retained only for conflict review`, status: "REVIEW" }, { check: "Direct reference links in prior history", result: history.some((item) => item.direct) ? "At least one prior direct/linked reference resolved" : "No prior direct link resolved", status: history.some((item) => item.direct) ? "PASS" : "REVIEW" }, { check: "Contract basis", result: matched.length ? `${matched.length} project contract-library record(s) ranked` : `${contractBasis.length} FIDIC reference principle(s) supplied as non-governing guidance`, status: "REVIEW" }, { check: "Application context", result: `${applicationContext.length} selected-project application context record(s) ranked`, status: "REVIEW" }, { check: "Factual completeness", result: evidenceGaps.length ? `${evidenceGaps.length} mandatory gap(s)` : "No mandatory metadata gap detected", status: evidenceGaps.length ? "REVIEW" : "PASS" }, { check: "Acceptance / waiver control", result: "Reservation and non-admission controls applied", status: "PASS" }];
  const modelAudit = { model: "probabilistic semantic prototype classifier", version: "samco-090-port-1.3", history_screened_count: outgoingScreened, dated_before_count: datedBeforeCount, dated_after_count: datedAfterCount, prior_history_ranked_count: history.length, later_conflict_review_count: laterHistory.length, application_context_count: applicationContext.length, contract_basis_mode: matched.length ? "selected_project_contract_library" : "secondary_fidic_reference", top_topics: topics.slice(0, 4), role_probabilities: roleProbabilities, thresholds: { accepted: 0.58, review: 0.45 }, evidence_rule: "Only SAMCO correspondence dated before the selected consultant letter may support prior history; later correspondence is conflict-check context only. FIDIC reference principles never prove project incorporation." };

  const historyLines = history.length ? history.map((item) => `• ${item.reference || "Unnumbered SAMCO record"}${val(item.row, ["Date", "date"]) ? ` dated ${val(item.row, ["Date", "date"])}` : " [date to verify]"}${val(item.row, ["Subject", "subject", "Main Purpose"]) ? ` — ${val(item.row, ["Subject", "subject", "Main Purpose"])}` : " [subject to verify]"} (relevance ${(item.probability * 100).toFixed(0)}%)`) : ["• No sufficiently related outgoing SAMCO reference was resolved; authorised review is mandatory."];
  const clauseLines = contractBasis.map((item) => `• ${[clauseLabel(item.clause), val(item.clause, ["clause_title", "Clause / Topic", "title"])].filter(Boolean).join(" — ") || "Contract-library record"} [ranking ${(item.probability * 100).toFixed(0)}%]: ${val(item.clause, ["exact_clause_text", "Clause Text", "published_contract_wording"])}${val(item.clause, ["source_scope"]) ? ` (${val(item.clause, ["source_scope"])})` : ""}`);
  const contextLines = applicationContext.length ? applicationContext.slice(0, 5).map((item) => `• ${item.area}: ${item.record} [context ${(item.relevance_probability * 100).toFixed(0)}%]`) : ["• No structured application fact was sufficiently related; the original project records must be reviewed."];
  const attachments = unique([`Incoming consultant letter ${reference || "[reference to confirm]"}`, ...history.map((item) => item.reference).filter(Boolean), "Selected-project schedule, progress, procurement, delivery, commercial, risk, and site records — where relevant and verified", "Signed Contract extracts for every relied-upon clause — verify before issue"], 16); const projectName = val(project, ["project_display_name", "project_name", "project_id"]) || "Selected Project";
  const draft = [
    `Project: ${projectName}`, `Subject: Formal Response to ${reference || "Consultant Correspondence"}${subject ? ` — ${subject}` : ""}`, "", "Dear Sirs,", "", `We refer to ${reference || "the above correspondence"}${date ? ` dated ${date}` : " [date to be verified]"}. SAMCO reviewed the indexed contents against this project's application context, correspondence register, and Contract & Claims library. This controlled draft must be checked against the original documents and signed Contract before issue.`, "",
    `1. ${TITLES.record_history}`, date ? `Only SAMCO correspondence dated before ${date}, the indexed date of the selected consultant letter, is listed below as prior history. Later SAMCO letters are checked separately for consistency and are not used as earlier evidence.` : "The selected consultant letter date is missing. No SAMCO correspondence is treated as prior evidence until that date is verified.", ...historyLines, laterHistory.length ? `${laterHistory.length} later SAMCO record(s) were screened separately for conflict risk and were not used as prior evidence.` : "No later SAMCO record was used as prior evidence.", "This draft does not withdraw, replace, or amend any earlier SAMCO position. Any apparent inconsistency must be resolved against the original correspondence.", "",
    `2. ${TITLES.actual_effect_mitigation}`, `The indexed incoming record states: ${fact(incoming, ["Plain English Meaning", "Affected Activities", "Scope Impact", "Sequence Impact", "Commercial Impact"]) || "the complete factual effect is unavailable"}.`, "Relevant selected-project application context reviewed:", ...contextLines, "Actual effects must be separated from anticipated effects. Continued performance, mitigation, procurement effort, resequencing, or cooperation by SAMCO neither transfers responsibility nor waives a supported right.", "No effect, delay, critical-path consequence, cost, or liability is confirmed without contemporaneous records.", "",
    `3. ${TITLES.notice_purpose_status}`, "Earlier correspondence may record an event, give early warning, maintain continuing notice, request action, and preserve further particulars. A later clarification or revision does not automatically cancel the original record.", "",
    `4. ${TITLES.contract_basis_challenge}`, matched.length ? "The following text is from this project's published Contract & Claims library. It is not a certified verbatim extract until checked against the signed Contract:" : "No project-specific clause met the evidence threshold. The following concise FIDIC 2017 principles are secondary reference guidance only; they are not governing project clauses, certified quotations, or proof of incorporation:", ...clauseLines, "If the Consultant relies on a deadline, procedure, responsibility, or condition, please identify the exact signed clause/sub-clause and document priority.", "",
    `5. ${TITLES.continuing_position_entitlement}`, "This response is a continuing notice and reservation. SAMCO may provide interim, updated, or final particulars as further records become available.", ...(timeTopic ? ["Any time effect must be assessed separately by cause, timing, activities, calendars, float, controlling path, and finish movement. Genuine concurrency must be analysed without double counting or extinguishing separate event rights."] : []), ...(costTopic ? ["Any cost or valuation effect must be assessed from verified instructions, quantities, payment records, causation, mitigation, and the Contract without double counting."] : []), "Nothing establishes entitlement or quantum by assertion alone; the position remains subject to the Contract, causation, substantiation, and authorised review.", "",
    `6. ${TITLES.requested_action}`, ...requestedActions(incoming).map((item) => `• ${item.replace(/[.;]+$/, "")};`), "",
    `7. ${TITLES.reservation_rights}`, "This response is without prejudice to SAMCO's rights, remedies, notices, claims, defences, and entitlements. Nothing is an admission of liability, delay, responsibility, waiver, acceptance of an interpretation, or agreement to valuation, time, or cost consequences.", "Continued performance, mitigation, resequencing, cooperation, or acceptance of partial performance shall not release the responsible party or transfer responsibility to SAMCO. All previous notices, claims, and reservations remain maintained.", "",
    "Summary of SAMCO's Position", "Item | Controlled position", "--- | ---", "Record | The complete correspondence chain governs; no earlier SAMCO position is withdrawn.", "Facts | Only verified contemporaneous records may establish cause, effect, responsibility, time, or cost.", `Contract | ${matched.length ? "Published project clause wording must be checked against the signed Contract." : "FIDIC reference principles are non-governing guidance until incorporation and amendments are proven."}`, "Notice | Existing and continuing notices remain preserved subject to verification.", "Action | The Consultant is requested to reconsider, identify the basis, confirm facts, and respond.", "Rights | SAMCO maintains all supported rights and makes no admission or waiver.", "",
    "Evidence and Attachment Schedule", ...attachments.map((item, index) => `${String.fromCharCode(65 + index)}. ${item}`), "", "Yours faithfully,", "For SAMCO National Construction Company", "", "CONTROLLED DRAFT — NOT ISSUED — AUTHORISED CONTRACTS, PROJECT CONTROLS, PROJECT MANAGEMENT, AND LEGAL REVIEW REQUIRED",
  ].join("\n");
  return { status: "controlled_draft_review_required", selected_letter: incoming, professional_basis: professionalBasis, application_context: applicationContext, prior_correspondence: priorCorrespondence, later_correspondence_review: laterCorrespondenceReview, contract_evidence: contractEvidence, contention_map: contentionMap, conflict_review: conflictReview, evidence_gaps: evidenceGaps, attachment_schedule: attachments.map((item, index) => ({ item: String.fromCharCode(65 + index), evidence: item, status: /verify|where/i.test(item) ? "to be verified" : "indexed" })), model_audit: modelAudit, draft, notice: matched.length ? `A detailed project-evidence draft was generated with ${evidenceGaps.length} mandatory evidence/review gap(s). It has not been sent; authorised SAMCO review is mandatory.` : `A detailed controlled draft was generated using selected-project context, dated-prior SAMCO history only, and non-governing FIDIC reference principles. ${evidenceGaps.length} mandatory evidence/review gap(s) remain. It has not been sent; authorised SAMCO review is mandatory.` };
}
export const controlledResponseInternals = { classify, cosine, clauseNumbers, references, parseLetterDate, fallbackContractReferences, rankApplicationContext };
