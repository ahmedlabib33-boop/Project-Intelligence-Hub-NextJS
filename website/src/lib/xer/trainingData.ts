/**
 * Real training data for the Learning / ML tab, extracted from loaded P6 XERs.
 *
 * Each completed activity whose planned dates and actual dates are both
 * recorded in the file is one labelled observation: how many working days its
 * actual finish landed after (+) or before (−) its planned finish. Nothing is
 * generated, sampled or filled in — an activity that lacks either set of dates
 * is excluded and counted by reason, never estimated.
 *
 * Two sources, in order of trustworthiness:
 *  - baseline vs update (two schedules loaded): the planned dates come from the
 *    baseline file and the actuals from the update file, matched by activity.
 *  - a single schedule: the planned dates are the target dates stored in that
 *    same file. That is only a real plan if the file was not re-baselined to
 *    its own actuals; `assessExtraction` detects that case and refuses it.
 *
 * What is deliberately NOT exported as a feature: activity codes and ids
 * (they would only let a model memorise rows), cost fields and resource names
 * (they can embed per-person pay), and anything only known after the activity
 * finished (actual duration, float, actual finish).
 *
 * `project_id` identifies the project, not the file: every revision of one
 * programme must share it, otherwise the engine's cross-project validation
 * would score the model on activities it already saw in training.
 */

import type { Comparison } from "./compare";
import type { ProjectView, Task } from "./model";
import { dayDiff, toCsv } from "./format";

export const OBSERVATION_SCHEMA = "pih-training-observations/1";

/** A finish this many working days late counts as "delayed" for the classifier. */
export const DELAY_THRESHOLD_DAYS = 1;

/** The engine refuses to train supervised models on fewer labelled rows than this. */
export const ENGINE_MIN_LABELLED_ROWS = 20;

/** Above this share of exactly-on-plan activities a single file is treated as re-baselined. */
export const REBASELINED_SHARE = 0.9;

/** At or above this share of early (or late) finishes an extraction needs an explicit check. */
export const ONE_SIDED_SHARE = 0.95;

export type TrainingSource = "single_schedule" | "baseline_vs_update";

export type ObservationFeatures = {
  plannedDurationDays: number;
  taskType: string;
  durationType: string;
  calendar: string;
  wbsLevel1: string;
  wbsLevel2: string;
  wbsDepth: number;
  predecessorCount: number;
  successorCount: number;
  hasConstraint: number;
  plannedStartMonth: number;
  plannedStartOffsetDays: number;
  /** Working days the activity actually started after (+) / before (−) plan. Known the moment it starts. */
  startDeviationDays: number | null;
  resourceAssignmentCount: number;
};

export type Observation = {
  /** `${project group}|${activity code}` — one observation per activity per project. */
  key: string;
  /** The project (not the file): shared by every revision of one programme. */
  projectId: string;
  /** The P6 project name inside the file the row came from. */
  scheduleName: string;
  source: TrainingSource;
  sourceLabel: string;
  activityCode: string;
  activityName: string;
  capturedAt: string;
  f: ObservationFeatures;
  /** Working days on the activity's calendar; positive = finished late. */
  finishDeviationDays: number;
};

export type DeviationStats = {
  n: number;
  min: number;
  median: number;
  max: number;
  mean: number;
  onPlanShare: number;
  delayedShare: number;
  earlyShare: number;
};

export type ExtractionReport = {
  source: TrainingSource;
  sourceLabel: string;
  projectId: string;
  scheduleName: string;
  considered: number;
  extracted: number;
  excluded: { reason: string; count: number }[];
  caveats: string[];
  stats: DeviationStats | null;
  suitable: boolean;
  suitabilityNote: string | null;
  /** Allowed, but only after the user confirms the planned dates are comparable. */
  caution: string | null;
};

export type Extraction = { observations: Observation[]; report: ExtractionReport };

export type TrainingDatasetSpec = {
  task: "forecast_finish_deviation_prediction" | "delay_risk_prediction";
  target: "finish_deviation_days" | "delay_risk";
  label: string;
  kind: "regression" | "classification";
  description: string;
};

