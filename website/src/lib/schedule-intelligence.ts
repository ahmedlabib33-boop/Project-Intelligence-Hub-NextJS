export type ScheduleMode = "mitigation" | "recovery" | "revised";

type XerRow = Record<string, string>;

type XerRelationship = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: string;
  lagDays: number;
};

export type ScheduleTask = {
  id: string;
  code: string;
  name: string;
  wbsId: string;
  status: string;
  type: string;
  remainingDays: number;
  totalFloatDays: number | null;
  earlyStart: string;
  earlyFinish: string;
  lateFinish: string;
  constraintDate: string;
};

export type CpmResult = {
  networkLengthDays: number;
  pathIds: string[];
  startOffsets: Record<string, number>;
};

export type ScheduleModel = {
  fileName: string;
  project: {
    id: string;
    name: string;
    dataDate: string;
    scheduledFinish: string;
    hoursPerDay: number;
    terminalTaskId: string;
  };
  tasks: Record<string, ScheduleTask>;
  relationships: XerRelationship[];
  wbs: Record<string, { name: string; parentId: string }>;
  resourceCountByTask: Record<string, number>;
  topologicalOrder: string[];
  isDag: boolean;
  baseCpm: CpmResult;
  recoveryRequirement: {
    forecastFinish: string;
    requiredFinish: string;
    requiredRecoveryDays: number;
    basis: string;
  };
};

export type ScheduleCandidate = {
  id: string;
  actionType: "DURATION_COMPRESSION" | "LAG_OPTIMIZATION" | "FAST_TRACK_OVERLAP" | "PATTERN_BENCHMARK";
  activityId: string;
  activityName: string;
  wbsPath: string;
  currentDays: number;
  proposedDays: number;
  nominalReductionDays: number;
  individualExactGainDays: number;
  selectedExactIncrementalGainDays?: number;
  confidence: "high" | "medium" | "low";
  risk: "low" | "medium" | "high";
  priorityScore: number;
  strategy: string;
  validation: string;
  relationship?: string;
  notes?: string;
  durationChanges: Record<string, number>;
  lagChanges: Record<string, number>;
  affectedKeys: string[];
};

export type ScheduleChange = {
  changeType: "REMAINING_DURATION" | "RELATIONSHIP_LAG";
  activityId: string;
  activityName: string;
  oldValueDays: number;
  newValueDays: number;
  implementation: string;
};

export type ScheduleAnalysis = {
  mode: ScheduleMode;
  model: ScheduleModel;
  candidateCount: number;
  candidates: ScheduleCandidate[];
  selectedCandidates: ScheduleCandidate[];
  finalCpm: CpmResult;
  exactRecoveryDays: number;
  targetRecoveryDays: number | null;
  remainingGapDays: number | null;
  changes: ScheduleChange[];
  warnings: string[];
  readiness: "ready_with_gates" | "review_required" | "blocked";
  generatedAt: string;
};

type Modification = {
  durationChanges: Record<string, number>;
  lagChanges: Record<string, number>;
};

const EPSILON = 0.000001;
const EMPTY_MODIFICATION: Modification = { durationChanges: {}, lagChanges: {} };

function safeNumber(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseNativeDate(value: string) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateDifferenceDays(later: string, earlier: string) {
  const end = parseNativeDate(later);
  const start = parseNativeDate(earlier);
  if (!end || !start) return null;
  return (end.getTime() - start.getTime()) / 86_400_000;
}

function parseXer(content: string) {
  const tables: Record<string, XerRow[]> = {};
  let currentTable = "";
  let fields: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const cells = rawLine.split("\t");
    const marker = cells[0];
    if (marker === "%T" && cells[1]) {
      currentTable = cells[1];
      fields = [];
      if (!tables[currentTable]) tables[currentTable] = [];
    } else if (marker === "%F" && currentTable) {
      fields = cells.slice(1);
    } else if (marker === "%R" && currentTable && fields.length) {
      const values = cells.slice(1);
      const row: XerRow = {};
      fields.forEach((field, index) => {
        row[field] = values[index] || "";
      });
      tables[currentTable].push(row);
    }
  }
  return tables;
}

