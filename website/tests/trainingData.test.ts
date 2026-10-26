import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareSchedules } from "../src/lib/xer/compare";
import { buildSchedule, projectView, type ProjectView } from "../src/lib/xer/model";
import { DEFAULT_OPTIONS } from "../src/lib/xer/options";
import {
  assessExtraction,
  buildTraceabilityCsv,
  buildTrainingTable,
  deviationStats,
  delayClass,
  describeDataset,
  extractFromComparison,
  extractFromSchedule,
  judgeModel,
  mergeObservations,
  naiveBenchmark,
  observationsByProject,
  orientComparison,
  parseObservationSet,
  removeProject,
  serializeObservationSet,
  TRAINING_DATASETS,
  type Observation,
} from "../src/lib/xer/trainingData";

/* ------------------------------------------------------- XER fixtures */

type FixtureTask = {
  code: string;
  name?: string;
  type?: "TT_Task" | "TT_Mile";
  status: "TK_NotStart" | "TK_Active" | "TK_Complete";
  target?: [string, string];
  early?: [string, string];
  actual?: [string, string];
  hours?: number;
  constraint?: string;
};

// The default calendar works Mon–Fri, 08:00–12:00 and 13:00–17:00 (8 h/day).
function xer(project: string, tasks: FixtureTask[], preds: [string, string][] = [], dataDate = "2025-03-01 00:00"): string {
  const lines: string[] = [];
  const table = (name: string, fields: string[], rows: string[][]) => {
    lines.push(`%T\t${name}`, `%F\t${fields.join("\t")}`);
    for (const row of rows) lines.push(`%R\t${row.join("\t")}`);
  };
  table("PROJECT", ["proj_id", "proj_short_name", "last_recalc_date", "export_flag"], [["P1", project, dataDate, "Y"]]);
  table(
    "PROJWBS",
    ["wbs_id", "proj_id", "parent_wbs_id", "wbs_short_name", "wbs_name", "proj_node_flag", "seq_num"],
    [["W0", "P1", "", "ROOT", project, "Y", "0"], ["W1", "P1", "W0", "CIV", "Civil", "N", "1"], ["W2", "P1", "W1", "FND", "Foundations", "N", "1"]],
  );
  const fields = [
    "task_id", "proj_id", "wbs_id", "task_code", "task_name", "task_type", "duration_type", "status_code",
    "target_start_date", "target_end_date", "early_start_date", "early_end_date", "act_start_date", "act_end_date",
    "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "cstr_type",
  ];
  table(
    "TASK",
    fields,
    tasks.map((t, i) => [
      String(i + 1), "P1", "W2", t.code, t.name || `Activity ${t.code}`, t.type || "TT_Task", "DT_FixedDrtn", t.status,
      t.target?.[0] || "", t.target?.[1] || "", t.early?.[0] || "", t.early?.[1] || "", t.actual?.[0] || "", t.actual?.[1] || "",
      String(t.hours ?? 40), t.status === "TK_Complete" ? "0" : String(t.hours ?? 40), t.constraint || "",
    ]),
  );
  const id = (code: string) => String(tasks.findIndex((t) => t.code === code) + 1);
  table(
    "TASKPRED",
    ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"],
    preds.map(([pred, succ], i) => [String(i + 1), id(succ), id(pred), "P1", "P1", "PR_FS", "0"]),
  );
  return lines.join("\n");
}

function view(project: string, tasks: FixtureTask[], preds: [string, string][] = [], fileName = `${project}.xer`, dataDate?: string): ProjectView {
  const text = xer(project, tasks, preds, dataDate);
  const schedule = buildSchedule(text, fileName, text.length);
  const result = projectView(schedule, schedule.activeProj);
  assert.ok(result, "fixture must produce a project view");
  return result;
}

const ON_PLAN: FixtureTask["target"] = ["2025-01-13 08:00", "2025-01-15 17:00"];

