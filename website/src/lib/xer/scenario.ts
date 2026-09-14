/**
 * Scenario engine — Mitigation, Recovery and Revised programme on one pipeline.
 *
 * All three objectives run the same machinery over the same loaded schedule:
 * trace what drives the measured finish, propose interventions on exactly those
 * activities and relationships, solve every proposal with the analysis CPM
 * (calendars, lag calendar, constraints, progress — the calculation that
 * reproduces P6's stored finish), keep the best, and repeat. The objective only
 * sets the default controls; every control stays editable.
 *
 * Nothing here edits the file. A scenario is a set of edits layered over the
 * XER, and its dates are a Draft / Conditional shadow calculation until the
 * same edits are made and rescheduled in native Primavera P6.
 */

import {
  cpmContext, emptyComputed, forwardActivity, solveNetwork,
  type Analysis, type CpmContext, type CpmOverrides, type CpmStore,
} from "./analysis";
import { DAY } from "./format";
import type { Computed, Link, ProjectView, RelationshipKind, Task } from "./model";
import type { AnalyzerOptions } from "./options";

/* -------------------------------------------------------------- types */

export type ScenarioObjective = "mitigation" | "recovery" | "revised";

export type ScenarioActionType =
  | "ADD_SETS" | "EXTENDED_HOURS" | "COMPRESSION" | "LAG_REDUCTION" | "FAST_TRACK" | "RE_ESTIMATE";

export type Risk = "low" | "medium" | "high";

/** Productivity basis for one activity, resolved from the planning library and the activity mapping. */
export type TaskProductivity = {
  taskId: string;
  libraryCode: string;
  libraryName: string;
  uom: string;
  /** Remaining work quantity. */
  quantity: number;
  quantitySource: string;
  /** Output of one resource set (crews + equipment) per working day. */
  setDailyProduction: number;
  /** Cost of one set per working day; 0 when the library carries no rate. */
  setCostPerDay: number;
  /** Sets the programme currently assumes. */
  currentSets: number;
  /** Workface limit — the most sets the activity can physically take. */
  maxSets: number;
  /** Current sets were entered by the user, not derived from the file's duration. */
  setsConfirmed: boolean;
};

export type ScenarioControls = {
  objective: ScenarioObjective;
  /** Activity whose finish is measured; empty measures the project finish. */
  targetTaskId: string;
  targetMode: "auto" | "days" | "date";
  targetDays: number;
  /** yyyy-mm-dd */
  targetDate: string;

  allowAddSets: boolean;
  maxAddedSets: number;
  /** Output of an added set relative to a standard set (congestion, learning). */
  addedSetEfficiencyPct: number;
  mobilizationCostPerSet: number;

  allowExtendedHours: boolean;
  /** Paid hours relative to the calendar day — 1.25 is 10 h on an 8 h day. */
  extendedHoursFactor: number;
  /** Output of the extra hours relative to normal hours. */
  overtimeEfficiencyPct: number;
  overtimePremiumPct: number;

  allowCompression: boolean;
  maxCompressionPct: number;
  minRemainingDays: number;

  allowLagReduction: boolean;
  maxLagReductionPct: number;

  allowFastTrack: boolean;
  /** Share of the predecessor that may overlap its successor. */
  fastTrackOverlapPct: number;

  includeStarted: boolean;
  maxActions: number;
  /** Revised: stop once one more action gains less than this. */
  minGainDays: number;
  rankBy: "gain" | "cost" | "risk";
  reestimateFromProductivity: boolean;
  /** Durations are rounded up to this step, in days. 0 keeps hours. */
  granularityDays: number;
  timeBudgetMs: number;

  lockedTaskIds: string[];
  lockedLinkIds: string[];
  /** Activities whose code or name matches are never edited — delay events, approvals, permits. */
  excludePattern: string;
  /** Extended hours and compression only on resource-loaded or productivity-mapped activities. */
  workLeversNeedResources: boolean;
};

/** A user or optimizer edit to one activity. */
export type TaskEdit = {
  sets?: number;
  hoursFactor?: number;
  compressionPct?: number;
  /** Explicit remaining duration in days; overrides every other lever. */
  durationDays?: number;
  reestimated?: boolean;
};

export type LinkEdit = { lagDays?: number; type?: RelationshipKind };

export type ScenarioState = {
  tasks: Record<string, TaskEdit>;
  links: Record<string, LinkEdit>;
};

export type ScenarioAction = {
  id: string;
  step: number;
  bundle: string | null;
  type: ScenarioActionType;
  taskId: string | null;
  linkId: string | null;
  code: string;
  label: string;
  beforeValue: string;
  afterValue: string;
  /** Exact calendar-day gain when the action was applied, re-solved in full. */
  gainDays: number;
  cost: number | null;
  risk: Risk;
  basis: string;
  validation: string;
};

export type ScenarioChange = {
  kind: "Remaining duration" | "Relationship lag" | "Relationship type";
  taskId: string | null;
  linkId: string | null;
  code: string;
  name: string;
  from: string;
  to: string;
  fromNumber: number | null;
  toNumber: number | null;
  p6Field: string;
  levers: string;
};

export type MovedActivity = {
  task: Task;
  baseStart: Date | null;
  baseFinish: Date | null;
  start: Date | null;
  finish: Date | null;
  deltaDays: number;
  baseFloat: number | null;
  float: number | null;
};

export type ScenarioProgress = { phase: string; evaluations: number; actions: number; gainDays: number };

export type ScenarioResult = {
  objective: ScenarioObjective;
  controls: ScenarioControls;
  generatedAt: string;
  ms: number;
  evaluations: number;
  blocked: string | null;
  stopReason: string;

  targetTask: Task | null;
  fileFinish: Date | null;
  reestimatedFinish: Date | null;
  scenarioFinish: Date | null;
  requiredFinish: Date | null;
  requiredDays: number | null;
  targetBasis: string;
  gainDays: number;
  gainWorkDays: number;
  remainingGapDays: number | null;
  targetMet: boolean | null;

  actions: ScenarioAction[];
  changes: ScenarioChange[];
  moved: MovedActivity[];
  longestPath: Task[];
  criticalBefore: number;
  criticalAfter: number;
  negativeBefore: number;
  negativeAfter: number;
  totalCost: number;
  uncostedActions: number;

  /** Every applied action was re-solved in full; mismatches against its trial must be zero. */
  exactness: { checked: number; mismatches: number };
  warnings: string[];
  state: ScenarioState;
  /** Scenario early/late dates and float per activity. */
  dates: Map<string, Computed>;
};

