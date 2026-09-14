"use client";

/**
 * Mitigation · Recovery · Revised — one stage of the Schedule Intelligence
 * pipeline. The loaded schedule, its analysis, the planning library and the
 * activity mapping all feed the same engine; the objective only changes the
 * default controls, and every control, lever and edit stays editable.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Analysis } from "../../../lib/xer/analysis";
import { downloadCsv, formatDate, formatNum } from "../../../lib/xer/format";
import type { LoadedSchedule, ProjectView, RelationshipKind, Task } from "../../../lib/xer/model";
import type { AnalyzerOptions } from "../../../lib/xer/options";
import {
  defaultControls, evaluateScenario, resolveScenarioEdits, runScenarioAsync,
  type LinkEdit, type ScenarioAction, type ScenarioChange, type ScenarioControls, type ScenarioObjective,
  type ScenarioProgress, type ScenarioResult, type ScenarioState, type TaskEdit, type TaskProductivity, type MovedActivity,
} from "../../../lib/xer/scenario";
import { exportScenarioXer } from "../../../lib/xer/scenario-export";
import { PathChain, floatCell } from "../xer/helpers";
import { Badge, Card, DataTable, Kpi, Kpis, SectionTitle } from "../xer/ui";
import { downloadBlob } from "./LibraryWorkspace";

export type ScenarioRun = { value: ScenarioResult; productivity: TaskProductivity[] };

const OBJECTIVES: { key: ScenarioObjective; label: string; eyebrow: string; text: string }[] = [
  {
    key: "mitigation", label: "Mitigation", eyebrow: "Contain slippage",
    text: "Least-disruptive levers first — one added resource set, extended hours and limited compression. Logic is left untouched.",
  },
  {
    key: "recovery", label: "Recovery", eyebrow: "Close the gap",
    text: "Every lever, each gated — added sets, extended hours, compression, lag reduction and fast-tracking — against the evidenced or approved target.",
  },
  {
    key: "revised", label: "Revised programme", eyebrow: "Re-plan remaining work",
    text: "Re-estimates mapped activities from the library's production rates, then optimises by cost without forcing a date.",
  },
];

const LEVER_LABEL: Record<string, string> = {
  ADD_SETS: "Add set", EXTENDED_HOURS: "Extended hours", COMPRESSION: "Compression",
  LAG_REDUCTION: "Lag reduction", FAST_TRACK: "Fast-track", RE_ESTIMATE: "Re-estimate",
};

const riskTone = (risk: string) => (risk === "high" ? "bad" : risk === "medium" ? "warn" : "ok");
const round2 = (v: number) => Math.round(v * 100) / 100;

export default function ScenarioView({
  S, P, an, opts, productivity, controls, onControls, manual, onManual, run, onRun, onOpenTask, goMapping, goLibrary,
}: {
  S: LoadedSchedule;
  P: ProjectView;
  an: Analysis;
  opts: AnalyzerOptions;
  productivity: TaskProductivity[];
  controls: ScenarioControls;
  onControls: (next: ScenarioControls) => void;
  manual: ScenarioState;
  onManual: (next: ScenarioState) => void;
  run: ScenarioRun | null;
  onRun: (next: ScenarioRun | null) => void;
  onOpenTask: (t: Task) => void;
  goMapping: () => void;
  goLibrary: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Progress lives in its own small component so a long run repaints one line, not the whole stage.
  const progressSink = useRef<((p: ScenarioProgress | null) => void) | null>(null);
  const registerProgress = useCallback((sink: ((p: ScenarioProgress | null) => void) | null) => {
    progressSink.current = sink;
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const set = (patch: Partial<ScenarioControls>) => onControls({ ...controls, ...patch });
  const result = run?.value || null;

  const milestones = useMemo(
    () => P.tasks.filter((t) => t.isMile && !t.done && t.c.ef).sort((a, b) => +a.c.ef! - +b.c.ef!),
    [P],
  );
  const workCodes = useMemo(() => P.tasks.filter((t) => !t.done).map((t) => t.code), [P]);
  const workCodeList = useMemo(
    () => <datalist id="pl-work-codes">{workCodes.map((c) => <option key={c} value={c} />)}</datalist>,
    [workCodes],
  );
  const byCode = (code: string) => (P.byCode.get(code.trim()) || [])[0] || null;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 7000);
  };

  const execute = async (mode: "optimize" | "evaluate", override?: ScenarioControls) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setError(null);
    progressSink.current?.({ phase: "Preparing", evaluations: 0, actions: 0, gainDays: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const input = { P, an, opts, controls: override || controls, productivity, state: manual };
    try {
      const value = mode === "evaluate" ? evaluateScenario(input) : await runScenarioAsync(input, (p) => progressSink.current?.(p), ctrl.signal);
      onRun({ value, productivity });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The scenario could not be solved.");
      }
    } finally {
      setBusy(false);
      progressSink.current?.(null);
    }
  };

  const switchObjective = (objective: ScenarioObjective) => {
    onControls({
      ...defaultControls(objective),
      targetTaskId: controls.targetTaskId, targetMode: controls.targetMode, targetDays: controls.targetDays, targetDate: controls.targetDate,
      lockedTaskIds: controls.lockedTaskIds, lockedLinkIds: controls.lockedLinkIds, excludePattern: controls.excludePattern,
      timeBudgetMs: controls.timeBudgetMs,
    });
  };

  const excludeAndRerun = (action: ScenarioAction) => {
    const next: ScenarioControls = {
      ...controls,
      lockedTaskIds: action.taskId ? Array.from(new Set([...controls.lockedTaskIds, action.taskId])) : controls.lockedTaskIds,
      lockedLinkIds: action.linkId ? Array.from(new Set([...controls.lockedLinkIds, action.linkId])) : controls.lockedLinkIds,
    };
    onControls(next);
    void execute("optimize", next);
  };

  /* ------------------------------------------------------------ exports */

  const exportBase = `${P.name}-${controls.objective}`;

  const exportDates = () => {
    if (!result || !run) return;
    const edits = resolveScenarioEdits({ P, an, opts, controls: result.controls, productivity: run.productivity }, result.state);
    const header = [
      "Activity ID", "Activity name", "Status", "Remaining (file, d)", "Remaining (scenario, d)", "Early start (file)", "Early finish (file)",
      "Early start (scenario)", "Early finish (scenario)", "Finish shift (d)", "Total float (file, d)", "Total float (scenario, d)",
    ];
    const rows = P.tasks.map((t) => {
      const c = result.dates.get(t.id);
      const hd = t.cal.dayHours || 8;
      const rd = edits.rdHr?.get(t.id) ?? t.rdHr;
      return [
        t.code, t.name, t.statusName, round2(t.rdHr / hd), round2(rd / hd), formatDate(t.c.es, true), formatDate(t.c.ef, true),
        formatDate(c?.es || null, true), formatDate(c?.ef || null, true),
        t.c.ef && c?.ef ? round2((+c.ef - +t.c.ef) / 86_400_000) : "", t.c.tf ?? "", c?.tf ?? "",
      ];
    });
    downloadCsv(`${exportBase}-revised-dates.csv`, header, rows);
  };

  const exportXer = () => {
    if (!result || !run) return;
    const edits = resolveScenarioEdits({ P, an, opts, controls: result.controls, productivity: run.productivity }, result.state);
    const out = exportScenarioXer(S, P, edits);
    downloadBlob(`${S.fileName.replace(/\.xer$/i, "")}-${controls.objective}-CONTROLLED-COPY.xer`, out.text, "text/plain;charset=utf-8");
    flash(`Controlled copy written: ${out.tasksChanged} activity durations and ${out.linksChanged} relationships changed. Import it into P6 as a separate project and reschedule (F9) before relying on any date.`);
  };

  const exportAudit = () => {
    if (!result || !run) return;
    const audit = {
      engine: "Schedule Intelligence scenario engine",
      status: "Draft / Conditional — requires native P6 recalculation and approval",
      generatedAt: result.generatedAt,
      source: { file: S.fileName, project: P.name, dataDate: P.dataDate, lagCalendarMode: an.lagCalendarMode, lagCalendarSource: an.lagCalendarSource },
      objective: result.objective,
      controls: result.controls,
      target: { activity: result.targetTask?.code || "Project finish", basis: result.targetBasis, requiredFinish: result.requiredFinish, requiredDays: result.requiredDays },
      finish: { file: result.fileFinish, reestimated: result.reestimatedFinish, scenario: result.scenarioFinish },
      gainDays: result.gainDays, gainWorkDays: result.gainWorkDays, remainingGapDays: result.remainingGapDays, targetMet: result.targetMet,
      totalCost: result.totalCost, uncostedActions: result.uncostedActions,
      exactness: result.exactness, evaluations: result.evaluations, ms: result.ms, stopReason: result.stopReason,
      productivityBasis: run.productivity,
      actions: result.actions,
      changeRegister: result.changes,
      scenarioEdits: result.state,
      warnings: result.warnings,
    };
    downloadBlob(`${exportBase}-audit.json`, JSON.stringify(audit, null, 2), "application/json");
  };

  /* ------------------------------------------------------------- render */

  const objective = OBJECTIVES.find((o) => o.key === controls.objective) || OBJECTIVES[1];
  const manualCount = Object.keys(manual.tasks).length + Object.keys(manual.links).length;
  const percent = result && result.requiredDays && result.requiredDays > 0 ? Math.max(0, Math.min(100, (result.gainDays / result.requiredDays) * 100)) : null;

  return (
    <div className="xer-view pl-scenario">
      <nav className="schedule-intelligence-tabs pl-objectives" aria-label="Scenario objective">
        {OBJECTIVES.map((o) => (
          <button key={o.key} type="button" className={controls.objective === o.key ? "active" : ""} onClick={() => switchObjective(o.key)}>
            <span>{o.eyebrow}</span>
            {o.label}
          </button>
        ))}
      </nav>

      <div className="xer-callout">
        <b>{objective.label}:</b> {objective.text} Same schedule, same CPM, same library and mapping for all three — the objective only
        changes the defaults below.
      </div>

      <Kpis>
        <Kpi label="Schedule" value={formatNum(P.tasks.length)} note={`${S.fileName} · data date ${formatDate(P.dataDate)}`} />
        <Kpi label="Recalculated finish" value={formatDate(an.calcFinish)} note={`Stored ${formatDate(an.storedFinish)} · lag ${an.lagCalendarMode.replace("rcal_", "")} (${an.lagCalendarSource})`} />
        <Kpi label="Productivity basis" value={formatNum(productivity.length)} note="Mapped activities with a library rate" tone={productivity.length ? "ok" : "warn"} onClick={goMapping} />
        <Kpi label="Manual edits" value={formatNum(manualCount)} note="Kept fixed; the optimiser builds on them" tone={manualCount ? "info" : ""} />
        <Kpi label="Planning library" value="Edit" note="Activity list, crews, rates, equipment" onClick={goLibrary} />
      </Kpis>

      <Card eyebrow="Controls" title="Every lever and limit is editable" aside={<button type="button" className="xer-btn xer-btn-sm" onClick={() => switchObjective(controls.objective)}>Reset to {objective.label} defaults</button>}>
        <div className="pl-controls">
          <fieldset>
            <legend>Target</legend>
            <label className="xer-field xer-field-block">
              <span>Measure the finish of</span>
              <select className="xer-select" value={controls.targetTaskId} onChange={(e) => set({ targetTaskId: e.target.value })}>
                <option value="">Project finish (latest activity)</option>
                {controls.targetTaskId && !milestones.some((m) => m.id === controls.targetTaskId) && P.byId[controls.targetTaskId] ? (
                  <option value={controls.targetTaskId}>{P.byId[controls.targetTaskId].code} — {P.byId[controls.targetTaskId].name}</option>
                ) : null}
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name} ({formatDate(m.c.ef)})</option>)}
              </select>
            </label>
            <label className="xer-field xer-field-block">
              <span>…or any activity ID</span>
              <input
                className="xer-input"
                list="pl-work-codes"
                placeholder="Activity ID"
                onBlur={(e) => {
                  const t = byCode(e.target.value);
                  if (t) set({ targetTaskId: t.id });
                  e.target.value = "";
                }}
              />
            </label>
            <label className="xer-field xer-field-block">
              <span>Requirement</span>
              <select className="xer-select" value={controls.targetMode} onChange={(e) => set({ targetMode: e.target.value as ScenarioControls["targetMode"] })}>
                <option value="auto">From the schedule (must-finish, constraint, negative float)</option>
                <option value="days">Recover a number of calendar days</option>
                <option value="date">Finish by a date</option>
              </select>
            </label>
            {controls.targetMode === "days" ? <NumberControl label="Calendar days to recover" value={controls.targetDays} min={0} step={1} onChange={(v) => set({ targetDays: v })} /> : null}
            {controls.targetMode === "date" ? (
              <label className="xer-field xer-field-block">
                <span>Required finish date</span>
                <input className="xer-input" type="date" value={controls.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
              </label>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Resource sets</legend>
            <Toggle label="Add crews / equipment sets" checked={controls.allowAddSets} onChange={(v) => set({ allowAddSets: v })} note="Mapped activities only; output and cost from the library" />
            <NumberControl label="Most sets added per activity" value={controls.maxAddedSets} min={0} step={1} onChange={(v) => set({ maxAddedSets: v })} />
            <NumberControl label="Output of an added set (%)" value={controls.addedSetEfficiencyPct} min={1} max={100} step={5} onChange={(v) => set({ addedSetEfficiencyPct: v })} />
            <NumberControl label="Mobilisation cost per added set" value={controls.mobilizationCostPerSet} min={0} step={100} onChange={(v) => set({ mobilizationCostPerSet: v })} />
          </fieldset>

          <fieldset>
            <legend>Working hours &amp; durations</legend>
            <Toggle label="Extended working hours" checked={controls.allowExtendedHours} onChange={(v) => set({ allowExtendedHours: v })} />
            <NumberControl label="Paid hours × normal day" value={controls.extendedHoursFactor} min={1} max={2} step={0.05} onChange={(v) => set({ extendedHoursFactor: v })} />
            <NumberControl label="Output of extra hours (%)" value={controls.overtimeEfficiencyPct} min={1} max={100} step={5} onChange={(v) => set({ overtimeEfficiencyPct: v })} />
            <NumberControl label="Overtime premium (%)" value={controls.overtimePremiumPct} min={0} step={5} onChange={(v) => set({ overtimePremiumPct: v })} />
            <Toggle label="Compress unmapped durations" checked={controls.allowCompression} onChange={(v) => set({ allowCompression: v })} note="No productivity basis — flagged high risk" />
            <NumberControl label="Maximum compression (%)" value={controls.maxCompressionPct} min={0} max={90} step={5} onChange={(v) => set({ maxCompressionPct: v })} />
            <NumberControl label="Minimum remaining duration (d)" value={controls.minRemainingDays} min={0} step={0.5} onChange={(v) => set({ minRemainingDays: v })} />
            <Toggle label="Hours & compression need resources" checked={controls.workLeversNeedResources} onChange={(v) => set({ workLeversNeedResources: v })} note="Only resource-loaded or mapped activities" />
          </fieldset>

          <fieldset>
            <legend>Logic</legend>
            <Toggle label="Reduce relationship lags" checked={controls.allowLagReduction} onChange={(v) => set({ allowLagReduction: v })} />
            <NumberControl label="Maximum lag reduction (%)" value={controls.maxLagReductionPct} min={0} max={100} step={5} onChange={(v) => set({ maxLagReductionPct: v })} />
            <Toggle label="Fast-track FS handoffs" checked={controls.allowFastTrack} onChange={(v) => set({ allowFastTrack: v })} note="FS becomes SS with lag — high risk" />
            <NumberControl label="Overlap of the predecessor (%)" value={controls.fastTrackOverlapPct} min={0} max={90} step={5} onChange={(v) => set({ fastTrackOverlapPct: v })} />
          </fieldset>

          <fieldset>
            <legend>Search</legend>
            <label className="xer-field xer-field-block">
              <span>Rank interventions by</span>
              <select className="xer-select" value={controls.rankBy} onChange={(e) => set({ rankBy: e.target.value as ScenarioControls["rankBy"] })}>
                <option value="gain">Largest exact gain (risk-weighted)</option>
                <option value="cost">Lowest cost per day gained</option>
                <option value="risk">Lowest risk first</option>
              </select>
            </label>
            <NumberControl label="Maximum actions" value={controls.maxActions} min={0} step={1} onChange={(v) => set({ maxActions: v })} />
            <NumberControl label="Revised: stop below gain (d)" value={controls.minGainDays} min={0} step={0.5} onChange={(v) => set({ minGainDays: v })} />
            <NumberControl label="Round durations up to (d)" value={controls.granularityDays} min={0} step={0.5} onChange={(v) => set({ granularityDays: v })} />
            <NumberControl label="Time budget (s)" value={controls.timeBudgetMs / 1000} min={1} step={5} onChange={(v) => set({ timeBudgetMs: Math.max(1, v) * 1000 })} />
            <Toggle label="Include in-progress activities" checked={controls.includeStarted} onChange={(v) => set({ includeStarted: v })} />
            <Toggle label="Re-estimate mapped durations from rates" checked={controls.reestimateFromProductivity} onChange={(v) => set({ reestimateFromProductivity: v })} note="Quantity ÷ (output × confirmed sets)" />
          </fieldset>

          <fieldset>
            <legend>Never edit</legend>
            <label className="xer-field xer-field-block">
              <span>Activities matching (ID or name, regular expression)</span>
              <input className="xer-input" value={controls.excludePattern} onChange={(e) => set({ excludePattern: e.target.value })} />
            </label>
            <label className="xer-field xer-field-block">
              <span>Lock an activity</span>
              <input
                className="xer-input"
                list="pl-work-codes"
                placeholder="Activity ID"
                onBlur={(e) => {
                  const t = byCode(e.target.value);
                  if (t && !controls.lockedTaskIds.includes(t.id)) set({ lockedTaskIds: [...controls.lockedTaskIds, t.id] });
                  e.target.value = "";
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <div className="xer-tag-row">
              {controls.lockedTaskIds.map((id) => (
                <span key={id} className="xer-chip">
                  {P.byId[id]?.code || id}
                  <button type="button" aria-label="Unlock" onClick={() => set({ lockedTaskIds: controls.lockedTaskIds.filter((x) => x !== id) })}>✕</button>
                </span>
              ))}
              {controls.lockedLinkIds.map((id) => {
                const l = P.links.find((x) => x.id === id);
                return (
                  <span key={id} className="xer-chip">
                    {l ? `${l.pred?.code} → ${l.succ?.code}` : id}
                    <button type="button" aria-label="Unlock" onClick={() => set({ lockedLinkIds: controls.lockedLinkIds.filter((x) => x !== id) })}>✕</button>
                  </span>
                );
              })}
            </div>
          </fieldset>
        </div>
        {workCodeList}

        <div className="xer-toolbar pl-run">
          <button type="button" className="schedule-intelligence-primary" disabled={busy} onClick={() => void execute("optimize")}>
            {busy ? "Solving…" : `Run ${objective.label.toLowerCase()}`}
          </button>
          <button type="button" className="xer-btn" disabled={busy || !manualCount} onClick={() => void execute("evaluate")}>Evaluate manual edits only</button>
          {busy ? <button type="button" className="xer-btn" onClick={() => abort.current?.abort()}>Cancel</button> : null}
          {result ? <button type="button" className="xer-btn" disabled={busy} onClick={() => onRun(null)}>Clear result</button> : null}
          <ProgressLine register={registerProgress} />
        </div>
        {error ? <p className="xer-error">{error}</p> : null}
        {notice ? <p className="xer-busy">{notice}</p> : null}
      </Card>

      {result ? (
        <ScenarioResultView
          result={result}
          P={P}
          percent={percent}
          onOpenTask={onOpenTask}
          onExclude={excludeAndRerun}
          busy={busy}
          exportBase={exportBase}
          exportDates={exportDates}
          exportXer={exportXer}
          exportAudit={exportAudit}
          adopt={() => {
            onManual(result.state);
            flash("The scenario's edits are now manual edits — change any value below and evaluate, or run again to build on them.");
          }}
        />
      ) : (
        <section className="schedule-intelligence-card">
          <div className="schedule-intelligence-empty schedule-intelligence-empty-large">
            <b>No scenario solved yet</b>
            <span>
              Set the target and levers, then run. Map activities to the planning library first for crew- and cost-based levers; unmapped
              activities can still be compressed, and logic levers need no mapping.
            </span>
          </div>
        </section>
      )}

      <ManualEdits P={P} manual={manual} onManual={onManual} busy={busy} evaluate={() => void execute("evaluate")} />
    </div>
  );
}

/* ------------------------------------------------------------- results */

function ScenarioResultView({
  result, P, percent, onOpenTask, onExclude, busy, exportBase, exportDates, exportXer, exportAudit, adopt,
}: {
  result: ScenarioResult;
  P: ProjectView;
  percent: number | null;
  onOpenTask: (t: Task) => void;
  onExclude: (a: ScenarioAction) => void;
  busy: boolean;
  exportBase: string;
  exportDates: () => void;
  exportXer: () => void;
  exportAudit: () => void;
  adopt: () => void;
}) {
  const [tab, setTab] = useState<"actions" | "register" | "moved" | "path" | "gates">("actions");
  const openLink = (a: ScenarioAction | ScenarioChange) => {
    if (a.taskId && P.byId[a.taskId]) onOpenTask(P.byId[a.taskId]);
    else if (a.linkId) {
      const l = P.links.find((x) => x.id === a.linkId);
      if (l?.succ) onOpenTask(l.succ);
    }
  };

  if (result.blocked) {
    return <div className="xer-callout xer-callout-warn"><b>Blocked.</b> {result.blocked}</div>;
  }

  return (
    <>
      <section className="schedule-intelligence-status" aria-live="polite">
        <div>
          <p>Draft / Conditional — native P6 recalculation required</p>
          <b>{result.targetMet === true ? "Target met" : result.targetMet === false ? "Target not met — gap reported" : "Scenario solved"}</b>
          <span>
            {result.stopReason} · {formatNum(result.evaluations)} exact CPM solves in {formatNum(result.ms / 1000, 1)} s · exactness{" "}
            {result.exactness.mismatches ? `${result.exactness.mismatches} mismatches` : `${result.exactness.checked}/${result.exactness.checked} re-solved identically`}
          </span>
        </div>
        <div className="schedule-intelligence-downloads">
          <button type="button" onClick={exportXer}>Controlled-copy XER</button>
          <button type="button" onClick={exportDates}>Revised dates CSV</button>
          <button type="button" onClick={exportAudit}>Audit JSON</button>
          <button type="button" onClick={adopt} disabled={busy}>Edit these results by hand</button>
        </div>
      </section>

      <Kpis>
        <Kpi label="File finish" value={formatDate(result.fileFinish)} note={result.targetTask ? result.targetTask.code : "Project finish, recalculated"} />
        {result.reestimatedFinish ? <Kpi label="After re-estimate" value={formatDate(result.reestimatedFinish)} note="Mapped durations from library rates" tone="info" /> : null}
        <Kpi label="Scenario finish" value={formatDate(result.scenarioFinish)} note={`${result.actions.length} actions · ${result.changes.length} P6 changes`} tone="info" />
        <Kpi label="Gain" value={`${formatNum(result.gainDays, 1)} d`} note={`${formatNum(result.gainWorkDays, 1)} working days`} tone={result.gainDays > 0 ? "ok" : ""} />
        <Kpi label="Required" value={result.requiredDays === null ? "Not set" : `${formatNum(result.requiredDays, 1)} d`} note={result.targetBasis} />
        <Kpi label="Remaining gap" value={result.remainingGapDays === null ? "—" : `${formatNum(result.remainingGapDays, 1)} d`} tone={result.remainingGapDays ? "crit" : result.remainingGapDays === 0 ? "ok" : ""} note={result.remainingGapDays ? "Needs a further approved decision" : ""} />
        <Kpi label="Indicative cost" value={formatNum(result.totalCost, 0)} note={result.uncostedActions ? `${result.uncostedActions} edits without a cost basis` : "From library crew and equipment rates"} />
        <Kpi label="Critical activities" value={`${formatNum(result.criticalBefore)} → ${formatNum(result.criticalAfter)}`} note={`Negative float ${formatNum(result.negativeBefore)} → ${formatNum(result.negativeAfter)}`} />
      </Kpis>

      {percent !== null ? (
        <section className="schedule-intelligence-progress" aria-label="Progress to target">
          <div><span>Exact gain against the requirement</span><b>{formatNum(percent, 0)}%</b></div>
          <i><em style={{ width: `${percent}%` }} /></i>
        </section>
      ) : null}

      <div className="xer-subtabs">
        {([
          ["actions", `Actions (${result.actions.length})`], ["register", `P6 change register (${result.changes.length})`],
          ["moved", `Moved activities (${result.moved.length})`], ["path", "Driving path"], ["gates", `Gates & warnings (${result.warnings.length})`],
        ] as [typeof tab, string][]).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "actions" ? (
        <Card eyebrow="In the order applied" title="Interventions" aside="Each gain is exact — re-solved over the whole network">
          <DataTable
            rows={result.actions}
            rowKey={(a) => a.id}
            exportName={`${exportBase}-actions`}
            minWidth={1300}
            empty="No intervention was needed or possible."
            columns={[
              { k: "id", label: "#", cell: (a) => <span className="xer-mono">{a.id}{a.bundle ? <small className="pl-sub">pair {a.bundle}</small> : null}</span>, sort: (a) => a.step },
              { k: "type", label: "Lever", cell: (a) => <Badge tone="info">{LEVER_LABEL[a.type] || a.type}</Badge>, sort: (a) => a.type, csv: (a) => a.type },
              { k: "code", label: "Activity / relationship", cell: (a) => <button type="button" className="pl-link xer-mono" onClick={() => openLink(a)}>{a.code}</button>, sort: (a) => a.code },
              { k: "change", label: "Change", cell: (a) => <span>{a.beforeValue} <i className="xer-diff-arrow">→</i> <b>{a.afterValue}</b></span>, csv: (a) => `${a.beforeValue} -> ${a.afterValue}` },
              { k: "gain", label: "Gain (d)", align: "right", cell: (a) => formatNum(a.gainDays, 2), sort: (a) => a.gainDays },
              { k: "cost", label: "Cost", align: "right", cell: (a) => (a.cost === null ? <span className="xer-dim">no basis</span> : formatNum(a.cost, 0)), sort: (a) => a.cost },
              { k: "risk", label: "Risk", cell: (a) => <Badge tone={riskTone(a.risk)}>{a.risk}</Badge>, sort: (a) => a.risk },
              { k: "basis", label: "Basis", cell: (a) => <small>{a.basis}</small>, csv: (a) => a.basis },
              { k: "validation", label: "Required validation", cell: (a) => <small>{a.validation}</small>, csv: (a) => a.validation },
              {
                k: "x", label: "", cell: (a) => (a.type === "RE_ESTIMATE" ? null : (
                  <button type="button" className="xer-btn xer-btn-sm" disabled={busy} onClick={() => onExclude(a)} title="Lock this activity or relationship and solve again">
                    Exclude &amp; re-run
                  </button>
                )),
              },
            ]}
          />
        </Card>
      ) : null}

      {tab === "register" ? (
        <Card eyebrow="Recreate in a controlled P6 copy" title="P6 change register" aside="Or export the controlled-copy XER">
          <DataTable
            rows={result.changes}
            rowKey={(c, i) => `${c.kind}-${c.taskId || c.linkId}-${i}`}
            exportName={`${exportBase}-p6-change-register`}
            minWidth={1000}
            empty="The scenario changes nothing."
            columns={[
              { k: "kind", label: "Change", cell: (c) => c.kind, sort: (c) => c.kind },
              { k: "code", label: "Activity / relationship", cell: (c) => <button type="button" className="pl-link xer-mono" onClick={() => openLink(c)}>{c.code}</button>, sort: (c) => c.code },
              { k: "name", label: "Name", cell: (c) => <small>{c.name}</small>, sort: (c) => c.name },
              { k: "from", label: "From", cell: (c) => c.from, csv: (c) => c.fromNumber ?? c.from },
              { k: "to", label: "To", cell: (c) => <b>{c.to}</b>, csv: (c) => c.toNumber ?? c.to },
              { k: "field", label: "XER field", cell: (c) => <span className="xer-mono">{c.p6Field}</span>, csv: (c) => c.p6Field },
              { k: "levers", label: "Levers", cell: (c) => c.levers, csv: (c) => c.levers },
            ]}
          />
        </Card>
      ) : null}

      {tab === "moved" ? (
        <Card eyebrow="Recalculated over the whole network" title="Activities whose finish moves" aside="Earliest first">
          <DataTable
            rows={result.moved}
            rowKey={(m) => m.task.id}
            exportName={`${exportBase}-moved-activities`}
            searchText={(m) => `${m.task.code} ${m.task.name}`}
            onRowClick={(m) => onOpenTask(m.task)}
            minWidth={980}
            columns={[
              { k: "code", label: "ID", cell: (m: MovedActivity) => <span className="xer-mono">{m.task.code}</span>, sort: (m) => m.task.code },
              { k: "name", label: "Name", cell: (m) => m.task.name, sort: (m) => m.task.name },
              { k: "bf", label: "File finish", cell: (m) => formatDate(m.baseFinish), sort: (m) => +(m.baseFinish || 0), csv: (m) => formatDate(m.baseFinish, true) },
              { k: "sf", label: "Scenario finish", cell: (m) => <b>{formatDate(m.finish)}</b>, sort: (m) => +(m.finish || 0), csv: (m) => formatDate(m.finish, true) },
              { k: "d", label: "Shift (d)", align: "right", cell: (m) => <span className={m.deltaDays < 0 ? "xer-tone-text-ok" : "xer-tone-text-bad"}>{formatNum(m.deltaDays, 1)}</span>, sort: (m) => m.deltaDays },
              { k: "tf0", label: "TF file", align: "right", cell: (m) => floatCell(m.baseFloat, { ...DEFAULT_TF }), sort: (m) => m.baseFloat },
              { k: "tf1", label: "TF scenario", align: "right", cell: (m) => floatCell(m.float, { ...DEFAULT_TF }), sort: (m) => m.float },
            ]}
          />
        </Card>
      ) : null}

      {tab === "path" ? (
        <Card eyebrow="After the scenario" title={`Driving path — ${result.longestPath.length} activities`}>
          <PathChain tasks={result.longestPath} critical max={80} onPick={onOpenTask} />
        </Card>
      ) : null}

      {tab === "gates" ? (
        <Card eyebrow="Planning engineer gates" title="Required before issue or execution">
          <ol className="pl-gates">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ol>
          <SectionTitle>Target basis</SectionTitle>
          <p className="xer-muted">{result.targetBasis}</p>
        </Card>
      ) : null}
    </>
  );
}

const DEFAULT_TF = {
  hoursPerDay: 8, autoHoursPerDay: true, tfCritical: 0, tfNear: 10, highFloat: 44, highDuration: 44, longLag: 5,
  retainedLogic: true, ignoreLOE: true, matchBy: "code" as const, dateTol: 0, durTol: 0, fuzzyRename: true, fieldsOff: {},
};

/* ----------------------------------------------------------- manual edits */

function ManualEdits({ P, manual, onManual, busy, evaluate }: { P: ProjectView; manual: ScenarioState; onManual: (s: ScenarioState) => void; busy: boolean; evaluate: () => void }) {
  const [linkSucc, setLinkSucc] = useState<Task | null>(null);

  const cleanTask = (edit: TaskEdit): TaskEdit | null => {
    const out: TaskEdit = {};
    if (edit.sets !== undefined && Number.isFinite(edit.sets)) out.sets = edit.sets;
    if (edit.hoursFactor !== undefined && Number.isFinite(edit.hoursFactor)) out.hoursFactor = edit.hoursFactor;
    if (edit.compressionPct !== undefined && Number.isFinite(edit.compressionPct)) out.compressionPct = edit.compressionPct;
    if (edit.durationDays !== undefined && Number.isFinite(edit.durationDays)) out.durationDays = edit.durationDays;
    if (edit.reestimated) out.reestimated = true;
    return Object.keys(out).length ? out : null;
  };
  const setTask = (id: string, edit: TaskEdit | null) => {
    const tasks = { ...manual.tasks };
    const clean = edit ? cleanTask(edit) : null;
    if (clean) tasks[id] = clean;
    else delete tasks[id];
    onManual({ ...manual, tasks });
  };
  const setLink = (id: string, edit: LinkEdit | null) => {
    const links = { ...manual.links };
    if (edit && (edit.lagDays !== undefined || edit.type)) links[id] = edit;
    else delete links[id];
    onManual({ ...manual, links });
  };
  const numOrUndef = (v: string) => {
    const n = Number.parseFloat(v);
    return v.trim() === "" || !Number.isFinite(n) ? undefined : n;
  };

  const taskRows = Object.entries(manual.tasks).filter(([id]) => P.byId[id]);
  const linkRows = Object.entries(manual.links).map(([id, edit]) => ({ id, edit, link: P.links.find((l) => l.id === id) })).filter((r) => r.link);

  return (
    <Card eyebrow="Manual edits" title="Change any activity or relationship by hand" aside={<button type="button" className="xer-btn xer-btn-sm" disabled={busy || (!taskRows.length && !linkRows.length)} onClick={evaluate}>Evaluate</button>}>
      <div className="xer-toolbar">
        <label className="xer-field">
          <span>Activity</span>
          <input
            className="xer-input"
            list="pl-work-codes"
            placeholder="Activity ID"
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const t = (P.byCode.get(e.target.value.trim()) || [])[0];
              e.target.value = "";
              if (t && !t.done && !manual.tasks[t.id]) setTask(t.id, { durationDays: round2(t.rd) });
            }}
          />
        </label>
        <label className="xer-field">
          <span>Relationships into</span>
          <input
            className="xer-input"
            list="pl-work-codes"
            placeholder="Successor ID"
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => {
              const t = (P.byCode.get(e.target.value.trim()) || [])[0];
              e.target.value = "";
              setLinkSucc(t || null);
            }}
          />
        </label>
        {linkSucc ? (
          <select
            className="xer-select"
            value=""
            onChange={(e) => {
              const l = linkSucc.preds.find((x) => x.id === e.target.value);
              if (l) setLink(l.id, { lagDays: round2(l.lag), type: l.type });
              setLinkSucc(null);
            }}
          >
            <option value="">Choose a predecessor of {linkSucc.code}…</option>
            {linkSucc.preds.map((l) => <option key={l.id} value={l.id}>{l.pred?.code} → {linkSucc.code} · {l.type} {formatNum(l.lag, 1)} d</option>)}
          </select>
        ) : null}
        {taskRows.length || linkRows.length ? (
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => window.confirm("Remove every manual edit?") && onManual({ tasks: {}, links: {} })}>Clear all</button>
        ) : null}
      </div>

      {taskRows.length ? (
        <table className="xer-mini-table">
          <thead>
            <tr><th>Activity</th><th className="xer-num">File rem. (d)</th><th className="xer-num">Duration (d)</th><th className="xer-num">Sets</th><th className="xer-num">Hours ×</th><th className="xer-num">Compress %</th><th>From rates</th><th /></tr>
          </thead>
          <tbody>
            {taskRows.map(([id, edit]) => {
              const t = P.byId[id];
              const input = (field: keyof TaskEdit, value: number | undefined, placeholder: string) => (
                <input
                  key={`${id}:${field}:${value}`}
                  className="pl-cell-input pl-num-input pl-narrow"
                  inputMode="decimal"
                  defaultValue={value === undefined ? "" : String(value)}
                  placeholder={placeholder}
                  onBlur={(e) => {
                    const v = numOrUndef(e.target.value);
                    if (v !== value) setTask(id, { ...edit, [field]: v });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              );
              return (
                <tr key={id}>
                  <td><b className="xer-mono">{t.code}</b><small className="pl-sub">{t.name}</small></td>
                  <td className="xer-num">{formatNum(t.rd, 1)}</td>
                  <td className="xer-num">{input("durationDays", edit.durationDays, "—")}</td>
                  <td className="xer-num">{input("sets", edit.sets, "—")}</td>
                  <td className="xer-num">{input("hoursFactor", edit.hoursFactor, "1.00")}</td>
                  <td className="xer-num">{input("compressionPct", edit.compressionPct, "0")}</td>
                  <td><input type="checkbox" checked={!!edit.reestimated} onChange={(e) => setTask(id, { ...edit, reestimated: e.target.checked || undefined })} /></td>
                  <td><button type="button" className="pl-icon" title="Remove edit" onClick={() => setTask(id, null)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {linkRows.length ? (
        <table className="xer-mini-table">
          <thead><tr><th>Relationship</th><th>File</th><th>Type</th><th className="xer-num">Lag (d)</th><th /></tr></thead>
          <tbody>
            {linkRows.map(({ id, edit, link }) => (
              <tr key={id}>
                <td className="xer-mono">{link!.pred?.code} → {link!.succ?.code}</td>
                <td>{link!.type} {formatNum(link!.lag, 1)} d</td>
                <td>
                  <select className="xer-select" value={edit.type || link!.type} onChange={(e) => setLink(id, { ...edit, type: e.target.value as RelationshipKind })}>
                    {["FS", "SS", "FF", "SF"].map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                  </select>
                </td>
                <td className="xer-num">
                  <input
                    key={`${id}:lag:${edit.lagDays}`}
                    className="pl-cell-input pl-num-input pl-narrow"
                    inputMode="decimal"
                    defaultValue={edit.lagDays === undefined ? "" : String(edit.lagDays)}
                    placeholder={formatNum(link!.lag, 1)}
                    onBlur={(e) => {
                      const v = numOrUndef(e.target.value);
                      if (v !== edit.lagDays) setLink(id, { ...edit, lagDays: v });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td><button type="button" className="pl-icon" title="Remove edit" onClick={() => setLink(id, null)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!taskRows.length && !linkRows.length ? (
        <p className="xer-muted">
          No manual edits. Add an activity to set its remaining duration, resource sets, working hours or compression directly, or pick a
          relationship to change its type or lag. Manual edits are kept fixed when the optimiser runs.
        </p>
      ) : null}
    </Card>
  );
}

function ProgressLine({ register }: { register: (sink: ((p: ScenarioProgress | null) => void) | null) => void }) {
  const [progress, setProgress] = useState<ScenarioProgress | null>(null);
  useEffect(() => {
    register(setProgress);
    return () => register(null);
  }, [register]);
  if (!progress) return null;
  return (
    <span className="xer-busy pl-progress">
      {progress.phase} · {formatNum(progress.evaluations)} exact CPM solves · {progress.actions} actions
    </span>
  );
}

function NumberControl({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="xer-field xer-field-block">
      <span>{label}</span>
      <input
        className="xer-input"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          onChange(Number.isFinite(v) ? v : 0);
        }}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, note }: { label: string; checked: boolean; onChange: (v: boolean) => void; note?: ReactNode }) {
  return (
    <label className="xer-check-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{note ? <small>{note}</small> : null}</span>
    </label>
  );
}
