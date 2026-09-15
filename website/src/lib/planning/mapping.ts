/**
 * Activity mapping — ties schedule activities to planning-library activity
 * codes, and turns that tie into the productivity basis the scenario engine
 * uses.
 *
 * Mappings are keyed by activity ID so they survive a new revision of the same
 * programme. A code rule maps every activity carrying one P6 activity-code
 * value at once; a mapping made on the activity itself always wins.
 */

import type { ProjectView, Task } from "../xer/model";
import type { TaskProductivity } from "../xer/scenario";
import { activityBasis, cellNumber, normLabel, type ActivityBasis, type LibraryIndex } from "./library";

export const MAPPING_SCHEMA = "pih-activity-mapping/1";

/** Implied resource sets outside this band mean the quantity is not in the library's unit. */
const MIN_PLAUSIBLE_SETS = 0.05;
const MAX_PLAUSIBLE_SETS = 50;

export type ActivityMapping = {
  libraryCode: string;
  /** Crew types that do this activity; empty uses every rate row of the code. */
  crews: string[];
  includeEquipment: boolean;
  quantity: number | null;
  currentSets: number | null;
  maxSets: number | null;
  productionOverride: number | null;
  note: string;
};

export type CodeRule = {
  id: string;
  codeType: string;
  codeValue: string;
  libraryCode: string;
  crews: string[];
  includeEquipment: boolean;
};

export type MappingStore = {
  schema: string;
  byTaskCode: Record<string, Partial<ActivityMapping>>;
  rules: CodeRule[];
  updatedAt: string;
};

export function emptyMappingStore(): MappingStore {
  return { schema: MAPPING_SCHEMA, byTaskCode: {}, rules: [], updatedAt: new Date().toISOString() };
}

export function parseMappingJson(text: string): MappingStore {
  const data = JSON.parse(text) as MappingStore;
  if (!data || data.schema !== MAPPING_SCHEMA) throw new Error("This JSON file is not an activity mapping export.");
  return { schema: MAPPING_SCHEMA, byTaskCode: data.byTaskCode || {}, rules: Array.isArray(data.rules) ? data.rules : [], updatedAt: data.updatedAt || new Date().toISOString() };
}

const BLANK: ActivityMapping = {
  libraryCode: "", crews: [], includeEquipment: true, quantity: null, currentSets: null, maxSets: null, productionOverride: null, note: "",
};

export type EffectiveMapping = { mapping: ActivityMapping; via: "activity" | "rule" | "none"; rule: CodeRule | null };

export function effectiveMapping(store: MappingStore, t: Task): EffectiveMapping {
  const own = store.byTaskCode[t.code] || {};
  const rule = own.libraryCode ? null : store.rules.find((r) => t.codes.some((c) => c.type === r.codeType && c.code === r.codeValue)) || null;
  const mapping: ActivityMapping = {
    ...BLANK,
    ...(rule ? { libraryCode: rule.libraryCode, crews: rule.crews, includeEquipment: rule.includeEquipment } : {}),
    ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)),
  } as ActivityMapping;
  return { mapping, via: own.libraryCode ? "activity" : rule ? "rule" : "none", rule };
}

