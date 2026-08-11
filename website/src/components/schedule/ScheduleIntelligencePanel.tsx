"use client";

import { useMemo, useRef, useState } from "react";
import {
  candidatesToCsv,
  changesToCsv,
  parseScheduleXer,
  runScheduleAnalysis,
  type ScheduleAnalysis,
  type ScheduleMode,
  type ScheduleModel
} from "../../lib/schedule-intelligence";

const MODE_COPY: Record<ScheduleMode, { label: string; eyebrow: string; title: string; description: string; action: string }> = {
  mitigation: {
    label: "Schedule Mitigation",
    eyebrow: "Controlled prevention",
    title: "Limit further slippage before it becomes recovery work",
    description: "A deliberately conservative scenario: limited duration interventions only, prioritized on the controlling corridor and protected by field-validation gates.",
    action: "Run mitigation analysis"
  },
  recovery: {
    label: "Schedule Recovery",
    eyebrow: "Targeted recovery",
    title: "Test a recovery route against the evidenced finish requirement",
    description: "Combines duration, lag and carefully gated fast-track hypotheses. Every selected combination is re-solved by exact shadow CPM before it is shown.",
    action: "Run recovery analysis"
  },
  revised: {
    label: "Schedule Revised",
    eyebrow: "Revised programme proposal",
    title: "Optimize the remaining network without forcing an external date",
    description: "Produces a review-ready change register and revised remaining-duration proposal. It is a planning option, not an issued P6 baseline or contractual completion date.",
    action: "Build revised proposal"
  }
};

