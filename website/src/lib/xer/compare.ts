/**
 * Comparison engine.
 *
 * Matches the activities of two schedules, diffs every meaningful field, diffs
 * the logic network, the WBS, calendars and resources, and ranks what actually
 * moved the programme. Built for before/after pairs — a fragnet insertion, a
 * revision, or two consecutive progress updates.
 */

import { analyze, isCritical } from "./analysis";
import { WorkCalendar } from "./calendar";
import { clamp, dayDiff, formatDate, formatMoney, formatNum, num, percent, uniq } from "./format";
import { CONSTRAINT, type Link, type ProjectView, type Task, type WbsNode } from "./model";
import { analysisKey, type AnalyzerOptions } from "./options";

/* -------------------------------------------------------- field table */

export type FieldType = "text" | "num" | "date";

export type CompareField = {
  k: string;
  l: string;
  cat: string;
  t: FieldType;
  u?: string;
  dec?: number;
  money?: boolean;
  /** Excluded by default — see `DEFAULT_FIELDS_OFF`. */
  off?: boolean;
  tol?: (opts: AnalyzerOptions) => number;
  get: (t: Task, P: ProjectView) => unknown;
};

export const COMPARE_FIELDS: CompareField[] = [
  { k: "name", l: "Activity name", cat: "Attributes", t: "text", get: (t) => t.name },
  { k: "wbsPath", l: "WBS path", cat: "Structure", t: "text", get: (t) => t.wbsPath || "" },
  { k: "type", l: "Activity type", cat: "Attributes", t: "text", get: (t) => t.typeName },
  { k: "status", l: "Status", cat: "Progress", t: "text", get: (t) => t.statusName },
  { k: "cal", l: "Calendar", cat: "Structure", t: "text", get: (t) => t.calName },
  { k: "od", l: "Original duration", cat: "Duration", t: "num", u: "d", dec: 1, tol: (o) => o.durTol, get: (t) => t.od },
  { k: "rd", l: "Remaining duration", cat: "Duration", t: "num", u: "d", dec: 1, tol: (o) => o.durTol, get: (t) => t.rd },
  { k: "start", l: "Start", cat: "Dates", t: "date", get: (t) => t.start },
  { k: "finish", l: "Finish", cat: "Dates", t: "date", get: (t) => t.finish },
  { k: "actStart", l: "Actual start", cat: "Dates", t: "date", get: (t) => t.actStart },
  { k: "actEnd", l: "Actual finish", cat: "Dates", t: "date", get: (t) => t.actEnd },
  { k: "earlyStart", l: "Early start", cat: "CPM dates", t: "date", off: true, get: (t) => t.earlyStart },
  { k: "earlyEnd", l: "Early finish", cat: "CPM dates", t: "date", off: true, get: (t) => t.earlyEnd },
  { k: "lateStart", l: "Late start", cat: "CPM dates", t: "date", off: true, get: (t) => t.lateStartD },
  { k: "lateEnd", l: "Late finish", cat: "CPM dates", t: "date", off: true, get: (t) => t.lateFinish },
  { k: "tf", l: "Total float", cat: "Float", t: "num", u: "d", dec: 1, get: (t) => t.tf },
  { k: "ff", l: "Free float", cat: "Float", t: "num", u: "d", dec: 1, off: true, get: (t) => t.ff },
  { k: "crit", l: "On critical path", cat: "Float", t: "text", get: (t) => (t.tf !== null && t.tf <= 0 ? "Yes" : "No") },
  { k: "pct", l: "% complete", cat: "Progress", t: "num", u: "%", dec: 1, get: (t) => t.pct },
  {
    k: "cstr", l: "Primary constraint", cat: "Constraints", t: "text",
    get: (t) => (t.cstrType ? (CONSTRAINT[t.cstrType] || t.cstrType) + (t.cstrDate ? ` @ ${formatDate(t.cstrDate)}` : "") : ""),
  },
  {
    k: "cstr2", l: "Secondary constraint", cat: "Constraints", t: "text",
    get: (t) => (t.cstrType2 ? (CONSTRAINT[t.cstrType2] || t.cstrType2) + (t.cstrDate2 ? ` @ ${formatDate(t.cstrDate2)}` : "") : ""),
  },
  { k: "preds", l: "Predecessor count", cat: "Logic", t: "num", dec: 0, get: (t) => t.preds.length + t.extPreds.length },
  { k: "succs", l: "Successor count", cat: "Logic", t: "num", dec: 0, get: (t) => t.succs.length + t.extSuccs.length },
  { k: "budget", l: "Budgeted cost", cat: "Cost", t: "num", dec: 0, money: true, get: (t) => t.budget },
  { k: "remCost", l: "Remaining cost", cat: "Cost", t: "num", dec: 0, money: true, off: true, get: (t) => t.remainCost },
  {
    k: "rsrc", l: "Resources", cat: "Resources", t: "text",
    get: (t, P) => t.rsrcs.map((r) => (P.S.rsrcById[r.rsrc_id] || {}).rsrc_short_name || r.rsrc_id).sort().join(", "),
  },
  { k: "units", l: "Budgeted units", cat: "Resources", t: "num", dec: 1, off: true, get: (t) => (t.cost ? t.cost.qty : 0) },
  {
    k: "codes", l: "Activity codes", cat: "Attributes", t: "text", off: true,
    get: (t) => t.codes.map((c) => `${c.type}:${c.code}`).sort().join(" | "),
  },
  { k: "durType", l: "Duration type", cat: "Attributes", t: "text", off: true, get: (t) => t.durTypeName },
];