export type ScenarioInput = {
  P: ProjectView;
  an: Analysis;
  opts: AnalyzerOptions;
  controls: ScenarioControls;
  productivity: TaskProductivity[];
  /** Edits made by hand; the optimizer builds on them and never overrides an explicit duration. */
  state?: ScenarioState;
};

/* ----------------------------------------------------------- presets */

const BASE_CONTROLS: ScenarioControls = {
  objective: "recovery",
  targetTaskId: "",
  targetMode: "auto",
  targetDays: 0,
  targetDate: "",
  allowAddSets: true,
  maxAddedSets: 2,
  addedSetEfficiencyPct: 85,
  mobilizationCostPerSet: 0,
  allowExtendedHours: true,
  extendedHoursFactor: 1.25,
  overtimeEfficiencyPct: 90,
  overtimePremiumPct: 50,
  allowCompression: true,
  maxCompressionPct: 20,
  minRemainingDays: 1,
  allowLagReduction: true,
  maxLagReductionPct: 50,
  allowFastTrack: true,
  fastTrackOverlapPct: 30,
  includeStarted: true,
  maxActions: 25,
  minGainDays: 1,
  rankBy: "gain",
  reestimateFromProductivity: false,
  granularityDays: 1,
  timeBudgetMs: 60000,
  lockedTaskIds: [],
  lockedLinkIds: [],
  excludePattern: "\b(EOT|DLY|DELAY|FRAGNET|SUBMITTAL|APPROVAL|PERMIT)",
  workLeversNeedResources: true,
};

export const OBJECTIVE_PRESETS: Record<ScenarioObjective, Partial<ScenarioControls>> = {
  // Contain further slippage with the least disruptive levers.
  mitigation: {
    maxAddedSets: 1, allowExtendedHours: true, allowCompression: true, maxCompressionPct: 10,
    allowLagReduction: false, allowFastTrack: false, maxActions: 10, rankBy: "risk", reestimateFromProductivity: false,
  },
  // Close an evidenced gap with every lever, each gated.
  recovery: {
    maxAddedSets: 2, allowExtendedHours: true, allowCompression: true, maxCompressionPct: 20,
    allowLagReduction: true, maxLagReductionPct: 50, allowFastTrack: true, fastTrackOverlapPct: 30,
    maxActions: 25, rankBy: "gain", reestimateFromProductivity: false,
  },
  // Re-plan the remaining work from the library, then optimise without forcing a date.
  revised: {
    maxAddedSets: 1, allowExtendedHours: false, allowCompression: true, maxCompressionPct: 15,
    allowLagReduction: true, maxLagReductionPct: 30, allowFastTrack: false,
    maxActions: 15, rankBy: "cost", reestimateFromProductivity: true, minGainDays: 1,
  },
};

export function defaultControls(objective: ScenarioObjective): ScenarioControls {
  return { ...BASE_CONTROLS, ...OBJECTIVE_PRESETS[objective], objective, lockedTaskIds: [], lockedLinkIds: [] };
}

export const EMPTY_STATE: ScenarioState = { tasks: {}, links: {} };

const RISK_FACTOR: Record<Risk, number> = { low: 1, medium: 0.85, high: 0.65 };

const ACTION_VALIDATION: Record<ScenarioActionType, string> = {
  ADD_SETS: "Confirm workface space, access, supervision, material supply and equipment for the added set before issue.",
  EXTENDED_HOURS: "Confirm labour-law limits, HSE fatigue controls, lighting, supervision and the premium rate.",
  COMPRESSION: "No productivity basis — evidence the method or resource change that achieves the shorter duration.",
  LAG_REDUCTION: "Reduce only non-mandatory waiting time; curing, testing, approvals and contractual periods stay.",
  FAST_TRACK: "Approve only where the work is physically divisible and the overlap is safe, drawn and method-stated.",
  RE_ESTIMATE: "Confirm the remaining quantity and that the library rate represents this workface.",
};

/* ------------------------------------------------------------ engine */

type Engine = {
  P: ProjectView;
  an: Analysis;
  opts: AnalyzerOptions;
  C: ScenarioControls;
  ctx: CpmContext;
  prod: Map<string, TaskProductivity>;
  pos: Map<string, number>;
  linkById: Map<string, Link>;
  target: Task | null;
  exclude: RegExp | null;
  excludeError: string | null;
  evaluations: number;
};