export const TRAINING_DATASETS: TrainingDatasetSpec[] = [
  {
    task: "forecast_finish_deviation_prediction",
    target: "finish_deviation_days",
    label: "Finish deviation (days)",
    kind: "regression",
    description: "Predict how many working days an activity finishes after its plan, given its plan and how late it started.",
  },
  {
    task: "delay_risk_prediction",
    target: "delay_risk",
    label: "Delay risk (delayed / on time)",
    kind: "classification",
    description: `Classify an activity as "delayed" (finished ≥ ${DELAY_THRESHOLD_DAYS} working day late) or "on_time" (on time or early).`,
  },
];

export const FEATURE_COLUMNS = [
  "activity_name",
  "planned_duration_days",
  "task_type",
  "duration_type",
  "calendar",
  "wbs_level_1",
  "wbs_level_2",
  "wbs_depth",
  "predecessor_count",
  "successor_count",
  "has_constraint",
  "planned_start_month",
  "planned_start_offset_days",
  "start_deviation_days",
  "resource_assignment_count",
] as const;

/* ------------------------------------------------------------ statistics */

const round2 = (value: number) => Math.round(value * 100) / 100;

export function deviationStats(values: number[]): DeviationStats | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  const share = (test: (v: number) => boolean) => values.filter(test).length / values.length;
  return {
    n: values.length,
    min: sorted[0],
    median: round2(median),
    max: sorted[sorted.length - 1],
    mean: round2(values.reduce((a, b) => a + b, 0) / values.length),
    onPlanShare: share((v) => Math.abs(v) < 0.005),
    delayedShare: share((v) => v >= DELAY_THRESHOLD_DAYS),
    earlyShare: share((v) => v <= -DELAY_THRESHOLD_DAYS),
  };
}

/**
 * Decide whether an extraction is a real plan-vs-actual set. A file that
 * re-baselined itself is refused outright; a one-sided result is allowed but
 * must be acknowledged, because it usually means the planned dates are not
 * comparable with the actuals rather than that every activity really ran early
 * (or late).
 */
export function assessExtraction(
  source: TrainingSource,
  stats: DeviationStats | null,
): { suitable: boolean; note: string | null; caution: string | null } {
  if (!stats) return { suitable: false, note: "No usable plan-vs-actual observation was found. The exclusion reasons below say why — nothing is estimated to fill the gap.", caution: null };
  if (source === "single_schedule" && stats.n >= ENGINE_MIN_LABELLED_ROWS && stats.onPlanShare > REBASELINED_SHARE) {
    return {
      suitable: false,
      note: `${Math.floor(stats.onPlanShare * 100)}% of completed activities finished exactly on their target dates: this file was re-baselined to its own progress, so its "plan" is just its actuals. Load the original baseline as A and this update as B instead.`,
      caution: null,
    };
  }
  if (stats.n >= ENGINE_MIN_LABELLED_ROWS && (stats.earlyShare >= ONE_SIDED_SHARE || stats.delayedShare >= ONE_SIDED_SHARE)) {
    const early = stats.earlyShare >= ONE_SIDED_SHARE;
    return {
      suitable: true,
      note: null,
      caution: `${Math.floor((early ? stats.earlyShare : stats.delayedShare) * 100)}% of these activities finished ${early ? "early" : "late"} (median ${stats.median > 0 ? "+" : ""}${stats.median} working days). A one-sided result like this usually means the planned dates are not comparable with the actuals (a re-sequenced programme, a different calendar or a different progress history), not that every activity really ran ${early ? "early" : "late"}. Check the two schedules before adding these rows.`,
    };
  }
  return { suitable: true, note: null, caution: null };
}

/* ------------------------------------------------------------ extraction */

type Counter = Map<string, number>;
const bump = (counter: Counter, reason: string) => counter.set(reason, (counter.get(reason) || 0) + 1);

function workingDays(task: Task, from: Date, to: Date): number {
  const hoursPerDay = task.cal.dayHours || 8;
  return round2(task.cal.between(from, to) / hoursPerDay);
}

function wbsSegments(task: Task): string[] {
  // `wbsPath` is "<project root> › <level 1> › <level 2> …".
  return task.wbsPath ? task.wbsPath.split(" › ") : [];
}

function isScheduledWork(task: Task): boolean {
  return !task.isMile && !task.isLOE && !task.isWBSsum;
}

