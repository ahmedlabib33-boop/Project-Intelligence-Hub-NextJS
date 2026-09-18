"use client";

/**
 * Stage 1 of the Schedule Intelligence pipeline — create a schedule.
 *
 * Tender and detailed schedule creation, the evidence analyzer and reader and
 * report studio run on the schedule-creation service. Where that service is
 * not connected to this deployment, every step still appears with its inputs
 * and result sections, marked "Not wired" and empty: nothing is estimated,
 * sampled or filled in. The detailed schedule takes its activities and rates
 * from the pipeline's planning library, and a built schedule opens straight
 * into analysis, mapping and Mitigation / Recovery / Revised.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AI_CHECKING, checkEvidenceAi, type AiHealth } from "../../../lib/evidence/run";
import { activityBasis, cellText, type LibraryIndex, type PlanningLibrary } from "../../../lib/planning/library";
import {
  BLOB_UPLOAD_THRESHOLD_BYTES,
  callService,
  usesBlobUpload,
  uploadFileToBlob,
  type JsonRecord,
  type ServiceReply,
  type ServiceStatus,
} from "../../../lib/planning/service";
import { formatNum } from "../../../lib/xer/format";
import { Badge, Card, Kpi, Kpis, SectionTitle } from "../xer/ui";
import EvidenceIntelligenceStep from "./EvidenceIntelligenceStep";
import { downloadBlob } from "./LibraryWorkspace";

type Step = "understand" | "analyzer" | "tender" | "detailed" | "reader" | "reports";

const STEPS: { key: Step; label: string; eyebrow: string }[] = [
  { key: "understand", label: "Project brief & requirements", eyebrow: "AI · any format" },
  { key: "analyzer", label: "Evidence analyzer", eyebrow: "Readiness · conflicts" },
  { key: "tender", label: "Tender schedule", eyebrow: "From evidence documents" },
  { key: "detailed", label: "Detailed schedule", eyebrow: "Library · answers · crews" },
  { key: "reader", label: "Evidence reader", eyebrow: "Arabic / English text" },
  { key: "reports", label: "Report studio", eyebrow: "Populate templates" },
];

type RunOptions = { download?: boolean; fallbackName?: string };
type FormOrBuilder = FormData | (() => Promise<FormData>);
type Runner = (label: string, form: FormOrBuilder, options?: RunOptions) => Promise<ServiceReply | null>;

const str = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const records = (v: unknown): JsonRecord[] =>
  Array.isArray(v) ? v.filter((x): x is JsonRecord => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const numOrNull = (v: string): number | null => {
  const n = Number.parseFloat(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};

/* -------------------------------------------------------------- stage */

