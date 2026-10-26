"use client";

/**
 * Real training data for the Learning / ML tab.
 *
 * Turns loaded P6 schedules into labelled plan-vs-actual observations, keeps
 * them in a per-browser training set that grows across revisions and projects,
 * and hands the engine an exact CSV. Nothing is generated: activities without
 * both planned and actual dates are excluded and counted by reason, and the
 * reference rules a model has to beat are shown next to the training set so a
 * model is never judged in isolation.
 */

import { useEffect, useRef, useState } from "react";
import { clearStoredTrainingSet, readStoredTrainingSet, writeStoredTrainingSet } from "../../../lib/planning/store";
import type { Comparison } from "../../../lib/xer/compare";
import { formatDate, formatNum } from "../../../lib/xer/format";
import type { ProjectView } from "../../../lib/xer/model";
import {
  buildTrainingTable,
  buildTraceabilityCsv,
  describeDataset,
  ENGINE_MIN_LABELLED_ROWS,
  extractFromComparison,
  extractFromSchedule,
  mergeObservations,
  naiveBenchmark,
  observationsByProject,
  orientComparison,
  parseObservationSet,
  removeProject,
  serializeObservationSet,
  TRAINING_DATASETS,
  type Benchmark,
  type DatasetSummary,
  type Extraction,
  type Observation,
  type TrainingDatasetSpec,
} from "../../../lib/xer/trainingData";
import { Badge, Card, Kpi, Kpis, SectionTitle } from "../xer/ui";
import { downloadBlob } from "./LibraryWorkspace";

export type UseTrainingPayload = {
  file: File;
  spec: TrainingDatasetSpec;
  summary: DatasetSummary;
  benchmark: Benchmark;
  projectScope: string;
};

type Mode = "baseline" | "single";

const pct = (share: number) => `${Math.round(share * 100)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatNum(value, 1)}`;

