/**
 * Analysis engine — CPM, longest path, float paths, out-of-sequence progress,
 * logic integrity and DCMA-style health checks.
 *
 * Everything here is a recalculation from the XER's own data. It is a shadow
 * calculation for review, not a substitute for a native Primavera P6 schedule
 * run: where the stored dates and the recalculated dates disagree, the
 * "Dates not consistent with a re-schedule" check reports it rather than
 * silently preferring one over the other.
 */

import { WorkCalendar, DEFAULT_CALENDAR, TWENTY_FOUR_HOUR_CALENDAR } from "./calendar";
import { dayDiff, formatDate, formatNum, groupBy, percent, sortBy, uid, uniq } from "./format";
import { HARD_CONSTRAINTS, type Computed, type Link, type ProjectView, type RelationshipKind, type Task, type WbsNode } from "./model";
import { analysisKey, type AnalyzerOptions } from "./options";

/* -------------------------------------------------------------- types */

export type CheckStatus = "pass" | "warn" | "fail" | "info";
export type CheckSeverity = "bad" | "warn" | "info";

export type CheckItem = Task | { link: Link; reason?: string } | { task: Task; days: number | null };

export type Check = {
  id: string;
  key: string;
  name: string;
  cat: string;
  sev: CheckSeverity;
  desc: string;
  items: CheckItem[];
  unit: string;
  info: string;
  count: number;
  total: number;
  pctv: number;
  status: CheckStatus;
};

export type FloatPath = {
  index: number;
  tasks: Task[];
  tf: number;
  start: Date | null;
  finish: Date | null;
};

export type StoredFloatPath = { index: number; tasks: Task[]; tf: number };

export type OutOfSequence = { link: Link; pred: Task; succ: Task; reason: string };

export type InvalidDate = { task: Task; why: string; sev: "bad" | "warn" };

export type CurvePoint = {
  k: number;
  date: Date;
  plan: number;
  act: number;
  fc: number;
  cumPlan: number;
  cumAct: number;
  cumFc: number;
};

export type DistributionBand = {
  label: string;
  value: number;
  tone: string;
  filter: (t: Task) => boolean;
};

export type WbsBreak = {
  label: string;
  name: string;
  value: number;
  pct: number;
  minTF: number | null;
  wbs: WbsNode;
};

export type Stats = {
  total: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  milestones: number;
  loe: number;
  links: number;
  linksInternal: number;
  external: number;
  critical: number;
  near: number;
  negative: number;
  budget: number;
  actual: number;
  remain: number;
  origDur: number;
  remDur: number;
  calendars: number;
  wbs: number;
  resources: number;
  pct: number;
  pctCount: number;
};