export default function ScheduleCreationStage({
  service,
  onRecheck,
  library,
  index,
  projectName,
  onOpenSchedule,
}: {
  service: ServiceStatus;
  onRecheck: () => void;
  library: PlanningLibrary | null;
  index: LibraryIndex | null;
  projectName: string;
  onOpenSchedule: (file: File) => void;
}) {
  const wired = service.state === "wired";
  const [step, setStep] = useState<Step>("understand");
  const [evidence, setEvidence] = useState<File[]>([]);
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [analyzer, setAnalyzer] = useState<JsonRecord | null>(null);
  const [tender, setTender] = useState<JsonRecord | null>(null);
  const [reader, setReader] = useState<JsonRecord | null>(null);
  const [inspection, setInspection] = useState<JsonRecord | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealth>(AI_CHECKING);
  const recheckAi = () => { setAiHealth(AI_CHECKING); void checkEvidenceAi().then(setAiHealth); };
  useEffect(() => { void checkEvidenceAi().then(setAiHealth); }, []);

  const projectLabel = name.trim() || projectName || "Schedule";
  const noData = wired ? "No data yet — run this step." : "No data — not wired on this deployment.";

  const run: Runner = async (label, formOrBuilder, options = {}) => {
    if (!wired) return null;
    setBusy(label);
    setError("");
    try {
      const form = typeof formOrBuilder === "function" ? await formOrBuilder() : formOrBuilder;
      form.set("project_name", projectLabel);
      const reply = await callService(form, options.fallbackName);
      if (reply.file && options.download !== false) {
        downloadBlob(reply.file.name, reply.file.blob, reply.file.blob.type || "application/octet-stream");
      }
      return reply;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
      return null;
    } finally {
      setBusy("");
    }
  };

  const evidenceForm = async (action: string): Promise<FormData> => {
    const form = new FormData();
    form.set("action", action);
    const totalBytes = evidence.reduce((sum, file) => sum + file.size, 0);
    if (usesBlobUpload() && totalBytes > BLOB_UPLOAD_THRESHOLD_BYTES) {
      const refs = await Promise.all(evidence.map((file) => uploadFileToBlob(file)));
      form.set("evidence_blob_files", JSON.stringify(refs));
    } else {
      evidence.forEach((file) => form.append("evidence_files", file));
    }
    return form;
  };

  const stateTone = wired ? "ok" : service.state === "checking" ? "info" : "bad";
  const stateLabel = wired ? "Wired" : service.state === "checking" ? "Checking" : "Not wired";

  return (
    <div className="xer-view pl-create">
      <Card eyebrow="Stage 1 · Create schedule" title="Project evidence, tender and detailed schedule creation" aside={<Badge tone={stateTone}>{stateLabel}</Badge>}>
        <Kpis>
          <Kpi label="Schedule-creation service" value={stateLabel} note={service.detail} tone={wired ? "ok" : service.state === "checking" ? "info" : "crit"} />
          <Kpi label="Endpoint" value={<span className="xer-mono pl-endpoint">{service.endpoint || "—"}</span>} note={service.checkedAt ? `Checked ${new Date(service.checkedAt).toLocaleTimeString()}` : ""} />
          <Kpi label="Engine" value={wired ? `${service.engine} ${service.version}`.trim() : "—"} note={wired ? service.mode || "" : "No data — not wired"} />
          <Kpi
            label="Upload limit"
            value={wired && service.limits?.combined_mb ? `${service.limits.combined_mb} MB` : "—"}
            note={
              wired
                ? `${service.limits?.file_count ?? "—"} files per request · files above ~3.5 MB upload directly to storage · scanned documents ${service.ocr ? "read" : "not read (OCR required)"}`
                : "No data — not wired"
            }
          />
          <Kpi
            label="Planning library"
            value={library && index ? formatNum(index.activities.size) : "—"}
            note="Activities available to the detailed schedule — browser, wired"
            tone={library ? "ok" : "warn"}
          />
        </Kpis>
        <div className="xer-toolbar pl-run">
          <label className="xer-field">
            <span>Project name</span>
            <input className="xer-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <EvidencePicker files={evidence} onChange={setEvidence} />
          <button type="button" className="xer-btn xer-btn-sm" onClick={onRecheck}>Check service again</button>
          {busy ? <span className="xer-busy pl-progress">{busy}…</span> : null}
        </div>
        {error ? <p className="xer-error">{error}</p> : null}
      </Card>

      <div className="xer-subtabs">
        {STEPS.map((s) => (
          <button key={s.key} type="button" className={step === s.key ? "active" : ""} onClick={() => setStep(s.key)}>
            {s.label}
            <i>{s.key === "understand" || wired ? s.eyebrow : "not wired"}</i>
          </button>
        ))}
      </div>

      <div hidden={step !== "understand"}>
        <EvidenceIntelligenceStep evidence={evidence} projectName={projectLabel} health={aiHealth} onRecheckAi={recheckAi} />
      </div>

      <div hidden={step !== "analyzer"}>
        <AnalyzerStep service={service} onRecheck={onRecheck} busy={busy} evidence={evidence} noData={noData} result={analyzer}
          onRun={async () => {
            const reply = await run("Analysing evidence", () => evidenceForm("evidence_analyze"));
            if (reply?.json) setAnalyzer(reply.json);
          }}
        />
      </div>

      <div hidden={step !== "tender"}>
        <TenderStep service={service} onRecheck={onRecheck} busy={busy} evidence={evidence} noData={noData} result={tender} projectLabel={projectLabel}
          onRun={async (dataDate) => {
            const reply = await run("Building the tender schedule", async () => {
              const form = await evidenceForm("tender_build");
              form.set("data_date", dataDate);
              form.set("build_mode", "TENDER");
              return form;
            });
            if (reply?.json) setTender(reply.json);
          }}
        />
      </div>

      <div hidden={step !== "detailed"}>
        <DetailedStep service={service} onRecheck={onRecheck} busy={busy} noData={noData} index={index} analyzer={analyzer}
          projectLabel={projectLabel} run={run} onOpenSchedule={onOpenSchedule}
        />
      </div>

      <div hidden={step !== "reader"}>
        <ReaderStep service={service} onRecheck={onRecheck} busy={busy} evidence={evidence} noData={noData} result={reader}
          onRun={async () => {
            const reply = await run("Reading evidence", () => evidenceForm("evidence_read"));
            if (reply?.json) setReader(reply.json);
          }}
        />
      </div>

      <div hidden={step !== "reports"}>
        <ReportsStep service={service} onRecheck={onRecheck} busy={busy} noData={noData} result={inspection} run={run} onInspected={setInspection} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- shared parts */

function WiringNote({ service, onRecheck, what }: { service: ServiceStatus; onRecheck: () => void; what: string }) {
  if (service.state === "wired") return null;
  return (
    <div className="xer-callout xer-callout-warn pl-not-wired">
      <span>
        <b>{service.state === "checking" ? "Checking the connection…" : "Not wired on this deployment."}</b> {what} runs on the schedule-creation
        service. {service.detail} Nothing is estimated or filled in — this step stays empty until the service is connected.
      </span>
      <button type="button" className="xer-btn xer-btn-sm" onClick={onRecheck}>Check again</button>
    </div>
  );
}

function EvidencePicker({ files, onChange }: { files: File[]; onChange: (next: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const mb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="xer-hidden-input"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          const next = [...files];
          for (const file of picked) {
            if (!next.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) next.push(file);
          }
          onChange(next);
          e.target.value = "";
        }}
      />
      <button type="button" className="xer-btn xer-btn-sm" onClick={() => ref.current?.click()}>Add evidence documents</button>
      {files.length ? <button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange([])}>Clear documents</button> : null}
      <span className="xer-dim">{files.length ? `${files.length} document(s) · ${formatNum(mb, 2)} MB` : "No evidence documents selected"}</span>
    </>
  );
}