export const COMPARE_CATEGORIES = uniq(COMPARE_FIELDS.map((f) => f.cat));

/**
 * Derived early/late dates and secondary cost/units are excluded by default:
 * every activity shifts them, which buries the edits that were actually made.
 * The field chooser turns them back on.
 */
export function defaultFieldsOff(): Record<string, boolean> {
  const off: Record<string, boolean> = {};
  for (const f of COMPARE_FIELDS) if (f.off) off[f.k] = true;
  return off;
}

export function activeCompareFields(opts: AnalyzerOptions): CompareField[] {
  return COMPARE_FIELDS.filter((f) => !opts.fieldsOff[f.k]);
}

/* --------------------------------------------------------- name match */

function normName(s: string | null | undefined): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normName(s).split(" ").filter((x) => x.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

/* --------------------------------------------------------- field diff */

export type FieldChange = {
  field: CompareField;
  key: string;
  label: string;
  cat: string;
  a: unknown;
  b: unknown;
  delta: number | null;
  aDisp: string;
  bDisp: string;
};

function fieldValue(f: CompareField, t: Task, P: ProjectView): unknown {
  try {
    return f.get(t, P);
  } catch {
    return null;
  }
}

export function fieldDisplay(f: CompareField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (f.t === "date") return formatDate(value as Date);
  if (f.t === "num") {
    return f.money ? formatMoney(value as number) : formatNum(value as number, f.dec === undefined ? 1 : f.dec) + (f.u || "");
  }
  return String(value);
}

function fieldDiff(f: CompareField, a: Task, b: Task, PA: ProjectView, PB: ProjectView, opts: AnalyzerOptions): FieldChange | null {
  const va = fieldValue(f, a, PA);
  const vb = fieldValue(f, b, PB);
  let changed = false;
  let delta: number | null = null;

  if (f.t === "date") {
    const ta = va ? +(va as Date) : null;
    const tb = vb ? +(vb as Date) : null;
    if (ta === null && tb === null) return null;
    if (ta === null || tb === null) {
      changed = true;
    } else {
      delta = dayDiff(va as Date, vb as Date);
      changed = Math.abs(delta || 0) > opts.dateTol;
    }
  } else if (f.t === "num") {
    const na = va === null || va === undefined ? null : +(va as number);
    const nb = vb === null || vb === undefined ? null : +(vb as number);
    if ((na === null || Number.isNaN(na)) && (nb === null || Number.isNaN(nb))) return null;
    delta = Math.round(((nb || 0) - (na || 0)) * 1000) / 1000;
    const tol = f.tol ? f.tol(opts) : 0;
    changed = Math.abs(delta) > tol + 1e-9;
  } else {
    changed = String(va || "") !== String(vb || "");
  }

  if (!changed) return null;
  return {
    field: f, key: f.k, label: f.l, cat: f.cat,
    a: va, b: vb, delta,
    aDisp: fieldDisplay(f, va), bDisp: fieldDisplay(f, vb),
  };
}

/* -------------------------------------------------------------- types */

export type LogicChange = { txt: string; kind: "add" | "del" | "mod"; rel: RelDiff };

export type ActivityDiff = {
  a: Task;
  b: Task;
  key: string;
  renamed: boolean;
  score?: number;
  changes: FieldChange[];
  cats: string[];
  startVar: number | null;
  finishVar: number | null;
  durVar: number;
  remDurVar: number;
  tfVar: number | null;
  pctVar: number;
  costVar: number;
  critA: boolean;
  critB: boolean;
  logicChanges: LogicChange[];
};

export type RelDiff = {
  key: string;
  a?: Link;
  b?: Link;
  typeChanged?: boolean;
  lagChanged?: boolean;
  lagDelta?: number;
};

export type ProjectRow = {
  l: string;
  a: unknown;
  b: unknown;
  t: "text" | "num" | "date" | "money";
  u?: string;
  delta: number | null;
  changed: boolean;
};

export type ResourceDiff = {
  name: string;
  a: { cost: number; qty: number; tasks: number };
  b: { cost: number; qty: number; tasks: number };
  costVar: number;
  qtyVar: number;
  taskVar: number;
  state: "added" | "removed" | "changed";
};

export type Comparison = {
  key: string;
  PA: ProjectView;
  PB: ProjectView;
  matchKey: (t: Task) => string;
  matched: { a: Task; b: Task; key: string }[];
  added: Task[];
  removed: Task[];
  renames: { a: Task; b: Task; score: number }[];
  diffs: ActivityDiff[];
  unchanged: number;
  changedCount: number;
  diffByIdA: Map<string, ActivityDiff>;
  diffByIdB: Map<string, ActivityDiff>;
  catCount: Record<string, number>;
  fieldCount: Record<string, number>;
  rel: { added: RelDiff[]; removed: RelDiff[]; changed: RelDiff[]; same: RelDiff[] };
  wbsDiff: { added: WbsNode[]; removed: WbsNode[]; changed: { a: WbsNode; b: WbsNode }[] };
  calDiff: {
    added: WorkCalendar[];
    removed: WorkCalendar[];
    changed: { a: WorkCalendar; b: WorkCalendar; s1: ReturnType<WorkCalendar["summary"]>; s2: ReturnType<WorkCalendar["summary"]> }[];
  };
  rsrcDiff: ResourceDiff[];
  crit: { entered: ActivityDiff[]; left: ActivityDiff[]; lpEntered: Task[]; lpLeft: Task[] };
  proj: ProjectRow[];
  impact: { d: ActivityDiff; weight: number; onLP: boolean }[];
  similarity: number;
  matchRate: number;
  finishVar: number | null;
  dataDateVar: number | null;
  summaryCounts: {
    added: number; removed: number; modified: number; unchanged: number; renamed: number;
    relAdded: number; relRemoved: number; relChanged: number;
  };
  /** Baseline execution index: B's actual completions ÷ A's planned completions at B's data date. */
  bei: number | null;
  missed: ActivityDiff[];
  ms: number;
};

/* ------------------------------------------------------------ compare */

export function comparisonKey(PA: ProjectView, PB: ProjectView, opts: AnalyzerOptions): string {
  return [
    PA.S.fileName, PA.projId, PB.S.fileName, PB.projId,
    opts.matchBy, opts.dateTol, opts.durTol, analysisKey(opts),
    activeCompareFields(opts).map((f) => f.k).join(","),
  ].join("#");
}

export function compareSchedules(PA: ProjectView, PB: ProjectView, opts: AnalyzerOptions): Comparison {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const FIELDS = activeCompareFields(opts);
  const key = comparisonKey(PA, PB, opts);

  analyze(PA, opts);
  analyze(PB, opts);

  const mode = opts.matchBy;
  const matchKey = (t: Task) =>
    mode === "name" ? normName(t.name) : mode === "code+wbs" ? `${t.code}@@${t.wbsPath}` : t.code;

  /* ---------- match activities ---------- */
  const mapA = new Map<string, Task[]>();
  const mapB = new Map<string, Task[]>();
  for (const t of PA.tasks) {
    const k = matchKey(t);
    const bucket = mapA.get(k);
    if (bucket) bucket.push(t);
    else mapA.set(k, [t]);
  }
  for (const t of PB.tasks) {
    const k = matchKey(t);
    const bucket = mapB.get(k);
    if (bucket) bucket.push(t);
    else mapB.set(k, [t]);
  }

  const matched: { a: Task; b: Task; key: string }[] = [];
  const added: Task[] = [];
  const removed: Task[] = [];
  for (const [k, listA] of mapA) {
    const listB = mapB.get(k);
    if (!listB) {
      for (const t of listA) removed.push(t);
      continue;
    }
    const pairCount = Math.min(listA.length, listB.length);
    for (let i = 0; i < pairCount; i++) matched.push({ a: listA[i], b: listB[i], key: k });
    for (let i = pairCount; i < listA.length; i++) removed.push(listA[i]);
    for (let i = pairCount; i < listB.length; i++) added.push(listB[i]);
  }
  for (const [k, listB] of mapB) if (!mapA.has(k)) for (const t of listB) added.push(t);

  /* ---------- fuzzy rename detection ---------- */
  const renames: { a: Task; b: Task; score: number }[] = [];
  if (opts.fuzzyRename && removed.length && added.length && removed.length * added.length <= 4_000_000) {
    const addedTokens = added.map((t) => ({ t, tk: tokenize(t.name), nn: normName(t.name) }));
    const usedB = new Set<string>();
    const byNorm = new Map<string, typeof addedTokens>();
    for (const entry of addedTokens) {
      const bucket = byNorm.get(entry.nn);
      if (bucket) bucket.push(entry);
      else byNorm.set(entry.nn, [entry]);
    }
    for (const r of removed) {
      const nn = normName(r.name);
      let hit = (byNorm.get(nn) || []).find((x) => !usedB.has(x.t.id));
      let score = hit ? 1 : 0;
      if (!hit && added.length <= 6000) {
        const tk = tokenize(r.name);
        let best: (typeof addedTokens)[number] | null = null;
        let bestScore = 0;
        for (const x of addedTokens) {
          if (usedB.has(x.t.id)) continue;
          const s = jaccard(tk, x.tk);
          if (s > bestScore) {
            bestScore = s;
            best = x;
          }
        }
        if (best && bestScore >= 0.75) {
          hit = best;
          score = bestScore;
        }
      }
      if (hit) {
        usedB.add(hit.t.id);
        renames.push({ a: r, b: hit.t, score: Math.round(score * 100) });
      }
    }
  }

  /* ---------- field-level diff ---------- */
  const pairs: { a: Task; b: Task; key: string; renamed?: boolean; score?: number }[] = matched.concat(
    renames.map((r) => ({ a: r.a, b: r.b, key: r.a.code, renamed: true, score: r.score })),
  );

  const diffs: ActivityDiff[] = [];
  const catCount: Record<string, number> = {};
  const fieldCount: Record<string, number> = {};
  let unchanged = 0;

  for (const pair of pairs) {
    const changes: FieldChange[] = [];
    for (const f of FIELDS) {
      const change = fieldDiff(f, pair.a, pair.b, PA, PB, opts);
      if (change) changes.push(change);
    }
    const record: ActivityDiff = {
      a: pair.a, b: pair.b, key: pair.key,
      renamed: !!pair.renamed, score: pair.score,
      changes, cats: uniq(changes.map((c) => c.cat)),
      startVar: dayDiff(pair.a.start, pair.b.start),
      finishVar: dayDiff(pair.a.finish, pair.b.finish),
      durVar: Math.round((pair.b.od - pair.a.od) * 100) / 100,
      remDurVar: Math.round((pair.b.rd - pair.a.rd) * 100) / 100,
      tfVar: pair.a.tf === null || pair.b.tf === null ? null : Math.round((pair.b.tf - pair.a.tf) * 100) / 100,
      pctVar: Math.round((pair.b.pct - pair.a.pct) * 10) / 10,
      costVar: Math.round(pair.b.budget - pair.a.budget),
      critA: isCritical(pair.a, opts),
      critB: isCritical(pair.b, opts),
      logicChanges: [],
    };
    if (!changes.length && !pair.renamed) unchanged++;
    for (const c of changes) {
      catCount[c.cat] = (catCount[c.cat] || 0) + 1;
      fieldCount[c.label] = (fieldCount[c.label] || 0) + 1;
    }
    diffs.push(record);
  }

  const diffByIdA = new Map(diffs.map((d) => [d.a.id, d]));
  const diffByIdB = new Map(diffs.map((d) => [d.b.id, d]));

  /* ---------- relationship diff ---------- */
  const linkKey = (l: Link) =>
    `${l.pred ? matchKey(l.pred) : `⟨ext:${l.predId}⟩`} → ${l.succ ? matchKey(l.succ) : `⟨ext:${l.succId}⟩`}`;

  const linksA = new Map<string, Link[]>();
  const linksB = new Map<string, Link[]>();
  for (const l of PA.links) {
    const k = linkKey(l);
    const bucket = linksA.get(k);
    if (bucket) bucket.push(l);
    else linksA.set(k, [l]);
  }
  for (const l of PB.links) {
    const k = linkKey(l);
    const bucket = linksB.get(k);
    if (bucket) bucket.push(l);
    else linksB.set(k, [l]);
  }

  const relAdded: RelDiff[] = [];
  const relRemoved: RelDiff[] = [];
  const relChanged: RelDiff[] = [];
  const relSame: RelDiff[] = [];

  for (const [k, la] of linksA) {
    const lb = linksB.get(k);
    if (!lb) {
      for (const l of la) relRemoved.push({ key: k, a: l });
      continue;
    }
    const pairCount = Math.min(la.length, lb.length);
    for (let i = 0; i < pairCount; i++) {
      const A = la[i];
      const B = lb[i];
      const typeChanged = A.type !== B.type;
      const lagChanged = Math.abs(A.lag - B.lag) > 1e-6;
      if (typeChanged || lagChanged) {
        relChanged.push({
          key: k, a: A, b: B, typeChanged, lagChanged,
          lagDelta: Math.round((B.lag - A.lag) * 100) / 100,
        });
      } else {
        relSame.push({ key: k, a: A, b: B });
      }
    }
    for (let i = pairCount; i < la.length; i++) relRemoved.push({ key: k, a: la[i] });
    for (let i = pairCount; i < lb.length; i++) relAdded.push({ key: k, b: lb[i] });
  }
  for (const [k, lb] of linksB) if (!linksA.has(k)) for (const l of lb) relAdded.push({ key: k, b: l });

  // Attach logic changes to the activity diffs they belong to.
  const noteLogic = (taskId: string, side: "a" | "b", txt: string, kind: LogicChange["kind"], rel: RelDiff) => {
    const d = side === "a" ? diffByIdA.get(taskId) : diffByIdB.get(taskId);
    if (d) d.logicChanges.push({ txt, kind, rel });
  };

  for (const r of relAdded) {
    const link = r.b!;
    const lagText = link.lag ? ` ${link.lag > 0 ? "+" : ""}${link.lag}d` : "";
    if (link.succ) {
      noteLogic(link.succ.id, "b", `Added predecessor ${link.pred ? link.pred.code : "external"} (${link.type}${lagText})`, "add", r);
    }
    if (link.pred) {
      noteLogic(link.pred.id, "b", `Added successor ${link.succ ? link.succ.code : "external"}`, "add", r);
    }
  }
  for (const r of relRemoved) {
    const link = r.a!;
    if (link.succ) noteLogic(link.succ.id, "a", `Removed predecessor ${link.pred ? link.pred.code : "external"}`, "del", r);
    if (link.pred) noteLogic(link.pred.id, "a", `Removed successor ${link.succ ? link.succ.code : "external"}`, "del", r);
  }
  for (const r of relChanged) {
    const A = r.a!;
    const B = r.b!;
    const txt = (r.typeChanged ? `Type ${A.type}→${B.type} ` : "") + (r.lagChanged ? `Lag ${A.lag}d→${B.lag}d` : "");
    if (B.succ) noteLogic(B.succ.id, "b", `Predecessor ${B.pred ? B.pred.code : "ext"}: ${txt}`, "mod", r);
    if (B.pred) noteLogic(B.pred.id, "b", `Successor ${B.succ ? B.succ.code : "ext"}: ${txt}`, "mod", r);
  }
  for (const d of diffs) {
    if (d.logicChanges.length && !d.cats.includes("Logic network")) d.cats.push("Logic network");
  }

  /* ---------- WBS / calendars / resources ---------- */
  const wbsKey = (w: WbsNode) => w.path || w.name;
  const wa = new Map(PA.wbsAll.map((w) => [wbsKey(w), w]));
  const wb = new Map(PB.wbsAll.map((w) => [wbsKey(w), w]));
  const wbsDiff: Comparison["wbsDiff"] = { added: [], removed: [], changed: [] };
  for (const [k, w] of wa) {
    const other = wb.get(k);
    if (!other) wbsDiff.removed.push(w);
    else if (w.name !== other.name) wbsDiff.changed.push({ a: w, b: other });
  }
  for (const [k, w] of wb) if (!wa.has(k)) wbsDiff.added.push(w);

  const ca = new Map(PA.S.calList.map((c) => [c.name, c]));
  const cb = new Map(PB.S.calList.map((c) => [c.name, c]));
  const calDiff: Comparison["calDiff"] = { added: [], removed: [], changed: [] };
  for (const [k, c] of ca) {
    const other = cb.get(k);
    if (!other) {
      calDiff.removed.push(c);
      continue;
    }
    const s1 = c.summary();
    const s2 = other.summary();
    if (s1.days !== s2.days || Math.abs(s1.hours - s2.hours) > 0.01 || s1.exceptions !== s2.exceptions || c.dayHours !== other.dayHours) {
      calDiff.changed.push({ a: c, b: other, s1, s2 });
    }
  }
  for (const [k, c] of cb) if (!ca.has(k)) calDiff.added.push(c);

  const rollResources = (P: ProjectView) => {
    const map = new Map<string, { name: string; cost: number; qty: number; tasks: number }>();
    for (const t of P.tasks) {
      for (const r of t.rsrcs) {
        const name = (P.S.rsrcById[r.rsrc_id] || {}).rsrc_short_name || r.rsrc_id;
        const entry = map.get(name) || { name, cost: 0, qty: 0, tasks: 0 };
        entry.cost += num(r.target_cost);
        entry.qty += num(r.target_qty);
        entry.tasks++;
        map.set(name, entry);
      }
    }
    return map;
  };
  const ra = rollResources(PA);
  const rb = rollResources(PB);
  const rsrcDiff: ResourceDiff[] = [];
  for (const name of uniq(Array.from(ra.keys()).concat(Array.from(rb.keys())))) {
    const A = ra.get(name) || { cost: 0, qty: 0, tasks: 0 };
    const B = rb.get(name) || { cost: 0, qty: 0, tasks: 0 };
    if (A.cost !== B.cost || A.qty !== B.qty || A.tasks !== B.tasks) {
      rsrcDiff.push({
        name, a: A, b: B,
        costVar: B.cost - A.cost, qtyVar: B.qty - A.qty, taskVar: B.tasks - A.tasks,
        state: !ra.has(name) ? "added" : !rb.has(name) ? "removed" : "changed",
      });
    }
  }

  /* ---------- critical path movement ---------- */
  const lpA = new Set(PA.an!.longestPath.map(matchKey));
  const lpB = new Set(PB.an!.longestPath.map(matchKey));
  const critEntered = diffs.filter((d) => !d.critA && d.critB);
  const critLeft = diffs.filter((d) => d.critA && !d.critB);
  const lpEntered = PB.an!.longestPath.filter((t) => !lpA.has(matchKey(t)));
  const lpLeft = PA.an!.longestPath.filter((t) => !lpB.has(matchKey(t)));

  /* ---------- project level ---------- */
  const sa = PA.an!.stat;
  const sb = PB.an!.stat;
  const proj: ProjectRow[] = (
    [
      { l: "Project name", a: PA.longName, b: PB.longName, t: "text" },
      { l: "Data date", a: PA.dataDate, b: PB.dataDate, t: "date" },
      { l: "Project start", a: PA.start, b: PB.start, t: "date" },
      { l: "Project finish", a: PA.finish, b: PB.finish, t: "date" },
      { l: "Must-finish by", a: PA.mustFinish, b: PB.mustFinish, t: "date" },
      { l: "Calculated finish", a: PA.an!.calcFinish, b: PB.an!.calcFinish, t: "date" },
      { l: "Activities", a: sa.total, b: sb.total, t: "num" },
      { l: "Complete", a: sa.complete, b: sb.complete, t: "num" },
      { l: "In progress", a: sa.inProgress, b: sb.inProgress, t: "num" },
      { l: "Not started", a: sa.notStarted, b: sb.notStarted, t: "num" },
      { l: "Milestones", a: sa.milestones, b: sb.milestones, t: "num" },
      { l: "Relationships", a: sa.links, b: sb.links, t: "num" },
      { l: "Critical activities", a: sa.critical, b: sb.critical, t: "num" },
      { l: "Negative float activities", a: sa.negative, b: sb.negative, t: "num" },
      { l: "Longest path length", a: PA.an!.longestPath.length, b: PB.an!.longestPath.length, t: "num" },
      { l: "Overall % complete", a: Math.round(sa.pct * 10) / 10, b: Math.round(sb.pct * 10) / 10, t: "num", u: "%" },
      { l: "Budgeted cost", a: sa.budget, b: sb.budget, t: "money" },
      { l: "Actual cost", a: sa.actual, b: sb.actual, t: "money" },
      { l: "Remaining duration", a: Math.round(sa.remDur), b: Math.round(sb.remDur), t: "num", u: "d" },
      { l: "Open ends", a: PA.an!.openEnds.length, b: PB.an!.openEnds.length, t: "num" },
      { l: "Hard constraints", a: PA.an!.hardConstraints.length, b: PB.an!.hardConstraints.length, t: "num" },
      { l: "Out-of-sequence relationships", a: PA.an!.outOfSequence.length, b: PB.an!.outOfSequence.length, t: "num" },
      { l: "Health score", a: PA.an!.score, b: PB.an!.score, t: "num", u: "%" },
      { l: "Calendars", a: sa.calendars, b: sb.calendars, t: "num" },
      { l: "WBS nodes", a: sa.wbs, b: sb.wbs, t: "num" },
    ] as Omit<ProjectRow, "delta" | "changed">[]
  ).map((row) => {
    let delta: number | null = null;
    let changed = false;
    if (row.t === "date") {
      delta = dayDiff(row.a as Date, row.b as Date);
      changed = !!row.a !== !!row.b || (delta !== null && Math.abs(delta) > 0.01);
    } else if (row.t === "text") {
      changed = String(row.a || "") !== String(row.b || "");
    } else {
      delta = ((row.b as number) || 0) - ((row.a as number) || 0);
      changed = Math.abs(delta) > 1e-9;
    }
    return { ...row, delta, changed };
  });

  /* ---------- impact ranking ---------- */
  const impact = diffs
    .filter(
      (d) =>
        d.changes.some((c) => ["Duration", "Constraints", "Structure"].includes(c.cat)) || d.logicChanges.length > 0,
    )
    .map((d) => ({
      d,
      weight:
        Math.abs(d.finishVar || 0) +
        Math.abs(d.durVar || 0) * 2 +
        d.logicChanges.length * 3 +
        (d.critB ? 15 : 0) +
        (lpB.has(matchKey(d.b)) ? 25 : 0),
      onLP: lpB.has(matchKey(d.b)),
    }))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 300);

  /* ---------- headline numbers ---------- */
  const changedCount = diffs.filter((d) => d.changes.length || d.logicChanges.length).length;
  const totalUnion = Math.max(PA.tasks.length, PB.tasks.length) || 1;
  const matchRate = percent(matched.length, totalUnion);
  const fieldSlots = pairs.length * FIELDS.length || 1;
  const changedSlots = diffs.reduce((s, d) => s + d.changes.length, 0);
  const relTotal = Math.max(PA.links.length, PB.links.length) || 1;
  const similarity = Math.round(
    0.45 * matchRate +
      0.35 * (pairs.length ? (1 - changedSlots / fieldSlots) * 100 : 0) +
      0.2 * ((relSame.length / relTotal) * 100),
  );

  const bei = (() => {
    const dd = PB.dataDate;
    if (!dd) return null;
    const planned = PA.tasks.filter((t) => !t.isLOE && !t.isWBSsum && t.finish && t.finish <= dd).length;
    const actual = PB.tasks.filter((t) => !t.isLOE && !t.isWBSsum && t.actEnd && t.actEnd <= dd).length;
    return planned ? Math.round((actual / planned) * 100) / 100 : null;
  })();

  const missed = (() => {
    const dd = PB.dataDate;
    if (!dd) return [] as ActivityDiff[];
    return diffs.filter((d) => d.a.finish && d.a.finish <= dd && !(d.b.actEnd && d.b.actEnd <= dd));
  })();

  const finished = typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    key, PA, PB, matchKey,
    matched, added, removed, renames, diffs, unchanged, changedCount,
    diffByIdA, diffByIdB, catCount, fieldCount,
    rel: { added: relAdded, removed: relRemoved, changed: relChanged, same: relSame },
    wbsDiff, calDiff, rsrcDiff,
    crit: { entered: critEntered, left: critLeft, lpEntered, lpLeft },
    proj, impact,
    similarity: clamp(similarity, 0, 100),
    matchRate: Math.round(matchRate * 10) / 10,
    finishVar: dayDiff(PA.finish, PB.finish),
    dataDateVar: dayDiff(PA.dataDate, PB.dataDate),
    summaryCounts: {
      added: added.length, removed: removed.length, modified: changedCount,
      unchanged, renamed: renames.length,
      relAdded: relAdded.length, relRemoved: relRemoved.length, relChanged: relChanged.length,
    },
    bei, missed,
    ms: Math.round(finished - started),
  };
}