export type Analysis = {
  optsKey: string;
  order: Task[];
  inCycle: Task[];
  cycles: Task[][];
  calcStart: Date | null;
  calcFinish: Date | null;
  lateAnchor: Date | null;
  lateFromProjEnd: boolean;
  /** `sched_calendar_on_relationship_lag` actually applied to this run. */
  lagCalendarMode: string;
  /** Whether that mode was read from the file, inferred, or fell back. */
  lagCalendarSource: "file" | "inferred" | "default";
  storedFinish: Date | null;
  drift: {
    count: number;
    max: number;
    list: { task: Task; days: number | null }[];
    /** Activities P6 placed later / earlier than this recalculation. */
    later: number;
    earlier: number;
    /** Plain reading of what the drift pattern most likely means. */
    interpretation: string;
  };
  longestPath: Task[];
  longestPathEnd: Task | null;
  lpDuration: number | null;
  floatPaths: FloatPath[];
  storedFloatPaths: StoredFloatPath[];
  scopeTasks: Task[];
  noPred: Task[];
  noSucc: Task[];
  openEnds: Task[];
  danglingStart: Task[];
  danglingFinish: Task[];
  linksInternal: Link[];
  leads: Link[];
  lags: Link[];
  longLags: Link[];
  byRelType: { FS: number; SS: number; FF: number; SF: number };
  fsPct: number;
  redundant: Link[];
  duplicateLinks: Link[];
  constrained: Task[];
  hardConstraints: Task[];
  softConstraints: Task[];
  dupCodes: { code: string; list: Task[] }[];
  dupNames: { name: string; list: Task[] }[];
  outOfSequence: OutOfSequence[];
  oosTasks: Task[];
  invalidDates: InvalidDate[];
  invalidTasks: Task[];
  checks: Check[];
  score: number;
  failCount: number;
  warnCount: number;
  passCount: number;
  cpli?: number;
  stat: Stats;
  floatDist: DistributionBand[];
  durDist: DistributionBand[];
  curve: CurvePoint[];
  wbsBreak: WbsBreak[];
  ms: number;
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* ------------------------------------------------------------- entry */

/** Run (or reuse) the full analysis for one project view. */
export function analyze(P: ProjectView, opts: AnalyzerOptions): Analysis {
  const key = analysisKey(opts);
  if (P.an && P.an.optsKey === key) return P.an;

  const t0 = now();
  const an = { optsKey: key } as Analysis;
  P.an = an;

  topoSort(P, an);

  // Honour the file's own setting; infer it only when the file carries none.
  let lagOverride: string | undefined;
  if (P.schedOpt.calendarOnLag) {
    an.lagCalendarSource = "file";
  } else {
    const detected = detectLagMode(P, an, opts);
    lagOverride = detected || undefined;
    an.lagCalendarSource = detected ? "inferred" : "default";
  }

  computeCPM(P, an, opts, lagOverride);
  computeLongestPath(P, an);
  computeFloatPaths(P, an);
  logicIntegrity(P, an, opts);
  outOfSequence(P, an);
  runChecks(P, an, opts);
  buildStats(P, an, opts);

  an.ms = Math.round(now() - t0);
  return an;
}

/* ------------------------------------------------- lag-mode detection */

const LAG_MODES = ["rcal_Predecessor", "rcal_Successor", "rcal_24Hour", "rcal_Project"];

/**
 * Infer `sched_calendar_on_relationship_lag` for files that ship without a
 * SCHEDOPTIONS row.
 *
 * The setting materially moves every lagged cross-calendar link, so guessing
 * wrong is expensive. Rather than assume, run the forward pass under each
 * candidate and keep whichever best reproduces the finish dates P6 itself
 * stored in the file. On files that *do* declare the option this procedure
 * independently recovers the declared value, which is what makes it
 * trustworthy on the files that do not.
 *
 * Returns null when the file offers nothing to discriminate on.
 */
function detectLagMode(P: ProjectView, an: Analysis, opts: AnalyzerOptions): string | null {
  // Only lagged links that cross a calendar boundary can tell the modes apart.
  const discriminating = P.links.filter(
    (l) => l.lagHr !== 0 && l.pred && l.succ && l.pred.calId !== l.succ.calId,
  ).length;
  if (discriminating < 10) return null;

  let best: { mode: string; score: number } | null = null;
  for (const mode of LAG_MODES) {
    computeCPM(P, an, opts, mode, true);
    let sum = 0;
    let n = 0;
    for (const t of P.tasks) {
      if (t.done || !t.c.ef || !t.finish) continue;
      sum += Math.abs((+t.finish - +t.c.ef) / 86_400_000);
      n++;
    }
    if (!n) continue;
    const score = sum / n;
    if (!best || score < best.score) best = { mode, score };
  }
  return best ? best.mode : null;
}

/* -------------------------------------------------------------- topo */

function topoSort(P: ProjectView, an: Analysis): void {
  const indeg = new Map<string, number>();
  for (const t of P.tasks) indeg.set(t.id, t.preds.length);
  const queue = P.tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order: Task[] = [];
  let head = 0;
  while (head < queue.length) {
    const t = P.byId[queue[head++]];
    order.push(t);
    for (const l of t.succs) {
      const succ = l.succ!;
      const d = (indeg.get(succ.id) || 0) - 1;
      indeg.set(succ.id, d);
      if (d === 0) queue.push(succ.id);
    }
  }
  an.order = order;
  an.inCycle = P.tasks.filter((t) => (indeg.get(t.id) || 0) > 0);
  an.cycles = an.inCycle.length ? findCycles(an.inCycle) : [];
}

function findCycles(nodes: Task[]): Task[][] {
  const set = new Set(nodes.map((t) => t.id));
  const cycles: Task[][] = [];
  const state = new Map<string, number>();
  const stack: Task[] = [];

  function dfs(t: Task): void {
    state.set(t.id, 1);
    stack.push(t);
    for (const l of t.succs) {
      const s = l.succ!;
      if (!set.has(s.id)) continue;
      const st = state.get(s.id) || 0;
      if (st === 1) {
        const ix = stack.findIndex((x) => x.id === s.id);
        if (ix >= 0 && cycles.length < 40) cycles.push(stack.slice(ix).concat([s]));
      } else if (st === 0) {
        dfs(s);
      }
    }
    state.set(t.id, 2);
    stack.pop();
  }

  for (const t of nodes) if (!state.get(t.id)) dfs(t);
  return cycles;
}

/* --------------------------------------------------------------- CPM */

/** Two hours of slop when deciding whether a predecessor drove a date. */
const DRIVER_TOLERANCE_MS = 3600 * 1000 * 2;

/**
 * Remaining-work edits layered over the file for a what-if run, keyed by task
 * and relationship id. Anything not listed keeps the value the XER carries, so
 * an empty set reproduces the analysis run exactly.
 */
export type CpmOverrides = {
  /** Remaining duration in hours on the activity's own calendar. */
  rdHr?: Map<string, number>;
  /** Relationship lag in hours, traversed on the configured lag calendar. */
  lagHr?: Map<string, number>;
  relType?: Map<string, RelationshipKind>;
};

/** Where a pass reads and writes per-activity results. */
export type CpmStore = (t: Task) => Computed;

/**
 * How a pass treats driving relationships: `file` records them on the
 * activities and links themselves (the analysis run), `scratch` records them
 * only in the store, and `none` skips them for fast incremental what-if runs.
 */
export type DriverMode = "file" | "scratch" | "none";

/** Everything a CPM pass needs that stays fixed for one project view. */
export type CpmContext = {
  P: ProjectView;
  opts: AnalyzerOptions;
  dd: Date | null;
  startAnchor: Date;
  lagMode: string;
  lagCalendar: (link: Link, succ: Task) => WorkCalendar;
};

export type NetworkDates = {
  calcStart: Date | null;
  calcFinish: Date | null;
  lateAnchor: Date | null;
  lateFromProjEnd: boolean;
};

export function emptyComputed(): Computed {
  return { es: null, ef: null, ls: null, lf: null, tf: null, ff: null, drivers: [], driven: [] };
}

export function cpmContext(P: ProjectView, opts: AnalyzerOptions, lagMode: string): CpmContext {
  const dd = P.dataDate;
  /**
   * Which calendar relationship lag is measured on. P6 exposes this as
   * `sched_calendar_on_relationship_lag`; getting it wrong shifts every
   * lagged, cross-calendar link. P6's own default is the predecessor's
   * calendar, so that is the fallback when the option is absent.
   */
  const projectCal = P.S.calendars[P.proj.calId || ""] || P.S.calList[0] || DEFAULT_CALENDAR;
  const mode = lagMode.trim();
  const lagCalendar = (link: Link, succ: Task): WorkCalendar => {
    switch (mode) {
      case "rcal_Successor":
        return succ.cal;
      case "rcal_24Hour":
        return TWENTY_FOUR_HOUR_CALENDAR;
      case "rcal_Project":
        return projectCal;
      case "rcal_Predecessor":
      default:
        return link.pred ? link.pred.cal : succ.cal;
    }
  };
  return { P, opts, dd, startAnchor: dd || P.start || P.actualStart || new Date(), lagMode: mode, lagCalendar };
}

export function remainingHours(t: Task, ov?: CpmOverrides | null): number {
  if (t.done || t.isMile) return 0;
  const edited = ov && ov.rdHr ? ov.rdHr.get(t.id) : undefined;
  return edited === undefined ? t.rdHr : edited;
}

export function lagHours(l: Link, ov?: CpmOverrides | null): number {
  const edited = ov && ov.lagHr ? ov.lagHr.get(l.id) : undefined;
  return edited === undefined ? l.lagHr : edited;
}

export function relationshipType(l: Link, ov?: CpmOverrides | null): RelationshipKind {
  const edited = ov && ov.relType ? ov.relType.get(l.id) : undefined;
  return edited === undefined ? l.type : edited;
}

const shift = (cal: WorkCalendar, d: Date | null, hr: number) => (hr >= 0 ? cal.add(d, hr) : cal.sub(d, -hr));

/**
 * Forward-pass one activity from its predecessors' results in `get`.
 *
 * Exported so a what-if run can re-solve only the activities downstream of an
 * edit: every other activity keeps its previous result, and because this is
 * the same function the full pass uses, the partial result is identical to a
 * full recalculation.
 */
export function forwardActivity(
  ctx: CpmContext,
  t: Task,
  get: CpmStore,
  ov: CpmOverrides | null,
  drivers: DriverMode,
): void {
  const { dd, startAnchor, opts, lagCalendar } = ctx;
  const c = get(t);
  const cal = t.cal;
  const dur = remainingHours(t, ov);
  const candidates = drivers === "none" ? null : new Map<Link, { cand: Date; kind: "es" | "ef" }>();
  let esMax: Date | null = null;
  let efMax: Date | null = null;

  for (const l of t.preds) {
    const pc = get(l.pred!);
    if (!pc.ef && !pc.es) continue;
    const lagHr = lagHours(l, ov);
    const type = relationshipType(l, ov);
    // Lag is traversed on the configured lag calendar; the resulting moment
    // is then snapped onto the successor's own working time.
    const lagCal = lagCalendar(l, t);
    let cand: Date | null = null;
    let kind: "es" | "ef";
    if (type === "FS" && t.type === "TT_FinMile") {
      // A finish milestone carries a finish, not a start: P6 places it at the
      // predecessor's finish instant. Snapping it as a start would roll it
      // past the end of the shift onto the next working morning.
      cand = cal.normalizeFinish(shift(lagCal, pc.ef, lagHr));
      kind = "ef";
    } else if (type === "FS") {
      cand = cal.normalizeStart(shift(lagCal, pc.ef, lagHr));
      kind = "es";
    } else if (type === "SS" && t.type === "TT_FinMile") {
      cand = cal.normalizeFinish(shift(lagCal, pc.es, lagHr));
      kind = "ef";
    } else if (type === "SS") {
      cand = cal.normalizeStart(shift(lagCal, pc.es, lagHr));
      kind = "es";
    } else if (type === "FF") {
      cand = cal.normalizeFinish(shift(lagCal, pc.ef, lagHr));
      kind = "ef";
    } else {
      cand = cal.normalizeFinish(shift(lagCal, pc.es, lagHr));
      kind = "ef";
    }
    if (!cand) continue;
    if (kind === "es") {
      if (!esMax || cand > esMax) esMax = cand;
    } else if (!efMax || cand > efMax) {
      efMax = cand;
    }
    if (candidates) candidates.set(l, { cand, kind });
  }

  let es: Date | null;
  let ef: Date | null;

  if (t.done) {
    es = t.actStart || esMax || startAnchor;
    ef = t.actEnd || es;
  } else {
    const base = dd ? new Date(dd) : startAnchor;
    if (t.started) {
      // Remaining work resumes at the data date; retained logic can push it later.
      let rs: Date = base;
      if (opts.retainedLogic && esMax && esMax > rs) rs = esMax;
      if (efMax) {
        const back = cal.sub(efMax, dur);
        if (back && back > rs) rs = back;
      }
      rs = cal.normalizeStart(rs)!;
      es = t.actStart || rs;
      ef = dur > 0 ? cal.add(rs, dur) : rs;
      if (efMax && ef && ef < efMax) ef = efMax;
      c.remStart = rs;
      c.constrained = false;
    } else {
      let s: Date = esMax ? (esMax > base ? esMax : base) : base;
      let byConstraint = false;
      const applyStart = (ct: string, cdate: Date | null) => {
        if (!cdate) return;
        if (ct === "CS_MSO" || ct === "CS_MANDSTART") {
          s = new Date(cdate);
          byConstraint = true;
        } else if (ct === "CS_MSOA" && cdate > s) {
          s = new Date(cdate);
          byConstraint = true;
        }
      };
      applyStart(t.cstrType, t.cstrDate);
      applyStart(t.cstrType2, t.cstrDate2);
      s = cal.normalizeStart(s)!;
      es = s;
      ef = dur > 0 ? cal.add(s, dur) : s;
      if (efMax && ef && ef < efMax) {
        ef = efMax;
        es = dur > 0 ? cal.sub(ef, dur) : ef;
        byConstraint = false;
      }
      const applyFinish = (ct: string, cdate: Date | null) => {
        if (!cdate) return;
        if (ct === "CS_MEO" || ct === "CS_MANDFIN") {
          ef = cal.normalizeFinish(new Date(cdate));
          es = dur > 0 ? cal.sub(ef, dur) : ef;
          byConstraint = true;
        } else if (ct === "CS_MEOA" && ef && cdate > ef) {
          ef = cal.normalizeFinish(new Date(cdate));
          es = dur > 0 ? cal.sub(ef, dur) : ef;
          byConstraint = true;
        }
      };
      applyFinish(t.cstrType, t.cstrDate);
      applyFinish(t.cstrType2, t.cstrDate2);
      c.constrained = byConstraint;
    }
  }

  c.es = es;
  c.ef = ef;

  if (!candidates) return;
  // Record which relationship actually set the controlling date.
  for (const l of t.preds) {
    const hit = candidates.get(l);
    if (!hit) continue;
    const ref = hit.kind === "es" ? es : ef;
    if (ref && Math.abs(+hit.cand - +ref) < DRIVER_TOLERANCE_MS) {
      c.drivers.push(l);
      get(l.pred!).driven.push(l);
      if (drivers === "file") l.driving = true;
    } else if (drivers === "file") {
      l.driving = false;
    }
  }
}

/**
 * Forward pass, backward pass and free float over the whole network, reading
 * and writing through `get`. Returns null when only the forward pass was asked
 * for.
 */
export function solveNetwork(
  ctx: CpmContext,
  order: Task[],
  inCycle: Task[],
  get: CpmStore,
  ov: CpmOverrides | null,
  drivers: DriverMode,
  forwardOnly = false,
): NetworkDates | null {
  const { P, lagCalendar } = ctx;

  /* ---------- forward pass ---------- */
  for (const t of order) forwardActivity(ctx, t, get, ov, drivers);

  // Loop members keep their stored dates so the views stay usable.
  for (const t of inCycle) {
    const c = get(t);
    c.es = t.start;
    c.ef = t.finish;
    c.broken = true;
  }

  if (forwardOnly) return null;

  /* ---------- project finish ---------- */
  const finishes = P.tasks.filter((t) => get(t).ef).map((t) => +get(t).ef!);
  const calcFinish = finishes.length ? new Date(Math.max(...finishes)) : null;
  const starts = P.tasks.filter((t) => get(t).es).map((t) => +get(t).es!);
  const calcStart = starts.length ? new Date(Math.min(...starts)) : null;

  // P6 default: late dates run back from the latest early finish. The project
  // must-finish date is used instead only when the schedule option says so, or
  // when it is earlier and therefore binding.
  let lateAnchor = calcFinish;
  const useProjEnd = !!P.schedOpt.raw && P.schedOpt.raw.sched_use_project_end_date_for_float === "Y";
  if (P.mustFinish && calcFinish && (useProjEnd || P.mustFinish < calcFinish)) lateAnchor = P.mustFinish;

  /* ---------- backward pass ---------- */
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i];
    const c = get(t);
    const cal = t.cal;
    const dur = remainingHours(t, ov);
    let lf: Date | null = null;
    let ls: Date | null = null;

    for (const l of t.succs) {
      const sc = get(l.succ!);
      if (!sc.ls && !sc.lf) continue;
      const lagHr = lagHours(l, ov);
      const type = relationshipType(l, ov);
      const lagCal = lagCalendar(l, l.succ!);
      const back = (d: Date | null, hr: number) => (hr >= 0 ? lagCal.sub(d, hr) : lagCal.add(d, -hr));
      let cand: Date | null;
      let kind: "lf" | "ls";
      if (type === "FS") {
        cand = cal.normalizeFinish(back(sc.ls, lagHr));
        kind = "lf";
      } else if (type === "SS") {
        cand = cal.normalizeStart(back(sc.ls, lagHr));
        kind = "ls";
      } else if (type === "FF") {
        cand = cal.normalizeFinish(back(sc.lf, lagHr));
        kind = "lf";
      } else {
        cand = cal.normalizeStart(back(sc.lf, lagHr));
        kind = "ls";
      }
      if (!cand) continue;
      if (kind === "lf") {
        if (!lf || cand < lf) lf = cand;
      } else if (!ls || cand < ls) {
        ls = cand;
      }
    }

    if (!lf && !ls) lf = lateAnchor ? cal.normalizeFinish(new Date(lateAnchor)) : c.ef;
    if (lf && ls) {
      const alt = dur > 0 ? cal.add(ls, dur) : ls;
      if (alt && alt < lf) lf = alt;
    } else if (ls && !lf) {
      lf = dur > 0 ? cal.add(ls, dur) : ls;
    }

    const applyLate = (ct: string, cdate: Date | null) => {
      if (!cdate) return;
      if (ct === "CS_MEOB" || ct === "CS_MEO" || ct === "CS_MANDFIN") {
        if (!lf || cdate < lf || ct !== "CS_MEOB") lf = new Date(cdate);
      } else if (ct === "CS_MSOB" || ct === "CS_MSO" || ct === "CS_MANDSTART") {
        const shifted = cal.add(cdate, dur);
        if (shifted && (!lf || shifted < lf || ct !== "CS_MSOB")) lf = shifted;
      }
    };
    applyLate(t.cstrType, t.cstrDate);
    applyLate(t.cstrType2, t.cstrDate2);

    if (P.mustFinish && !t.succs.length && lf && lf > P.mustFinish) lf = cal.normalizeFinish(new Date(P.mustFinish));

    c.lf = lf;
    c.ls = lf ? (dur > 0 ? cal.sub(lf, dur) : new Date(lf)) : null;
    c.tf = t.done || !lf || !c.ef ? null : Math.round((cal.between(c.ef, lf) / (cal.dayHours || 8)) * 100) / 100;
  }

  /* ---------- free float ---------- */
  for (const t of P.tasks) {
    const c = get(t);
    const cal = t.cal;
    if (t.done) {
      c.ff = null;
      continue;
    }
    let ff: number | null = null;
    for (const l of t.succs) {
      const sc = get(l.succ!);
      if (!sc.es) continue;
      const lagHr = lagHours(l, ov);
      const type = relationshipType(l, ov);
      const lagCal = lagCalendar(l, l.succ!);
      const move = (d: Date | null, hr: number) => (hr >= 0 ? lagCal.add(d, hr) : lagCal.sub(d, -hr));
      let gap: number;
      if (type === "FS") gap = cal.between(cal.normalizeStart(move(c.ef, lagHr)), sc.es);
      else if (type === "FF") gap = cal.between(cal.normalizeFinish(move(c.ef, lagHr)), sc.ef);
      else if (type === "SS") gap = cal.between(cal.normalizeStart(move(c.es, lagHr)), sc.es);
      else gap = cal.between(cal.normalizeFinish(move(c.es, lagHr)), sc.ef);
      const days = Math.round((gap / (cal.dayHours || 8)) * 100) / 100;
      if (ff === null || days < ff) ff = days;
    }
    c.ff = ff === null ? c.tf : ff;
  }

  return { calcStart, calcFinish, lateAnchor, lateFromProjEnd: useProjEnd };
}