const EPS_DAYS = 1 / 24 / 6; // ten minutes
const sameTime = (a: Date | null, b: Date | null) => (a ? +a : 0) === (b ? +b : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const dayHours = (t: Task) => t.cal.dayHours || 8;
const linkDayHours = (l: Link) => (l.succ ? l.succ.cal.dayHours : l.pred ? l.pred.cal.dayHours : 8) || 8;

function createEngine(input: ScenarioInput): Engine {
  const { P, an, opts, controls } = input;
  const pos = new Map<string, number>();
  an.order.forEach((t, i) => pos.set(t.id, i));
  const linkById = new Map<string, Link>();
  for (const l of P.links) if (l.pred && l.succ) linkById.set(l.id, l);
  const prod = new Map<string, TaskProductivity>();
  for (const p of input.productivity) if (P.byId[p.taskId]) prod.set(p.taskId, p);
  let exclude: RegExp | null = null;
  let excludeError: string | null = null;
  if (controls.excludePattern.trim()) {
    try {
      exclude = new RegExp(controls.excludePattern, "i");
    } catch {
      excludeError = `The exclusion pattern "${controls.excludePattern}" is not a valid expression and was ignored.`;
    }
  }
  return {
    P, an, opts, C: controls, exclude, excludeError,
    ctx: cpmContext(P, opts, an.lagCalendarMode),
    prod, pos, linkById,
    target: controls.targetTaskId ? P.byId[controls.targetTaskId] || null : null,
    evaluations: 0,
  };
}

function eligibleForWork(t: Task): boolean {
  return !t.done && !t.isMile && !t.isLOE && !t.isWBSsum;
}

function isExcluded(E: Engine, t: Task): boolean {
  return !!E.exclude && E.exclude.test(`${t.code} ${t.name}`);
}

/** Remaining hours of `t` under an edit, rounded to the configured granularity unless `round` is off. */
function taskHours(E: Engine, t: Task, edit: TaskEdit | undefined, round = true): number {
  if (!eligibleForWork(t)) return t.done || t.isMile ? 0 : t.rdHr;
  if (!edit) return t.rdHr;
  const hd = dayHours(t);
  if (edit.durationDays !== undefined) return Math.max(0, edit.durationDays * hd);

  const p = E.prod.get(t.id);
  let hr = t.rdHr;
  let reduction = false;
  if (edit.reestimated && p && p.quantity > 0 && p.setDailyProduction > 0 && p.currentSets > 0) {
    hr = (p.quantity / (p.setDailyProduction * p.currentSets)) * hd;
  }
  if (edit.sets !== undefined && p && p.currentSets > 0 && edit.sets !== p.currentSets) {
    const added = edit.sets - p.currentSets;
    const effective = p.currentSets + added * (added > 0 ? E.C.addedSetEfficiencyPct / 100 : 1);
    if (effective > 0) hr *= p.currentSets / effective;
    reduction = true;
  }
  if (edit.hoursFactor && edit.hoursFactor > 1) {
    hr /= 1 + (edit.hoursFactor - 1) * (E.C.overtimeEfficiencyPct / 100);
    reduction = true;
  }
  if (edit.compressionPct) {
    hr *= 1 - Math.min(90, Math.max(0, edit.compressionPct)) / 100;
    reduction = true;
  }

  const step = E.C.granularityDays > 0 ? E.C.granularityDays * hd : 0;
  if (round && step > 0) hr = Math.ceil(hr / step - 1e-9) * step;
  if (reduction) {
    const floor = Math.min(t.rdHr, Math.max(E.C.minRemainingDays, 0) * hd);
    const ceiling = edit.reestimated ? Number.POSITIVE_INFINITY : t.rdHr;
    hr = Math.min(Math.max(hr, floor), ceiling);
  } else if (edit.reestimated) {
    hr = Math.max(hr, step || 0);
  }
  return Math.max(0, hr);
}

/** Indicative cost of an activity's edit relative to the file, from its productivity basis. */
function taskCost(E: Engine, t: Task, edit: TaskEdit | undefined): number | null {
  if (!edit) return 0;
  const p = E.prod.get(t.id);
  const levers = edit.sets !== undefined || (edit.hoursFactor || 0) > 1;
  if (!levers) return edit.compressionPct || edit.durationDays !== undefined ? null : 0;
  if (!p || !(p.setCostPerDay > 0)) return null;
  const hd = dayHours(t);
  // Resource cost follows the work actually done, not the duration rounded for the schedule.
  const baseDays = taskHours(E, t, edit.reestimated ? { reestimated: true } : undefined, false) / hd;
  const days = taskHours(E, t, edit, false) / hd;
  const sets = edit.sets ?? p.currentSets;
  const factor = edit.hoursFactor && edit.hoursFactor > 1 ? 1 + (edit.hoursFactor - 1) * (1 + E.C.overtimePremiumPct / 100) : 1;
  const scenario = sets * p.setCostPerDay * factor * days;
  const base = p.currentSets * p.setCostPerDay * baseDays;
  const mobilization = Math.max(0, sets - p.currentSets) * Math.max(0, E.C.mobilizationCostPerSet);
  return scenario - base + mobilization;
}

export function scenarioOverrides(E: Engine, state: ScenarioState): CpmOverrides {
  const rdHr = new Map<string, number>();
  for (const [id, edit] of Object.entries(state.tasks)) {
    const t = E.P.byId[id];
    if (!t || !eligibleForWork(t)) continue;
    const hr = taskHours(E, t, edit);
    if (Math.abs(hr - t.rdHr) > 1e-6) rdHr.set(id, hr);
  }
  const lagHr = new Map<string, number>();
  const relType = new Map<string, RelationshipKind>();
  for (const [id, edit] of Object.entries(state.links)) {
    const l = E.linkById.get(id);
    if (!l) continue;
    if (edit.lagDays !== undefined) lagHr.set(id, edit.lagDays * linkDayHours(l));
    if (edit.type && edit.type !== l.type) relType.set(id, edit.type);
  }
  return { rdHr, lagHr, relType };
}

type Solved = { store: Map<string, Computed>; get: CpmStore; finish: Date | null };

function solveFull(E: Engine, state: ScenarioState, forwardOnly: boolean): Solved & { net: ReturnType<typeof solveNetwork> } {
  E.evaluations++;
  const store = new Map<string, Computed>();
  for (const t of E.P.tasks) store.set(t.id, emptyComputed());
  const get: CpmStore = (t) => store.get(t.id)!;
  const net = solveNetwork(E.ctx, E.an.order, E.an.inCycle, get, scenarioOverrides(E, state), "scratch", forwardOnly);
  return { store, get, finish: measure(E, get), net };
}

function measure(E: Engine, get: CpmStore): Date | null {
  if (E.target) return get(E.target).ef;
  let max = 0;
  for (const t of E.P.tasks) {
    const ef = get(t).ef;
    if (ef && +ef > max) max = +ef;
  }
  return max ? new Date(max) : null;
}

/**
 * Re-solve only what an edit can move: the edited activities and everything
 * downstream whose dates actually change. Uses the same per-activity forward
 * step as the full pass, so the finish is identical to a full recalculation.
 */
function trialFinish(E: Engine, base: Map<string, Computed>, state: ScenarioState, seeds: string[]): Date | null {
  E.evaluations++;
  const ov = scenarioOverrides(E, state);
  const overlay = new Map<string, Computed>();
  const get: CpmStore = (t) => overlay.get(t.id) || base.get(t.id)!;
  const dirty = new Set(seeds);
  let start = Number.POSITIVE_INFINITY;
  for (const id of dirty) {
    const p = E.pos.get(id);
    if (p !== undefined && p < start) start = p;
  }
  const order = E.an.order;
  for (let i = start; i < order.length; i++) {
    const t = order[i];
    if (!dirty.has(t.id)) continue;
    const c = emptyComputed();
    overlay.set(t.id, c);
    forwardActivity(E.ctx, t, get, ov, "none");
    const was = base.get(t.id)!;
    if (!sameTime(c.es, was.es) || !sameTime(c.ef, was.ef)) {
      for (const l of t.succs) dirty.add(l.succ!.id);
    }
  }
  return measure(E, get);
}

/** Incomplete activities and relationships that drive the measured finish, ties included. */
function drivingTree(E: Engine, get: CpmStore, finish: Date | null): { tasks: Task[]; links: Link[] } {
  let ends: Task[];
  if (E.target) ends = [E.target];
  else if (!finish) ends = [];
  else ends = E.P.tasks.filter((t) => !t.done && get(t).ef && Math.abs(+get(t).ef! - +finish) < 60_000);

  const tasks: Task[] = [];
  const links: Link[] = [];
  const seen = new Set<string>();
  const stack = ends.slice();
  while (stack.length) {
    const t = stack.pop()!;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (!t.done) tasks.push(t);
    for (const l of get(t).drivers) {
      links.push(l);
      if (l.pred && !l.pred.done) stack.push(l.pred);
    }
  }
  return { tasks, links };
}

type Candidate = {
  type: ScenarioActionType;
  taskId: string | null;
  linkId: string | null;
  taskEdit?: TaskEdit;
  linkEdit?: LinkEdit;
  seeds: string[];
  code: string;
  label: string;
  beforeValue: string;
  afterValue: string;
  nominalDays: number;
  risk: Risk;
  basis: string;
};

function withCandidate(state: ScenarioState, c: Candidate): ScenarioState {
  const next: ScenarioState = { tasks: { ...state.tasks }, links: { ...state.links } };
  if (c.taskId && c.taskEdit) next.tasks[c.taskId] = c.taskEdit;
  if (c.linkId && c.linkEdit) next.links[c.linkId] = c.linkEdit;
  return next;
}

function generateCandidates(E: Engine, state: ScenarioState, tree: { tasks: Task[]; links: Link[] }): Candidate[] {
  const C = E.C;
  const lockedTasks = new Set(C.lockedTaskIds);
  const lockedLinks = new Set(C.lockedLinkIds);
  const out: Candidate[] = [];

  for (const t of tree.tasks) {
    if (!eligibleForWork(t) || lockedTasks.has(t.id) || isExcluded(E, t)) continue;
    if (t.started && !C.includeStarted) continue;
    const edit = state.tasks[t.id] || {};
    if (edit.durationDays !== undefined) continue;
    const hd = dayHours(t);
    const current = taskHours(E, t, state.tasks[t.id]);
    if (current <= 1e-6) continue;
    const p = E.prod.get(t.id);
    const resourced = !C.workLeversNeedResources || t.rsrcs.length > 0 || !!p;
    const offer = (type: ScenarioActionType, next: TaskEdit, label: string, before: string, after: string, risk: Risk, basis: string) => {
      const hr = taskHours(E, t, next);
      if (hr >= current - 1e-6) return;
      out.push({
        type, taskId: t.id, linkId: null, taskEdit: next, seeds: [t.id], code: t.code,
        label, beforeValue: before, afterValue: after, nominalDays: (current - hr) / hd, risk,
        basis: `${basis} Remaining ${fmt(current / hd)} d → ${fmt(hr / hd)} d.`,
      });
    };

    if (C.allowAddSets && p && p.currentSets > 0) {
      const sets = edit.sets ?? p.currentSets;
      if (sets - p.currentSets < C.maxAddedSets && sets + 1 <= Math.max(p.maxSets, p.currentSets)) {
        offer(
          "ADD_SETS", { ...edit, sets: sets + 1 }, `Add one resource set to ${t.code}`,
          `${fmt(sets, 2)} sets`, `${fmt(sets + 1, 2)} sets`, p.setsConfirmed ? "medium" : "high",
          `Library ${p.libraryCode} ${p.libraryName}: ${fmt(p.setDailyProduction, 2)} ${p.uom}/set-day on ${fmt(p.quantity, 1)} ${p.uom} (${p.quantitySource}).${p.setsConfirmed ? "" : " Current sets are derived from the file's duration — confirm them."}`,
        );
      }
    }
    if (C.allowExtendedHours && resourced && !(edit.hoursFactor && edit.hoursFactor > 1) && C.extendedHoursFactor > 1) {
      offer(
        "EXTENDED_HOURS", { ...edit, hoursFactor: C.extendedHoursFactor }, `Extended working hours on ${t.code}`,
        "1.00 × day", `${fmt(C.extendedHoursFactor, 2)} × day`, "medium",
        `${fmt(C.overtimeEfficiencyPct, 0)}% output on the extra hours.`,
      );
    }
    const productivityLever = C.allowAddSets && !!p && p.currentSets > 0;
    if (C.allowCompression && resourced && !productivityLever && !edit.compressionPct && C.maxCompressionPct > 0) {
      offer(
        "COMPRESSION", { ...edit, compressionPct: C.maxCompressionPct }, `Compress remaining duration of ${t.code}`,
        "0%", `−${fmt(C.maxCompressionPct, 0)}%`, "high",
        "No library productivity basis mapped to this activity.",
      );
    }
  }

  const seenLinks = new Set<string>();
  for (const l of tree.links) {
    if (!l.pred || !l.succ || seenLinks.has(l.id) || lockedLinks.has(l.id) || l.succ.done) continue;
    if (isExcluded(E, l.pred) || isExcluded(E, l.succ)) continue;
    seenLinks.add(l.id);
    const edit = state.links[l.id] || {};
    const lagDays = edit.lagDays ?? l.lag;
    const type = edit.type ?? l.type;
    const label = `${l.pred.code} → ${l.succ.code}`;
    if (C.allowLagReduction && lagDays > 1e-6 && edit.lagDays === undefined && C.maxLagReductionPct > 0) {
      const next = round2(lagDays * (1 - C.maxLagReductionPct / 100));
      out.push({
        type: "LAG_REDUCTION", taskId: null, linkId: l.id, linkEdit: { ...edit, lagDays: next }, seeds: [l.succ.id],
        code: label, label: `Reduce lag ${label}`, beforeValue: `${type} ${fmt(lagDays)} d`, afterValue: `${type} ${fmt(next)} d`,
        nominalDays: lagDays - next, risk: "medium", basis: `Positive lag of ${fmt(lagDays)} d on a driving relationship.`,
      });
    }
    if (
      C.allowFastTrack && type === "FS" && edit.type === undefined && !l.succ.started && !l.pred.done &&
      !l.pred.isMile && !l.succ.isMile && C.fastTrackOverlapPct > 0
    ) {
      const predHr = taskHours(E, l.pred, state.tasks[l.pred.id]);
      if (predHr > 0) {
        const hd = linkDayHours(l);
        const nextLag = round2((predHr * (1 - C.fastTrackOverlapPct / 100)) / hd + lagDays);
        out.push({
          type: "FAST_TRACK", taskId: null, linkId: l.id, linkEdit: { ...edit, type: "SS", lagDays: nextLag }, seeds: [l.succ.id],
          code: label, label: `Fast-track ${label}`, beforeValue: `FS ${fmt(lagDays)} d`, afterValue: `SS ${fmt(nextLag)} d`,
          nominalDays: (predHr / hd) * (C.fastTrackOverlapPct / 100), risk: "high",
          basis: `Successor released after ${fmt(100 - C.fastTrackOverlapPct, 0)}% of the predecessor's remaining work.`,
        });
      }
    }
  }
  return out;
}

function score(E: Engine, gain: number, cost: number | null, risk: Risk): [number, number] {
  const r = RISK_FACTOR[risk];
  if (E.C.rankBy === "risk") return [0, gain * r * r];
  if (E.C.rankBy === "cost") {
    // Costed actions rank by gain per unit cost ahead of uncosted ones.
    if (cost !== null && cost > 0) return [1, gain / cost];
    if (cost !== null && cost <= 0) return [2, gain];
    return [0, gain * r];
  }
  return [0, gain * r];
}

const better = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1] + 1e-12);