export default function TrainingDataPanel({
  view,
  cmp,
  projectName,
  onUse,
}: {
  view: ProjectView | null;
  cmp: Comparison | null;
  projectName: string;
  onUse: (payload: UseTrainingPayload) => void;
}) {
  const [mode, setMode] = useState<Mode>("baseline");
  const [groupEdit, setGroupEdit] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{ key: string; value: Extraction } | null>(null);
  const [ackKey, setAckKey] = useState("");
  const [trainingSet, setTrainingSet] = useState<Observation[]>([]);
  const [specIndex, setSpecIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  // Read after mount so server and first client render agree.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setTrainingSet(readStoredTrainingSet());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const oriented = cmp ? orientComparison(cmp) : null;
  const activeMode: Mode = cmp && mode === "baseline" ? "baseline" : "single";
  const group = (groupEdit ?? (projectName || view?.name || "")).trim();
  const sourceKey = activeMode === "baseline" && cmp
    ? `B|${cmp.PA.S.fileName}|${cmp.PB.S.fileName}|${group}`
    : view ? `S|${view.S.fileName}|${view.projId}|${group}` : "";
  const current = extraction && extraction.key === sourceKey ? extraction.value : null;
  const acknowledged = ackKey === sourceKey && sourceKey !== "";

  const spec = TRAINING_DATASETS[specIndex];
  const summary = describeDataset(trainingSet, spec);
  const benchmark = naiveBenchmark(trainingSet, spec);
  const projects = observationsByProject(trainingSet);
  const classificationBlocked = spec.kind === "classification" && summary.classCounts.length < 2;
  const canTrain = summary.meetsEngineFloor && !classificationBlocked;

  const commit = (next: Observation[]) => {
    setTrainingSet(next);
    if (next.length === 0) clearStoredTrainingSet();
    else if (!writeStoredTrainingSet(next)) {
      setError("This browser could not save the training set (storage full or blocked) — export it as JSON to keep it.");
    }
  };

  const extract = () => {
    if (!sourceKey) return;
    setBusy("Reading completed activities…");
    setError("");
    setNotice("");
    window.setTimeout(() => {
      try {
        const result = activeMode === "baseline" && cmp ? extractFromComparison(cmp, group) : extractFromSchedule(view!, group);
        setExtraction({ key: sourceKey, value: result });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The schedule could not be read.");
      } finally {
        setBusy("");
      }
    }, 30);
  };

  const addToSet = () => {
    if (!current || !current.report.suitable || !current.observations.length) return;
    const result = mergeObservations(trainingSet, current.observations);
    commit(result.merged);
    setError("");
    setNotice(
      `Added ${result.added} new, replaced ${result.replaced} existing${result.keptBetter ? `, kept ${result.keptBetter} better-evidenced baseline row${result.keptBetter === 1 ? "" : "s"}` : ""}. The set now holds ${result.merged.length} row${result.merged.length === 1 ? "" : "s"}.`,
    );
  };

  const useForTraining = () => {
    const table = buildTrainingTable(trainingSet, spec);
    // No byte-order mark: the engine reads this with a plain CSV reader.
    const file = new File([table.csv], `training_${spec.target}.csv`, { type: "text/csv" });
    onUse({ file, spec, summary, benchmark, projectScope: projects.length === 1 ? projects[0].projectId : "Multiple projects" });
    setNotice(`Loaded ${table.rows.length} real rows into the training form below (${spec.task}, target ${spec.target}).`);
  };

  const downloadTraining = () => {
    const table = buildTrainingTable(trainingSet, spec);
    downloadBlob(`training_${spec.target}.csv`, table.csv, "text/csv;charset=utf-8");
  };

  const importSet = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const parsed = parseObservationSet(await file.text());
      const result = mergeObservations(trainingSet, parsed.observations);
      commit(result.merged);
      setNotice(
        `Imported ${parsed.observations.length} row${parsed.observations.length === 1 ? "" : "s"} (${result.added} new, ${result.replaced} replaced)${parsed.rejected ? `; ${parsed.rejected} malformed row${parsed.rejected === 1 ? "" : "s"} rejected` : ""}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The training set could not be imported.");
    }
  };

  const report = current?.report;
  const stats = report?.stats || null;

  return (
    <>
      <Card
        eyebrow="Real training data"
        title="Extract planned-vs-actual observations from your schedules"
        aside={report ? <Badge tone={report.suitable ? "ok" : "crit"}>{report.suitable ? "Usable" : "Not usable"}</Badge> : null}
      >
        <p className="xer-dim">
          Every completed activity with both planned and actual dates becomes one labelled row. Nothing is generated or
          estimated; activities missing either date are excluded and counted below. Identifiers, costs and resource
          names are never exported as features.
        </p>

        {!view ? (
          <p className="xer-dim pl-td-empty">Load a P6 XER first (slot A for a baseline, slot B for the update) to extract observations.</p>
        ) : (
          <>
            {cmp ? (
              <div className="pl-td-choice" role="radiogroup" aria-label="Observation source">
                <label className={activeMode === "baseline" ? "active" : ""}>
                  <input type="radio" name="td-mode" checked={activeMode === "baseline"} onChange={() => setMode("baseline")} />
                  <span>
                    <b>Baseline vs update <em>(recommended)</em></b>
                    <small>
                      Planned dates from {oriented!.baseline.S.fileName} ({formatDate(oriented!.baseline.dataDate) || "no data date"}), actuals from{" "}
                      {oriented!.update.S.fileName} ({formatDate(oriented!.update.dataDate) || "no data date"}); {formatNum(cmp.matched.length)} matched activities.
                      {oriented!.swapped ? " Slot A holds the later schedule, so the roles were swapped for you." : ""}
                      {oriented!.assumed ? " Data dates are missing or equal — slot A is assumed to be the earlier schedule." : ""}
                    </small>
                  </span>
                </label>
                <label className={activeMode === "single" ? "active" : ""}>
                  <input type="radio" name="td-mode" checked={activeMode === "single"} onChange={() => setMode("single")} />
                  <span>
                    <b>Active schedule only</b>
                    <small>Target dates vs actual dates stored in {view.S.fileName}. Only valid if the file was not re-baselined to its progress.</small>
                  </span>
                </label>
              </div>
            ) : (
              <p className="xer-dim">Source: target dates vs actual dates in <b>{view.S.fileName}</b>. Load a baseline as A and an update as B for a stronger plan-vs-actual set.</p>
            )}

            <div className="pl-form-row">
              <label>
                Project (every revision of one programme must share this name)
                <input type="text" className="xer-input" value={groupEdit ?? (projectName || view.name)} onChange={(e) => setGroupEdit(e.target.value)} />
              </label>
            </div>
            <div className="pl-actions">
              <button type="button" className="xer-btn xer-btn-primary xer-btn-sm" onClick={extract} disabled={!!busy || !group}>
                Extract observations
              </button>
              {busy ? <span className="xer-busy pl-progress">{busy}</span> : null}
            </div>
          </>
        )}

        {report ? (
          <>
            <Kpis>
              <Kpi label="Observations" value={formatNum(report.extracted)} note={`of ${formatNum(report.considered)} activities considered`} tone={report.suitable ? "ok" : "crit"} />
              <Kpi label="Median finish deviation" value={stats ? `${signed(stats.median)} d` : "—"} note="working days · + late, − early" />
              <Kpi label="Finished on plan" value={stats ? pct(stats.onPlanShare) : "—"} note={stats ? `${pct(stats.delayedShare)} late · ${pct(stats.earlyShare)} early` : ""} />
              <Kpi label="Range" value={stats ? `${signed(stats.min)} … ${signed(stats.max)}` : "—"} note="working days" />
            </Kpis>

            {report.suitabilityNote ? <p className="xer-error">{report.suitabilityNote}</p> : null}
            {report.caution ? (
              <>
                <p className="xer-error" role="alert">{report.caution}</p>
                <label className="xer-check-field">
                  <input type="checkbox" checked={acknowledged} onChange={(e) => setAckKey(e.target.checked ? sourceKey : "")} />
                  <span><b>I have checked that the planned dates are comparable with the actuals</b></span>
                </label>
              </>
            ) : null}

            {report.excluded.length ? (
              <>
                <SectionTitle>Excluded — never estimated</SectionTitle>
                <div className="xer-table-wrap">
                  <table className="xer-table">
                    <thead><tr><th>Reason</th><th>Activities</th></tr></thead>
                    <tbody>
                      {report.excluded.map((row) => (
                        <tr key={row.reason}><td>{row.reason}</td><td>{formatNum(row.count)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {report.caveats.map((caveat) => <p key={caveat} className="xer-dim">{caveat}</p>)}

            <div className="pl-actions">
              <button type="button" className="xer-btn xer-btn-primary xer-btn-sm" onClick={addToSet} disabled={!report.suitable || !report.extracted || (!!report.caution && !acknowledged)}>
                Add {formatNum(report.extracted)} row{report.extracted === 1 ? "" : "s"} to the training set
              </button>
              <span className="xer-dim">Project: {report.projectId}</span>
            </div>
          </>
        ) : null}
        {notice ? <p className="xer-note pl-td-notice">{notice}</p> : null}
        {error ? <p className="xer-error">{error}</p> : null}
      </Card>

      <Card
        eyebrow="Training set"
        title="Accumulated real observations"
        aside={<Badge tone={summary.meetsEngineFloor ? "ok" : "warn"}>{summary.meetsEngineFloor ? "Meets engine floor" : `Needs ${ENGINE_MIN_LABELLED_ROWS - summary.rows} more`}</Badge>}
      >
        <Kpis>
          <Kpi label="Labelled rows" value={formatNum(summary.rows)} note={`engine needs ≥ ${ENGINE_MIN_LABELLED_ROWS}`} tone={summary.meetsEngineFloor ? "ok" : "warn"} />
          <Kpi label="Projects" value={formatNum(summary.projects)} note={summary.projects >= 2 ? "cross-project validation possible" : "single-project validation only"} tone={summary.projects >= 2 ? "ok" : "info"} />
        </Kpis>

        {projects.length ? (
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th>Project</th><th>Rows</th><th>From baseline vs update</th><th>Revisions read</th><th /></tr></thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.projectId}>
                    <td>{project.projectId}</td>
                    <td>{formatNum(project.count)}</td>
                    <td>{formatNum(project.baselineRows)}</td>
                    <td title={project.schedules.join("\n")}>{project.schedules.length}</td>
                    <td>
                      <button type="button" className="xer-btn xer-btn-sm" onClick={() => commit(removeProject(trainingSet, project.projectId))} aria-label={`Remove ${project.projectId} from the training set`}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="xer-dim pl-td-empty">The training set is empty. Extract observations above and add them.</p>
        )}

        <SectionTitle>What to learn</SectionTitle>
        <div className="pl-td-choice" role="radiogroup" aria-label="Dataset">
          {TRAINING_DATASETS.map((option, index) => (
            <label key={option.task} className={index === specIndex ? "active" : ""}>
              <input type="radio" name="td-spec" checked={index === specIndex} onChange={() => setSpecIndex(index)} />
              <span><b>{option.label}</b><small>{option.description}</small></span>
            </label>
          ))}
        </div>

        {summary.classCounts.length ? (
          <p className="xer-dim">Classes: {summary.classCounts.map((c) => `${c.label} ${c.count}`).join(" · ")}</p>
        ) : null}
        {summary.warnings.length ? (
          <ul className="pl-gates">{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        ) : null}

        {benchmark.rules.length ? (
          <>
            <SectionTitle>Reference rules a model must beat</SectionTitle>
            <div className="xer-table-wrap">
              <table className="xer-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    {benchmark.kind === "regression" ? <><th>MAE (d)</th><th>RMSE (d)</th><th>R²</th></> : <><th>Accuracy</th><th>Balanced accuracy</th></>}
                  </tr>
                </thead>
                <tbody>
                  {benchmark.rules.map((rule) => (
                    <tr key={rule.name} title={rule.description}>
                      <td>{rule.name}</td>
                      {benchmark.kind === "regression"
                        ? <><td>{formatNum(rule.mae ?? null, 2)}</td><td>{formatNum(rule.rmse ?? null, 2)}</td><td>{formatNum(rule.r2 ?? null, 3)}</td></>
                        : <><td>{formatNum(rule.accuracy ?? null, 3)}</td><td>{formatNum(rule.balancedAccuracy ?? null, 3)}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="xer-dim">Scored on all {formatNum(benchmark.rows)} rows. After training, the engine&apos;s measured metrics are compared with these rules.</p>
          </>
        ) : null}

        <div className="pl-actions">
          <button type="button" className="xer-btn xer-btn-primary xer-btn-sm" onClick={useForTraining} disabled={!canTrain} title={canTrain ? "" : "The engine needs enough labelled rows (and both classes for a classifier)."}>
            Use for training
          </button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={downloadTraining} disabled={!summary.rows}>Download training CSV</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => downloadBlob("training_traceability.csv", "﻿" + buildTraceabilityCsv(trainingSet), "text/csv;charset=utf-8")} disabled={!summary.rows}>Download traceability CSV</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => downloadBlob("training_set.json", serializeObservationSet(trainingSet), "application/json")} disabled={!summary.rows}>Export set (JSON)</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => importRef.current?.click()}>Import set (JSON)</button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            onClick={() => {
              if (window.confirm(`Remove all ${trainingSet.length} observations from this browser's training set?`)) commit([]);
            }}
            disabled={!summary.rows}
          >
            Clear set
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="xer-hidden-input"
            onChange={(e) => {
              void importSet(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="xer-dim">
          The set is stored in this browser only. The traceability CSV maps every row back to its activity code and file; it is
          kept separate so identifiers never reach the model.
        </p>
      </Card>
    </>
  );
}