function pickProject(tables: Record<string, XerRow[]>) {
  const projects = tables.PROJECT || [];
  if (!projects.length) throw new Error("The uploaded file does not contain a Primavera PROJECT table.");
  const counts = new Map<string, number>();
  for (const task of tables.TASK || []) {
    const id = task.proj_id || "";
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...projects].sort((left, right) => (counts.get(right.proj_id || "") || 0) - (counts.get(left.proj_id || "") || 0))[0];
}

function taskDurationDays(row: XerRow, hoursPerDay: number) {
  if (row.status_code === "TK_Complete") return 0;
  return Math.max(0, safeNumber(row.remain_drtn_hr_cnt) / hoursPerDay);
}

function relationshipKey(row: XerRow) {
  return `${row.pred_task_id || ""}->${row.task_id || ""}|${row.pred_type || "PR_FS"}|${row.task_pred_id || ""}`;
}

function pairKey(predecessorId: string, successorId: string) {
  return `${predecessorId}\u0000${successorId}`;
}

function findTerminalTask(tasks: Record<string, ScheduleTask>, relationships: XerRelationship[]) {
  const list = Object.values(tasks);
  const explicit = list.filter((task) => /project\s+finish/i.test(`${task.name} ${task.code}`));
  const latest = (items: ScheduleTask[]) => [...items].sort((left, right) => (parseNativeDate(right.earlyFinish)?.getTime() || 0) - (parseNativeDate(left.earlyFinish)?.getTime() || 0))[0];
  if (explicit.length) return latest(explicit).id;
  const milestones = list.filter((task) => (task.type === "TT_FinMile" || task.type === "TT_Mile") && task.status !== "TK_Complete");
  if (milestones.length) return latest(milestones).id;
  const predecessorIds = new Set(relationships.map((relationship) => relationship.predecessorId));
  const sinks = list.filter((task) => !predecessorIds.has(task.id));
  return (sinks.length ? latest(sinks) : latest(list)).id;
}

function topologicalOrder(tasks: Record<string, ScheduleTask>, relationships: XerRelationship[]) {
  const ids = Object.keys(tasks);
  const nextByTask: Record<string, Set<string>> = Object.fromEntries(ids.map((id) => [id, new Set<string>()]));
  const inDegree: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const relationship of relationships) {
    const next = nextByTask[relationship.predecessorId];
    if (!next || !inDegree.hasOwnProperty(relationship.successorId) || next.has(relationship.successorId)) continue;
    next.add(relationship.successorId);
    inDegree[relationship.successorId] += 1;
  }
  const queue = ids.filter((id) => inDegree[id] === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    order.push(id);
    for (const next of nextByTask[id]) {
      inDegree[next] -= 1;
      if (inDegree[next] === 0) queue.push(next);
    }
    queue.sort();
  }
  return { order, isDag: order.length === ids.length };
}