const SINGLE: FixtureTask[] = [
  // Starts 2 working days late; finishes Wed→Wed next week = 5 working days (not 7 calendar days) late.
  { code: "T1", status: "TK_Complete", target: ["2025-01-06 08:00", "2025-01-08 17:00"], actual: ["2025-01-08 08:00", "2025-01-15 17:00"] },
  // Finishes Fri→Tue = 3 working days early.
  { code: "T2", status: "TK_Complete", target: ["2025-01-13 08:00", "2025-01-17 17:00"], actual: ["2025-01-13 08:00", "2025-01-14 17:00"], constraint: "CS_MSO" },
  { code: "T3", status: "TK_Complete", target: ON_PLAN, actual: ON_PLAN },
  { code: "T4", status: "TK_Active", target: ON_PLAN, actual: ["2025-01-13 08:00", ""] },
  { code: "T5", status: "TK_Complete", type: "TT_Mile", target: ON_PLAN, actual: ON_PLAN },
  { code: "T6", status: "TK_Complete", target: ON_PLAN },
  { code: "T7", status: "TK_Complete", actual: ON_PLAN },
  { code: "T8", status: "TK_Complete", target: ON_PLAN, actual: ON_PLAN, hours: 0 },
];

/* ----------------------------------------------------------- tests */

describe("extractFromSchedule", () => {
  const ex = extractFromSchedule(view("Marassi Bridges", SINGLE, [["T3", "T1"]]), "Marassi");
  const byCode = new Map(ex.observations.map((o) => [o.activityCode, o]));

  it("measures working days on the activity calendar, skipping weekends", () => {
    assert.equal(byCode.get("T1")?.finishDeviationDays, 5);
    assert.equal(byCode.get("T2")?.finishDeviationDays, -3);
    assert.equal(byCode.get("T3")?.finishDeviationDays, 0);
  });

  it("records how late the activity started as a feature known at start", () => {
    assert.equal(byCode.get("T1")?.f.startDeviationDays, 2);
    assert.equal(byCode.get("T2")?.f.startDeviationDays, 0);
  });

  it("takes structure from the schedule", () => {
    const t1 = byCode.get("T1")!;
    assert.equal(t1.f.plannedDurationDays, 5);
    assert.equal(t1.f.wbsLevel1, "CIV");
    assert.equal(t1.f.wbsLevel2, "FND");
    assert.equal(t1.f.wbsDepth, 2);
    assert.equal(t1.f.predecessorCount, 1);
    assert.equal(t1.f.plannedStartMonth, 1);
    assert.equal(byCode.get("T2")?.f.hasConstraint, 1);
    assert.equal(byCode.get("T3")?.f.successorCount, 1);
  });

  it("uses the project group, not the P6 project name, as the project identity", () => {
    assert.equal(ex.report.projectId, "Marassi");
    assert.equal(byCode.get("T1")?.projectId, "Marassi");
    assert.equal(byCode.get("T1")?.scheduleName, "Marassi Bridges");
    assert.equal(byCode.get("T1")?.key, "Marassi|T1");
  });

  it("excludes what it cannot learn from and counts every reason", () => {
    assert.equal(ex.report.considered, 8);
    assert.equal(ex.report.extracted, 3);
    const reasons = Object.fromEntries(ex.report.excluded.map((e) => [e.reason, e.count]));
    assert.equal(reasons["Not completed yet — no actual finish to learn from"], 1);
    assert.equal(reasons["Milestone, level-of-effort or WBS-summary activity"], 1);
    assert.equal(reasons["Completed but actual start or finish is not recorded"], 1);
    assert.equal(reasons["No planned (target) dates recorded"], 1);
    assert.equal(reasons["Zero planned duration"], 1);
    assert.equal(ex.report.excluded.reduce((sum, e) => sum + e.count, 0) + ex.report.extracted, ex.report.considered);
  });

  it("falls back to the P6 project name when no group is given", () => {
    assert.equal(extractFromSchedule(view("Marassi Bridges", SINGLE)).report.projectId, "Marassi Bridges");
  });
});