function resolveTarget(E: Engine, fileFinish: Date | null): { required: Date | null; basis: string } {
  const C = E.C;
  if (C.targetMode === "date" && C.targetDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(C.targetDate);
    if (m) return { required: new Date(+m[1], +m[2] - 1, +m[3], 23, 59), basis: `Approved target date ${C.targetDate}` };
  }
  if (C.targetMode === "days" && C.targetDays > 0 && fileFinish) {
    return { required: new Date(+fileFinish - C.targetDays * DAY), basis: `Approved recovery of ${fmt(C.targetDays)} calendar days` };
  }
  if (C.objective === "revised") return { required: null, basis: "Revised programme — no external date is forced" };

  const t = E.target;
  if (t && t.cstrDate && ["CS_MEO", "CS_MEOB", "CS_MANDFIN"].includes(t.cstrType) && t.c.ef && t.c.ef > t.cstrDate) {
    return { required: t.cstrDate, basis: `Finish constraint on ${t.code}` };
  }
  if (!t && E.P.mustFinish && fileFinish && fileFinish > E.P.mustFinish) {
    return { required: E.P.mustFinish, basis: "Project must-finish date" };
  }
  const probe = t || E.an.longestPathEnd;
  if (probe && probe.c.tf !== null && probe.c.tf < 0 && probe.c.ef) {
    const back = probe.cal.sub(probe.c.ef, -probe.c.tf * dayHours(probe));
    if (back) return { required: back, basis: `Negative total float of ${fmt(probe.c.tf)} d on ${probe.code}` };
  }
  return {
    required: null,
    basis: "No must-finish date, finish constraint or negative float evidences a requirement — set a target to drive the scenario.",
  };
}