function cpm(model: Pick<ScheduleModel, "tasks" | "relationships" | "topologicalOrder" | "project">, modification: Modification = EMPTY_MODIFICATION): CpmResult {
  const taskIds = Object.keys(model.tasks);
  const starts: Record<string, number> = Object.fromEntries(taskIds.map((id) => [id, 0]));
  const parent: Record<string, string | null> = Object.fromEntries(taskIds.map((id) => [id, null]));
  const relationshipsByPair = new Map<string, XerRelationship[]>();
  for (const relationship of model.relationships) {
    const key = pairKey(relationship.predecessorId, relationship.successorId);
    const rows = relationshipsByPair.get(key) || [];
    rows.push(relationship);
    relationshipsByPair.set(key, rows);
  }
  const successorPairs: Record<string, string[]> = Object.fromEntries(taskIds.map((id) => [id, []]));
  for (const key of relationshipsByPair.keys()) {
    const [predecessorId, successorId] = key.split("\u0000");
    successorPairs[predecessorId]?.push(successorId);
  }
  const duration = (taskId: string) => modification.durationChanges[taskId] ?? model.tasks[taskId]?.remainingDays ?? 0;
  for (const predecessorId of model.topologicalOrder) {
    for (const successorId of successorPairs[predecessorId] || []) {
      const relationships = relationshipsByPair.get(pairKey(predecessorId, successorId)) || [];
      let strongestWeight = -Infinity;
      for (const relationship of relationships) {
        const lag = modification.lagChanges[relationship.id] ?? relationship.lagDays;
        const predecessorDuration = duration(predecessorId);
        const successorDuration = duration(successorId);
        const weight = relationship.type === "PR_SS" ? lag
          : relationship.type === "PR_FF" ? predecessorDuration + lag - successorDuration
            : relationship.type === "PR_SF" ? lag - successorDuration
              : predecessorDuration + lag;
        strongestWeight = Math.max(strongestWeight, weight);
      }
      const proposedStart = starts[predecessorId] + strongestWeight;
      if (proposedStart > starts[successorId] + EPSILON) {
        starts[successorId] = proposedStart;
        parent[successorId] = predecessorId;
      }
    }
  }
  const terminalId = model.project.terminalTaskId;
  const terminalFinish = (starts[terminalId] || 0) + duration(terminalId);
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | null = terminalId;
  while (current && !seen.has(current)) {
    seen.add(current);
    path.unshift(current);
    current = parent[current];
  }
  return { networkLengthDays: round(terminalFinish, 3), pathIds: path, startOffsets: starts };
}

function wbsPath(model: ScheduleModel, wbsId: string) {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = wbsId;
  while (current && model.wbs[current] && !seen.has(current)) {
    seen.add(current);
    parts.unshift(model.wbs[current].name || current);
    current = model.wbs[current].parentId;
  }
  return parts.join(" > ") || "Unassigned WBS";
}

function recoveryRequirement(model: Pick<ScheduleModel, "project" | "tasks">) {
  const terminal = model.tasks[model.project.terminalTaskId];
  const forecast = terminal?.earlyFinish || model.project.scheduledFinish;
  const required = terminal?.constraintDate || terminal?.lateFinish || "";
  const dateGap = dateDifferenceDays(forecast, required);
  if (dateGap !== null && dateGap > 0) {
    return { forecastFinish: forecast, requiredFinish: required, requiredRecoveryDays: round(dateGap), basis: terminal.constraintDate ? "terminal constraint date" : "terminal late finish" };
  }
  const terminalFloat = terminal?.totalFloatDays || 0;
  return {
    forecastFinish: forecast,
    requiredFinish: required || "Not evidenced",
    requiredRecoveryDays: round(Math.max(0, -terminalFloat)),
    basis: terminalFloat < 0 ? "negative total float" : "no evidenced recovery requirement"
  };
}