describe("extractFromComparison", () => {
  const baseline: FixtureTask[] = [
    { code: "T1", status: "TK_NotStart", early: ["2025-01-06 08:00", "2025-01-08 17:00"], target: ["2025-01-06 08:00", "2025-01-08 17:00"] },
    { code: "T2", status: "TK_NotStart", early: ON_PLAN, target: ON_PLAN },
    { code: "T3", status: "TK_Active", early: ON_PLAN, target: ON_PLAN, actual: ["2025-01-13 08:00", ""] },
    { code: "T4", status: "TK_NotStart", early: ON_PLAN, target: ON_PLAN },
    { code: "T10", status: "TK_NotStart", early: ON_PLAN, target: ON_PLAN },
  ];
  const update: FixtureTask[] = [
    // Done before the baseline's data date although the baseline has it not started: impossible history.
    { code: "T10", status: "TK_Complete", target: ON_PLAN, actual: ["2024-12-20 08:00", "2024-12-23 17:00"] },
    { code: "T1", status: "TK_Complete", target: ["2025-01-20 08:00", "2025-01-22 17:00"], actual: ["2025-01-08 08:00", "2025-01-15 17:00"] },
    { code: "T2", status: "TK_Complete", target: ON_PLAN, actual: ["2025-01-13 08:00", "2025-01-15 17:00"] },
    { code: "T3", status: "TK_Complete", target: ON_PLAN, actual: ON_PLAN },
    { code: "T4", status: "TK_Active", target: ON_PLAN, actual: ["2025-01-13 08:00", ""] },
    { code: "T9", status: "TK_Complete", target: ON_PLAN, actual: ON_PLAN },
  ];
  const A = view("Baseline", baseline, [], "baseline.xer", "2025-01-01 00:00");
  const B = view("Update", update, [], "update.xer", "2025-02-01 00:00");
  const ex = extractFromComparison(compareSchedules(A, B, DEFAULT_OPTIONS), "Marassi");

  it("reads the same rows whichever slot each schedule was loaded into", () => {
    const swapped = extractFromComparison(compareSchedules(B, A, DEFAULT_OPTIONS), "Marassi");
    const strip = (rows: Observation[]) => rows.map((o) => ({ code: o.activityCode, dev: o.finishDeviationDays, f: o.f })).sort((x, y) => x.code.localeCompare(y.code));
    assert.deepEqual(strip(swapped.observations), strip(ex.observations));
    assert.match(swapped.report.sourceLabel, /baseline\.xer \(baseline\).*update\.xer \(update\)/);
    assert.ok(swapped.report.caveats.some((c) => /Slot A holds the later schedule/.test(c)));
    assert.ok(!ex.report.caveats.some((c) => /Slot A holds the later schedule/.test(c)));
  });

  it("orients by data date and says so when it cannot", () => {
    const cmp = compareSchedules(A, B, DEFAULT_OPTIONS);
    assert.deepEqual([orientComparison(cmp).swapped, orientComparison(cmp).assumed], [false, false]);
    assert.deepEqual([orientComparison(compareSchedules(B, A, DEFAULT_OPTIONS)).swapped, orientComparison(compareSchedules(B, A, DEFAULT_OPTIONS)).assumed], [true, false]);
    const sameDate = view("Update", update, [], "same.xer", "2025-01-01 00:00");
    const unknown = orientComparison(compareSchedules(A, sameDate, DEFAULT_OPTIONS));
    assert.equal(unknown.assumed, true);
    const caveats = extractFromComparison(compareSchedules(A, sameDate, DEFAULT_OPTIONS)).report.caveats;
    assert.ok(caveats.some((c) => /missing or equal/.test(c)));
  });

  it("plans from the baseline's dates, not the update's re-planned target dates", () => {
    const t1 = ex.observations.find((o) => o.activityCode === "T1");
    assert.equal(t1?.finishDeviationDays, 5);
    assert.equal(t1?.source, "baseline_vs_update");
  });

  it("reports the baseline-vs-update source and both file names", () => {
    assert.equal(ex.report.source, "baseline_vs_update");
    assert.match(ex.report.sourceLabel, /baseline\.xer.*update\.xer/);
  });

  it("excludes activities already started in the baseline and ones not completed in the update", () => {
    const reasons = Object.fromEntries(ex.report.excluded.map((e) => [e.reason, e.count]));
    assert.equal(reasons["Already started in the baseline — its planned dates are not a forecast"], 1);
    assert.equal(reasons["Not completed in the update — no actual finish to learn from"], 1);
    assert.deepEqual(ex.observations.map((o) => o.activityCode).sort(), ["T1", "T2"]);
  });

  it("refuses rows whose update history contradicts the baseline's data date", () => {
    const reasons = Object.fromEntries(ex.report.excluded.map((e) => [e.reason, e.count]));
    assert.equal(reasons["Started before the baseline's data date although the baseline has it not started — the two files do not share one progress history"], 1);
    assert.ok(!ex.observations.some((o) => o.activityCode === "T10"));
  });

  it("flags activities that exist in only one schedule", () => {
    assert.ok(ex.report.caveats.some((c) => /1 activities exist in only one of the two schedules/.test(c)));
  });
});