function computeCPM(
  P: ProjectView,
  an: Analysis,
  opts: AnalyzerOptions,
  lagModeOverride?: string,
  forwardOnly = false,
): void {
  for (const t of P.tasks) t.c = emptyComputed();

  const lagMode = (lagModeOverride || P.schedOpt.calendarOnLag || "rcal_Predecessor").trim();
  an.lagCalendarMode = lagMode;

  const ctx = cpmContext(P, opts, lagMode);
  const net = solveNetwork(ctx, an.order, an.inCycle, (t) => t.c, null, "file", forwardOnly);

  // Lag-mode detection only needs the forward pass.
  if (!net) return;

  an.calcFinish = net.calcFinish;
  an.calcStart = net.calcStart;
  an.lateAnchor = net.lateAnchor;
  an.lateFromProjEnd = net.lateFromProjEnd;

  /* ---------- stored vs recalculated drift ---------- */
  let count = 0;
  let max = 0;
  let considered = 0;
  const list: { task: Task; days: number | null }[] = [];
  for (const t of P.tasks) {
    if (t.done || !t.c.ef || !t.finish) continue;
    considered++;
    const delta = dayDiff(t.finish, t.c.ef);
    if (delta === null) continue;
    const abs = Math.abs(delta);
    if (abs > 1) {
      count++;
      list.push({ task: t, days: delta });
      if (abs > max) max = abs;
    }
  }
  // Which way the drift runs is more diagnostic than how much of it there is.
  // Scatter in both directions points at a calculation difference; drift that
  // runs almost entirely one way points at something holding activities back
  // that a logic-only CPM does not model.
  const later = list.filter((d) => (d.days || 0) < 0).length;
  const earlier = list.filter((d) => (d.days || 0) > 0).length;
  const resourceLoaded = P.tasks.filter((t) => t.rsrcs.length).length;
  // Only read a pattern into the drift once there is enough of it to be a
  // pattern. Two activities out of 1,200 is noise, not evidence of levelling.
  const material = count >= 10 && count >= considered * 0.01;
  let interpretation: string;
  if (!count) {
    interpretation = "The recalculation reproduces the stored dates.";
  } else if (!material) {
    interpretation =
      `${formatNum(count)} of ${formatNum(considered)} activities differ by more than a day — too few to read a ` +
      "pattern into. Treat them as individual items to check rather than a systematic difference.";
  } else if (later >= count * 0.95) {
    interpretation =
      "Almost every difference has P6 placing the activity later than a logic-only CPM would. That is the signature " +
      "of something holding work back that this engine does not model — most often resource levelling" +
      (resourceLoaded ? ` (${formatNum(resourceLoaded)} activities are resource loaded)` : "") +
      ", or a file edited after its last re-schedule. It is not evidence of a logic error.";
  } else if (earlier >= count * 0.95) {
    interpretation =
      "Almost every difference has P6 placing the activity earlier than a logic-only CPM would, which usually means " +
      "the stored dates predate the current logic — the file was most likely edited without being re-scheduled.";
  } else {
    interpretation =
      "Differences run in both directions, which usually means the recalculation and the stored dates were produced " +
      "under different scheduling options (progress override, calendar-on-lag, or external project links).";
  }

  an.drift = {
    count,
    max: Math.round(max * 10) / 10,
    list: list.sort((a, b) => Math.abs(b.days || 0) - Math.abs(a.days || 0)),
    later,
    earlier,
    interpretation,
  };
  an.storedFinish = P.finish;
}

