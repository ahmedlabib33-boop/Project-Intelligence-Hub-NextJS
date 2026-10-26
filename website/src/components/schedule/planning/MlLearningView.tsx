"use client";

/**
 * Learning / ML tab — trains and registers real models through the Project
 * Controls ML Decision-Support engine (proxied by the schedule-creation
 * service). Nothing here is decorative: every status shown is read from the
 * engine's own response. Below the engine's 20-labeled-row floor, training is
 * refused and that refusal is shown verbatim — never a fabricated result.
 * Native P6/CPM/TIA calculations always govern; a trained model here is
 * advisory decision support only (see model_card.governance in results).
 */

import { useEffect, useRef, useState } from "react";
import { callService, type JsonRecord, type ServiceStatus } from "../../../lib/planning/service";
import type { Comparison } from "../../../lib/xer/compare";
import { formatNum } from "../../../lib/xer/format";
import type { ProjectView } from "../../../lib/xer/model";
import { judgeModel, type Benchmark, type TrainingDatasetSpec } from "../../../lib/xer/trainingData";
import { Badge, Card, Kpi, Kpis, SectionTitle } from "../xer/ui";
import TrainingDataPanel, { type UseTrainingPayload } from "./TrainingDataPanel";

type DataOrigin = "real_project" | "synthetic_benchmark" | "external_reference" | "unspecified";

const DATA_ORIGINS: { value: DataOrigin; label: string }[] = [
  { value: "real_project", label: "Real project data" },
  { value: "synthetic_benchmark", label: "Synthetic / demo data" },
  { value: "external_reference", label: "External reference data" },
  { value: "unspecified", label: "Unspecified" },
];

const str = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "—");