/* ---------------------------------------------------------- optimize */

export function* optimizeScenario(input: ScenarioInput): Generator<ScenarioProgress, ScenarioResult, void> {
  const t0 = Date.now();
  const E = createEngine(input);
  const C = E.C;
  const warnings: string[] = [];

  const fileGet: CpmStore = (t) => t.c;
  const fileFinish = measure(E, fileGet);

  if (E.an.inCycle.length) {
    return finalize(E, input, cloneState(input.state), [], {
      t0, fileFinish, reestimatedFinish: null, required: null, basis: "", warnings,
      blocked: `The network contains ${E.an.inCycle.length} activities in logic loops. Repair the loops in P6 before any scenario can be solved.`,
      stopReason: "Blocked", exactness: { checked: 0, mismatches: 0 },
    });
  }
  if (C.targetTaskId && !E.target) warnings.push("The selected target activity is not in this project; the project finish is measured instead.");
  if (E.excludeError) warnings.push(E.excludeError);

  let state = cloneState(input.state);
  const actions: ScenarioAction[] = [];
  let step = 0;

  if (C.reestimateFromProductivity) {
    const locked = new Set(C.lockedTaskIds);
    let count = 0;
    for (const p of E.prod.values()) {
      const t = E.P.byId[p.taskId];
      if (!t || !eligibleForWork(t) || locked.has(t.id) || isExcluded(E, t) || !p.setsConfirmed || !(p.quantity > 0) || !(p.setDailyProduction > 0)) continue;
      const edit = state.tasks[t.id] || {};
      if (edit.durationDays !== undefined) continue;
      state.tasks[t.id] = { ...edit, reestimated: true };
      count++;
    }
    if (!count) warnings.push("Re-estimation is on, but no mapped activity has a remaining quantity, a production rate and confirmed resource sets — enter the sets on site in Activity mapping.");
  }

  let solved = solveFull(E, state, true);
  const reestimatedFinish = C.reestimateFromProductivity ? solved.finish : null;
  if (C.reestimateFromProductivity) {
    for (const [id, edit] of Object.entries(state.tasks)) {
      if (!edit.reestimated) continue;
      const t = E.P.byId[id];
      const hd = dayHours(t);
      const hr = taskHours(E, t, { reestimated: true });
      if (Math.abs(hr - t.rdHr) < 1e-6) continue;
      const p = E.prod.get(id)!;
      actions.push({
        id: `A${String(++step).padStart(3, "0")}`, step, bundle: null, type: "RE_ESTIMATE", taskId: id, linkId: null,
        code: t.code, label: `Re-estimate ${t.code} from production rate`,
        beforeValue: `${fmt(t.rdHr / hd)} d`, afterValue: `${fmt(hr / hd)} d`, gainDays: 0, cost: null, risk: "low",
        basis: `${fmt(p.quantity, 1)} ${p.uom} ÷ (${fmt(p.setDailyProduction, 2)} ${p.uom}/set-day × ${fmt(p.currentSets, 2)} sets).`,
        validation: ACTION_VALIDATION.RE_ESTIMATE,
      });
    }
  }

  const { required, basis } = resolveTarget(E, fileFinish);
  let current = solved.finish;
  let stopReason = "Action limit reached";
  const exactness = { checked: 0, mismatches: 0 };
  const optimizing = actions.length;

  while (actions.length - optimizing < C.maxActions) {
    if (required && current && +current <= +required + 60_000) {
      stopReason = "Target met";
      break;
    }
    if (Date.now() - t0 > C.timeBudgetMs) {
      stopReason = "Time budget reached";
      warnings.push(`The optimizer stopped at its ${fmt(C.timeBudgetMs / 1000, 0)} s time budget; raise it under the controls to search further.`);
      break;
    }
    if (!current) {
      stopReason = "No measurable finish";
      break;
    }

    const tree = drivingTree(E, solved.get, current);
    const candidates = generateCandidates(E, state, tree);
    if (!candidates.length) {
      stopReason = "No further intervention is available on the driving path under the current controls";
      break;
    }

    const evaluated: { c: Candidate; gain: number; cost: number | null; s: [number, number] }[] = [];
    for (const c of candidates) {
      const trial = trialFinish(E, solved.store, withCandidate(state, c), c.seeds);
      const gain = trial ? (+current - +trial) / DAY : 0;
      const cost = c.taskId ? taskCost(E, E.P.byId[c.taskId], c.taskEdit) : null;
      const prevCost = c.taskId ? taskCost(E, E.P.byId[c.taskId], state.tasks[c.taskId]) : 0;
      const delta = cost === null || prevCost === null ? cost : cost - prevCost;
      evaluated.push({ c, gain, cost: delta, s: score(E, gain, delta, c.risk) });
      if (E.evaluations % 12 === 0) {
        yield { phase: "Testing interventions", evaluations: E.evaluations, actions: actions.length, gainDays: fileFinish ? (+fileFinish - +current) / DAY : 0 };
      }
    }

    let chosen: { list: Candidate[]; gain: number } | null = null;
    let best: (typeof evaluated)[number] | null = null;
    for (const e of evaluated) {
      if (e.gain <= EPS_DAYS) continue;
      if (!best || better(e.s, best.s)) best = e;
    }
    if (best) chosen = { list: [best.c], gain: best.gain };

    if (!chosen) {
      // Parallel driving paths: no single edit moves the finish, a pair may.
      const pool = evaluated.slice().sort((a, b) => b.c.nominalDays - a.c.nominalDays).slice(0, 12).map((e) => e.c);
      let pairBest: { list: Candidate[]; gain: number } | null = null;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const a = pool[i];
          const b = pool[j];
          if ((a.taskId && a.taskId === b.taskId) || (a.linkId && a.linkId === b.linkId)) continue;
          const trial = trialFinish(E, solved.store, withCandidate(withCandidate(state, a), b), [...a.seeds, ...b.seeds]);
          const gain = trial ? (+current - +trial) / DAY : 0;
          if (gain > EPS_DAYS && (!pairBest || gain > pairBest.gain + 1e-9)) pairBest = { list: [a, b], gain };
        }
        if (E.evaluations % 12 === 0) {
          yield { phase: "Testing paired interventions", evaluations: E.evaluations, actions: actions.length, gainDays: fileFinish ? (+fileFinish - +current) / DAY : 0 };
        }
      }
      chosen = pairBest;
    }

    if (!chosen) {
      stopReason = "No single or paired intervention advances the finish — it is held by parallel paths, constraints or completed work";
      break;
    }
    if (!required && C.objective === "revised" && chosen.gain < C.minGainDays - 1e-9) {
      stopReason = `Diminishing returns — the next action gains less than ${fmt(C.minGainDays)} d`;
      break;
    }

    const before = current;
    const trialGain = chosen.gain;
    let nextState = state;
    for (const c of chosen.list) nextState = withCandidate(nextState, c);
    const nextSolved = solveFull(E, nextState, true);
    const gain = nextSolved.finish ? (+before - +nextSolved.finish) / DAY : 0;
    exactness.checked++;
    if (Math.abs(gain - trialGain) > 1e-6) exactness.mismatches++;

    const bundle = chosen.list.length > 1 ? `B${step + 1}` : null;
    for (const c of chosen.list) {
      const prevCost = c.taskId ? taskCost(E, E.P.byId[c.taskId], state.tasks[c.taskId]) : 0;
      const cost = c.taskId ? taskCost(E, E.P.byId[c.taskId], c.taskEdit) : null;
      actions.push({
        id: `A${String(++step).padStart(3, "0")}`, step, bundle, type: c.type, taskId: c.taskId, linkId: c.linkId,
        code: c.code, label: c.label, beforeValue: c.beforeValue, afterValue: c.afterValue,
        gainDays: round2(chosen.list.length > 1 ? gain / chosen.list.length : gain),
        cost: cost === null || prevCost === null ? cost : round2(cost - prevCost),
        risk: c.risk, basis: c.basis, validation: ACTION_VALIDATION[c.type],
      });
    }
    state = nextState;
    solved = nextSolved;
    current = nextSolved.finish;
  }

  // Trim: drop any optimizer action the final finish no longer needs.
  yield { phase: "Removing redundant actions", evaluations: E.evaluations, actions: actions.length, gainDays: 0 };
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.type === "RE_ESTIMATE") continue;
      const later = actions.slice(i + 1).some((b) => (a.taskId && b.taskId === a.taskId) || (a.linkId && b.linkId === a.linkId));
      if (later) continue;
      const reverted = revertAction(E, state, a, actions.slice(0, i));
      const seeds = a.taskId ? [a.taskId] : a.linkId ? [E.linkById.get(a.linkId)!.succ!.id] : [];
      const trial = trialFinish(E, solved.store, reverted, seeds);
      if (trial && current && +trial <= +current + 60_000) {
        state = reverted;
        solved = solveFull(E, state, true);
        current = solved.finish;
        actions.splice(i, 1);
        trimmed = true;
        break;
      }
    }
  }

  return finalize(E, input, state, actions, {
    t0, fileFinish, reestimatedFinish, required, basis, warnings, blocked: null, stopReason, exactness,
  });
}