/* ------------------------------------------------------- longest path */

function computeLongestPath(P: ProjectView, an: Analysis): void {
  for (const t of P.tasks) t.c.lp = false;

  // The latest-finishing incomplete activity; ties go to one with no successors.
  let end: Task | null = null;
  for (const t of P.tasks) {
    if (t.done || !t.c.ef) continue;
    if (!end) {
      end = t;
      continue;
    }
    if (t.c.ef > end.c.ef!) end = t;
    else if (+t.c.ef === +end.c.ef! && !t.succs.length && end.succs.length) end = t;
  }

  if (!end) {
    an.longestPath = [];
    an.longestPathEnd = null;
    an.lpDuration = 0;
    return;
  }

  const chain: Task[] = [];
  const seen = new Set<string>();
  (function back(t: Task | null, depth: number) {
    if (!t || seen.has(t.id) || depth > 5000) return;
    seen.add(t.id);
    t.c.lp = true;
    chain.push(t);
    let best: Link | null = null;
    for (const l of t.c.drivers) {
      const p = l.pred!;
      if (p.done) continue;
      if (!best || (p.c.ef && best.pred!.c.ef && p.c.ef > best.pred!.c.ef)) best = l;
    }
    if (best) back(best.pred, depth + 1);
  })(end, 0);
  chain.reverse();

  an.longestPath = chain;
  an.longestPathEnd = end;
  an.lpDuration = chain.length ? dayDiff(chain[0].c.es, end.c.ef) : 0;
}

