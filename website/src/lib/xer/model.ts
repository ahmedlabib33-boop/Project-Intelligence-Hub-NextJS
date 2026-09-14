/**
 * Schedule model built from a parsed XER.
 *
 * `buildSchedule` reads the file once and indexes every table. `projectView`
 * then materialises one project inside that file into the analysable graph the
 * analysis and comparison engines consume — activities, relationships, WBS
 * tree, calendars, resources, codes and schedule options.
 */

import { WorkCalendar, DEFAULT_CALENDAR } from "./calendar";
import { clamp, num, numOrNull, parseDate } from "./format";
import { parseXer, table, type XerFile, type XerHeader, type XerRow } from "./parse";

/* ------------------------------------------------------------ lookups */

export const REL_TYPE: Record<string, string> = { PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF" };

export const TASK_TYPE: Record<string, string> = {
  TT_Task: "Task Dependent",
  TT_Rsrc: "Resource Dependent",
  TT_LOE: "Level of Effort",
  TT_Mile: "Start Milestone",
  TT_FinMile: "Finish Milestone",
  TT_WBS: "WBS Summary",
};

export const STATUS: Record<string, string> = {
  TK_NotStart: "Not Started",
  TK_Active: "In Progress",
  TK_Complete: "Completed",
};

export const DUR_TYPE: Record<string, string> = {
  DT_FixedDrtn: "Fixed Duration & Units",
  DT_FixedQty: "Fixed Units",
  DT_FixedDUR2: "Fixed Duration & Units/Time",
  DT_FixedRate: "Fixed Units/Time",
};

export const CONSTRAINT: Record<string, string> = {
  CS_ALAP: "As Late As Possible",
  CS_MSO: "Start On",
  CS_MSOA: "Start On or After",
  CS_MSOB: "Start On or Before",
  CS_MEO: "Finish On",
  CS_MEOA: "Finish On or After",
  CS_MEOB: "Finish On or Before",
  CS_MANDSTART: "Mandatory Start",
  CS_MANDFIN: "Mandatory Finish",
};

/** Constraints that override logic outright. */
export const HARD_CONSTRAINTS = ["CS_MANDSTART", "CS_MANDFIN", "CS_MSO", "CS_MEO"];

export const PCT_TYPE: Record<string, string> = { CP_Phys: "Physical", CP_Drtn: "Duration", CP_Units: "Units" };

/* -------------------------------------------------------------- types */

export type RelationshipKind = "FS" | "SS" | "FF" | "SF";

export type Link = {
  id: string;
  predId: string;
  succId: string;
  pred: Task | null;
  succ: Task | null;
  type: RelationshipKind;
  lagHr: number;
  /** Lag in days on the governing activity's calendar. */
  lag: number;
  comments: string;
  /** One end of the link is outside this project view. */
  external: boolean;
  extProj: boolean;
  key: string;
  /** Set by the CPM pass: this link drives its successor's controlling date. */
  driving?: boolean;
};

export type WbsNode = {
  id: string;
  parent: string;
  code: string;
  name: string;
  fullName?: string;
  seq: number;
  isRoot: boolean;
  children: WbsNode[];
  tasks: Task[];
  allTasks?: Task[];
  level: number;
  path: string;
  raw: XerRow;
  stat?: WbsStat;
};

export type WbsStat = {
  count: number;
  done: number;
  prog: number;
  notStarted: number;
  budget: number;
  actual: number;
  remain: number;
  start: Date | null;
  finish: Date | null;
  minTF: number | null;
  pct: number;
};

export type TaskCost = {
  budget: number;
  actual: number;
  remain: number;
  atc: number;
  qty: number;
  actQty: number;
  remQty: number;
  n: number;
};

export type ActivityCode = { typeId: string; type: string; codeId: string; code: string; desc: string };
export type TaskUdf = { name: string; value: string };
export type TaskMemo = { topic: string; text: string };

/** Per-activity CPM results, recomputed by `analyze`. */
export type Computed = {
  es: Date | null;
  ef: Date | null;
  ls: Date | null;
  lf: Date | null;
  tf: number | null;
  ff: number | null;
  drivers: Link[];
  driven: Link[];
  remStart?: Date | null;
  constrained?: boolean;
  /** Member of a logic loop — dates fall back to the stored values. */
  broken?: boolean;
  /** On the computed longest path. */
  lp?: boolean;
  /** Float-path index this activity was assigned to. */
  fp?: number;
};

export type Task = {
  id: string;
  raw: XerRow;
  code: string;
  name: string;
  wbsId: string;
  wbs: WbsNode | null;
  wbsPath: string;
  wbsName: string;
  calId: string;
  cal: WorkCalendar;
  calName: string;
  type: string;
  typeName: string;
  durType: string;
  durTypeName: string;
  status: string;
  statusName: string;
  isMile: boolean;
  isLOE: boolean;
  isWBSsum: boolean;
  done: boolean;
  started: boolean;
  actStart: Date | null;
  actEnd: Date | null;
  earlyStart: Date | null;
  earlyEnd: Date | null;
  lateStart: Date | null;
  lateEnd: Date | null;
  remLateStart: Date | null;
  remLateEnd: Date | null;
  targetStart: Date | null;
  targetEnd: Date | null;
  reStart: Date | null;
  reEnd: Date | null;
  expectEnd: Date | null;
  suspend: Date | null;
  resume: Date | null;
  cstrType: string;
  cstrDate: Date | null;
  cstrType2: string;
  cstrDate2: Date | null;
  odHr: number;
  rdHr: number;
  adHr: number;
  tfHr: number | null;
  ffHr: number | null;
  physPct: number;
  pctType: string;
  driving: boolean;
  floatPath: number | null;
  floatPathOrder: number | null;
  rsrcs: XerRow[];
  cost: TaskCost | null;
  codes: ActivityCode[];
  udfs: TaskUdf[];
  memos: TaskMemo[];
  preds: Link[];
  succs: Link[];
  extPreds: Link[];
  extSuccs: Link[];
  /** Durations in days on the activity's own calendar. */
  od: number;
  rd: number;
  ad: number;
  tf: number | null;
  ff: number | null;
  start: Date | null;
  finish: Date | null;
  lateFinish: Date | null;
  lateStartD: Date | null;
  pct: number;
  budget: number;
  actualCost: number;
  remainCost: number;
  /** Populated by `analyze`. */
  c: Computed;
};

export type ProjectMeta = {
  id: string;
  raw: XerRow;
  name: string;
  longName: string;
  dataDate: Date | null;
  planStart?: Date | null;
  mustFinish?: Date | null;
  schedEnd?: Date | null;
  addDate?: Date | null;
  calId: string | null;
  taskCount: number;
};

export type ScheduleOptions = {
  raw: XerRow;
  ignoreOtherProj: boolean;
  retainedLogic: boolean;
  progressOverride: boolean;
  calcFloatFrom: string;
  calendarOnLag: string;
  openEndsCritical: boolean;
  useExpectFinish: boolean;
  levelFloat: number;
};

export type LoadedSchedule = {
  fileName: string;
  size: number;
  /** Original file text, kept so a controlled copy can be written back out. */
  text: string;
  header: XerHeader | null;
  raw: XerFile;
  warnings: string[];
  tables: { name: string; rows: number; fields: number }[];
  calendars: Record<string, WorkCalendar>;
  calList: WorkCalendar[];
  projects: ProjectMeta[];
  projById: Record<string, ProjectMeta>;
  activeProj: string | null;
  views: Record<string, ProjectView>;
  rsrcById: Record<string, XerRow>;
  actvTypeById: Record<string, XerRow>;
  actvCodeById: Record<string, XerRow>;
  udfTypeById: Record<string, XerRow>;
  wbsRows: XerRow[];
  taskRows: XerRow[];
  predRows: XerRow[];
  taskRsrcRows: XerRow[];
  taskActvRows: XerRow[];
  udfRows: XerRow[];
  memoRows: XerRow[];
  schedOpts: XerRow[];
  projRows: XerRow[];
};

export type ProjectView = {
  S: LoadedSchedule;
  projId: string;
  proj: ProjectMeta;
  wbsById: Record<string, WbsNode>;
  wbsRoots: WbsNode[];
  wbsAll: WbsNode[];
  schedOpt: ScheduleOptions;
  hoursPerDay: number;
  tasks: Task[];
  byId: Record<string, Task>;
  byCode: Map<string, Task[]>;
  links: Link[];
  duplicateLinks: Link[];
  dataDate: Date | null;
  start: Date | null;
  finish: Date | null;
  actualStart: Date | null;
  mustFinish: Date | null | undefined;
  name: string;
  longName: string;
  /** Analysis cache, filled by `analyze`. */
  an?: import("./analysis").Analysis;
};

/* ------------------------------------------------------- build schedule */

export function buildSchedule(text: string, fileName: string, size: number): LoadedSchedule {
  const x = parseXer(text);

  const S: LoadedSchedule = {
    fileName,
    size,
    text,
    header: x.header,
    raw: x,
    warnings: x.warnings.slice(),
    tables: Object.keys(x.tables).map((k) => ({
      name: k,
      rows: x.tables[k].rows.length,
      fields: x.tables[k].fields.length,
    })),
    calendars: {},
    calList: [],
    projects: [],
    projById: {},
    activeProj: null,
    views: {},
    rsrcById: {},
    actvTypeById: {},
    actvCodeById: {},
    udfTypeById: {},
    wbsRows: [],
    taskRows: [],
    predRows: [],
    taskRsrcRows: [],
    taskActvRows: [],
    udfRows: [],
    memoRows: [],
    schedOpts: [],
    projRows: [],
  };

  for (const row of table(x, "CALENDAR")) {
    const cal = new WorkCalendar(row);
    S.calendars[cal.id] = cal;
    S.calList.push(cal);
  }
  if (!S.calList.length) {
    S.calendars.default = DEFAULT_CALENDAR;
    S.calList.push(DEFAULT_CALENDAR);
  }

  for (const row of table(x, "RSRC")) S.rsrcById[row.rsrc_id] = row;
  for (const row of table(x, "ACTVTYPE")) S.actvTypeById[row.actv_code_type_id] = row;
  for (const row of table(x, "ACTVCODE")) S.actvCodeById[row.actv_code_id] = row;
  for (const row of table(x, "UDFTYPE")) S.udfTypeById[row.udf_type_id] = row;

  S.wbsRows = table(x, "PROJWBS");
  S.taskRows = table(x, "TASK");
  S.predRows = table(x, "TASKPRED");
  S.taskRsrcRows = table(x, "TASKRSRC");
  S.taskActvRows = table(x, "TASKACTV");
  S.udfRows = table(x, "UDFVALUE");
  S.memoRows = table(x, "TASKMEMO");
  S.schedOpts = table(x, "SCHEDOPTIONS");
  S.projRows = table(x, "PROJECT");

  const taskCountByProj: Record<string, number> = {};
  for (const t of S.taskRows) taskCountByProj[t.proj_id] = (taskCountByProj[t.proj_id] || 0) + 1;

  for (const p of S.projRows) {
    // Skip baseline/linked projects that carry no activities of their own.
    if (p.export_flag === "N" && S.projRows.length > 1 && !taskCountByProj[p.proj_id]) continue;
    const proj: ProjectMeta = {
      id: p.proj_id,
      raw: p,
      name: p.proj_short_name || p.proj_id,
      longName: "",
      dataDate: parseDate(p.last_recalc_date),
      planStart: parseDate(p.plan_start_date),
      mustFinish: parseDate(p.plan_end_date),
      schedEnd: parseDate(p.scd_end_date),
      addDate: parseDate(p.add_date),
      calId: p.clndr_id,
      taskCount: taskCountByProj[p.proj_id] || 0,
    };
    S.projects.push(proj);
    S.projById[proj.id] = proj;
  }

  // The project's long name lives on the root PROJWBS node.
  for (const w of S.wbsRows) {
    if (w.proj_node_flag === "Y" && S.projById[w.proj_id]) S.projById[w.proj_id].longName = w.wbs_name;
  }

  if (!S.projects.length && S.taskRows.length) {
    const pid = S.taskRows[0].proj_id;
    const proj: ProjectMeta = {
      id: pid,
      raw: {},
      name: "Project " + pid,
      longName: "",
      dataDate: null,
      taskCount: S.taskRows.length,
      calId: null,
    };
    S.projects.push(proj);
    S.projById[pid] = proj;
  }

  S.projects.sort((a, b) => b.taskCount - a.taskCount);
  S.activeProj = S.projects.length ? S.projects[0].id : null;
  return S;
}

/* --------------------------------------------------------- project view */

/** Materialise (and cache) the analysable view of one project. */
export function projectView(S: LoadedSchedule, projId?: string | null): ProjectView | null {
  const id = projId || S.activeProj;
  if (!id) return null;
  if (S.views[id]) return S.views[id];

  const proj = S.projById[id];
  if (!proj) return null;
  const cal = (calId: string) => S.calendars[calId] || S.calList[0] || DEFAULT_CALENDAR;

  /* ---------- WBS ---------- */
  const wbsById: Record<string, WbsNode> = {};
  const wbsAll: WbsNode[] = [];
  for (const w of S.wbsRows) {
    if (w.proj_id !== id) continue;
    const node: WbsNode = {
      id: w.wbs_id,
      parent: w.parent_wbs_id,
      code: w.wbs_short_name || "",
      name: w.wbs_name || "",
      seq: num(w.seq_num),
      isRoot: w.proj_node_flag === "Y",
      children: [],
      tasks: [],
      level: 0,
      path: "",
      raw: w,
    };
    wbsById[node.id] = node;
    wbsAll.push(node);
  }
  const roots: WbsNode[] = [];
  for (const w of wbsAll) {
    const parent = wbsById[w.parent];
    if (parent) parent.children.push(w);
    else roots.push(w);
  }
  (function walk(list: WbsNode[], level: number, prefix: string) {
    list.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));
    for (const w of list) {
      w.level = level;
      w.path = prefix ? `${prefix} › ${w.code}` : w.code;
      w.fullName = (prefix ? `${prefix} › ` : "") + w.name;
      walk(w.children, level + 1, w.path);
    }
  })(roots, 0, "");

  /* ---------- resources & cost per activity ---------- */
  const rsrcByTask: Record<string, XerRow[]> = {};
  const costByTask: Record<string, TaskCost> = {};
  for (const r of S.taskRsrcRows) {
    if (r.proj_id && r.proj_id !== id) continue;
    (rsrcByTask[r.task_id] = rsrcByTask[r.task_id] || []).push(r);
    const cost = (costByTask[r.task_id] = costByTask[r.task_id] || {
      budget: 0, actual: 0, remain: 0, atc: 0, qty: 0, actQty: 0, remQty: 0, n: 0,
    });
    cost.budget += num(r.target_cost);
    cost.actual += num(r.act_reg_cost) + num(r.act_ot_cost);
    cost.remain += num(r.remain_cost);
    cost.qty += num(r.target_qty);
    cost.actQty += num(r.act_reg_qty) + num(r.act_ot_qty);
    cost.remQty += num(r.remain_qty);
    cost.n++;
  }

  /* ---------- activity codes / UDFs / memos ---------- */
  const actvByTask: Record<string, ActivityCode[]> = {};
  for (const a of S.taskActvRows) {
    if (a.proj_id && a.proj_id !== id) continue;
    const code = S.actvCodeById[a.actv_code_id];
    const type = S.actvTypeById[a.actv_code_type_id];
    if (!code) continue;
    (actvByTask[a.task_id] = actvByTask[a.task_id] || []).push({
      typeId: a.actv_code_type_id,
      type: type ? type.actv_code_type : "Code",
      codeId: a.actv_code_id,
      code: code.short_name || "",
      desc: code.actv_code_name || "",
    });
  }

  const udfByTask: Record<string, TaskUdf[]> = {};
  for (const u of S.udfRows) {
    if (u.fk_id === undefined) continue;
    const type = S.udfTypeById[u.udf_type_id];
    if (!type || type.table_name !== "TASK") continue;
    const value = u.udf_text || u.udf_number || u.udf_date || u.udf_code_id || "";
    (udfByTask[u.fk_id] = udfByTask[u.fk_id] || []).push({
      name: type.udf_type_label || type.udf_type_name,
      value,
    });
  }

  const memoByTask: Record<string, TaskMemo[]> = {};
  for (const m of S.memoRows) {
    if (m.proj_id && m.proj_id !== id) continue;
    (memoByTask[m.task_id] = memoByTask[m.task_id] || []).push({
      topic: m.memo_type_id,
      text: (m.task_memo || "").replace(/<[^>]+>/g, " ").trim(),
    });
  }

  /* ---------- schedule options ---------- */
  const so = S.schedOpts.find((o) => o.proj_id === id) || S.schedOpts[0] || ({} as XerRow);
  const schedOpt: ScheduleOptions = {
    raw: so,
    ignoreOtherProj: so.sched_outer_depend_type === "SD_None",
    retainedLogic: so.sched_retained_logic === "Y",
    progressOverride: so.sched_progress_override === "Y",
    calcFloatFrom: so.sched_float_type || "",
    calendarOnLag: so.sched_calendar_on_relationship_lag || "",
    openEndsCritical: so.sched_open_critical_flag === "Y",
    useExpectFinish: so.sched_use_expect_end_date === "Y",
    levelFloat: num(so.level_float_thrs_cnt),
  };

  /* ---------- activities ---------- */
  const tasks: Task[] = [];
  const byId: Record<string, Task> = {};
  const byCode = new Map<string, Task[]>();
  let hpdSum = 0;
  let hpdCount = 0;

  for (const r of S.taskRows) {
    if (r.proj_id !== id) continue;
    const calendar = cal(r.clndr_id);
    hpdSum += calendar.dayHours;
    hpdCount++;
    const status = r.status_code;
    const hd = calendar.dayHours || 8;

    const t: Task = {
      id: r.task_id,
      raw: r,
      code: r.task_code || "",
      name: r.task_name || "",
      wbsId: r.wbs_id,
      wbs: wbsById[r.wbs_id] || null,
      wbsPath: (wbsById[r.wbs_id] || ({} as WbsNode)).path || "",
      wbsName: (wbsById[r.wbs_id] || ({} as WbsNode)).name || "",
      calId: r.clndr_id,
      cal: calendar,
      calName: calendar.name,
      type: r.task_type,
      typeName: TASK_TYPE[r.task_type] || r.task_type,
      durType: r.duration_type,
      durTypeName: DUR_TYPE[r.duration_type] || r.duration_type,
      status,
      statusName: STATUS[status] || status,
      isMile: r.task_type === "TT_Mile" || r.task_type === "TT_FinMile",
      isLOE: r.task_type === "TT_LOE",
      isWBSsum: r.task_type === "TT_WBS",
      done: status === "TK_Complete",
      started: status !== "TK_NotStart",
      actStart: parseDate(r.act_start_date),
      actEnd: parseDate(r.act_end_date),
      earlyStart: parseDate(r.early_start_date),
      earlyEnd: parseDate(r.early_end_date),
      lateStart: parseDate(r.late_start_date),
      lateEnd: parseDate(r.late_end_date),
      remLateStart: parseDate(r.rem_late_start_date),
      remLateEnd: parseDate(r.rem_late_end_date),
      targetStart: parseDate(r.target_start_date),
      targetEnd: parseDate(r.target_end_date),
      reStart: parseDate(r.restart_date),
      reEnd: parseDate(r.reend_date),
      expectEnd: parseDate(r.expect_end_date),
      suspend: parseDate(r.suspend_date),
      resume: parseDate(r.resume_date),
      cstrType: r.cstr_type || "",
      cstrDate: parseDate(r.cstr_date),
      cstrType2: r.cstr_type2 || "",
      cstrDate2: parseDate(r.cstr_date2),
      odHr: num(r.target_drtn_hr_cnt),
      rdHr: num(r.remain_drtn_hr_cnt),
      adHr: num(r.act_work_qty || 0),
      tfHr: numOrNull(r.total_float_hr_cnt),
      ffHr: numOrNull(r.free_float_hr_cnt),
      physPct: num(r.phys_complete_pct),
      pctType: r.complete_pct_type,
      driving: r.driving_path_flag === "Y",
      floatPath: numOrNull(r.float_path),
      floatPathOrder: numOrNull(r.float_path_order),
      rsrcs: rsrcByTask[r.task_id] || [],
      cost: costByTask[r.task_id] || null,
      codes: actvByTask[r.task_id] || [],
      udfs: udfByTask[r.task_id] || [],
      memos: memoByTask[r.task_id] || [],
      preds: [],
      succs: [],
      extPreds: [],
      extSuccs: [],
      od: 0, rd: 0, ad: 0, tf: null, ff: null,
      start: null, finish: null, lateFinish: null, lateStartD: null,
      pct: 0, budget: 0, actualCost: 0, remainCost: 0,
      c: { es: null, ef: null, ls: null, lf: null, tf: null, ff: null, drivers: [], driven: [] },
    };

    t.od = t.odHr / hd;
    t.rd = t.rdHr / hd;
    t.ad = t.started ? (t.done ? t.od : Math.max(0, t.od - t.rd)) : 0;
    t.tf = t.tfHr === null ? null : t.tfHr / hd;
    t.ff = t.ffHr === null ? null : t.ffHr / hd;
    t.start = t.actStart || t.earlyStart || t.targetStart;
    t.finish = t.actEnd || t.earlyEnd || t.targetEnd;
    t.lateFinish = t.lateEnd || t.remLateEnd;
    t.lateStartD = t.lateStart || t.remLateStart;

    if (t.pctType === "CP_Phys") {
      t.pct = t.physPct;
    } else if (t.pctType === "CP_Units") {
      const qty = t.cost ? t.cost.qty : 0;
      t.pct = qty ? clamp((t.cost!.actQty / qty) * 100, 0, 100) : t.done ? 100 : 0;
    } else {
      t.pct = t.odHr > 0 ? clamp((1 - t.rdHr / t.odHr) * 100, 0, 100) : t.done ? 100 : 0;
    }
    if (t.done) t.pct = 100;
    if (!t.started) t.pct = Math.min(t.pct, 0) || 0;
    t.pct = Math.round(t.pct * 10) / 10;

    t.budget = t.cost ? t.cost.budget : 0;
    t.actualCost = t.cost ? t.cost.actual : 0;
    t.remainCost = t.cost ? t.cost.remain : 0;

    tasks.push(t);
    byId[t.id] = t;
    if (t.code) {
      const bucket = byCode.get(t.code);
      if (bucket) bucket.push(t);
      else byCode.set(t.code, [t]);
    }
    if (t.wbs) t.wbs.tasks.push(t);
  }

  /* ---------- relationships ---------- */
  const links: Link[] = [];
  const pairSeen = new Map<string, number>();
  for (const r of S.predRows) {
    const succ = byId[r.task_id] || null;
    const pred = byId[r.pred_task_id] || null;
    if (!succ && !pred) continue;
    const hd = (succ ? succ.cal.dayHours : pred ? pred.cal.dayHours : 8) || 8;
    const link: Link = {
      id: r.task_pred_id,
      predId: r.pred_task_id,
      succId: r.task_id,
      pred,
      succ,
      type: (REL_TYPE[r.pred_type] || r.pred_type || "FS") as RelationshipKind,
      lagHr: num(r.lag_hr_cnt),
      lag: num(r.lag_hr_cnt) / hd,
      comments: r.comments || "",
      external: !succ || !pred,
      extProj: r.pred_proj_id !== id || r.proj_id !== id,
      key: "",
    };
    link.key = `${pred ? pred.code : "?" + r.pred_task_id}→${succ ? succ.code : "?" + r.task_id}:${link.type}`;
    links.push(link);
    if (succ && pred) {
      succ.preds.push(link);
      pred.succs.push(link);
    } else if (succ) {
      succ.extPreds.push(link);
    } else if (pred) {
      pred.extSuccs.push(link);
    }
    const dupKey = `${r.pred_task_id}>${r.task_id}`;
    pairSeen.set(dupKey, (pairSeen.get(dupKey) || 0) + 1);
  }
  const duplicateLinks = links.filter((l) => l.pred && l.succ && (pairSeen.get(`${l.predId}>${l.succId}`) || 0) > 1);

  /* ---------- WBS roll-up ---------- */
  for (const root of roots) {
    (function roll(w: WbsNode): Task[] {
      let all = w.tasks.slice();
      for (const child of w.children) all = all.concat(roll(child));
      w.allTasks = all;
      const odSum = Math.max(1, all.reduce((s, x) => s + (x.odHr || 1), 0));
      w.stat = {
        count: all.length,
        done: all.filter((x) => x.done).length,
        prog: all.filter((x) => x.started && !x.done).length,
        notStarted: all.filter((x) => !x.started).length,
        budget: all.reduce((s, x) => s + x.budget, 0),
        actual: all.reduce((s, x) => s + x.actualCost, 0),
        remain: all.reduce((s, x) => s + x.remainCost, 0),
        start: all.reduce<Date | null>((m, x) => (!x.start ? m : !m || x.start < m ? x.start : m), null),
        finish: all.reduce<Date | null>((m, x) => (!x.finish ? m : !m || x.finish > m ? x.finish : m), null),
        minTF: all.reduce<number | null>((m, x) => (x.tf === null ? m : m === null || x.tf < m ? x.tf : m), null),
        pct: all.length ? all.reduce((s, x) => s + x.pct * (x.odHr || 1), 0) / odSum : 0,
      };
      return all;
    })(root);
  }

  /* ---------- project-level dates ---------- */
  const withStart = tasks.filter((t) => t.start);
  const withFinish = tasks.filter((t) => t.finish);
  const dataDate =
    proj.dataDate ||
    (() => {
      const candidates = tasks.filter((t) => !t.done && t.earlyStart).map((t) => t.earlyStart!).sort((a, b) => +a - +b);
      return candidates[0] || null;
    })();
  const actualStart = (() => {
    const stamps = tasks.filter((t) => t.actStart).map((t) => +t.actStart!);
    return stamps.length ? new Date(Math.min(...stamps)) : null;
  })();

  const view: ProjectView = {
    S,
    projId: id,
    proj,
    wbsById,
    wbsRoots: roots,
    wbsAll,
    schedOpt,
    hoursPerDay: hpdCount ? Math.round((hpdSum / hpdCount) * 100) / 100 : 8,
    tasks,
    byId,
    byCode,
    links,
    duplicateLinks,
    dataDate,
    start: withStart.length ? new Date(Math.min(...withStart.map((t) => +t.start!))) : null,
    finish: withFinish.length ? new Date(Math.max(...withFinish.map((t) => +t.finish!))) : null,
    actualStart,
    mustFinish: proj.mustFinish,
    name: proj.name,
    longName: proj.longName || proj.name,
  };

  S.views[id] = view;
  return view;
}