export function parseScheduleXer(fileName: string, content: string): ScheduleModel {
  const tables = parseXer(content);
  const projectRow = pickProject(tables);
  const projectId = projectRow.proj_id || "";
  const calendar = (tables.CALENDAR || []).find((row) => row.clndr_id === projectRow.clndr_id);
  const hoursPerDay = Math.max(1, safeNumber(calendar?.day_hr_cnt, 8));
  const tasks: Record<string, ScheduleTask> = {};
  for (const row of tables.TASK || []) {
    if ((row.proj_id || "") !== projectId || !row.task_id) continue;
    tasks[row.task_id] = {
      id: row.task_id,
      code: row.task_code || row.task_id,
      name: row.task_name || "Unnamed activity",
      wbsId: row.wbs_id || "",
      status: row.status_code || "UNKNOWN",
      type: row.task_type || "",
      remainingDays: taskDurationDays(row, hoursPerDay),
      totalFloatDays: row.total_float_hr_cnt === "" || row.total_float_hr_cnt === undefined ? null : safeNumber(row.total_float_hr_cnt) / hoursPerDay,
      earlyStart: row.early_start_date || row.restart_date || row.target_start_date || "",
      earlyFinish: row.early_end_date || row.reend_date || row.target_end_date || "",
      lateFinish: row.late_end_date || "",
      constraintDate: row.cstr_date || ""
    };
  }
  if (!Object.keys(tasks).length) throw new Error("No activities were found for the primary PROJECT record in this XER file.");
  const relationships: XerRelationship[] = (tables.TASKPRED || [])
    .filter((row) => Boolean(tasks[row.pred_task_id || ""]) && Boolean(tasks[row.task_id || ""]))
    .map((row) => ({
      id: relationshipKey(row),
      predecessorId: row.pred_task_id,
      successorId: row.task_id,
      type: row.pred_type || "PR_FS",
      lagDays: safeNumber(row.lag_hr_cnt) / hoursPerDay
    }));
  const wbs: ScheduleModel["wbs"] = {};
  for (const row of tables.PROJWBS || []) {
    if ((row.proj_id || "") === projectId && row.wbs_id) wbs[row.wbs_id] = { name: row.wbs_name || row.wbs_short_name || row.wbs_id, parentId: row.parent_wbs_id || "" };
  }
  const resourceCountByTask: Record<string, number> = {};
  for (const row of tables.TASKRSRC || []) {
    if (tasks[row.task_id || ""]) resourceCountByTask[row.task_id] = (resourceCountByTask[row.task_id] || 0) + 1;
  }
  const terminalTaskId = findTerminalTask(tasks, relationships);
  const topology = topologicalOrder(tasks, relationships);
  const modelBase = {
    fileName,
    project: {
      id: projectId,
      name: projectRow.proj_short_name || projectRow.proj_name || projectId,
      dataDate: projectRow.last_recalc_date || projectRow.apply_actuals_date || projectRow.next_data_date || "Not available",
      scheduledFinish: projectRow.scd_end_date || "",
      hoursPerDay,
      terminalTaskId
    },
    tasks,
    relationships,
    wbs,
    resourceCountByTask,
    topologicalOrder: topology.order,
    isDag: topology.isDag
  };
  const baseCpm = topology.isDag ? cpm(modelBase) : { networkLengthDays: 0, pathIds: [], startOffsets: {} };
  const model = { ...modelBase, baseCpm, recoveryRequirement: { forecastFinish: "", requiredFinish: "", requiredRecoveryDays: 0, basis: "" } };
  return { ...model, recoveryRequirement: recoveryRequirement(model) };
}

function candidateRisk(actionType: ScheduleCandidate["actionType"]) {
  if (actionType === "DURATION_COMPRESSION") return "high" as const;
  if (actionType === "FAST_TRACK_OVERLAP") return "high" as const;
  return "medium" as const;
}

function candidateConfidence(task: ScheduleTask, resourceCount: number, gain: number) {
  if (gain <= EPSILON) return "low" as const;
  if ((task.totalFloatDays ?? 1) <= 0 && resourceCount > 0) return "high" as const;
  return "medium" as const;
}

function candidatePriority(gain: number, task: ScheduleTask, risk: ScheduleCandidate["risk"]) {
  const floatBonus = Math.max(0, 15 - Math.max(-15, task.totalFloatDays ?? 15));
  const riskFactor = risk === "high" ? 0.72 : risk === "medium" ? 0.88 : 1;
  return round((gain * 100 + floatBonus) * riskFactor, 2);
}

function mergeModification(base: Modification, candidate: ScheduleCandidate): Modification {
  return {
    durationChanges: { ...base.durationChanges, ...candidate.durationChanges },
    lagChanges: { ...base.lagChanges, ...candidate.lagChanges }
  };
}