/* --------------------------------------------------------- float paths */

function computeFloatPaths(P: ProjectView, an: Analysis, maxPaths = 12): void {
  const candidates = P.tasks.filter((t) => !t.done && t.c.tf !== null);
  const assigned = new Map<string, number>();
  const paths: FloatPath[] = [];
  const sorted = candidates.slice().sort((a, b) => a.c.tf! - b.c.tf! || +b.c.ef! - +a.c.ef!);

  for (const seed of sorted) {
    if (paths.length >= maxPaths) break;
    if (assigned.has(seed.id)) continue;

    const chain: Task[] = [];
    const seen = new Set<string>();

    // Walk back along the driving relationships…
    (function back(t: Task | null, depth: number) {
      if (!t || seen.has(t.id) || assigned.has(t.id) || depth > 4000) return;
      seen.add(t.id);
      chain.push(t);
      let best: Link | null = null;
      for (const l of t.c.drivers) {
        const p = l.pred!;
        if (p.done || assigned.has(p.id)) continue;
        if (!best || p.c.tf! < best.pred!.c.tf!) best = l;
      }
      if (best) back(best.pred, depth + 1);
    })(seed, 0);
    chain.reverse();

    // …then forward along the relationships this seed drives.
    (function forward(t: Task | null, depth: number) {
      if (!t || depth > 4000) return;
      let best: Link | null = null;
      for (const l of t.c.driven) {
        const s = l.succ!;
        if (s.done || assigned.has(s.id) || seen.has(s.id)) continue;
        if (!best || s.c.tf! < best.succ!.c.tf!) best = l;
      }
      if (best) {
        seen.add(best.succ!.id);
        chain.push(best.succ!);
        forward(best.succ, depth + 1);
      }
    })(seed, 0);

    if (!chain.length) continue;
    const index = paths.length + 1;
    for (const t of chain) {
      assigned.set(t.id, index);
      t.c.fp = index;
    }
    const tf = chain.reduce((m, t) => Math.min(m, t.c.tf!), 1e9);
    paths.push({
      index,
      tasks: chain,
      tf: Math.round(tf * 100) / 100,
      start: chain.reduce<Date | null>((m, t) => (!t.c.es ? m : !m || t.c.es < m ? t.c.es : m), null),
      finish: chain.reduce<Date | null>((m, t) => (!t.c.ef ? m : !m || t.c.ef > m ? t.c.ef : m), null),
    });
  }
  an.floatPaths = paths;

  // P6-stored float paths, when the file carries a multiple-float-path run.
  const stored = groupBy(P.tasks.filter((t) => t.floatPath !== null), (t) => t.floatPath!);
  an.storedFloatPaths = Array.from(stored.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 30)
    .map(([index, list]) => ({
      index,
      tasks: sortBy(list, (t) => (t.floatPathOrder === null ? 9e9 : t.floatPathOrder)),
      tf: list.reduce((m, t) => (t.tf === null ? m : Math.min(m, t.tf)), 1e9),
    }));
}

/* ----------------------------------------------------- logic integrity */