export function setActivityMapping(store: MappingStore, taskCode: string, patch: Partial<ActivityMapping>): MappingStore {
  const current = { ...(store.byTaskCode[taskCode] || {}), ...patch };
  const cleaned = Object.fromEntries(
    Object.entries(current).filter(([k, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(k === "includeEquipment" && v === true)),
  ) as Partial<ActivityMapping>;
  const byTaskCode = { ...store.byTaskCode };
  if (Object.keys(cleaned).length) byTaskCode[taskCode] = cleaned;
  else delete byTaskCode[taskCode];
  return { ...store, byTaskCode, updatedAt: new Date().toISOString() };
}

export function clearActivityMappings(store: MappingStore, taskCodes: string[]): MappingStore {
  const byTaskCode = { ...store.byTaskCode };
  for (const code of taskCodes) delete byTaskCode[code];
  return { ...store, byTaskCode, updatedAt: new Date().toISOString() };
}

export function upsertRule(store: MappingStore, rule: Omit<CodeRule, "id"> & { id?: string }): MappingStore {
  const id = rule.id || `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const rules = store.rules.filter((r) => r.id !== id && !(r.codeType === rule.codeType && r.codeValue === rule.codeValue));
  return { ...store, rules: [...rules, { ...rule, id }], updatedAt: new Date().toISOString() };
}

export function deleteRule(store: MappingStore, id: string): MappingStore {
  return { ...store, rules: store.rules.filter((r) => r.id !== id), updatedAt: new Date().toISOString() };
}

/* ---------------------------------------------------------- quantities */

const CASH = /cash|cost|money|budget|payment|price|amount|value|revenue|expense|\b(sar|egp|usd|aed|eur)\b/i;

/**
 * Remaining work quantity carried by the activity's material resources in the
 * XER. Cost-type materials are ignored; when several remain, only one whose
 * name shares a work word with the activity is trusted.
 */
export function xerQuantity(P: ProjectView, t: Task): { quantity: number; source: string } | null {
  const usable = t.rsrcs
    .map((r) => ({ r, res: P.S.rsrcById[r.rsrc_id] || {} }))
    .filter((x) => x.res.rsrc_type === "RT_Mat" && !CASH.test(`${x.res.rsrc_name || ""} ${x.res.rsrc_short_name || ""}`))
    .map((x) => {
      const remaining = cellNumber(x.r.remain_qty) || 0;
      const planned = cellNumber(x.r.target_qty) || 0;
      const budgeted = !(remaining > 0) && !t.started && planned > 0;
      return { name: x.res.rsrc_name || x.r.rsrc_id, quantity: remaining > 0 ? remaining : budgeted ? planned : 0, budgeted };
    })
    .filter((x) => x.quantity > 0);
  if (!usable.length) return null;
  let pick = usable.length === 1 ? usable[0] : null;
  if (!pick) {
    const own = tokens(t.name);
    pick = usable.find((x) => Array.from(tokens(x.name)).some((w) => own.has(w))) || null;
  }
  if (!pick) return null;
  return { quantity: pick.quantity, source: `${pick.name} ${pick.budgeted ? "budgeted" : "remaining"} quantity (XER)` };
}

/* ------------------------------------------------------------ resolve */

export type MappedActivity = {
  task: Task;
  via: EffectiveMapping["via"];
  mapping: ActivityMapping;
  basis: ActivityBasis | null;
  quantity: number | null;
  quantitySource: string;
  production: number | null;
  remainingDays: number;
  /** Sets the file's remaining duration implies at library productivity. */
  impliedSets: number | null;
  currentSets: number;
  maxSets: number;
  /** Remaining duration the library rate gives at the current sets. */
  productivityDays: number | null;
  varianceDays: number | null;
  costPerDay: number;
  issues: string[];
};

const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString();

export function resolveMapped(P: ProjectView, index: LibraryIndex, store: MappingStore, t: Task): MappedActivity {
  const { mapping, via } = effectiveMapping(store, t);
  const remainingDays = t.rd;
  const issues: string[] = [];
  const basis = mapping.libraryCode ? activityBasis(index, mapping.libraryCode, mapping.crews, mapping.includeEquipment) : null;
  if (mapping.libraryCode && !basis) issues.push(`Library code ${mapping.libraryCode} does not exist`);
  if (basis) issues.push(...basis.issues);

  const production = mapping.productionOverride ?? basis?.dailyProduction ?? null;
  const entered = mapping.quantity !== null && mapping.quantity !== undefined;
  const fromXer = entered ? null : xerQuantity(P, t);
  let quantity: number | null = entered ? mapping.quantity : fromXer?.quantity ?? null;
  let quantitySource = entered ? "Entered" : fromXer ? fromXer.source : "Not available";
  let impliedSets = quantity && production && remainingDays > 0 ? quantity / (production * remainingDays) : null;

  if (impliedSets !== null && (impliedSets < MIN_PLAUSIBLE_SETS || impliedSets > MAX_PLAUSIBLE_SETS)) {
    if (entered) {
      issues.push(`The entered quantity implies ${fmt(impliedSets)} resource sets at the library rate — check it is in ${basis?.uom || "the library unit"}`);
    } else {
      issues.push(`XER quantity ${fmt(quantity || 0)} (${quantitySource}) implies ${fmt(impliedSets)} sets at the library rate — ignored as a unit mismatch; enter the quantity in ${basis?.uom || "the library unit"}`);
      quantity = null;
      quantitySource = "Not available — XER quantity is not in the library unit";
      impliedSets = null;
    }
  } else if (basis && fromXer && basis.uom) {
    issues.push(`Confirm the XER quantity is in ${basis.uom}`);
  }
  if (basis && quantity === null && !issues.some((i) => i.includes("unit mismatch"))) issues.push("No remaining quantity — enter one to re-estimate from the rate");

  const currentSets = mapping.currentSets && mapping.currentSets > 0
    ? mapping.currentSets
    : impliedSets ? Math.min(MAX_PLAUSIBLE_SETS, Math.max(1, Math.round(impliedSets))) : 1;
  const maxSets = mapping.maxSets && mapping.maxSets >= currentSets ? mapping.maxSets : currentSets + 2;
  const productivityDays = quantity && production ? quantity / (production * currentSets) : null;

  return {
    task: t, via, mapping, basis, quantity, quantitySource, production, remainingDays, impliedSets, currentSets, maxSets,
    productivityDays, varianceDays: productivityDays === null ? null : productivityDays - remainingDays,
    costPerDay: basis ? basis.costPerDay : 0, issues,
  };
}

/** Productivity inputs for every mapped, incomplete activity that has a usable rate. */
export function productivityInputs(P: ProjectView, index: LibraryIndex, store: MappingStore): TaskProductivity[] {
  const out: TaskProductivity[] = [];
  for (const t of P.tasks) {
    if (t.done || t.isMile || t.isLOE || t.isWBSsum) continue;
    const { mapping } = effectiveMapping(store, t);
    if (!mapping.libraryCode) continue;
    const m = resolveMapped(P, index, store, t);
    if (!m.basis || !(m.production && m.production > 0)) continue;
    out.push({
      taskId: t.id, libraryCode: m.basis.code, libraryName: m.basis.description, uom: m.basis.uom,
      quantity: m.quantity || 0, quantitySource: m.quantitySource, setDailyProduction: m.production,
      setCostPerDay: m.costPerDay, currentSets: m.currentSets, maxSets: m.maxSets,
      setsConfirmed: !!(m.mapping.currentSets && m.mapping.currentSets > 0),
    });
  }
  return out;
}

/* --------------------------------------------------------- suggestions */

const SYNONYMS: Record<string, string> = {
  rft: "reinforc", rebar: "reinforc", reinforc: "reinforc", reinforcement: "reinforc",
  conc: "concret", concret: "concret", concrete: "concret", pour: "concret", cast: "concret", concreting: "concret",
  shutter: "formwork", deshutter: "formwork", formwork: "formwork", form: "formwork",
  foot: "footing", footing: "footing", raft: "raft", slab: "slab", wall: "wall", column: "column", col: "column",
  beam: "beam", stair: "stair", core: "core", foundation: "foundation",
  backfill: "backfill", excavat: "excavat", excavation: "excavat", replacement: "replacement", compaction: "compaction",
  waterproof: "damproof", proof: "damproof", dam: "damproof", membrane: "damproof",
  bitumen: "bitumin", bitumin: "bitumin", bituminou: "bitumin",
  ins: "insulat", insulat: "insulat", insulation: "insulat", thermal: "insulat",
  plaster: "plaster", paint: "paint", tile: "tile", ceramic: "ceramic", marble: "marble", block: "block", brick: "brick",
  blind: "blinding", blinding: "blinding", plain: "blinding", grade: "grade", grading: "grading", partition: "partition", gypsum: "gypsum",
  door: "door", window: "window", hvac: "hvac", plumb: "plumbing", plumbing: "plumbing", electric: "electrical", electrical: "electrical",
  manhole: "manhole", dewater: "dewatering", dewatering: "dewatering", shoring: "shoring", precast: "precast", steel: "steel",
  soil: "soil", asphalt: "asphalt", road: "road", disposal: "disposal", survey: "survey",
};

const WORK_TYPES = new Set([
  "reinforc", "concret", "formwork", "backfill", "excavat", "replacement", "compaction", "damproof", "bitumin", "insulat",
  "plaster", "paint", "tile", "ceramic", "marble", "block", "brick", "blinding", "partition", "gypsum", "door", "window",
  "hvac", "plumbing", "electrical", "manhole", "dewatering", "shoring", "precast", "asphalt", "grading", "disposal", "steel", "survey",
]);
const ELEMENTS = new Set(["footing", "raft", "slab", "wall", "column", "beam", "stair", "core", "foundation", "roof", "ceiling", "tank"]);

const STOP = new Set([
  "the", "and", "for", "with", "work", "works", "of", "in", "to", "at", "by", "on", "incl", "including", "ug", "gf", "typ",
  "typical", "floor", "level", "area", "zone", "part", "phase", "rc", "pc", "b", "big", "quantity", "qty", "patch", "protection",
]);

/** Activities that consume no crew output — deliveries, approvals, tests. */
const NOT_PRODUCTION = /\b(deliver(y|ies)?|submittals?|approv(al|als|e|ed)|drawings?|dwgs?|procure(ment)?|purchas(e|ing)|tests?|testing|inspections?|permits?|handover|as[- ]?built|design|review|noc)\b/i;
/** Waiting activities — mapped only when the name also names real work. */
const WAITING = /\b(curing|clearance|mobili[sz]ation|demobili[sz]ation)\b/i;

function stem(word: string): string {
  let w = word.toLowerCase();
  if (SYNONYMS[w]) return SYNONYMS[w];
  for (const suffix of ["ings", "ing", "ies", "es", "s", "ed"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return SYNONYMS[w] || w;
}

export function tokens(text: string): Set<string> {
  const out = new Set(
    text.toLowerCase().replace(/\([^)]*\b[a-z]?\d+[a-z]?\b[^)]*\)/g, " ").split(/[^a-z]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)).map(stem).filter((w) => w.length > 1 && !STOP.has(w)),
  );
  // Formwork and reinforcement on a cast element are concrete work.
  if (out.has("formwork") || out.has("reinforc")) out.add("concret");
  return out;
}

const CREW_HINTS: [RegExp, string][] = [
  [/shutter|formwork|carpent/i, "carpent"],
  [/\brft\b|rebar|reinforc|steel fix/i, "steel fixing"],
  [/pour|casting|concreting/i, "concrete pouring"],
  [/plaster/i, "plastering"],
  [/paint/i, "painting"],
  [/tile|ceramic/i, "tile fixing"],
  [/marble/i, "marble"],
  [/block|brick/i, "block work"],
  [/backfill|excavat|replacement|compaction|disposal/i, "general workers"],
  [/survey|setting out/i, "surveying"],
  [/manhole/i, "manhole"],
  [/plumb/i, "plumbing"],
  [/dewater/i, "dewatering"],
  [/shoring/i, "shoring"],
  [/precast/i, "precast"],
];

export type Suggestion = { code: string; description: string; crews: string[]; score: number };

export function suggestLibraryActivities(index: LibraryIndex, t: Task, max = 3): Suggestion[] {
  const own = tokens(t.name);
  if (!own.size || NOT_PRODUCTION.test(t.name)) return [];
  const hasWork = Array.from(own).some((w) => WORK_TYPES.has(w));
  if (WAITING.test(t.name) && !hasWork) return [];
  const context = new Set(Array.from(tokens(t.wbsName)).filter((w) => !own.has(w)));
  const hint = CREW_HINTS.find(([re]) => re.test(t.name));

  const out: Suggestion[] = [];
  for (const [code, row] of index.activities) {
    const theirs = tokens(String(row.description || ""));
    if (!theirs.size) continue;
    let weight = 0;
    for (const w of own) if (theirs.has(w)) weight += WORK_TYPES.has(w) ? 1 : ELEMENTS.has(w) ? 0.6 : 0.4;
    if (!weight) continue;
    for (const w of context) if (theirs.has(w)) weight += 0.15;

    const rateRows = index.labour.get(code) || [];
    let crews: string[] = [];
    let bonus = 0;
    if (hint) {
      crews = Array.from(new Set(rateRows.map((r) => String(r.crew || "")).filter((c) => normLabel(c).includes(hint[1]))));
      if (crews.length) bonus = 0.25;
    }
    if (rateRows.length || index.equipment.has(code)) bonus += 0.1;
    const score = weight / Math.sqrt(own.size * theirs.size) + bonus;
    out.push({ code, description: String(row.description || ""), crews, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}