function taskTokenSignature(task: ScheduleTask, path: string) {
  const stopWords = new Set(["the", "and", "for", "with", "from", "work", "works", "activity", "area", "floor", "building", "phase", "part"]);
  const tokens = `${task.name} ${path}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token));
  return [...new Set(tokens)].slice(0, 3).sort().join("|");
}

function generateCandidates(model: ScheduleModel, mode: ScheduleMode) {
  const path = new Set(model.baseCpm.pathIds);
  const activeTasks = Object.values(model.tasks).filter((task) => task.status !== "TK_Complete" && task.remainingDays > 0);
  const floats = activeTasks.map((task) => task.totalFloatDays).filter((value): value is number => value !== null).sort((left, right) => left - right);
  const corridorFloat = floats.length ? floats[Math.max(0, Math.floor((floats.length - 1) * 0.12))] : 0;
  const corridor = activeTasks.filter((task) => path.has(task.id) || (task.totalFloatDays !== null && task.totalFloatDays <= corridorFloat));
  const durationRatios = mode === "mitigation" ? [0.08] : mode === "recovery" ? [0.15, 0.25] : [0.12, 0.2];
  const candidates: ScheduleCandidate[] = [];
  let sequence = 1;
  const addCandidate = (draft: Omit<ScheduleCandidate, "id" | "individualExactGainDays" | "priorityScore" | "confidence">) => {
    const trial = cpm(model, { durationChanges: draft.durationChanges, lagChanges: draft.lagChanges });
    const gain = Math.max(0, model.baseCpm.networkLengthDays - trial.networkLengthDays);
    if (gain <= EPSILON) return;
    const task = model.tasks[draft.activityId] || Object.values(model.tasks).find((item) => item.code === draft.activityId) || activeTasks[0];
    candidates.push({
      ...draft,
      id: `SI-${String(sequence++).padStart(4, "0")}`,
      individualExactGainDays: round(gain),
      priorityScore: candidatePriority(gain, task, draft.risk),
      confidence: candidateConfidence(task, model.resourceCountByTask[task.id] || 0, gain)
    });
  };
  for (const task of corridor.slice(0, 180)) {
    for (const ratio of durationRatios) {
      const proposed = Math.max(1, round(task.remainingDays * (1 - ratio), 3));
      if (proposed >= task.remainingDays) continue;
      addCandidate({
        actionType: "DURATION_COMPRESSION",
        activityId: task.id,
        activityName: task.name,
        wbsPath: wbsPath(model, task.wbsId),
        currentDays: round(task.remainingDays),
        proposedDays: proposed,
        nominalReductionDays: round(task.remainingDays - proposed),
        risk: candidateRisk("DURATION_COMPRESSION"),
        strategy: "Test a controlled remaining-duration compression using confirmed crew, equipment, workface and productivity evidence.",
        validation: "Confirm resource capacity, work method, HSE, QA/QC, procurement, access and calendar feasibility before changing the controlled P6 copy.",
        notes: `Native float: ${task.totalFloatDays === null ? "not available" : `${round(task.totalFloatDays)} days`}.`,
        durationChanges: { [task.id]: proposed },
        lagChanges: {},
        affectedKeys: [`task:${task.id}`]
      });
    }
  }
  if (mode !== "mitigation") {
    for (const relationship of model.relationships) {
      const predecessor = model.tasks[relationship.predecessorId];
      const successor = model.tasks[relationship.successorId];
      if (!predecessor || !successor || (!path.has(predecessor.id) && !path.has(successor.id))) continue;
      if (relationship.lagDays > EPSILON) {
        const proposed = round(relationship.lagDays * (mode === "recovery" ? 0.5 : 0.7), 3);
        addCandidate({
          actionType: "LAG_OPTIMIZATION",
          activityId: successor.id,
          activityName: successor.name,
          wbsPath: wbsPath(model, successor.wbsId),
          currentDays: round(successor.remainingDays),
          proposedDays: round(successor.remainingDays),
          nominalReductionDays: round(relationship.lagDays - proposed),
          risk: candidateRisk("LAG_OPTIMIZATION"),
          strategy: "Review the positive relationship lag and replace only non-mandatory waiting time with evidence-backed, explicit native logic.",
          validation: "Do not reduce technical, regulatory, contractual, curing, testing, approval or acceptance waiting requirements without written project evidence.",
          relationship: `${predecessor.code} → ${successor.code} (${relationship.type}, ${round(relationship.lagDays)} days)`,
          durationChanges: {},
          lagChanges: { [relationship.id]: proposed },
          affectedKeys: [`rel:${relationship.id}`]
        });
      }
      if (mode === "recovery" && relationship.type === "PR_FS" && predecessor.remainingDays > 0 && successor.remainingDays > 0) {
        const overlap = Math.min(successor.remainingDays * 0.15, predecessor.remainingDays * 0.25);
        if (overlap <= EPSILON) continue;
        const proposed = round(relationship.lagDays - overlap, 3);
        addCandidate({
          actionType: "FAST_TRACK_OVERLAP",
          activityId: successor.id,
          activityName: successor.name,
          wbsPath: wbsPath(model, successor.wbsId),
          currentDays: round(successor.remainingDays),
          proposedDays: round(successor.remainingDays),
          nominalReductionDays: round(overlap),
          risk: candidateRisk("FAST_TRACK_OVERLAP"),
          strategy: "Test a partial workfront release / overlap hypothesis across an FS handoff.",
          validation: "Approve only when the predecessor and successor are physically divisible, safe to overlap and supported by drawings, method statements and responsible discipline leads.",
          relationship: `${predecessor.code} → ${successor.code} (${relationship.type})`,
          durationChanges: {},
          lagChanges: { [relationship.id]: proposed },
          affectedKeys: [`rel:${relationship.id}`]
        });
      }
    }
  }
  if (mode !== "mitigation") {
    const groups = new Map<string, ScheduleTask[]>();
    for (const task of corridor) {
      const signature = taskTokenSignature(task, wbsPath(model, task.wbsId));
      if (!signature) continue;
      const group = groups.get(signature) || [];
      group.push(task);
      groups.set(signature, group);
    }
    for (const [signature, tasks] of groups) {
      if (tasks.length < 3) continue;
      const durations = tasks.map((task) => task.remainingDays).sort((left, right) => left - right);
      const median = durations[Math.floor(durations.length / 2)];
      const slowerTasks = tasks.filter((task) => task.remainingDays > median * 1.18);
      if (!slowerTasks.length) continue;
      const changes: Record<string, number> = {};
      for (const task of slowerTasks) changes[task.id] = Math.max(median, round(task.remainingDays * 0.8, 3));
      const anchor = slowerTasks[0];
      addCandidate({
        actionType: "PATTERN_BENCHMARK",
        activityId: anchor.id,
        activityName: `Adaptive pattern benchmark: ${signature.replace(/\|/g, " / ")}`,
        wbsPath: "Multiple comparable work locations",
        currentDays: round(slowerTasks.reduce((total, task) => total + task.remainingDays, 0)),
        proposedDays: round(Object.values(changes).reduce((total, value) => total + value, 0)),
        nominalReductionDays: round(slowerTasks.reduce((total, task) => total + task.remainingDays, 0) - Object.values(changes).reduce((total, value) => total + value, 0)),
        risk: candidateRisk("PATTERN_BENCHMARK"),
        strategy: "Use the schedule's own repeated activity pattern to benchmark slower comparable workfaces, then verify the quantities, methods and resource conditions before implementation.",
        validation: "This is a local schedule pattern, not a productivity fact. Confirm comparability, quantities, workfront readiness and manpower before adopting the benchmark in P6.",
        notes: `${slowerTasks.length} activities are proposed for a controlled benchmark review.`,
        durationChanges: changes,
        lagChanges: {},
        affectedKeys: slowerTasks.map((task) => `task:${task.id}`)
      });
    }
  }
  return candidates.sort((left, right) => right.priorityScore - left.priorityScore || right.individualExactGainDays - left.individualExactGainDays).slice(0, 300);
}

function modeTarget(model: ScheduleModel, mode: ScheduleMode, requestedTarget: number | null) {
  if (mode === "revised") return null;
  if (mode === "recovery") return requestedTarget && requestedTarget > 0 ? requestedTarget : (model.recoveryRequirement.requiredRecoveryDays || null);
  const required = model.recoveryRequirement.requiredRecoveryDays;
  return required > 0 ? Math.min(30, Math.max(5, required * 0.25)) : Math.min(15, Math.max(3, model.baseCpm.networkLengthDays * 0.02));
}

function selectsSameScope(selected: ScheduleCandidate[], candidate: ScheduleCandidate) {
  const used = new Set(selected.flatMap((item) => item.affectedKeys));
  return candidate.affectedKeys.some((key) => used.has(key));
}

function makeChangeRegister(model: ScheduleModel, modification: Modification) {
  const changes: ScheduleChange[] = [];
  for (const [taskId, newValue] of Object.entries(modification.durationChanges)) {
    const task = model.tasks[taskId];
    if (!task) continue;
    changes.push({
      changeType: "REMAINING_DURATION",
      activityId: task.code,
      activityName: task.name,
      oldValueDays: round(task.remainingDays, 3),
      newValueDays: round(newValue, 3),
      implementation: "Change only after approved productivity, resource and work-method validation; update a controlled P6 copy, recalculate, then seek formal approval."
    });
  }
  const relationshipById = Object.fromEntries(model.relationships.map((relationship) => [relationship.id, relationship]));
  for (const [relationshipId, newValue] of Object.entries(modification.lagChanges)) {
    const relationship = relationshipById[relationshipId];
    if (!relationship) continue;
    const predecessor = model.tasks[relationship.predecessorId];
    const successor = model.tasks[relationship.successorId];
    changes.push({
      changeType: "RELATIONSHIP_LAG",
      activityId: `${predecessor?.code || relationship.predecessorId} → ${successor?.code || relationship.successorId}`,
      activityName: relationship.type,
      oldValueDays: round(relationship.lagDays, 3),
      newValueDays: round(newValue, 3),
      implementation: "Validate the physical, technical and contractual basis; update the native relationship/lag only in a controlled P6 copy, then recalculate."
    });
  }
  return changes.sort((left, right) => left.changeType.localeCompare(right.changeType) || left.activityId.localeCompare(right.activityId));
}

export function runScheduleAnalysis(model: ScheduleModel, mode: ScheduleMode, requestedTarget: number | null): ScheduleAnalysis {
  if (!model.isDag) {
    return {
      mode, model, candidateCount: 0, candidates: [], selectedCandidates: [], finalCpm: model.baseCpm, exactRecoveryDays: 0,
      targetRecoveryDays: null, remainingGapDays: null, changes: [], generatedAt: new Date().toISOString(), readiness: "blocked",
      warnings: ["The XER relationship graph contains a cycle. The schedule must be repaired and recalculated in Primavera P6 before any shadow-CPM or recovery recommendation can be made."]
    };
  }
  const candidates = generateCandidates(model, mode);
  const target = modeTarget(model, mode, requestedTarget);
  const selected: ScheduleCandidate[] = [];
  let modification: Modification = { durationChanges: {}, lagChanges: {} };
  let currentCpm = model.baseCpm;
  const maximumActions = mode === "mitigation" ? 6 : mode === "recovery" ? 16 : 12;
  while (selected.length < maximumActions) {
    let best: { candidate: ScheduleCandidate; cpm: CpmResult; incrementalGain: number } | null = null;
    for (const candidate of candidates) {
      if (selected.some((item) => item.id === candidate.id) || selectsSameScope(selected, candidate)) continue;
      const trialCpm = cpm(model, mergeModification(modification, candidate));
      const incrementalGain = currentCpm.networkLengthDays - trialCpm.networkLengthDays;
      if (incrementalGain <= EPSILON) continue;
      const riskFactor = candidate.risk === "high" ? 0.75 : candidate.risk === "medium" ? 0.9 : 1;
      const score = incrementalGain * riskFactor;
      const bestScore = best ? best.incrementalGain * (best.candidate.risk === "high" ? 0.75 : best.candidate.risk === "medium" ? 0.9 : 1) : -Infinity;
      if (!best || score > bestScore + EPSILON || (Math.abs(score - bestScore) <= EPSILON && candidate.priorityScore > best.candidate.priorityScore)) best = { candidate, cpm: trialCpm, incrementalGain };
    }
    if (!best) break;
    const candidate = { ...best.candidate, selectedExactIncrementalGainDays: round(best.incrementalGain) };
    selected.push(candidate);
    modification = mergeModification(modification, candidate);
    currentCpm = best.cpm;
    const achieved = model.baseCpm.networkLengthDays - currentCpm.networkLengthDays;
    if (target !== null && achieved >= target - EPSILON) break;
  }
  const exactRecoveryDays = round(Math.max(0, model.baseCpm.networkLengthDays - currentCpm.networkLengthDays));
  const resourceCoverage = Object.keys(model.resourceCountByTask).length / Math.max(1, Object.keys(model.tasks).length);
  const warnings = [
    "Exact shadow-CPM gain is the governing result in this module; adaptive ranking never replaces precedence mathematics.",
    "The source XER is not modified. Exported changes are a review register only and must be recreated, recalculated and approved in a controlled Primavera P6 copy.",
    "Calendar exceptions, external relationships, constraints, resource leveling, constructability, HSE, QA/QC, procurement and approvals require project evidence and native P6 verification."
  ];
  if (resourceCoverage < 0.35) warnings.push(`Only ${round(resourceCoverage * 100, 1)}% of activities contain resource assignments in this XER. Treat duration-compression recommendations as review hypotheses until resource validation is complete.`);
  if (target !== null && exactRecoveryDays < target - EPSILON) warnings.push(`The selected scenario achieves ${exactRecoveryDays} days of exact shadow-CPM gain against a ${round(target)}-day target. The remaining gap needs additional approved scope, sequencing or completion-date decisions.`);
  if (!model.recoveryRequirement.requiredRecoveryDays && mode === "recovery" && !requestedTarget) warnings.push("No native terminal constraint, late-finish pressure or negative terminal float established a recovery target. Enter an approved recovery target before using this as a committed recovery plan.");
  const readiness: ScheduleAnalysis["readiness"] = candidates.length ? (target !== null && exactRecoveryDays < target - EPSILON ? "review_required" : "ready_with_gates") : "blocked";
  return {
    mode,
    model,
    candidateCount: candidates.length,
    candidates,
    selectedCandidates: selected,
    finalCpm: currentCpm,
    exactRecoveryDays,
    targetRecoveryDays: target === null ? null : round(target),
    remainingGapDays: target === null ? null : round(Math.max(0, target - exactRecoveryDays)),
    changes: makeChangeRegister(model, modification),
    warnings,
    readiness,
    generatedAt: new Date().toISOString()
  };
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function candidatesToCsv(candidates: ScheduleCandidate[]) {
  const headers = ["candidate_id", "action_type", "activity_id", "activity_name", "wbs_path", "current_days", "proposed_days", "nominal_reduction_days", "individual_exact_gain_days", "selected_exact_incremental_gain_days", "confidence", "risk", "priority_score", "strategy", "validation", "relationship", "notes"];
  const rows = candidates.map((candidate) => [candidate.id, candidate.actionType, candidate.activityId, candidate.activityName, candidate.wbsPath, candidate.currentDays, candidate.proposedDays, candidate.nominalReductionDays, candidate.individualExactGainDays, candidate.selectedExactIncrementalGainDays ?? "", candidate.confidence, candidate.risk, candidate.priorityScore, candidate.strategy, candidate.validation, candidate.relationship || "", candidate.notes || ""]);
  return [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
}

export function changesToCsv(changes: ScheduleChange[]) {
  const headers = ["change_type", "activity_id", "activity_name", "old_value_days", "new_value_days", "implementation"];
  const rows = changes.map((change) => [change.changeType, change.activityId, change.activityName, change.oldValueDays, change.newValueDays, change.implementation]);
  return [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
}