/** State with one action undone, rebuilt from the actions that precede it. */
function revertAction(E: Engine, state: ScenarioState, action: ScenarioAction, earlier: ScenarioAction[]): ScenarioState {
  const next: ScenarioState = { tasks: { ...state.tasks }, links: { ...state.links } };
  if (action.taskId) {
    const edit = { ...(next.tasks[action.taskId] || {}) };
    const p = E.prod.get(action.taskId);
    if (action.type === "ADD_SETS" && p) {
      const sets = (edit.sets ?? p.currentSets) - 1;
      if (sets <= p.currentSets) delete edit.sets;
      else edit.sets = sets;
    } else if (action.type === "EXTENDED_HOURS") {
      delete edit.hoursFactor;
    } else if (action.type === "COMPRESSION") {
      delete edit.compressionPct;
    }
    if (Object.keys(edit).length) next.tasks[action.taskId] = edit;
    else delete next.tasks[action.taskId];
  }
  if (action.linkId) {
    const edit = { ...(next.links[action.linkId] || {}) };
    if (action.type === "LAG_REDUCTION") delete edit.lagDays;
    if (action.type === "FAST_TRACK") {
      delete edit.type;
      delete edit.lagDays;
      const lagEdit = earlier.find((b) => b.linkId === action.linkId && b.type === "LAG_REDUCTION");
      if (lagEdit) edit.lagDays = Number.parseFloat(lagEdit.afterValue.split(" ")[1]);
    }
    if (Object.keys(edit).length) next.links[action.linkId] = edit;
    else delete next.links[action.linkId];
  }
  return next;
}