describe("assessExtraction", () => {
  const rebaselined = deviationStats(Array.from({ length: 30 }, (_, i) => (i === 0 ? 3 : 0)));
  const genuine = deviationStats(Array.from({ length: 30 }, (_, i) => i - 10));

  it("refuses a single file whose actuals equal its own plan", () => {
    const verdict = assessExtraction("single_schedule", rebaselined);
    assert.equal(verdict.suitable, false);
    assert.match(verdict.note || "", /re-baselined/);
  });

  it("does not claim 100% when the share is only just above the threshold", () => {
    const stats = deviationStats(Array.from({ length: 300 }, (_, i) => (i === 0 ? 1 : 0)));
    assert.match(assessExtraction("single_schedule", stats).note || "", /^99%/);
  });

  it("accepts the same distribution from a real baseline", () => {
    assert.equal(assessExtraction("baseline_vs_update", rebaselined).suitable, true);
  });

  it("accepts a single file with genuine spread, and does not judge tiny samples", () => {
    assert.equal(assessExtraction("single_schedule", genuine).suitable, true);
    assert.equal(assessExtraction("single_schedule", deviationStats([0, 0, 0])).suitable, true);
  });

  it("allows a one-sided distribution only with a caution to acknowledge", () => {
    const early = assessExtraction("baseline_vs_update", deviationStats(Array.from({ length: 30 }, (_, i) => -20 - i)));
    assert.equal(early.suitable, true);
    assert.match(early.caution || "", /^100% of these activities finished early/);
    const late = assessExtraction("baseline_vs_update", deviationStats(Array.from({ length: 30 }, (_, i) => 5 + i)));
    assert.match(late.caution || "", /finished late/);
    assert.equal(assessExtraction("baseline_vs_update", genuine).caution, null);
  });

  it("does not call a tiny sample one-sided", () => {
    assert.equal(assessExtraction("baseline_vs_update", deviationStats([-5, -6, -7])).caution, null);
  });

  it("refuses an empty extraction", () => {
    assert.equal(assessExtraction("single_schedule", null).suitable, false);
  });
});

describe("deviationStats", () => {
  it("computes the distribution", () => {
    const stats = deviationStats([-4, -1, 0, 2, 6]);
    assert.ok(stats);
    assert.equal(stats.median, 0);
    assert.equal(stats.min, -4);
    assert.equal(stats.max, 6);
    assert.equal(stats.mean, 0.6);
    assert.equal(stats.onPlanShare, 0.2);
    assert.equal(stats.delayedShare, 0.4);
    assert.equal(stats.earlyShare, 0.4);
  });

  it("averages the two middle values for an even count", () => {
    assert.equal(deviationStats([1, 2, 3, 10])?.median, 2.5);
  });
});

function obs(project: string, code: string, finish: number, start: number | null = 0, source: Observation["source"] = "single_schedule"): Observation {
  return {
    key: `${project}|${code}`, projectId: project, scheduleName: `${project}.xer`, source, sourceLabel: "x", activityCode: code, activityName: `Activity ${code}`, capturedAt: "t",
    f: {
      plannedDurationDays: 5, taskType: "Task Dependent", durationType: "Fixed", calendar: "5x8", wbsLevel1: "CIV", wbsLevel2: "FND", wbsDepth: 2,
      predecessorCount: 1, successorCount: 1, hasConstraint: 0, plannedStartMonth: 3, plannedStartOffsetDays: 10, startDeviationDays: start, resourceAssignmentCount: 2,
    },
    finishDeviationDays: finish,
  };
}