export default function MlLearningView({
  service,
  projectName,
  view,
  cmp,
}: {
  service: ServiceStatus;
  projectName: string;
  view: ProjectView | null;
  cmp: Comparison | null;
}) {
  const wired = service.state === "wired";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [engineWired, setEngineWired] = useState<boolean | null>(null);
  const [engineDetail, setEngineDetail] = useState("");
  const [tasks, setTasks] = useState<JsonRecord>({});
  const [models, setModels] = useState<JsonRecord | null>(null);

  const [task, setTask] = useState("forecast_finish_deviation_prediction");
  const [target, setTarget] = useState("");
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>("real_project");
  const [projectScope, setProjectScope] = useState(projectName);
  const [promote, setPromote] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [result, setResult] = useState<JsonRecord | null>(null);
  const [reference, setReference] = useState<{ spec: TrainingDatasetSpec; benchmark: Benchmark } | null>(null);
  const targetTouched = useRef(false);

  const useRealData = (payload: UseTrainingPayload) => {
    setFile(payload.file);
    setTask(payload.spec.task);
    setTarget(payload.spec.target);
    targetTouched.current = true;
    setDataOrigin("real_project");
    setProjectScope(payload.projectScope);
    setPromote(false);
    setResult(null);
    setError("");
    setReference({ spec: payload.spec, benchmark: payload.benchmark });
  };

  const changeTask = (key: string) => {
    setTask(key);
    const hint = (tasks[key] as JsonRecord | undefined)?.target_hint;
    if (typeof hint === "string" && hint && !targetTouched.current) setTarget(hint);
    if (reference && reference.spec.task !== key) setReference(null);
  };

  type EngineStatus = { engineWired: boolean; engineDetail: string; tasks: JsonRecord; models: JsonRecord | null };

  const fetchStatus = async (): Promise<EngineStatus> => {
    const form = new FormData();
    form.set("action", "ml_status");
    const reply = await callService(form);
    const json = reply.json || {};
    return {
      engineWired: json.wired !== false,
      engineDetail: str(json.detail || ""),
      tasks: (json.tasks as JsonRecord) || {},
      models: (json.models as JsonRecord) || null,
    };
  };

  const applyStatus = (status: EngineStatus | null, failure?: unknown) => {
    if (status) {
      setEngineWired(status.engineWired);
      setEngineDetail(status.engineDetail);
      setTasks(status.tasks);
      setModels(status.models);
    } else {
      setEngineWired(false);
      setEngineDetail(failure instanceof Error ? failure.message : "Could not reach the ML engine.");
    }
    setBusy("");
  };

  const refreshStatus = () => {
    if (!wired) return;
    setBusy("Checking ML engine");
    setError("");
    void fetchStatus().then((status) => applyStatus(status), (failure) => applyStatus(null, failure));
  };

  useEffect(() => {
    if (!wired) return;
    void fetchStatus().then((status) => applyStatus(status), (failure) => applyStatus(null, failure));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wired]);

  const runTraining = async () => {
    if (!wired || !file || !task || !target) return;
    setBusy("Training model");
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("action", "ml_train");
      form.set("ml_task", task);
      form.set("ml_target", target);
      form.set("ml_data_origin", dataOrigin);
      form.set("ml_project_scope", projectScope);
      form.set("ml_promote", promote ? "true" : "false");
      form.set("data_file", file);
      const reply = await callService(form);
      const json = reply.json || {};
      if (json.wired === false) {
        setError(str(json.detail) || "The ML engine is not reachable.");
        return;
      }
      setResult(json);
      refreshStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Training failed.");
    } finally {
      setBusy("");
    }
  };

  const stateTone = !wired ? "crit" : engineWired === null ? "info" : engineWired ? "ok" : "crit";
  const stateLabel = !wired ? "Not wired" : engineWired === null ? "Checking" : engineWired ? "Wired" : "Not wired";
  const taskList = Object.entries(tasks);
  const card = (result?.model_card as JsonRecord | undefined) || null;
  const isolation = (card?.training_isolation as JsonRecord | undefined) || null;
  const metrics = (card?.metrics as JsonRecord | undefined) || null;
  const modelRow = (result?.model as JsonRecord | undefined) || null;
  const judgement = reference && card && str(card.task) === reference.spec.task ? judgeModel(metrics, reference.benchmark) : null;

  return (
    <div className="xer-view pl-create">
      <Card
        eyebrow="Learning / ML"
        title="Train and register real models — decision support only"
        aside={<Badge tone={stateTone}>{stateLabel}</Badge>}
      >
        <Kpis>
          <Kpi label="ML engine" value={stateLabel} note={!wired ? "Schedule-creation service is not wired here." : engineDetail || "—"} tone={stateTone} />
          <Kpi label="Governed tasks" value={String(taskList.length)} note="From the Project Controls ML Decision-Support registry" />
          <Kpi
            label="Registered models"
            value={models ? String(models.registered_model_count ?? 0) : "—"}
            note={models ? str(models.actual_trained_machine_learning) : "—"}
            tone={models && models.real_project_promoted_model_count ? "ok" : "info"}
          />
        </Kpis>
        <p className="xer-dim">
          Every model trained here stays advisory decision support. Native P6/CPM/TIA results always govern —
          a model is never promoted to production status unless it was trained on data explicitly marked
          &ldquo;real project data&rdquo; and validated at ≥20 labeled records.
        </p>
      </Card>

      <TrainingDataPanel view={view} cmp={cmp} projectName={projectName} onUse={useRealData} />

      <Card eyebrow="Run learning" title="Train a model on the selected file">
        <div className="pl-form-row">
          <label>
            Task
            <select className="xer-select" value={task} onChange={(e) => changeTask(e.target.value)} disabled={!wired}>
              {taskList.length
                ? taskList.map(([key, def]) => (
                    <option key={key} value={key}>{str((def as JsonRecord)?.title) || key}</option>
                  ))
                : <option value={task}>{task}</option>}
            </select>
          </label>
          <label>
            Target column
            <input type="text" className="xer-input" value={target} onChange={(e) => { targetTouched.current = true; setTarget(e.target.value); }} placeholder="e.g. finish_deviation_days" disabled={!wired} />
          </label>
          <label>
            Data origin
            <select className="xer-select" value={dataOrigin} onChange={(e) => setDataOrigin(e.target.value as DataOrigin)} disabled={!wired}>
              {DATA_ORIGINS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Project scope
            <input type="text" className="xer-input" value={projectScope} onChange={(e) => setProjectScope(e.target.value)} disabled={!wired} />
          </label>
          <label className="pl-checkbox">
            <input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} disabled={!wired} />
            Promote if eligible (only takes effect for real project data)
          </label>
        </div>

        <div className="pl-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.xlsx,.jsonl,.parquet"
            className="xer-hidden-input"
            onChange={(e) => { setFile(e.target.files?.[0] || null); }}
          />
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => fileRef.current?.click()} disabled={!wired}>
            {file ? `Selected: ${file.name}` : "Choose training file"}
          </button>
          <button
            type="button"
            className="xer-btn xer-btn-primary xer-btn-sm"
            onClick={() => void runTraining()}
            disabled={!wired || !engineWired || !file || !task || !target || !!busy}
          >
            Run learning
          </button>
          {busy ? <span className="xer-busy pl-progress">{busy}…</span> : null}
        </div>
        {dataOrigin !== "real_project" ? <Badge tone="warn">SYNTHETIC / DEMO DATA</Badge> : null}
        {error ? <p className="xer-error">{error}</p> : null}
      </Card>

      {card ? (
        <Card eyebrow="Training result" title={str(card.task) || task} aside={<Badge tone={modelRow?.promotion_status === "PROMOTED" ? "ok" : "info"}>{str(modelRow?.promotion_status) || "DRAFT"}</Badge>}>
          {dataOrigin !== "real_project" ? <Badge tone="warn">SYNTHETIC / DEMO DATA — not production evidence</Badge> : null}
          <Kpis>
            <Kpi label="Selected model" value={str(card.selected_model)} note={str(card.selected_framework)} />
            <Kpi label="Records" value={`${str(card.training_records)} train / ${str(card.validation_records)} test`} note={`${str(card.total_records)} total`} />
            {typeof metrics?.mae === "number" ? <Kpi label="MAE (held-out)" value={num(metrics.mae)} note="working days" /> : null}
            {typeof metrics?.rmse === "number" ? <Kpi label="RMSE (held-out)" value={num(metrics.rmse)} note="working days" /> : null}
            {typeof metrics?.r2 === "number" ? <Kpi label="R² (held-out)" value={num(metrics.r2)} note="1.0 = perfect" /> : null}
            {typeof metrics?.accuracy === "number" ? <Kpi label="Accuracy (held-out)" value={num(metrics.accuracy)} /> : null}
            {typeof metrics?.balanced_accuracy === "number" ? <Kpi label="Balanced accuracy" value={num(metrics.balanced_accuracy)} note="averages per-class recall" /> : null}
            <Kpi label="Confidence" value={num(metrics?.confidence)} note={`OOD score ${num(metrics?.ood_score)}`} />
            <Kpi label="CV score" value={num(metrics?.cross_validation_score_mean)} note={str(metrics?.cross_validation_scoring)} />
          </Kpis>
          {judgement && reference ? (
            <>
              <SectionTitle>Against the reference rules</SectionTitle>
              <p className={judgement.level === "does_not_beat" ? "xer-error" : "xer-note"}>
                <b>{judgement.level === "beats" ? "Beats the rules." : judgement.level === "mixed" ? "Inconclusive." : "Does not beat the rules."}</b> {judgement.message}
              </p>
              <div className="xer-table-wrap">
                <table className="xer-table">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      {reference.benchmark.kind === "regression" ? <><th>MAE (d)</th><th>RMSE (d)</th></> : <><th>Accuracy</th><th>Balanced accuracy</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {reference.benchmark.rules.map((rule) => (
                      <tr key={rule.name}>
                        <td>{rule.name}</td>
                        {reference.benchmark.kind === "regression"
                          ? <><td>{formatNum(rule.mae ?? null, 2)}</td><td>{formatNum(rule.rmse ?? null, 2)}</td></>
                          : <><td>{formatNum(rule.accuracy ?? null, 3)}</td><td>{formatNum(rule.balancedAccuracy ?? null, 3)}</td></>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {isolation?.warning ? <p className="xer-error">{str(isolation.warning)}</p> : null}
          <SectionTitle>Governance</SectionTitle>
          <p className="xer-dim">
            {str((card.governance as JsonRecord | undefined)?.accuracy_statement) ||
              "Measured validation metrics only; no universal accuracy guarantee. Native schedule and TIA calculations remain governing."}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