function cloneState(state?: ScenarioState): ScenarioState {
  const tasks: Record<string, TaskEdit> = {};
  const links: Record<string, LinkEdit> = {};
  if (state) {
    for (const [k, v] of Object.entries(state.tasks)) tasks[k] = { ...v };
    for (const [k, v] of Object.entries(state.links)) links[k] = { ...v };
  }
  return { tasks, links };
}

type FinalizeMeta = {
  t0: number;
  fileFinish: Date | null;
  reestimatedFinish: Date | null;
  required: Date | null;
  basis: string;
  warnings: string[];
  blocked: string | null;
  stopReason: string;
  exactness: { checked: number; mismatches: number };
};

function finalize(E: Engine, input: ScenarioInput, state: ScenarioState, actions: ScenarioAction[], meta: FinalizeMeta): ScenarioResult {
  const { P, an, opts, C } = E;
  const full = meta.blocked ? null : solveFull(E, state, false);
  const get: CpmStore = full ? full.get : (t) => t.c;
  const finish = full ? full.finish : meta.fileFinish;

  const gainDays = meta.fileFinish && finish ? round2((+meta.fileFinish - +finish) / DAY) : 0;
  const measureTask = E.target || an.longestPathEnd;
  const gainWorkDays = measureTask && meta.fileFinish && finish
    ? round2(measureTask.cal.between(finish, meta.fileFinish) / dayHours(measureTask))
    : 0;
  const requiredDays = meta.required && meta.fileFinish ? round2((+meta.fileFinish - +meta.required) / DAY) : null;
  const targetMet = meta.required && finish ? +finish <= +meta.required + 60_000 : null;
  const remainingGapDays = meta.required && finish ? round2(Math.max(0, (+finish - +meta.required) / DAY)) : null;

  const incomplete = P.tasks.filter((t) => !t.done);
  const moved: MovedActivity[] = [];
  if (full) {
    for (const t of incomplete) {
      const c = get(t);
      if (!t.c.ef || !c.ef) continue;
      const delta = (+c.ef - +t.c.ef) / DAY;
      if (Math.abs(delta) < 1 / 24) continue;
      moved.push({ task: t, baseStart: t.c.es, baseFinish: t.c.ef, start: c.es, finish: c.ef, deltaDays: round2(delta), baseFloat: t.c.tf, float: c.tf });
    }
    moved.sort((a, b) => a.deltaDays - b.deltaDays);
  }

  const longestPath: Task[] = [];
  if (full) {
    let end: Task | null = E.target;
    if (!end) {
      for (const t of incomplete) {
        const ef = get(t).ef;
        if (!ef) continue;
        if (!end || ef > get(end).ef! || (+ef === +get(end).ef! && !t.succs.length && end.succs.length)) end = t;
      }
    }
    const seen = new Set<string>();
    let cursor: Task | null = end;
    while (cursor && !seen.has(cursor.id) && longestPath.length < 5000) {
      seen.add(cursor.id);
      longestPath.push(cursor);
      let next: Link | null = null;
      for (const l of get(cursor).drivers) {
        if (!l.pred || l.pred.done) continue;
        if (!next || (get(l.pred).ef && get(next.pred!).ef && get(l.pred).ef! > get(next.pred!).ef!)) next = l;
      }
      cursor = next ? next.pred : null;
    }
    longestPath.reverse();
  }

  const crit = (tf: number | null) => tf !== null && tf <= opts.tfCritical;
  const changes = buildChanges(E, state, actions);

  let totalCost = 0;
  let uncosted = 0;
  for (const [id, edit] of Object.entries(state.tasks)) {
    const t = P.byId[id];
    if (!t) continue;
    const cost = taskCost(E, t, edit);
    if (cost === null) uncosted++;
    else totalCost += cost;
  }

  const warnings = meta.warnings.slice();
  if (an.drift.count && an.drift.count >= 10) {
    warnings.push(`The base recalculation differs from P6's stored dates on ${an.drift.count} activities (max ${an.drift.max} d). ${an.drift.interpretation}`);
  }
  if (meta.exactness.mismatches) {
    warnings.push(`${meta.exactness.mismatches} of ${meta.exactness.checked} applied actions solved differently in full than in trial — report this; the full solve governs every figure shown.`);
  }
  if (meta.required && targetMet === false) {
    warnings.push(`The scenario reaches ${fmt(gainDays)} of the ${fmt(requiredDays || 0)} calendar days required; ${fmt(remainingGapDays || 0)} days remain open and need a further approved decision. The gap is reported, not forced.`);
  }
  if (E.target && get(E.target).constrained) {
    warnings.push(`${E.target.code} is placed by its own constraint, so logic edits cannot move it until the constraint is reviewed.`);
  }
  if (uncosted) warnings.push(`${uncosted} edited activities have no productivity cost basis — their cost is not included in the total.`);
  warnings.push(
    "Draft / Conditional: every date, gain and cost here is a shadow calculation. Recreate the change register in a controlled P6 copy, reschedule (F9) and approve before issue or any contractual use.",
    "Resource levelling, resource availability limits and external relationships are not modelled.",
  );

  const dates = full ? full.store : new Map<string, Computed>();

  return {
    objective: C.objective,
    controls: C,
    generatedAt: new Date().toISOString(),
    ms: Date.now() - meta.t0,
    evaluations: E.evaluations,
    blocked: meta.blocked,
    stopReason: meta.stopReason,
    targetTask: E.target,
    fileFinish: meta.fileFinish,
    reestimatedFinish: meta.reestimatedFinish,
    scenarioFinish: finish,
    requiredFinish: meta.required,
    requiredDays,
    targetBasis: meta.basis,
    gainDays,
    gainWorkDays,
    remainingGapDays,
    targetMet,
    actions,
    changes,
    moved,
    longestPath,
    criticalBefore: incomplete.filter((t) => crit(t.c.tf)).length,
    criticalAfter: full ? incomplete.filter((t) => crit(get(t).tf)).length : 0,
    negativeBefore: incomplete.filter((t) => t.c.tf !== null && t.c.tf < 0).length,
    negativeAfter: full ? incomplete.filter((t) => get(t).tf !== null && get(t).tf! < 0).length : 0,
    totalCost: round2(totalCost),
    uncostedActions: uncosted,
    exactness: meta.exactness,
    warnings,
    state,
    dates,
  };
}