function logicIntegrity(P: ProjectView, an: Analysis, opts: AnalyzerOptions): void {
  const inScope = (t: Task) => (opts.ignoreLOE ? !(t.isLOE || t.isWBSsum) : true);
  const scope = P.tasks.filter(inScope);

  an.scopeTasks = scope;
  an.noPred = scope.filter((t) => t.preds.length === 0 && t.extPreds.length === 0);
  an.noSucc = scope.filter((t) => t.succs.length === 0 && t.extSuccs.length === 0);
  an.openEnds = uniq(an.noPred.concat(an.noSucc));

  // Dangling: the start is not tied by an FS/SS predecessor, or the finish is
  // not tied by an FS/FF successor.
  an.danglingStart = scope.filter((t) => t.preds.length && !t.preds.some((l) => l.type === "FS" || l.type === "SS"));
  an.danglingFinish = scope.filter((t) => t.succs.length && !t.succs.some((l) => l.type === "FS" || l.type === "FF"));

  const links = P.links.filter((l) => l.pred && l.succ);
  an.linksInternal = links;
  an.leads = links.filter((l) => l.lagHr < 0);
  an.lags = links.filter((l) => l.lagHr > 0);
  an.longLags = links.filter((l) => l.lag > opts.longLag);
  an.byRelType = {
    FS: links.filter((l) => l.type === "FS").length,
    SS: links.filter((l) => l.type === "SS").length,
    FF: links.filter((l) => l.type === "FF").length,
    SF: links.filter((l) => l.type === "SF").length,
  };
  an.fsPct = links.length ? (an.byRelType.FS / links.length) * 100 : 0;

  // Redundant: a direct zero-lag FS link that a longer path already implies.
  an.redundant = [];
  if (links.length <= 25000) {
    const adj = new Map<string, string[]>();
    for (const l of links) {
      const bucket = adj.get(l.predId);
      if (bucket) bucket.push(l.succId);
      else adj.set(l.predId, [l.succId]);
    }
    let budget = 400_000;
    for (const l of links) {
      if (l.type !== "FS" || l.lagHr !== 0) continue;
      if (budget <= 0) break;
      const target = l.succId;
      const stack = (adj.get(l.predId) || []).filter((x) => x !== target);
      const seen = new Set(stack);
      let found = false;
      let steps = 0;
      while (stack.length && steps < 400) {
        steps++;
        budget--;
        const cur = stack.pop()!;
        if (cur === target) {
          found = true;
          break;
        }
        for (const next of adj.get(cur) || []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      if (found) an.redundant.push(l);
      if (an.redundant.length > 800) break;
    }
  }
  an.duplicateLinks = P.duplicateLinks;

  an.constrained = P.tasks.filter((t) => t.cstrType || t.cstrType2);
  an.hardConstraints = P.tasks.filter(
    (t) => HARD_CONSTRAINTS.includes(t.cstrType) || HARD_CONSTRAINTS.includes(t.cstrType2),
  );
  const hardSet = new Set(an.hardConstraints);
  an.softConstraints = an.constrained.filter((t) => !hardSet.has(t));

  an.dupCodes = [];
  for (const [code, list] of P.byCode) if (list.length > 1) an.dupCodes.push({ code, list });
  const nameMap = groupBy(P.tasks, (t) => t.name.trim().toLowerCase());
  an.dupNames = Array.from(nameMap.entries())
    .filter(([k, v]) => k && v.length > 1)
    .map(([, v]) => ({ name: v[0].name, list: v }));
}

/* ----------------------------------------------------- out of sequence */

function outOfSequence(P: ProjectView, an: Analysis): void {
  const dd = P.dataDate;
  const oos: OutOfSequence[] = [];
  const shiftBy = (cal: WorkCalendar, d: Date | null, hr: number) =>
    !d ? null : hr >= 0 ? cal.add(d, hr) : cal.sub(d, -hr);

  for (const l of P.links) {
    if (!l.pred || !l.succ) continue;
    const p = l.pred;
    const s = l.succ;
    const cal = s.cal;
    // The earliest the successor was allowed to start/finish, lag included.
    const fromEnd = shiftBy(cal, p.actEnd, l.lagHr);
    const fromStart = shiftBy(cal, p.actStart, l.lagHr);
    let reason: string | null = null;

    if (l.type === "FS") {
      if (s.actStart) {
        if (!p.actStart) reason = "Successor started before the predecessor started at all";
        else if (!p.actEnd) reason = "Successor started while the predecessor is still in progress";
        else if (fromEnd && s.actStart < fromEnd) {
          const days = cal.between(s.actStart, fromEnd) / (cal.dayHours || 8);
          reason = `Successor started ${formatNum(days, 1)} d before the predecessor finished${l.lag ? " (allowing for the lag)" : ""}`;
        }
      }
      if (!reason && s.done && !p.done) reason = "Successor is complete while the predecessor is not";
    } else if (l.type === "SS") {
      if (s.actStart && (!p.actStart || (fromStart && s.actStart < fromStart))) {
        reason = "Successor started before the predecessor started";
      }
    } else if (l.type === "FF") {
      if (s.actEnd && (!p.actEnd || (fromEnd && s.actEnd < fromEnd))) {
        reason = "Successor finished before the predecessor finished";
      }
    } else if (l.type === "SF") {
      if (s.actEnd && (!p.actStart || (fromStart && s.actEnd < fromStart))) {
        reason = "Successor finished before the predecessor started";
      }
    }
    if (reason) oos.push({ link: l, pred: p, succ: s, reason });
  }

  an.outOfSequence = oos;
  an.oosTasks = uniq(oos.map((o) => o.succ));

  /* ---------- invalid / suspicious dates ---------- */
  const invalid: InvalidDate[] = [];
  const add = (task: Task, why: string, sev: "bad" | "warn" = "bad") => invalid.push({ task, why, sev });

  for (const t of P.tasks) {
    if (dd) {
      if (t.actStart && t.actStart > dd) add(t, "Actual start is after the data date");
      if (t.actEnd && t.actEnd > dd) add(t, "Actual finish is after the data date");
      if (!t.done && t.finish && t.finish < dd) add(t, "Incomplete activity forecast to finish before the data date");
      if (!t.started && t.start && t.start < dd) add(t, "Not-started activity scheduled to start before the data date");
      if (t.done && t.actEnd === null) add(t, "Marked complete without an actual finish date");
    }
    if (t.started && !t.actStart) add(t, "Progressed without an actual start date");
    if (t.done && !t.actStart) add(t, "Complete without an actual start date");
    if (!t.started && (t.actStart || t.actEnd)) add(t, "Not started but carries actual dates");
    if (!t.done && t.actEnd) add(t, "Actual finish present but activity is not marked complete");
    if (t.actStart && t.actEnd && t.actEnd < t.actStart) add(t, "Actual finish is before actual start");
    if (t.start && t.finish && t.finish < t.start) add(t, "Finish is before start");
    if (!t.started && t.pct > 0) add(t, "% complete > 0 but the activity has not started", "warn");
    if (t.done && t.rdHr > 0) add(t, "Complete but remaining duration is not zero", "warn");
    if (!t.done && t.rdHr === 0 && t.odHr > 0 && t.started) add(t, "Remaining duration is zero but not complete", "warn");
    if (t.expectEnd) add(t, "Has an expected finish date set", "warn");
    if (t.suspend && !t.resume) add(t, "Suspended without a resume date", "warn");
  }

  an.invalidDates = invalid;
  an.invalidTasks = uniq(invalid.filter((i) => i.sev === "bad").map((i) => i.task));
}

/* ------------------------------------------------------------ checks */

type CheckSpec = {
  key: string;
  name: string;
  cat: string;
  sev: CheckSeverity;
  desc: string;
  items: CheckItem[];
  unit?: string;
  info?: string;
  count?: number;
  total?: number;
  pctv?: number;
  test?: (check: { count: number; total: number; pctv: number; sev: CheckSeverity }) => CheckStatus;
};

function runChecks(P: ProjectView, an: Analysis, opts: AnalyzerOptions): void {
  const scope = an.scopeTasks;
  const links = an.linksInternal;
  const incomplete = P.tasks.filter((t) => !t.done);
  const N = scope.length || 1;
  const L = links.length || 1;
  const checks: Check[] = [];

  const push = (spec: CheckSpec): void => {
    const count = spec.count !== undefined ? spec.count : spec.items.length;
    const total = spec.total !== undefined ? spec.total : N;
    const pctv = spec.pctv !== undefined ? spec.pctv : total ? (count / total) * 100 : 0;
    const base = { count, total, pctv, sev: spec.sev };
    const status: CheckStatus = spec.test
      ? spec.test(base)
      : count === 0
        ? "pass"
        : spec.sev === "info"
          ? "info"
          : "fail";
    checks.push({
      id: uid(),
      key: spec.key,
      name: spec.name,
      cat: spec.cat,
      sev: spec.sev,
      desc: spec.desc,
      items: spec.items,
      unit: spec.unit || "activities",
      info: spec.info || "",
      count,
      total,
      pctv,
      status,
    });
  };

  /* ---- DCMA 14-point and related checks ---- */
  push({
    key: "logic", name: "Missing predecessors", cat: "DCMA 1 · Logic", sev: "bad",
    desc: "Activities with no predecessor (open start). Target ≤ 5%.",
    items: an.noPred, test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 10 ? "warn" : "fail"),
  });
  push({
    key: "logic2", name: "Missing successors", cat: "DCMA 1 · Logic", sev: "bad",
    desc: "Activities with no successor (open finish). Target ≤ 5%.",
    items: an.noSucc, test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 10 ? "warn" : "fail"),
  });
  push({
    key: "leads", name: "Leads (negative lag)", cat: "DCMA 2 · Leads", sev: "bad", unit: "relationships",
    desc: "Negative lag compresses logic and hides true drivers. Target = 0.",
    items: an.leads.map((link) => ({ link })), total: L, test: (x) => (x.count === 0 ? "pass" : "fail"),
  });
  push({
    key: "lags", name: "Lags", cat: "DCMA 3 · Lags", sev: "warn", unit: "relationships",
    desc: "Relationships carrying positive lag. Target ≤ 5% of relationships.",
    items: an.lags.map((link) => ({ link })), total: L,
    test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 10 ? "warn" : "fail"),
  });
  push({
    key: "longlag", name: `Lag longer than ${opts.longLag} days`, cat: "DCMA 3 · Lags", sev: "warn", unit: "relationships",
    desc: "Long lags usually hide missing scope or should be modelled as activities.",
    items: an.longLags.map((link) => ({ link })), total: L, test: (x) => (x.count === 0 ? "pass" : "warn"),
  });
  push({
    key: "fs", name: "Finish-Start relationships", cat: "DCMA 4 · Relationship types", sev: "warn", unit: "relationships",
    desc: "FS should dominate the network. Target ≥ 90% FS.",
    count: an.byRelType.FS, total: L, pctv: an.fsPct,
    items: links.filter((l) => l.type !== "FS").map((link) => ({ link })),
    test: (x) => (x.pctv >= 90 ? "pass" : x.pctv >= 75 ? "warn" : "fail"),
    info: `SS ${an.byRelType.SS} · FF ${an.byRelType.FF} · SF ${an.byRelType.SF}`,
  });
  push({
    key: "hard", name: "Hard constraints", cat: "DCMA 5 · Constraints", sev: "bad",
    desc: "Mandatory Start/Finish and Start On/Finish On override logic. Target ≤ 5%.",
    items: an.hardConstraints, test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 10 ? "warn" : "fail"),
  });
  push({
    key: "soft", name: "Soft constraints", cat: "DCMA 5 · Constraints", sev: "info",
    desc: "Start/Finish On or After/Before constraints — review each for justification.",
    items: an.softConstraints, test: (x) => (x.count === 0 ? "pass" : "info"),
  });
  push({
    key: "hifloat", name: `High float (> ${opts.highFloat} d)`, cat: "DCMA 6 · High float", sev: "warn",
    desc: "Excess float usually means missing successors or broken logic. Target ≤ 5%.",
    items: incomplete.filter((t) => t.tf !== null && t.tf > opts.highFloat), total: incomplete.length || 1,
    test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 15 ? "warn" : "fail"),
  });
  push({
    key: "negfloat", name: "Negative float", cat: "DCMA 7 · Negative float", sev: "bad",
    desc: "Any negative float means the plan cannot meet a date. Target = 0.",
    items: incomplete.filter((t) => t.tf !== null && t.tf < 0), total: incomplete.length || 1,
    test: (x) => (x.count === 0 ? "pass" : "fail"),
  });
  push({
    key: "hidur", name: `High duration (> ${opts.highDuration} d)`, cat: "DCMA 8 · High duration", sev: "warn",
    desc: "Long remaining durations reduce visibility. Target ≤ 5% of incomplete work.",
    items: incomplete.filter((t) => !t.isMile && !t.isLOE && t.rd > opts.highDuration), total: incomplete.length || 1,
    test: (x) => (x.pctv <= 5 ? "pass" : x.pctv <= 15 ? "warn" : "fail"),
  });
  push({
    key: "invalid", name: "Invalid dates", cat: "DCMA 9 · Invalid dates", sev: "bad",
    desc: "Actuals in the future, forecasts in the past, or contradictory status.",
    items: an.invalidTasks, test: (x) => (x.count === 0 ? "pass" : "fail"),
  });
  push({
    key: "resource", name: "Activities without resources or cost", cat: "DCMA 10 · Resources", sev: "info",
    desc: "Only meaningful for resource/cost-loaded schedules.",
    items: P.tasks.filter((t) => !t.isMile && !t.isLOE && !t.rsrcs.length && !t.budget),
    test: (x) => (x.pctv <= 5 ? "pass" : "info"),
  });
  push({
    key: "oos", name: "Out-of-sequence progress", cat: "Logic quality", sev: "bad", unit: "relationships",
    desc: "Work performed against the sequence in the network — logic no longer reflects execution.",
    items: an.outOfSequence.map((x) => ({ link: x.link, reason: x.reason })), total: L,
    test: (x) => (x.count === 0 ? "pass" : x.pctv <= 2 ? "warn" : "fail"),
  });
  push({
    key: "cycle", name: "Circular logic (loops)", cat: "Logic quality", sev: "bad",
    desc: "A closed loop makes the network unschedulable — P6 refuses to level it.",
    items: an.inCycle, test: (x) => (x.count === 0 ? "pass" : "fail"),
  });
  push({
    key: "dangleS", name: "Dangling starts (no FS/SS predecessor)", cat: "Logic quality", sev: "warn",
    desc: "The start of the activity is not driven by anything.",
    items: an.danglingStart, test: (x) => (x.pctv <= 5 ? "pass" : "warn"),
  });
  push({
    key: "dangleF", name: "Dangling finishes (no FS/FF successor)", cat: "Logic quality", sev: "warn",
    desc: "Nothing is driven by the finish of the activity.",
    items: an.danglingFinish, test: (x) => (x.pctv <= 5 ? "pass" : "warn"),
  });
  push({
    key: "redundant", name: "Redundant relationships", cat: "Logic quality", sev: "info", unit: "relationships",
    desc: "A direct FS link duplicated by a longer path through the network.",
    items: an.redundant.map((link) => ({ link })), total: L, test: (x) => (x.count === 0 ? "pass" : "info"),
  });
  push({
    key: "duplink", name: "Duplicate relationships", cat: "Logic quality", sev: "warn", unit: "relationships",
    desc: "The same predecessor/successor pair linked more than once.",
    items: an.duplicateLinks.map((link) => ({ link })), total: L, test: (x) => (x.count === 0 ? "pass" : "warn"),
  });
  push({
    key: "zerodur", name: "Zero-duration activities that are not milestones", cat: "Data quality", sev: "warn",
    desc: "Usually mis-typed milestones.",
    items: P.tasks.filter((t) => !t.isMile && !t.isLOE && t.odHr === 0), test: (x) => (x.count === 0 ? "pass" : "warn"),
  });
  push({
    key: "dupcode", name: "Duplicate activity IDs", cat: "Data quality", sev: "bad",
    desc: "Activity IDs must be unique — duplicates break comparison and tracking.",
    items: an.dupCodes.flatMap((d) => d.list), test: (x) => (x.count === 0 ? "pass" : "fail"),
  });
  push({
    key: "dupname", name: "Duplicate activity names", cat: "Data quality", sev: "info",
    desc: "Identical descriptions make reporting ambiguous.",
    items: an.dupNames.flatMap((d) => d.list), test: (x) => (x.pctv <= 5 ? "pass" : "info"),
  });
  push({
    key: "loe", name: "Level of Effort / WBS summary activities", cat: "Data quality", sev: "info",
    desc: "Hammocks are excluded from logic checks but inflate activity counts.",
    items: P.tasks.filter((t) => t.isLOE || t.isWBSsum), test: (x) => (x.count === 0 ? "pass" : "info"),
  });
  push({
    key: "nocal", name: "Activities on the default calendar", cat: "Data quality", sev: "info",
    desc: "Check that calendar assignment is deliberate.",
    items: P.tasks.filter((t) => t.cal && t.cal.isDefault), test: () => "info",
  });
  push({
    key: "stale", name: "Dates not consistent with a re-schedule", cat: "Data quality", sev: "warn",
    desc:
      "Stored early dates differ from a recalculated CPM by more than 1 day — the file may not have been re-scheduled " +
      "after the last edit (or uses settings this engine cannot read).",
    items: an.drift.list.map((d) => ({ task: d.task, days: d.days })), total: incomplete.length || 1,
    test: (x) => (x.pctv <= 2 ? "pass" : x.pctv <= 10 ? "warn" : "fail"),
    info: an.drift.count
      ? `max ${an.drift.max}d · P6 later on ${formatNum(an.drift.later)}, earlier on ${formatNum(an.drift.earlier)}`
      : "recalculation reproduces the stored dates",
  });
  push({
    key: "nofloat", name: "Activities with no total float value", cat: "Data quality", sev: "info",
    desc: "Float is blank — the schedule was probably never calculated.",
    items: incomplete.filter((t) => t.tf === null), total: incomplete.length || 1,
    test: (x) => (x.count === 0 ? "pass" : "warn"),
  });

  /* ---- critical path presence (DCMA 12) and CPLI (DCMA 13) ---- */
  const criticalItems = incomplete.filter((t) => t.tf !== null && t.tf <= opts.tfCritical);
  push({
    key: "critpath", name: "Critical path present and continuous", cat: "DCMA 12 · Critical path", sev: "bad",
    desc: "A continuous driving chain must run from the data date to project completion.",
    count: criticalItems.length, total: incomplete.length || 1, items: criticalItems,
    info: `Longest path holds ${an.longestPath.length} activities`,
    test: (x) => (x.count === 0 ? "fail" : an.longestPath.length > 1 ? "pass" : "warn"),
  });

  if (P.mustFinish && an.calcFinish) {
    const total = dayDiff(P.dataDate || an.calcStart, an.calcFinish) || 1;
    const cpli = (total + (dayDiff(an.calcFinish, P.mustFinish) || 0)) / total;
    an.cpli = Math.round(cpli * 100) / 100;
    push({
      key: "cpli", name: "CPLI (critical path length index)", cat: "DCMA 13 · CPLI", sev: "warn",
      desc: "(Critical path length + project total float) ÷ critical path length. Target ≥ 0.95.",
      count: an.cpli, total: 1, pctv: an.cpli * 100, items: [], unit: "ratio",
      test: () => (an.cpli! >= 0.95 ? "pass" : an.cpli! >= 0.9 ? "warn" : "fail"),
      info: `must-finish ${formatDate(P.mustFinish)}`,
    });
  }

  an.checks = checks;
  an.score = (() => {
    let scored = 0;
    let weightSum = 0;
    for (const c of checks) {
      if (c.status === "info") continue;
      const weight = c.sev === "bad" ? 3 : c.sev === "warn" ? 2 : 1;
      weightSum += weight;
      scored += weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0);
    }
    return weightSum ? Math.round((scored / weightSum) * 100) : 100;
  })();
  an.failCount = checks.filter((c) => c.status === "fail").length;
  an.warnCount = checks.filter((c) => c.status === "warn").length;
  an.passCount = checks.filter((c) => c.status === "pass").length;
}