describe("training set accumulation", () => {
  it("keeps one row per activity per project", () => {
    const first = mergeObservations([], [obs("A", "T1", 1), obs("A", "T2", 2)]);
    assert.equal(first.added, 2);
    const second = mergeObservations(first.merged, [obs("A", "T1", 9), obs("B", "T1", 3)]);
    assert.equal(second.added, 1);
    assert.equal(second.replaced, 1);
    assert.equal(second.merged.length, 3);
    assert.equal(second.merged.find((o) => o.key === "A|T1")?.finishDeviationDays, 9);
  });

  it("never lets a single-schedule row overwrite a baseline-vs-update row", () => {
    const base = mergeObservations([], [obs("A", "T1", 4, 0, "baseline_vs_update")]);
    const next = mergeObservations(base.merged, [obs("A", "T1", 0, 0, "single_schedule")]);
    assert.equal(next.keptBetter, 1);
    assert.equal(next.merged[0].finishDeviationDays, 4);
    const upgraded = mergeObservations(next.merged, [obs("A", "T1", 7, 0, "baseline_vs_update")]);
    assert.equal(upgraded.merged[0].finishDeviationDays, 7);
  });

  it("tallies and removes whole projects", () => {
    const set = [obs("A", "T1", 1), obs("A", "T2", 2, 0, "baseline_vs_update"), obs("B", "T1", 3)];
    const tally = observationsByProject(set);
    assert.deepEqual(tally.map((t) => [t.projectId, t.count, t.baselineRows]), [["A", 2, 1], ["B", 1, 0]]);
    assert.deepEqual(removeProject(set, "A").map((o) => o.projectId), ["B"]);
  });
});

describe("portable training set", () => {
  const set = [obs("A", "T1", 1.5, null), obs("B", "T2", -2)];

  it("round-trips without loss", () => {
    const parsed = parseObservationSet(serializeObservationSet(set));
    assert.equal(parsed.rejected, 0);
    assert.deepEqual(parsed.observations, set);
  });

  it("rejects the wrong schema and invalid JSON", () => {
    assert.throws(() => parseObservationSet(JSON.stringify({ schema: "other/1", observations: [] })), /not a training set/);
    assert.throws(() => parseObservationSet("{nope"), /not valid JSON/);
  });

  it("drops malformed rows and counts them instead of repairing them", () => {
    const broken = JSON.parse(serializeObservationSet(set));
    broken.observations.push({ key: "x" }, { ...set[0], finishDeviationDays: "late" }, null);
    const parsed = parseObservationSet(JSON.stringify(broken));
    assert.equal(parsed.observations.length, 2);
    assert.equal(parsed.rejected, 3);
  });
});

describe("training files", () => {
  const [regression, classification] = TRAINING_DATASETS;
  const set = [obs("A", "T1", 0.99), obs("A", "T2", 1), obs("B", "T3", -5, null)];

  it("puts project_id first and exactly one target last", () => {
    const table = buildTrainingTable(set, regression);
    assert.equal(table.header[0], "project_id");
    assert.equal(table.header[table.header.length - 1], "finish_deviation_days");
    assert.equal(table.header.filter((h) => h === "finish_deviation_days" || h === "delay_risk").length, 1);
    assert.ok(table.rows.every((row) => row.length === table.header.length));
  });

  it("never exports identifiers, costs, resource names or post-finish values as features", () => {
    const header = buildTrainingTable(set, regression).header.join(",");
    for (const banned of ["activity_code", "task_id", "task_code", "cost", "rsrc", "resource_name", "actual", "float", "act_end"]) {
      assert.ok(!header.includes(banned), `training header must not contain "${banned}"`);
    }
  });

  it("writes no byte-order mark, so the engine's CSV reader keeps project_id intact", () => {
    assert.notEqual(buildTrainingTable(set, regression).csv.charCodeAt(0), 0xfeff);
  });

  it("derives the delay class at the documented threshold", () => {
    assert.equal(delayClass(0.99), "on_time");
    assert.equal(delayClass(1), "delayed");
    assert.equal(delayClass(-30), "on_time");
    const classes = buildTrainingTable(set, classification).rows.map((row) => row[row.length - 1]);
    assert.deepEqual(classes, ["on_time", "delayed", "on_time"]);
  });

  it("leaves unknown start deviation blank rather than inventing 0", () => {
    const table = buildTrainingTable(set, regression);
    const column = table.header.indexOf("start_deviation_days");
    assert.equal(table.rows[2][column], "");
  });

  it("keeps identifiers in a separate traceability file", () => {
    const csv = buildTraceabilityCsv(set);
    assert.match(csv.split("\r\n")[0], /activity_code/);
    assert.match(csv, /T1/);
  });
});