function buildChanges(E: Engine, state: ScenarioState, actions: ScenarioAction[]): ScenarioChange[] {
  const out: ScenarioChange[] = [];
  const leversFor = (pred: (a: ScenarioAction) => boolean) =>
    Array.from(new Set(actions.filter(pred).map((a) => a.type.replace("_", " ").toLowerCase()))).join(", ") || "manual edit";

  for (const [id, edit] of Object.entries(state.tasks)) {
    const t = E.P.byId[id];
    if (!t || !eligibleForWork(t)) continue;
    const hr = taskHours(E, t, edit);
    if (Math.abs(hr - t.rdHr) < 1e-6) continue;
    const hd = dayHours(t);
    out.push({
      kind: "Remaining duration", taskId: id, linkId: null, code: t.code, name: t.name,
      from: `${fmt(t.rdHr / hd)} d`, to: `${fmt(hr / hd)} d`, fromNumber: round2(t.rdHr / hd), toNumber: round2(hr / hd),
      p6Field: t.started ? "remain_drtn_hr_cnt" : "target_drtn_hr_cnt + remain_drtn_hr_cnt",
      levers: leversFor((a) => a.taskId === id),
    });
  }
  for (const [id, edit] of Object.entries(state.links)) {
    const l = E.linkById.get(id);
    if (!l) continue;
    const name = `${l.pred!.name} → ${l.succ!.name}`;
    const code = `${l.pred!.code} → ${l.succ!.code}`;
    if (edit.type && edit.type !== l.type) {
      out.push({
        kind: "Relationship type", taskId: null, linkId: id, code, name, from: l.type, to: edit.type,
        fromNumber: null, toNumber: null, p6Field: "pred_type", levers: leversFor((a) => a.linkId === id),
      });
    }
    if (edit.lagDays !== undefined && Math.abs(edit.lagDays - l.lag) > 1e-6) {
      out.push({
        kind: "Relationship lag", taskId: null, linkId: id, code, name, from: `${fmt(l.lag)} d`, to: `${fmt(edit.lagDays)} d`,
        fromNumber: round2(l.lag), toNumber: round2(edit.lagDays), p6Field: "lag_hr_cnt", levers: leversFor((a) => a.linkId === id),
      });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code));
}

/* ------------------------------------------------------------ runners */

/** Run to completion synchronously. */
export function runScenario(input: ScenarioInput): ScenarioResult {
  const it = optimizeScenario(input);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** Run in slices so the page stays responsive; reports progress and honours an abort signal. */
export async function runScenarioAsync(
  input: ScenarioInput,
  onProgress?: (p: ScenarioProgress) => void,
  signal?: AbortSignal,
): Promise<ScenarioResult> {
  const it = optimizeScenario(input);
  let lastYield = Date.now();
  let lastReport = 0;
  let r = it.next();
  while (!r.done) {
    if (signal && signal.aborted) throw new DOMException("Scenario run cancelled", "AbortError");
    const now = Date.now();
    // Compute in ~120 ms slices, and repaint progress at most four times a second:
    // re-rendering the controls on every slice costs more than the solve itself.
    if (now - lastYield > 120) {
      if (onProgress && now - lastReport > 250) {
        onProgress(r.value);
        lastReport = now;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
    }
    r = it.next();
  }
  return r.value;
}

/** Evaluate hand-made edits exactly, without searching for more. */
export function evaluateScenario(input: ScenarioInput): ScenarioResult {
  return runScenario({ ...input, controls: { ...input.controls, maxActions: 0, reestimateFromProductivity: false } });
}

/** Remaining hours and relationship edits a scenario resolves to — used by the XER export. */
export function resolveScenarioEdits(input: ScenarioInput, state: ScenarioState): CpmOverrides {
  return scenarioOverrides(createEngine(input), state);
}