function toExcluded(counter: Counter) {
  return Array.from(counter, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

type RowContext = {
  planned: Task;
  actual: Task;
  plannedStart: Date;
  plannedFinish: Date;
  projectId: string;
  scheduleName: string;
  source: TrainingSource;
  sourceLabel: string;
  projectPlannedStart: Date | null;
  capturedAt: string;
};

function build(c: RowContext): Observation | null {
  if (!c.actual.actStart || !c.actual.actEnd) return null;
  const deviation = workingDays(c.planned, c.plannedFinish, c.actual.actEnd);
  if (!Number.isFinite(deviation)) return null;
  const startDeviation = workingDays(c.planned, c.plannedStart, c.actual.actStart);
  const segments = wbsSegments(c.planned);
  return {
    key: `${c.projectId}|${c.planned.code}`,
    projectId: c.projectId,
    scheduleName: c.scheduleName,
    source: c.source,
    sourceLabel: c.sourceLabel,
    activityCode: c.planned.code,
    activityName: c.planned.name,
    capturedAt: c.capturedAt,
    f: {
      plannedDurationDays: round2(c.planned.od),
      taskType: c.planned.typeName,
      durationType: c.planned.durTypeName,
      calendar: c.planned.calName,
      wbsLevel1: segments[1] || "",
      wbsLevel2: segments[2] || "",
      wbsDepth: Math.max(0, segments.length - 1),
      predecessorCount: c.planned.preds.length,
      successorCount: c.planned.succs.length,
      hasConstraint: c.planned.cstrType ? 1 : 0,
      plannedStartMonth: c.plannedStart.getMonth() + 1,
      plannedStartOffsetDays: c.projectPlannedStart ? Math.round(dayDiff(c.projectPlannedStart, c.plannedStart) ?? 0) : 0,
      startDeviationDays: Number.isFinite(startDeviation) ? startDeviation : null,
      resourceAssignmentCount: c.planned.rsrcs.length,
    },
    finishDeviationDays: deviation,
  };
}

function finishReport(
  observations: Observation[],
  base: Pick<ExtractionReport, "source" | "sourceLabel" | "projectId" | "scheduleName" | "considered" | "excluded" | "caveats">,
): Extraction {
  const stats = deviationStats(observations.map((row) => row.finishDeviationDays));
  const verdict = assessExtraction(base.source, stats);
  return {
    observations,
    report: { ...base, extracted: observations.length, stats, suitable: verdict.suitable, suitabilityNote: verdict.note, caution: verdict.caution },
  };
}

/**
 * One schedule on its own: planned = the target dates stored in the same file.
 * `projectGroup` names the project so every revision shares one identity.
 */
export function extractFromSchedule(view: ProjectView, projectGroup?: string): Extraction {
  const projectId = (projectGroup || "").trim() || view.name;
  const sourceLabel = `${view.S.fileName} (target dates vs actual dates)`;
  const capturedAt = new Date().toISOString();
  const excluded: Counter = new Map();
  const observations: Observation[] = [];
  const starts = view.tasks.map((t) => t.targetStart).filter((d): d is Date => !!d);
  const projectPlannedStart = starts.length ? new Date(Math.min(...starts.map((d) => +d))) : null;

  for (const task of view.tasks) {
    if (!isScheduledWork(task)) {
      bump(excluded, "Milestone, level-of-effort or WBS-summary activity");
      continue;
    }
    if (!task.done) {
      bump(excluded, "Not completed yet — no actual finish to learn from");
      continue;
    }
    if (!task.actStart || !task.actEnd) {
      bump(excluded, "Completed but actual start or finish is not recorded");
      continue;
    }
    if (!task.targetStart || !task.targetEnd) {
      bump(excluded, "No planned (target) dates recorded");
      continue;
    }
    if (!(task.odHr > 0)) {
      bump(excluded, "Zero planned duration");
      continue;
    }
    const row = build({
      planned: task, actual: task, plannedStart: task.targetStart, plannedFinish: task.targetEnd,
      projectId, scheduleName: view.name, source: "single_schedule", sourceLabel, projectPlannedStart, capturedAt,
    });
    if (row) observations.push(row);
    else bump(excluded, "Dates could not be converted to working days");
  }

  return finishReport(observations, {
    source: "single_schedule",
    sourceLabel,
    projectId,
    scheduleName: view.name,
    considered: view.tasks.length,
    excluded: toExcluded(excluded),
    caveats: [
      "Planned dates are the target dates stored in this same file. They are a real plan only if the schedule was not re-baselined to its own progress.",
    ],
  });
}

export type OrientedComparison = {
  baseline: ProjectView;
  update: ProjectView;
  /** Matched activities as (planned, actual) = (earlier schedule, later schedule). */
  pairs: { planned: Task; actual: Task }[];
  /** Slot A held the later schedule, so the roles were swapped. */
  swapped: boolean;
  /** Data dates were missing or equal, so slot A was assumed to be the earlier schedule. */
  assumed: boolean;
};

/**
 * Decide which loaded schedule is the baseline and which the update from their
 * data dates, not from the slot they were loaded into: the comparison engine reads
 * A → B as earlier → later, while the slot captions have said the opposite.
 */
export function orientComparison(cmp: Comparison): OrientedComparison {
  const dataA = cmp.PA.dataDate;
  const dataB = cmp.PB.dataDate;
  const swapped = !!dataA && !!dataB && +dataA > +dataB;
  const assumed = !dataA || !dataB || +dataA === +dataB;
  return {
    baseline: swapped ? cmp.PB : cmp.PA,
    update: swapped ? cmp.PA : cmp.PB,
    pairs: cmp.matched.map(({ a, b }) => (swapped ? { planned: b, actual: a } : { planned: a, actual: b })),
    swapped,
    assumed,
  };
}

/** Baseline vs update: planned dates from the earlier schedule, actuals from the later one, matched by activity. */
export function extractFromComparison(cmp: Comparison, projectGroup?: string): Extraction {
  const oriented = orientComparison(cmp);
  const projectId = (projectGroup || "").trim() || oriented.update.name;
  const sourceLabel = `${oriented.baseline.S.fileName} (baseline) → ${oriented.update.S.fileName} (update)`;
  const capturedAt = new Date().toISOString();
  const excluded: Counter = new Map();
  const observations: Observation[] = [];
  const starts = oriented.baseline.tasks.map((t) => t.earlyStart || t.targetStart).filter((d): d is Date => !!d);
  const projectPlannedStart = starts.length ? new Date(Math.min(...starts.map((d) => +d))) : null;
  const baselineDataDate = oriented.baseline.dataDate;

  for (const { planned: a, actual: b } of oriented.pairs) {
    if (!isScheduledWork(a) || !isScheduledWork(b)) {
      bump(excluded, "Milestone, level-of-effort or WBS-summary activity");
      continue;
    }
    if (!b.done) {
      bump(excluded, "Not completed in the update — no actual finish to learn from");
      continue;
    }
    if (!b.actStart || !b.actEnd) {
      bump(excluded, "Completed in the update but actual start or finish is not recorded");
      continue;
    }
    if (a.started) {
      bump(excluded, "Already started in the baseline — its planned dates are not a forecast");
      continue;
    }
    if (baselineDataDate && b.actStart < baselineDataDate) {
      bump(excluded, "Started before the baseline's data date although the baseline has it not started — the two files do not share one progress history");
      continue;
    }
    const plannedStart = a.earlyStart || a.targetStart;
    const plannedFinish = a.earlyEnd || a.targetEnd;
    if (!plannedStart || !plannedFinish) {
      bump(excluded, "No planned dates in the baseline");
      continue;
    }
    if (!(a.odHr > 0)) {
      bump(excluded, "Zero planned duration in the baseline");
      continue;
    }
    const row = build({
      planned: a, actual: b, plannedStart, plannedFinish,
      projectId, scheduleName: oriented.update.name, source: "baseline_vs_update", sourceLabel, projectPlannedStart, capturedAt,
    });
    if (row) observations.push(row);
    else bump(excluded, "Dates could not be converted to working days");
  }

  const caveats = ["Planned dates, duration, logic counts and WBS come from the baseline; only the actual dates come from the update."];
  if (oriented.swapped) {
    caveats.push(`Slot A holds the later schedule (data date ${oriented.update.dataDate?.toDateString()}), so it was used as the update and slot B as the baseline.`);
  }
  if (oriented.assumed) {
    caveats.push("The two schedules' data dates are missing or equal, so slot A was assumed to be the earlier one. Check the direction before adding these rows.");
  }
  if (cmp.removed.length + cmp.added.length > 0) {
    caveats.push(`${cmp.removed.length + cmp.added.length} activities exist in only one of the two schedules (renamed, added or removed) and were not used.`);
  }
  return finishReport(observations, {
    source: "baseline_vs_update",
    sourceLabel,
    projectId,
    scheduleName: oriented.update.name,
    considered: cmp.matched.length,
    excluded: toExcluded(excluded),
    caveats,
  });
}

/* --------------------------------------------------------- accumulation */

export type MergeResult = { merged: Observation[]; added: number; replaced: number; keptBetter: number };

/**
 * Merge new observations into an existing set. One row per activity per project:
 * a newer observation replaces an older one, except that a single-schedule row
 * never overwrites a baseline-vs-update row (the better-evidenced of the two).
 */
export function mergeObservations(existing: Observation[], incoming: Observation[]): MergeResult {
  const byKey = new Map(existing.map((row) => [row.key, row]));
  let added = 0;
  let replaced = 0;
  let keptBetter = 0;
  for (const row of incoming) {
    const current = byKey.get(row.key);
    if (!current) {
      byKey.set(row.key, row);
      added++;
    } else if (current.source === "baseline_vs_update" && row.source === "single_schedule") {
      keptBetter++;
    } else {
      byKey.set(row.key, row);
      replaced++;
    }
  }
  return { merged: Array.from(byKey.values()), added, replaced, keptBetter };
}

export function removeProject(observations: Observation[], projectId: string): Observation[] {
  return observations.filter((row) => row.projectId !== projectId);
}

export type ProjectTally = { projectId: string; count: number; baselineRows: number; schedules: string[] };

export function observationsByProject(observations: Observation[]): ProjectTally[] {
  const map = new Map<string, ProjectTally>();
  for (const row of observations) {
    const entry = map.get(row.projectId) || { projectId: row.projectId, count: 0, baselineRows: 0, schedules: [] };
    entry.count++;
    if (row.source === "baseline_vs_update") entry.baselineRows++;
    if (!entry.schedules.includes(row.scheduleName)) entry.schedules.push(row.scheduleName);
    map.set(row.projectId, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/* --------------------------------------------------- portable set (JSON) */

export function serializeObservationSet(observations: Observation[]): string {
  return JSON.stringify({ schema: OBSERVATION_SCHEMA, exportedAt: new Date().toISOString(), observations }, null, 1);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObservation(value: unknown): value is Observation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Observation>;
  const f = row.f as Partial<ObservationFeatures> | undefined;
  return (
    typeof row.key === "string" && row.key.length > 0 &&
    typeof row.projectId === "string" && row.projectId.length > 0 &&
    typeof row.activityCode === "string" &&
    typeof row.activityName === "string" &&
    (row.source === "single_schedule" || row.source === "baseline_vs_update") &&
    isFiniteNumber(row.finishDeviationDays) &&
    !!f && isFiniteNumber(f.plannedDurationDays) && isFiniteNumber(f.wbsDepth) &&
    isFiniteNumber(f.predecessorCount) && isFiniteNumber(f.successorCount) &&
    isFiniteNumber(f.hasConstraint) && isFiniteNumber(f.plannedStartMonth) &&
    isFiniteNumber(f.plannedStartOffsetDays) && isFiniteNumber(f.resourceAssignmentCount) &&
    (f.startDeviationDays === null || isFiniteNumber(f.startDeviationDays)) &&
    typeof f.taskType === "string" && typeof f.durationType === "string" && typeof f.calendar === "string" &&
    typeof f.wbsLevel1 === "string" && typeof f.wbsLevel2 === "string"
  );
}

/** Read a saved or imported set; malformed rows are counted and dropped, never repaired. */
export function parseObservationSet(text: string): { observations: Observation[]; rejected: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const record = data as { schema?: unknown; observations?: unknown };
  if (!record || record.schema !== OBSERVATION_SCHEMA || !Array.isArray(record.observations)) {
    throw new Error(`This is not a training set exported from the Hub (expected schema "${OBSERVATION_SCHEMA}").`);
  }
  const observations: Observation[] = [];
  let rejected = 0;
  for (const row of record.observations) {
    if (isObservation(row)) observations.push({ ...row, scheduleName: typeof row.scheduleName === "string" ? row.scheduleName : "", sourceLabel: typeof row.sourceLabel === "string" ? row.sourceLabel : "", capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "" });
    else rejected++;
  }
  return { observations, rejected };
}

/* -------------------------------------------------------------- datasets */

export function delayClass(finishDeviationDays: number): "delayed" | "on_time" {
  return finishDeviationDays >= DELAY_THRESHOLD_DAYS ? "delayed" : "on_time";
}

function featureCells(row: Observation): (string | number)[] {
  const f = row.f;
  return [
    row.activityName,
    f.plannedDurationDays,
    f.taskType,
    f.durationType,
    f.calendar,
    f.wbsLevel1,
    f.wbsLevel2,
    f.wbsDepth,
    f.predecessorCount,
    f.successorCount,
    f.hasConstraint,
    f.plannedStartMonth,
    f.plannedStartOffsetDays,
    f.startDeviationDays === null ? "" : f.startDeviationDays,
    f.resourceAssignmentCount,
  ];
}

export type DatasetTable = { header: string[]; rows: (string | number)[][]; csv: string };

/** The exact CSV the engine trains on: project_id, features, then exactly one target column. */
export function buildTrainingTable(observations: Observation[], spec: TrainingDatasetSpec): DatasetTable {
  const header = ["project_id", ...FEATURE_COLUMNS, spec.target];
  const rows = observations.map((row) => [
    row.projectId,
    ...featureCells(row),
    spec.target === "delay_risk" ? delayClass(row.finishDeviationDays) : row.finishDeviationDays,
  ]);
  return { header, rows, csv: toCsv(header, rows) };
}

/** Row-level provenance, kept out of the training file so identifiers never become features. */
export function buildTraceabilityCsv(observations: Observation[]): string {
  const header = ["row", "project_id", "schedule_name", "activity_code", "activity_name", "source", "source_files", "finish_deviation_days", "start_deviation_days", "captured_at"];
  const rows = observations.map((row, index) => [
    index + 1,
    row.projectId,
    row.scheduleName,
    row.activityCode,
    row.activityName,
    row.source,
    row.sourceLabel,
    row.finishDeviationDays,
    row.f.startDeviationDays === null ? "" : row.f.startDeviationDays,
    row.capturedAt,
  ]);
  return toCsv(header, rows);
}

/* ------------------------------------------------- reference benchmarks */

export type RuleScore = {
  name: string;
  description: string;
  mae?: number;
  rmse?: number;
  r2?: number;
  accuracy?: number;
  balancedAccuracy?: number;
};

export type Benchmark = { kind: "regression" | "classification"; rows: number; rules: RuleScore[] };

function regressionScore(name: string, description: string, actual: number[], predicted: number[]): RuleScore {
  const n = actual.length;
  const mean = actual.reduce((a, b) => a + b, 0) / n;
  let abs = 0;
  let sq = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const err = actual[i] - predicted[i];
    abs += Math.abs(err);
    sq += err * err;
    total += (actual[i] - mean) ** 2;
  }
  return { name, description, mae: round2(abs / n), rmse: round2(Math.sqrt(sq / n)), r2: total > 0 ? Math.round((1 - sq / total) * 1000) / 1000 : undefined };
}

function classificationScore(name: string, description: string, actual: string[], predicted: string[]): RuleScore {
  const n = actual.length;
  let correct = 0;
  const hit = new Map<string, number>();
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    seen.set(actual[i], (seen.get(actual[i]) || 0) + 1);
    if (actual[i] === predicted[i]) {
      correct++;
      hit.set(actual[i], (hit.get(actual[i]) || 0) + 1);
    }
  }
  const recalls = Array.from(seen, ([label, count]) => (hit.get(label) || 0) / count);
  return {
    name,
    description,
    accuracy: Math.round((correct / n) * 1000) / 1000,
    balancedAccuracy: Math.round((recalls.reduce((a, b) => a + b, 0) / recalls.length) * 1000) / 1000,
  };
}

/**
 * Simple rules a model has to beat to be worth using, scored on every row of the
 * dataset. A model that cannot beat "finish as late as it started" adds nothing
 * a planner could not do without machine learning.
 */
export function naiveBenchmark(observations: Observation[], spec: TrainingDatasetSpec): Benchmark {
  const rows = observations.length;
  if (!rows) return { kind: spec.kind, rows, rules: [] };
  const startSlip = observations.map((row) => row.f.startDeviationDays ?? 0);

  if (spec.kind === "regression") {
    const actual = observations.map((row) => row.finishDeviationDays);
    const mean = actual.reduce((a, b) => a + b, 0) / rows;
    return {
      kind: "regression",
      rows,
      rules: [
        regressionScore("Finishes on plan", "Always predict 0 days of deviation.", actual, actual.map(() => 0)),
        regressionScore("Average of this data", "Always predict the mean deviation of these rows.", actual, actual.map(() => mean)),
        regressionScore("Finishes as late as it started", "Predict the finish slip equals the start slip.", actual, startSlip),
      ],
    };
  }

  const actual = observations.map((row) => delayClass(row.finishDeviationDays));
  return {
    kind: "classification",
    rows,
    rules: [
      classificationScore("Always on time", 'Always predict "on_time".', actual, actual.map(() => "on_time")),
      classificationScore(
        "Delayed if it started late",
        `Predict "delayed" when the activity started ≥ ${DELAY_THRESHOLD_DAYS} working day late.`,
        actual,
        startSlip.map((slip) => (slip >= DELAY_THRESHOLD_DAYS ? "delayed" : "on_time")),
      ),
    ],
  };
}

export type Verdict = { level: "beats" | "mixed" | "does_not_beat"; message: string };

const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Compare the engine's measured validation metrics with the reference rules. Never overstates. */
export function judgeModel(metrics: Record<string, unknown> | null | undefined, benchmark: Benchmark): Verdict | null {
  if (!metrics || !benchmark.rules.length) return null;
  const caveat = " The rules are scored on all rows; the model on the engine's held-out rows.";

  if (benchmark.kind === "regression") {
    const mae = asNumber(metrics.mae);
    const rmse = asNumber(metrics.rmse);
    if (mae === null || rmse === null) return null;
    const bestMae = Math.min(...benchmark.rules.map((r) => r.mae ?? Infinity));
    const bestRmse = Math.min(...benchmark.rules.map((r) => r.rmse ?? Infinity));
    if (mae < bestMae && rmse < bestRmse) return { level: "beats", message: `Beats every reference rule on both MAE and RMSE.${caveat}` };
    if (mae >= bestMae && rmse >= bestRmse) {
      return { level: "does_not_beat", message: `Does not beat the best reference rule on MAE or RMSE — use the rule, not the model.${caveat}` };
    }
    return { level: "mixed", message: `Beats the best reference rule on only one of MAE and RMSE — inconclusive at this data size.${caveat}` };
  }

  const balanced = asNumber(metrics.balanced_accuracy);
  if (balanced === null) return null;
  const best = Math.max(...benchmark.rules.map((r) => r.balancedAccuracy ?? 0));
  if (balanced > best) return { level: "beats", message: `Balanced accuracy is above every reference rule.${caveat}` };
  return { level: "does_not_beat", message: `Balanced accuracy (${balanced.toFixed(3)}) does not beat the best reference rule (${best.toFixed(3)}) — use the rule, not the model.${caveat}` };
}

export type DatasetSummary = {
  rows: number;
  projects: number;
  meetsEngineFloor: boolean;
  classCounts: { label: string; count: number }[];
  warnings: string[];
};

export function describeDataset(observations: Observation[], spec: TrainingDatasetSpec): DatasetSummary {
  const rows = observations.length;
  const projects = new Set(observations.map((row) => row.projectId)).size;
  const warnings: string[] = [];
  const classes = new Map<string, number>();
  if (spec.kind === "classification") {
    for (const row of observations) {
      const label = delayClass(row.finishDeviationDays);
      classes.set(label, (classes.get(label) || 0) + 1);
    }
  }

  if (rows < ENGINE_MIN_LABELLED_ROWS) {
    warnings.push(`${rows} labelled row${rows === 1 ? "" : "s"} — the engine refuses supervised training below ${ENGINE_MIN_LABELLED_ROWS}.`);
  }
  if (projects < 2 && rows > 0) {
    warnings.push("Only one project: the engine validates on random rows from that same project, so its metrics do not show how the model performs on a different project. Add more projects for cross-project validation.");
  }
  if (spec.kind === "classification" && rows > 0 && classes.size < 2) {
    warnings.push("Every row falls in a single class — a classifier needs both delayed and on-time examples.");
  }
  if (spec.kind === "classification" && classes.size === 2 && Math.min(...classes.values()) < 2) {
    warnings.push("One class has fewer than 2 examples, so the engine cannot stratify its validation split.");
  }

  return {
    rows,
    projects,
    meetsEngineFloor: rows >= ENGINE_MIN_LABELLED_ROWS,
    classCounts: Array.from(classes, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    warnings,
  };
}