describe("describeDataset", () => {
  const [regression, classification] = TRAINING_DATASETS;

  it("warns below the engine floor and for a single project", () => {
    const summary = describeDataset([obs("A", "T1", 2)], regression);
    assert.equal(summary.meetsEngineFloor, false);
    assert.ok(summary.warnings.some((w) => /refuses supervised training below 20/.test(w)));
    assert.ok(summary.warnings.some((w) => /Only one project/.test(w)));
  });

  it("is quiet about row count and projects when both are sufficient", () => {
    const rows = Array.from({ length: 24 }, (_, i) => obs(i % 2 ? "A" : "B", `T${i}`, i % 4 === 0 ? 3 : 0));
    const summary = describeDataset(rows, classification);
    assert.equal(summary.meetsEngineFloor, true);
    assert.equal(summary.projects, 2);
    assert.deepEqual(summary.warnings, []);
    assert.deepEqual(summary.classCounts.map((c) => c.label).sort(), ["delayed", "on_time"]);
  });

  it("flags a classifier dataset with only one class", () => {
    const rows = Array.from({ length: 22 }, (_, i) => obs(i % 2 ? "A" : "B", `T${i}`, 0));
    assert.ok(describeDataset(rows, classification).warnings.some((w) => /single class/.test(w)));
  });
});

describe("reference benchmark and verdict", () => {
  const [regression, classification] = TRAINING_DATASETS;
  const set = [obs("A", "T1", 2, 2), obs("A", "T2", -2, -2), obs("A", "T3", 0, 0)];

  it("scores simple rules exactly", () => {
    const rules = Object.fromEntries(naiveBenchmark(set, regression).rules.map((r) => [r.name, r]));
    assert.equal(rules["Finishes on plan"].mae, 1.33);
    assert.equal(rules["Finishes as late as it started"].mae, 0);
    assert.equal(rules["Finishes as late as it started"].rmse, 0);
    assert.equal(rules["Finishes as late as it started"].r2, 1);
  });

  it("scores classification rules by accuracy and balanced accuracy", () => {
    const rules = Object.fromEntries(naiveBenchmark(set, classification).rules.map((r) => [r.name, r]));
    assert.equal(rules["Always on time"].accuracy, 0.667);
    assert.equal(rules["Always on time"].balancedAccuracy, 0.5);
    assert.equal(rules["Delayed if it started late"].accuracy, 1);
    assert.equal(rules["Delayed if it started late"].balancedAccuracy, 1);
  });

  it("returns no rules for an empty set", () => {
    assert.deepEqual(naiveBenchmark([], regression).rules, []);
  });

  it("only says a regression model beats the rules when it wins on both MAE and RMSE", () => {
    const bench = naiveBenchmark([obs("A", "T1", 2, 1), obs("A", "T2", -2, -1), obs("A", "T3", 4, 0)], regression);
    assert.equal(judgeModel({ mae: 0.1, rmse: 0.1 }, bench)?.level, "beats");
    assert.equal(judgeModel({ mae: 99, rmse: 99 }, bench)?.level, "does_not_beat");
    const best = bench.rules.reduce((m, r) => Math.min(m, r.mae ?? Infinity), Infinity);
    assert.equal(judgeModel({ mae: best - 0.01, rmse: 99 }, bench)?.level, "mixed");
  });

  it("says a classifier does not beat the rules unless its balanced accuracy is higher", () => {
    const bench = naiveBenchmark(set, classification);
    assert.equal(judgeModel({ balanced_accuracy: 0.57 }, bench)?.level, "does_not_beat");
    assert.equal(judgeModel({ balanced_accuracy: 1 }, bench)?.level, "does_not_beat");
    const weak = naiveBenchmark([obs("A", "T1", 2, 0), obs("A", "T2", 0, 0), obs("A", "T3", 0, 0)], classification);
    assert.equal(judgeModel({ balanced_accuracy: 0.9 }, weak)?.level, "beats");
  });

  it("makes no claim without metrics", () => {
    assert.equal(judgeModel(null, naiveBenchmark(set, regression)), null);
    assert.equal(judgeModel({}, naiveBenchmark(set, regression)), null);
  });
});