function RecordTable({ rows, empty, columns, max = 250 }: { rows: JsonRecord[]; empty: string; columns?: string[]; max?: number }) {
  const cols = useMemo(() => {
    if (columns) return columns;
    const found: string[] = [];
    for (const row of rows.slice(0, 200)) for (const key of Object.keys(row)) if (!found.includes(key)) found.push(key);
    return found;
  }, [rows, columns]);
  if (!rows.length) {
    return <div className="schedule-intelligence-empty"><b>{empty}</b></div>;
  }
  return (
    <div className="schedule-intelligence-scroll">
      <table className="schedule-intelligence-table xer-table" style={{ minWidth: Math.max(640, cols.length * 140) }}>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c.replaceAll("_", " ")}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} dir="auto">{Array.isArray(row[c]) ? (row[c] as unknown[]).map(str).join("; ") : str(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max ? <p className="xer-muted xer-note">Showing {max} of {formatNum(rows.length)} rows.</p> : null}
    </div>
  );
}

function ObjectView({ data, empty }: { data: JsonRecord | null; empty: string }) {
  if (!data || !Object.keys(data).length) return <div className="schedule-intelligence-empty"><b>{empty}</b></div>;
  const entries = Object.entries(data);
  const scalars = entries
    .filter(([, v]) => v === null || typeof v !== "object" || (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")))
    .map(([field, value]) => ({ field, value: Array.isArray(value) ? value.map(str).join("; ") : str(value) }));
  const nested = entries.filter(([, v]) => v && typeof v === "object" && !(Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")));
  return (
    <>
      {scalars.length ? <RecordTable rows={scalars} empty="" columns={["field", "value"]} /> : null}
      {nested.map(([key, value]) => (
        <div key={key}>
          <SectionTitle>{key.replaceAll("_", " ")}</SectionTitle>
          {Array.isArray(value) ? (
            <RecordTable rows={records(value)} empty="Empty" />
          ) : (
            <RecordTable rows={Object.entries(value as JsonRecord).map(([field, v]) => ({ field, value: str(v) }))} empty="Empty" columns={["field", "value"]} />
          )}
        </div>
      ))}
    </>
  );
}

type StepProps = { service: ServiceStatus; onRecheck: () => void; busy: string; noData: string };

/* ------------------------------------------------------ evidence analyzer */

function AnalyzerStep({ service, onRecheck, busy, evidence, noData, result, onRun }: StepProps & { evidence: File[]; result: JsonRecord | null; onRun: () => void }) {
  const wired = service.state === "wired";
  const dashboard = (result?.dashboard || {}) as JsonRecord;
  const tables = records(result?.dynamic_tables);
  return (
    <div className="xer-view">
      <WiringNote service={service} onRecheck={onRecheck} what="The evidence analyzer" />
      <Card eyebrow="First stage before schedule creation" title="Analyse schedule evidence" aside={<Badge tone={wired ? "ok" : "bad"}>{wired ? "Wired" : "Not wired"}</Badge>}>
        <p className="xer-muted">
          Classifies and cross-checks Arabic and English evidence, shows exact source locations, flags missing inputs and blocks unresolved
          conflicts. The detailed schedule uses this result as its evidence basis.
        </p>
        <div className="xer-toolbar pl-run">
          <button type="button" className="schedule-intelligence-primary" disabled={!wired || !!busy || !evidence.length} onClick={onRun}>
            Analyse evidence
          </button>
          <span className="xer-dim">{!wired ? "Not wired" : evidence.length ? `${evidence.length} document(s) ready` : "Add evidence documents above"}</span>
        </div>
      </Card>

      <Card eyebrow="Schedule builder readiness" title={result ? str(result.readiness_status) || "—" : "—"} aside={result ? (result.schedule_builder_transfer_allowed ? "Transfer allowed" : "Transfer blocked") : "No data"}>
        {Object.keys(dashboard).length ? (
          <Kpis>{Object.entries(dashboard).map(([label, value]) => <Kpi key={label} label={label} value={str(value)} />)}</Kpis>
        ) : (
          <div className="schedule-intelligence-empty"><b>{noData}</b></div>
        )}
      </Card>
      <Card eyebrow="Evidence-controlled output" title="Project schedule master summary"><RecordTable rows={records(result?.project_master_summary)} empty={noData} /></Card>
      <Card eyebrow="Evidence-controlled output" title="Must-have schedule data check"><RecordTable rows={records(result?.must_have_data_check)} empty={noData} /></Card>
      {tables.map((t) => (
        <Card key={str(t.title)} eyebrow="Evidence-controlled output" title={str(t.title)}><RecordTable rows={records(t.rows)} empty={noData} /></Card>
      ))}
      <Card eyebrow="User-controlled resolution" title="Conflicts"><RecordTable rows={records(result?.conflicts)} empty={noData} /></Card>
      <Card eyebrow="Blocks schedule creation" title="Missing information"><RecordTable rows={records(result?.missing_information)} empty={noData} /></Card>
      <Card eyebrow="Gate" title="Final readiness"><RecordTable rows={records(result?.readiness_table)} empty={noData} /></Card>
      <Card eyebrow="Documents" title="Document understanding register"><RecordTable rows={records(result?.document_register)} empty={noData} /></Card>
      <Card eyebrow="Traceability" title="Source traceability"><RecordTable rows={records(result?.source_traceability)} empty={noData} /></Card>
    </div>
  );
}

/* --------------------------------------------------------- tender schedule */

function TenderStep({
  service, onRecheck, busy, evidence, noData, result, projectLabel, onRun,
}: StepProps & { evidence: File[]; result: JsonRecord | null; projectLabel: string; onRun: (dataDate: string) => void }) {
  const wired = service.state === "wired";
  const [dataDate, setDataDate] = useState("");
  const summary = (result?.summary || null) as JsonRecord | null;
  const qa = (summary?.qa || null) as JsonRecord | null;
  const schedule = (result?.normalized_schedule || null) as JsonRecord | null;
  const activities = schedule ? (Array.isArray(schedule.activities) ? records(schedule.activities) : records(Object.values((schedule.activities || {}) as JsonRecord))) : [];
  const dash = (v: unknown) => (summary ? str(v) || "—" : "—");

  return (
    <div className="xer-view">
      <WiringNote service={service} onRecheck={onRecheck} what="Tender schedule creation" />
      <Card eyebrow="Evidence-to-schedule synthesis" title="Build a tender schedule" aside={<Badge tone={wired ? "ok" : "bad"}>{wired ? "Wired" : "Not wired"}</Badge>}>
        <p className="xer-muted">
          Builds a tender-level schedule for {projectLabel} from the evidence documents added above. Every activity stays linked to its source; the
          schedule is a proposal until it is recreated and recalculated in Primavera P6.
        </p>
        <div className="xer-toolbar pl-run">
          <label className="xer-field">
            <span>Data date</span>
            <input className="xer-input" type="date" value={dataDate} onChange={(e) => setDataDate(e.target.value)} />
          </label>
          <button type="button" className="schedule-intelligence-primary" disabled={!wired || !!busy || !evidence.length} onClick={() => onRun(dataDate)}>
            Build tender schedule
          </button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            disabled={!schedule}
            onClick={() => schedule && downloadBlob(`${projectLabel}-tender-schedule.json`, JSON.stringify(schedule, null, 2), "application/json")}
          >
            Download tender schedule (JSON)
          </button>
          <span className="xer-dim">{!wired ? "Not wired" : evidence.length ? `${evidence.length} document(s) ready` : "Add evidence documents above"}</span>
        </div>
      </Card>

      <Kpis>
        <Kpi label="Activities" value={dash(summary?.activity_count)} note={summary ? `${dash(summary.relationship_count)} relationships` : noData} />
        <Kpi label="Forecast finish (native CPM)" value={dash(summary?.forecast_finish)} note={summary ? `Data date ${dash(summary.data_date)}` : noData} />
        <Kpi label="Critical activities" value={dash(summary?.critical_count)} note={summary ? `${dash(summary.driving_path_count)} driving paths` : noData} />
        <Kpi label="Schedule QA" value={qa ? str(qa.score) || "—" : "—"} note={qa ? `Grade ${str(qa.grade) || "—"} · ${str(qa.warnings) || "0"} warnings` : noData} />
      </Kpis>

      <Card eyebrow="Pipeline hand-off" title="Open the tender schedule in analysis and recovery" aside={<Badge tone="bad">Not wired</Badge>}>
        <p className="xer-muted">
          Not wired yet: the tender builder returns its schedule as JSON, while the analysis, mapping and Mitigation / Recovery / Revised stages read a
          Primavera XER. No conversion is invented here — use the detailed schedule step, which does produce an XER, to carry a schedule into the
          pipeline.
        </p>
      </Card>
      <Card eyebrow="Built activities" title="Tender schedule activities"><RecordTable rows={activities} empty={noData} /></Card>
      <Card eyebrow="Build record" title="How the schedule was built"><ObjectView data={(result?.build || null) as JsonRecord | null} empty={noData} /></Card>
      <Card eyebrow="Evidence" title="Documents read">
        <RecordTable rows={records(result?.documents)} empty={noData} columns={["filename", "extension", "parser", "arabic_read_status", "arabic_characters", "warnings"]} />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------- detailed schedule */

type Pick = { selected: boolean; quantity: number | null; crews: number | null; production: number | null };
const EMPTY_PICK: Pick = { selected: false, quantity: null, crews: null, production: null };

function DetailedStep({
  service, onRecheck, busy, noData, index, analyzer, projectLabel, run, onOpenSchedule,
}: StepProps & {
  index: LibraryIndex | null;
  analyzer: JsonRecord | null;
  projectLabel: string;
  run: Runner;
  onOpenSchedule: (file: File) => void;
}) {
  const wired = service.state === "wired";
  // Every planner answer starts blank: the service blocks on anything missing rather than assuming it.
  const [answers, setAnswers] = useState({
    project_id: "", build_mode: "DETAILED", commencement_date: "", data_date: "", target_duration_days: "",
    hours_per_day: "", days_per_week: "", holiday_dates: "", default_wbs: "", logic_mode: "", conflicts_resolved: false,
  });
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [division, setDivision] = useState("");
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [result, setResult] = useState<JsonRecord | null>(null);

  const catalog = useMemo(() => {
    if (!index) return [];
    return Array.from(index.activities.entries()).map(([code, row]) => {
      const basis = activityBasis(index, code);
      return {
        code,
        description: cellText(row.description),
        division: cellText(row.divisionName) || cellText(row.division),
        subdivision: cellText(row.subdivisionName),
        uom: basis?.uom || cellText(row.uom),
        libraryProduction: basis?.dailyProduction ?? null,
        governing: basis?.governing || "",
      };
    });
  }, [index]);
  const divisions = useMemo(() => Array.from(new Set(catalog.map((c) => c.division).filter(Boolean))), [catalog]);
  const target = numOrNull(answers.target_duration_days);

  const lineFor = (c: (typeof catalog)[number]) => {
    const p = picks[c.code] || EMPTY_PICK;
    const production = p.production ?? c.libraryProduction;
    const duration = p.quantity && production && p.crews ? Math.max(1, Math.ceil(p.quantity / (production * p.crews))) : null;
    const recommended = p.quantity && production && target ? Math.max(1, Math.ceil(p.quantity / (production * target))) : null;
    const missing = [!p.quantity ? "quantity" : "", !production ? "productivity" : "", !p.crews ? "crews" : ""].filter(Boolean);
    return { ...p, production, duration, recommended, missing };
  };

  const shown = catalog.filter((c) => {
    if (onlySelected && !picks[c.code]?.selected) return false;
    if (division && c.division !== division) return false;
    const q = query.trim().toLowerCase();
    return !q || `${c.code} ${c.description} ${c.subdivision}`.toLowerCase().includes(q);
  });
  const selected = catalog.filter((c) => picks[c.code]?.selected);
  const complete = selected.filter((c) => !lineFor(c).missing.length).length;

  const setPick = (code: string, patch: Partial<Pick>) => {
    setPicks((prev) => ({ ...prev, [code]: { ...(prev[code] || EMPTY_PICK), ...patch } }));
    setResult(null);
  };
  const setAnswer = (key: keyof typeof answers, value: string | boolean) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  };

  const developForm = (action: string, artifact?: string) => {
    const lines = selected.map((c) => ({ c, line: lineFor(c) }));
    const activity = {
      kind: "activity", project_name: projectLabel, source_snapshot: [], support: { source: "Schedule Intelligence planning library" },
      rows: lines.map(({ c }, i) => ({
        activity_id: c.code, source_sequence_number: i + 1, source_activity_name: c.description, display_name: c.description,
        discipline: c.division, work_package: c.subdivision, uom: c.uom, approval_status: "APPROVED", provenance: "Planning library",
      })),
    };
    const productivity = {
      kind: "productivity", project_name: projectLabel, source_snapshot: [], support: { source: "Schedule Intelligence planning library" },
      rows: lines.map(({ c, line }) => ({
        original_activity_code: c.code, original_activity_name: c.description, display_name: c.description, original_uom: c.uom,
        normalized_uom: c.uom, selected_productivity: line.production, quantity: line.quantity, number_of_crews: line.crews,
        crew_type: c.governing, source_document: "Schedule Intelligence planning library",
        source_location: line.production !== c.libraryProduction ? `${c.code} · planner override` : `${c.code} · ${c.governing}`,
        approval_status: "APPROVED",
      })),
    };
    const form = new FormData();
    form.set("action", action);
    form.set("analyzer_payload", JSON.stringify(analyzer || {}));
    form.set("activity_payload", JSON.stringify(activity));
    form.set("productivity_payload", JSON.stringify(productivity));
    form.set("development_answers", JSON.stringify({
      ...answers,
      project_name: projectLabel,
      target_duration_days: numOrNull(answers.target_duration_days) ?? "",
      hours_per_day: numOrNull(answers.hours_per_day) ?? "",
      days_per_week: numOrNull(answers.days_per_week) ?? "",
    }));
    form.set("crew_overrides", "{}");
    if (artifact) form.set("artifact", artifact);
    return form;
  };

  const built = result?.status === "PRE_P6_SCHEDULE_BUILT";
  const blockers = records(result?.blockers);
  const canRun = wired && !busy && !!selected.length;

  const field = (label: string, key: keyof typeof answers, type = "text", placeholder = "") => (
    <label className="xer-field xer-field-block">
      <span>{label}</span>
      <input className="xer-input" type={type} value={String(answers[key])} placeholder={placeholder} onChange={(e) => setAnswer(key, e.target.value)} />
    </label>
  );

  return (
    <div className="xer-view">
      <WiringNote service={service} onRecheck={onRecheck} what="Detailed schedule construction" />

      <Card eyebrow="Fixed questions · answered before construction" title="Planner answers" aside={<Badge tone={wired ? "ok" : "bad"}>{wired ? "Wired" : "Not wired"}</Badge>}>
        <div className="pl-answer-grid">
          {field("Unique project ID *", "project_id")}
          <label className="xer-field xer-field-block">
            <span>Schedule level</span>
            <select className="xer-select" value={answers.build_mode} onChange={(e) => setAnswer("build_mode", e.target.value)}>
              <option value="DETAILED">Detailed</option>
              <option value="TENDER">Tender</option>
            </select>
          </label>
          {field("Commencement / NTP *", "commencement_date", "date")}
          {field("Data date *", "data_date", "date")}
          {field("Target duration (working days) *", "target_duration_days", "number")}
          {field("Working hours / day *", "hours_per_day", "number")}
          {field("Working days / week *", "days_per_week", "number")}
          {field("Default WBS *", "default_wbs")}
          <label className="xer-field xer-field-block">
            <span>Logic basis *</span>
            <select className="xer-select" value={answers.logic_mode} onChange={(e) => setAnswer("logic_mode", e.target.value)}>
              <option value="">Choose…</option>
              <option value="EVIDENCE">Evidence analyzer logic</option>
              <option value="SEQUENTIAL_SOURCE_ORDER">Approved sequential order (assumption)</option>
            </select>
          </label>
          {field("Non-working holidays", "holiday_dates", "text", "YYYY-MM-DD, comma separated")}
        </div>
        <label className="xer-check-field">
          <input type="checkbox" checked={answers.conflicts_resolved} onChange={(e) => setAnswer("conflicts_resolved", e.target.checked)} />
          <span>
            <b>Evidence conflicts affecting this schedule are resolved</b>
            <small>
              Evidence analyzer: {analyzer ? `result available · ${records(analyzer.conflicts).length} conflict(s)` : wired ? "not run yet" : "no data — not wired"}
            </small>
          </span>
        </label>
      </Card>

      <Card eyebrow="From the planning library · browser, wired" title="Scope, quantities and crews" aside={`${selected.length} selected · ${complete} complete`}>
        <p className="xer-muted">
          Tick the library activities in scope and enter each quantity and number of crews. Output per crew-day comes from the planning library and can
          be overridden. Duration = quantity ÷ (output × crews), rounded up; anything missing is sent as missing and blocks construction.
        </p>
        <div className="xer-toolbar">
          <input className="xer-input" type="search" placeholder="Search code or activity…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="xer-select" value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="">All divisions</option>
            {divisions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="xer-field">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
            <span>Selected only</span>
          </label>
          <span className="xer-table-count">{formatNum(shown.length)} activities</span>
        </div>
        {!index ? (
          <div className="schedule-intelligence-empty"><b>The planning library is not loaded.</b></div>
        ) : (
          <div className="schedule-intelligence-scroll">
            <table className="schedule-intelligence-table xer-table pl-grid" style={{ minWidth: 1180 }}>
              <thead>
                <tr>
                  <th>In scope</th><th>Code</th><th>Activity</th><th>UOM</th>
                  <th style={{ textAlign: "right" }}>Quantity</th><th style={{ textAlign: "right" }}>Output / crew-day</th>
                  <th style={{ textAlign: "right" }}>Crews</th><th style={{ textAlign: "right" }}>Duration (d)</th>
                  <th style={{ textAlign: "right" }}>Crews for target</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const line = lineFor(c);
                  const numberInput = (key: "quantity" | "crews" | "production", value: number | null, placeholder: string) => (
                    <input
                      key={`${c.code}:${key}:${value}`}
                      className="pl-cell-input pl-num-input"
                      inputMode="decimal"
                      defaultValue={value === null ? "" : String(value)}
                      placeholder={placeholder}
                      onBlur={(e) => {
                        const v = numOrNull(e.target.value);
                        if (v !== value) setPick(c.code, { [key]: v, selected: true });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  );
                  return (
                    <tr key={c.code} className={line.selected && line.missing.length ? "pl-row-issue" : undefined}>
                      <td><input type="checkbox" checked={line.selected} onChange={(e) => setPick(c.code, { selected: e.target.checked })} /></td>
                      <td className="xer-mono">{c.code}</td>
                      <td>{c.description}<small className="pl-sub">{c.subdivision}</small></td>
                      <td>{c.uom}</td>
                      <td className="pl-num">{numberInput("quantity", picks[c.code]?.quantity ?? null, "Required")}</td>
                      <td className="pl-num">
                        {numberInput("production", picks[c.code]?.production ?? null, c.libraryProduction === null ? "Missing" : formatNum(c.libraryProduction, 2))}
                        {c.governing ? <small className="pl-sub">{c.governing}</small> : null}
                      </td>
                      <td className="pl-num">{numberInput("crews", picks[c.code]?.crews ?? null, "Required")}</td>
                      <td className="pl-num">{line.duration ?? <span className="xer-dim">{line.selected ? `Missing ${line.missing.join(", ")}` : "—"}</span>}</td>
                      <td className="pl-num">{line.recommended ?? <span className="xer-dim">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="xer-toolbar pl-run">
          <button
            type="button"
            className="schedule-intelligence-primary"
            disabled={!canRun}
            onClick={async () => {
              const reply = await run("Constructing the detailed schedule", developForm("schedule_develop"));
              if (reply?.json) setResult(reply.json);
            }}
          >
            Construct schedule and show every step
          </button>
          <button type="button" className="xer-btn" disabled={!wired || !built || !!busy}
            onClick={() => void run("Preparing the Excel workbook", developForm("schedule_development_export", "xlsx"), { fallbackName: "schedule-development.xlsx" })}>
            Download Excel workbook
          </button>
          <button type="button" className="xer-btn" disabled={!wired || !built || !!busy}
            onClick={() => void run("Preparing the XER", developForm("schedule_development_export", "xer"), { fallbackName: "schedule-development.xer" })}>
            Download XER
          </button>
          <button type="button" className="xer-btn" disabled={!wired || !built || !!busy}
            onClick={async () => {
              const reply = await run("Opening the schedule in the pipeline", developForm("schedule_development_export", "xer"), { download: false, fallbackName: "schedule-development.xer" });
              if (reply?.file) onOpenSchedule(new File([reply.file.blob], reply.file.name.endsWith(".xer") ? reply.file.name : `${reply.file.name}.xer`));
            }}>
            Open in analysis &amp; recovery
          </button>
          <span className="xer-dim">{!wired ? "Not wired" : !selected.length ? "Select activities in scope" : built ? "Schedule built — ready for P6 staging" : ""}</span>
        </div>
      </Card>

      <Card eyebrow="Construction gate" title={result ? str(result.status).replaceAll("_", " ") : "—"} aside={result ? `${blockers.length} blocker(s)` : "No data"}>
        {result ? <p className="xer-muted">{str(result.warning)}</p> : <div className="schedule-intelligence-empty"><b>{noData}</b></div>}
        {blockers.length ? (
          <ul className="pl-blockers">
            {blockers.map((b, i) => <li key={`${str(b.type)}-${i}`}><b>{str(b.type).replaceAll("_", " ")}</b><span>{str(b.message)}</span></li>)}
          </ul>
        ) : null}
      </Card>
      <Card eyebrow="Live process trace" title="Construction steps"><RecordTable rows={records(result?.construction_steps)} empty={noData} /></Card>
      <Card eyebrow="Quantity ÷ (output × crews)" title="Crew plan"><RecordTable rows={records(result?.crew_plan)} empty={noData} /></Card>
      <Card eyebrow="Shadow CPM preview — P6 verification mandatory" title="Schedule activities"><RecordTable rows={records(result?.activities)} empty={noData} /></Card>
      <Card eyebrow="Logic" title="Relationships"><RecordTable rows={records(result?.relationships)} empty={noData} /></Card>
    </div>
  );
}

/* --------------------------------------------------------- evidence reader */

function ReaderStep({ service, onRecheck, busy, evidence, noData, result, onRun }: StepProps & { evidence: File[]; result: JsonRecord | null; onRun: () => void }) {
  const wired = service.state === "wired";
  const documents = records(result?.documents);
  return (
    <div className="xer-view">
      <WiringNote service={service} onRecheck={onRecheck} what="The evidence reader" />
      <Card eyebrow="Arabic and English Unicode text" title="Read and verify evidence" aside={<Badge tone={wired ? "ok" : "bad"}>{wired ? "Wired" : "Not wired"}</Badge>}>
        <p className="xer-muted">Scanned or image-only documents are reported as OCR required — never as read.</p>
        <div className="xer-toolbar pl-run">
          <button type="button" className="schedule-intelligence-primary" disabled={!wired || !!busy || !evidence.length} onClick={onRun}>Read evidence</button>
          <span className="xer-dim">{!wired ? "Not wired" : evidence.length ? `${evidence.length} document(s) ready` : "Add evidence documents above"}</span>
        </div>
      </Card>
      <Card eyebrow="Per-file reading status" title={documents.length ? `${documents.length} documents checked` : "Documents"}>
        {documents.length ? (
          <div className="schedule-intelligence-scroll">
            <table className="schedule-intelligence-table xer-table" style={{ minWidth: 900 }}>
              <thead><tr><th>Document</th><th>Parser</th><th>Arabic</th><th style={{ textAlign: "right" }}>Characters</th><th>Warnings</th></tr></thead>
              <tbody>
                {documents.map((d, i) => (
                  <tr key={`${str(d.sha256)}-${i}`}>
                    <td>
                      <b>{str(d.filename)}</b>
                      {d.text_preview ? (
                        <details><summary>Extracted text</summary><pre dir="auto" className="pl-preview">{str(d.text_preview)}</pre></details>
                      ) : null}
                    </td>
                    <td>{str(d.parser)}</td>
                    <td><Badge tone={str(d.arabic_read_status) === "ocr_required" ? "bad" : str(d.arabic_read_status) === "arabic_text_extracted" ? "ok" : "mut"}>{str(d.arabic_read_status).replaceAll("_", " ")}</Badge></td>
                    <td className="pl-num">{str(d.arabic_characters)}</td>
                    <td>{Array.isArray(d.warnings) ? (d.warnings as unknown[]).map(str).join("; ") || "None" : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="schedule-intelligence-empty"><b>{noData}</b></div>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------- report studio */

function ReportsStep({ service, onRecheck, busy, noData, result, run, onInspected }: StepProps & { result: JsonRecord | null; run: Runner; onInspected: (r: JsonRecord) => void }) {
  const wired = service.state === "wired";
  const [template, setTemplate] = useState<File | null>(null);
  const [data, setData] = useState<File | null>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const dataRef = useRef<HTMLInputElement>(null);
  const form = async (action: string): Promise<FormData> => {
    const f = new FormData();
    f.set("action", action);
    if (template) {
      if (usesBlobUpload() && template.size > BLOB_UPLOAD_THRESHOLD_BYTES) {
        f.set("template_blob_file", JSON.stringify(await uploadFileToBlob(template)));
      } else {
        f.set("template_file", template);
      }
    }
    if (data && action === "report_render") {
      if (usesBlobUpload() && data.size > BLOB_UPLOAD_THRESHOLD_BYTES) {
        f.set("data_blob_file", JSON.stringify(await uploadFileToBlob(data)));
      } else {
        f.set("data_file", data);
      }
    }
    return f;
  };
  const picker = (ref: React.RefObject<HTMLInputElement | null>, file: File | null, onPick: (f: File | null) => void, label: string, hint: string, accept?: string): ReactNode => (
    <>
      <input ref={ref} type="file" accept={accept} className="xer-hidden-input" onChange={(e) => { onPick(e.target.files?.[0] || null); e.target.value = ""; }} />
      <button type="button" className="xer-btn xer-btn-sm" onClick={() => ref.current?.click()}>{label}</button>
      <span className="xer-dim">{file ? file.name : hint}</span>
    </>
  );
  return (
    <div className="xer-view">
      <WiringNote service={service} onRecheck={onRecheck} what="Report studio" />
      <Card eyebrow="Precision report studio" title="Inspect or populate a controlled template" aside={<Badge tone={wired ? "ok" : "bad"}>{wired ? "Wired" : "Not wired"}</Badge>}>
        <div className="xer-toolbar pl-run">
          {picker(templateRef, template, setTemplate, "Choose template", "DOCX, XLSX, PPTX, PDF, HTML or text")}
          {picker(dataRef, data, setData, "Choose data", "Optional JSON, CSV or XLSX", ".json,.csv,.xlsx,.xlsm")}
        </div>
        <div className="xer-toolbar pl-run">
          <button type="button" className="schedule-intelligence-primary" disabled={!wired || !!busy || !template}
            onClick={async () => {
              const reply = await run("Inspecting the template", () => form("report_inspect"));
              if (reply?.json) onInspected(reply.json);
            }}>
            Inspect template
          </button>
          <button type="button" className="xer-btn" disabled={!wired || !!busy || !template}
            onClick={() => void run("Populating the report", () => form("report_render"), { fallbackName: "populated-report" })}>
            Populate and download
          </button>
          <span className="xer-dim">{wired ? "" : "Not wired"}</span>
        </div>
      </Card>
      <Card eyebrow="Template inspection" title="Placeholders and structure"><ObjectView data={result} empty={noData} /></Card>
    </div>
  );
}