/* ------------------------------------------------------------- stats */

function buildStats(P: ProjectView, an: Analysis, opts: AnalyzerOptions): void {
  const tasks = P.tasks;
  const incomplete = tasks.filter((t) => !t.done);
  const odSum = Math.max(1, tasks.reduce((s, t) => s + (t.odHr || 1), 0));

  const stat: Stats = {
    total: tasks.length,
    notStarted: tasks.filter((t) => !t.started).length,
    inProgress: tasks.filter((t) => t.started && !t.done).length,
    complete: tasks.filter((t) => t.done).length,
    milestones: tasks.filter((t) => t.isMile).length,
    loe: tasks.filter((t) => t.isLOE || t.isWBSsum).length,
    links: P.links.length,
    linksInternal: an.linksInternal.length,
    external: P.links.filter((l) => l.external).length,
    critical: incomplete.filter((t) => t.tf !== null && t.tf <= opts.tfCritical).length,
    near: incomplete.filter((t) => t.tf !== null && t.tf > opts.tfCritical && t.tf <= opts.tfNear).length,
    negative: incomplete.filter((t) => t.tf !== null && t.tf < 0).length,
    budget: tasks.reduce((s, t) => s + t.budget, 0),
    actual: tasks.reduce((s, t) => s + t.actualCost, 0),
    remain: tasks.reduce((s, t) => s + t.remainCost, 0),
    origDur: tasks.reduce((s, t) => s + t.od, 0),
    remDur: incomplete.reduce((s, t) => s + t.rd, 0),
    calendars: P.S.calList.length,
    wbs: P.wbsAll.length,
    resources: new Set(tasks.flatMap((t) => t.rsrcs.map((r) => r.rsrc_id))).size,
    pct: 0,
    pctCount: 0,
  };
  stat.pct = stat.total ? tasks.reduce((s, t) => s + t.pct * (t.odHr || 1), 0) / odSum : 0;
  stat.pctCount = percent(stat.complete, stat.total);
  an.stat = stat;

  const floatBands: { label: string; tone: string; test: (t: Task) => boolean }[] = [
    { label: "< 0", tone: "bad", test: (t) => t.tf! < 0 },
    { label: "0", tone: "crit", test: (t) => t.tf === 0 },
    { label: "1–10", tone: "warn", test: (t) => t.tf! > 0 && t.tf! <= 10 },
    { label: "11–20", tone: "gold", test: (t) => t.tf! > 10 && t.tf! <= 20 },
    { label: "21–44", tone: "blue", test: (t) => t.tf! > 20 && t.tf! <= 44 },
    { label: "> 44", tone: "violet", test: (t) => t.tf! > 44 },
  ];
  an.floatDist = floatBands.map((band) => ({
    label: band.label,
    tone: band.tone,
    value: incomplete.filter((t) => t.tf !== null && band.test(t)).length,
    filter: (t: Task) => !t.done && t.tf !== null && band.test(t),
  }));

  const durationBands: [number, number, string][] = [
    [0, 0, "Milestone / 0d"],
    [0.01, 5, "1–5 d"],
    [5, 10, "6–10 d"],
    [10, 20, "11–20 d"],
    [20, 44, "21–44 d"],
    [44, 1e9, "> 44 d"],
  ];
  an.durDist = durationBands.map(([lo, hi, label]) => {
    const test = (t: Task) => (lo === 0 && hi === 0 ? t.od === 0 : t.od > lo && t.od <= hi);
    return { label, tone: "blue", value: tasks.filter(test).length, filter: test };
  });

  an.curve = buildCurve(P);

  const level2 = P.wbsRoots[0] ? P.wbsRoots[0].children : [];
  an.wbsBreak = (level2.length ? level2 : P.wbsRoots).map((w) => ({
    label: w.code || w.name,
    name: w.name,
    value: (w.allTasks || []).length,
    pct: w.stat ? w.stat.pct : 0,
    minTF: w.stat ? w.stat.minTF : null,
    wbs: w,
  }));
}