function number(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function downloadFile(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function readinessLabel(analysis: ScheduleAnalysis) {
  if (analysis.readiness === "blocked") return "Blocked — schedule repair required";
  if (analysis.readiness === "review_required") return "Review required";
  return "Ready with P6 gates";
}

function modeFileName(mode: ScheduleMode) {
  return mode === "mitigation" ? "schedule_mitigation" : mode === "recovery" ? "schedule_recovery" : "schedule_revised";
}

function CandidateTable({ analysis }: { analysis: ScheduleAnalysis }) {
  const rows = analysis.selectedCandidates.length ? analysis.selectedCandidates : analysis.candidates.slice(0, 12);
  const selectionMode = analysis.selectedCandidates.length > 0;
  return (
    <section className="schedule-intelligence-card schedule-intelligence-table-card">
      <div className="schedule-intelligence-card-head">
        <div>
          <p>{selectionMode ? "Exact CPM selected actions" : "Highest-ranked exact CPM candidates"}</p>
          <h3>{selectionMode ? `${analysis.selectedCandidates.length} review actions selected` : "No gain-bearing action selected"}</h3>
        </div>
        <span>{selectionMode ? "Selected" : "Ranked"}</span>
      </div>
      {rows.length ? (
        <div className="schedule-intelligence-scroll">
          <table className="schedule-intelligence-table">
            <thead><tr><th>Action</th><th>Activity / Logic</th><th>Exact gain</th><th>Risk</th><th>Required validation</th></tr></thead>
            <tbody>
              {rows.map((candidate) => (
                <tr key={candidate.id}>
                  <td><b>{candidate.actionType.replaceAll("_", " ")}</b><small>{candidate.id} · confidence {candidate.confidence}</small></td>
                  <td><b>{candidate.activityName}</b><small>{candidate.relationship || candidate.wbsPath}</small></td>
                  <td><b>{number(candidate.selectedExactIncrementalGainDays ?? candidate.individualExactGainDays)} days</b><small>Individual: {number(candidate.individualExactGainDays)} days</small></td>
                  <td><span className={`schedule-risk schedule-risk-${candidate.risk}`}>{candidate.risk}</span></td>
                  <td>{candidate.validation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="schedule-intelligence-empty">No intervention created a gain on the selected controlling path. Review schedule logic, terminal selection, constraints and the native P6 calculation.</p>}
    </section>
  );
}

function ScheduleAnalysisResult({ analysis }: { analysis: ScheduleAnalysis }) {
  const target = analysis.targetRecoveryDays;
  const percent = target && target > 0 ? Math.min(100, Math.max(0, (analysis.exactRecoveryDays / target) * 100)) : null;
  const shortMode = modeFileName(analysis.mode);
  const auditPayload = useMemo(() => ({
    engine: "Schedule Intelligence web module",
    generated_at: analysis.generatedAt,
    mode: analysis.mode,
    project: analysis.model.project,
    source_file: analysis.model.fileName,
    schedule_profile: {
      activities: Object.keys(analysis.model.tasks).length,
      relationships: analysis.model.relationships.length,
      is_dag: analysis.model.isDag,
      base_shadow_network_days: analysis.model.baseCpm.networkLengthDays,
      optimized_shadow_network_days: analysis.finalCpm.networkLengthDays,
      terminal_activity: analysis.model.tasks[analysis.model.project.terminalTaskId]?.code || analysis.model.project.terminalTaskId,
      recovery_requirement: analysis.model.recoveryRequirement
    },
    exact_shadow_cpm_recovery_days: analysis.exactRecoveryDays,
    target_recovery_days: analysis.targetRecoveryDays,
    remaining_recovery_gap_days: analysis.remainingGapDays,
    selected_actions: analysis.selectedCandidates.map((candidate) => ({
      id: candidate.id,
      action_type: candidate.actionType,
      activity_id: candidate.activityId,
      activity_name: candidate.activityName,
      wbs_path: candidate.wbsPath,
      individual_exact_gain_days: candidate.individualExactGainDays,
      selected_exact_incremental_gain_days: candidate.selectedExactIncrementalGainDays,
      confidence: candidate.confidence,
      risk: candidate.risk,
      priority_score: candidate.priorityScore,
      strategy: candidate.strategy,
      validation: candidate.validation,
      relationship: candidate.relationship,
      notes: candidate.notes
    })),
    p6_change_register: analysis.changes,
    governance_warnings: analysis.warnings
  }), [analysis]);
  return (
    <div className="schedule-intelligence-results">
      <section className="schedule-intelligence-status" aria-live="polite">
        <div>
          <p>Analysis status</p>
          <b>{readinessLabel(analysis)}</b>
          <span>Generated locally from {analysis.model.fileName}</span>
        </div>
        <div className="schedule-intelligence-downloads">
          <button type="button" onClick={() => downloadFile(`${shortMode}_candidates.csv`, candidatesToCsv(analysis.candidates), "text/csv;charset=utf-8")}>Download candidate register</button>
          <button type="button" onClick={() => downloadFile(`${shortMode}_p6_change_register.csv`, changesToCsv(analysis.changes), "text/csv;charset=utf-8")}>Download P6 change register</button>
          <button type="button" onClick={() => downloadFile(`${shortMode}_analysis.json`, JSON.stringify(auditPayload, null, 2), "application/json;charset=utf-8")}>Download audit JSON</button>
        </div>
      </section>

      <div className="schedule-intelligence-kpis">
        <article><span>Base shadow network</span><strong>{number(analysis.model.baseCpm.networkLengthDays)} days</strong><small>Controlling terminal path</small></article>
        <article><span>Exact verified gain</span><strong>{number(analysis.exactRecoveryDays)} days</strong><small>After selected combinations</small></article>
        <article><span>{target === null ? "Optimization target" : "Recovery target"}</span><strong>{target === null ? "Open" : `${number(target)} days`}</strong><small>{target === null ? "No external date was forced" : "Native or approved target basis"}</small></article>
        <article><span>{target === null ? "Selected actions" : "Remaining gap"}</span><strong>{target === null ? analysis.selectedCandidates.length : `${number(analysis.remainingGapDays)} days`}</strong><small>{target === null ? "Exact CPM selected actions" : "Still requires a controlled decision"}</small></article>
      </div>

      {percent !== null ? <section className="schedule-intelligence-progress" aria-label="Recovery target progress"><div><span>Exact verified progress to recovery target</span><b>{number(percent)}%</b></div><i><em style={{ width: `${percent}%` }} /></i></section> : null}
      <CandidateTable analysis={analysis} />
      <section className="schedule-intelligence-card schedule-intelligence-governance">
        <div className="schedule-intelligence-card-head"><div><p>Planning engineer gates</p><h3>Required before issue or execution</h3></div><span>Governance</span></div>
        <ol>{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ol>
      </section>
    </div>
  );
}

export default function ScheduleIntelligencePanel({ projectName }: { projectName: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ScheduleMode>("mitigation");
  const [model, setModel] = useState<ScheduleModel | null>(null);
  const [analysis, setAnalysis] = useState<ScheduleAnalysis | null>(null);
  const [targetText, setTargetText] = useState("");
  const [fileState, setFileState] = useState("No XER loaded — the source file stays in this browser session.");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const copy = MODE_COPY[mode];

  async function loadFile(file: File) {
    setError("");
    setAnalysis(null);
    if (!/\.xer$/i.test(file.name)) {
      setModel(null);
      setError("Select a Primavera P6 .xer export. The module intentionally does not reinterpret arbitrary spreadsheet files as schedule logic.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setModel(null);
      setError("This browser-native analysis is limited to 30 MB. Export a single project XER or use the controlled desktop engine for a larger source package.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseScheduleXer(file.name, text);
      setModel(parsed);
      setFileState(`${file.name} recognized: ${Object.keys(parsed.tasks).length.toLocaleString()} activities, ${parsed.relationships.length.toLocaleString()} relationships, data date ${parsed.project.dataDate || "not available"}.`);
    } catch (cause) {
      setModel(null);
      setError(cause instanceof Error ? cause.message : "The XER could not be parsed.");
    }
  }

  function run(nextMode = mode) {
    if (!model) {
      setError("Load a valid Primavera XER before running Schedule Intelligence.");
      return;
    }
    setWorking(true);
    setError("");
    window.setTimeout(() => {
      try {
        const rawTarget = Number.parseFloat(targetText);
        setAnalysis(runScheduleAnalysis(model, nextMode, Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : null));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The schedule analysis could not be completed.");
      } finally {
        setWorking(false);
      }
    }, 20);
  }

  function changeMode(nextMode: ScheduleMode) {
    setMode(nextMode);
    if (model) run(nextMode);
  }

  const profileMetrics = model ? [
    ["Activities", Object.keys(model.tasks).length.toLocaleString()],
    ["Relationships", model.relationships.length.toLocaleString()],
    ["Terminal", model.tasks[model.project.terminalTaskId]?.code || "Not resolved"],
    ["Native recovery need", `${number(model.recoveryRequirement.requiredRecoveryDays)} days`]
  ] : [];

  return (
    <div className="schedule-intelligence">
      <section className="schedule-intelligence-hero">
        <div>
          <p>Schedule Intelligence · Local XER decision support</p>
          <h2>Adaptive, exact-CPM schedule options for {projectName}</h2>
          <span>Upload a Primavera P6 XER to reconstruct the selected project&apos;s native network, rank review options from its own schedule patterns, and verify every recommended gain by deterministic shadow CPM.</span>
        </div>
        <div className="schedule-intelligence-hero-badge"><b>Source protected</b><span>Browser-local processing<br />P6 verification remains mandatory</span></div>
      </section>

      <section className="schedule-intelligence-card schedule-intelligence-loader">
        <div className="schedule-intelligence-card-head"><div><p>01 · Controlled input</p><h3>Load Primavera P6 XER</h3></div><span>Required</span></div>
        <div className="schedule-intelligence-loader-row">
          <input ref={inputRef} type="file" accept=".xer,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />
          <button type="button" className="schedule-intelligence-primary" onClick={() => inputRef.current?.click()}>Choose XER file</button>
          <p>{fileState}</p>
        </div>
        {error ? <p className="schedule-intelligence-error" role="alert">{error}</p> : null}
      </section>

      {model ? <section className="schedule-intelligence-profile">
        {profileMetrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{label === "Terminal" ? model.tasks[model.project.terminalTaskId]?.name || "" : label === "Native recovery need" ? model.recoveryRequirement.basis : model.project.name}</small></article>)}
      </section> : null}

      <section className="schedule-intelligence-tabs" role="tablist" aria-label="Schedule Intelligence workflows">
        {(Object.keys(MODE_COPY) as ScheduleMode[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={mode === tab} className={mode === tab ? "active" : ""} onClick={() => changeMode(tab)}><span>{MODE_COPY[tab].eyebrow}</span>{MODE_COPY[tab].label}</button>)}
      </section>

      <section className="schedule-intelligence-workflow">
        <div className="schedule-intelligence-workflow-copy"><p>{copy.eyebrow}</p><h3>{copy.title}</h3><span>{copy.description}</span></div>
        <div className="schedule-intelligence-run-controls">
          {mode === "recovery" ? <label><span>Approved target recovery days <i>(optional)</i></span><input type="number" min="0" step="0.5" value={targetText} onChange={(event) => setTargetText(event.target.value)} placeholder={model?.recoveryRequirement.requiredRecoveryDays ? String(model.recoveryRequirement.requiredRecoveryDays) : "Enter target"} /></label> : null}
          <button type="button" className="schedule-intelligence-primary" disabled={!model || working} onClick={() => run()}>{working ? "Solving exact CPM…" : copy.action}</button>
        </div>
      </section>

      {analysis ? <ScheduleAnalysisResult analysis={analysis} /> : <section className="schedule-intelligence-empty schedule-intelligence-empty-large"><b>Awaiting schedule run</b><span>Load a valid XER, choose one of the three engineering workflows, then run the controlled analysis.</span></section>}
    </div>
  );
}