function buildCurve(P: ProjectView): CurvePoint[] {
  const points = new Map<number, CurvePoint>();
  const add = (date: Date, key: "plan" | "act" | "fc") => {
    const k = date.getFullYear() * 100 + date.getMonth();
    let point = points.get(k);
    if (!point) {
      point = {
        k, date: new Date(date.getFullYear(), date.getMonth(), 1),
        plan: 0, act: 0, fc: 0, cumPlan: 0, cumAct: 0, cumFc: 0,
      };
      points.set(k, point);
    }
    point[key]++;
  };

  for (const t of P.tasks) {
    if (t.isLOE || t.isWBSsum) continue;
    if (t.targetEnd) add(t.targetEnd, "plan");
    if (t.actEnd) add(t.actEnd, "act");
    else if (t.finish) add(t.finish, "fc");
  }

  const series = Array.from(points.values()).sort((a, b) => a.k - b.k);
  let cumPlan = 0;
  let cumAct = 0;
  let cumFc = 0;
  for (const point of series) {
    point.cumPlan = cumPlan += point.plan;
    point.cumAct = cumAct += point.act;
    point.cumFc = cumFc += point.act + point.fc;
  }
  return series;
}

/** Convenience predicate used by views and the comparison engine. */
export function isCritical(t: Task, opts: AnalyzerOptions): boolean {
  return t.tf !== null && t.tf <= opts.tfCritical;
}

export { DEFAULT_CALENDAR };
