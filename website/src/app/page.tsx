"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Chart from "chart.js/auto";
import portfolio from "../../public/data/portfolio.json";
import MermaidDiagram from "../components/MermaidDiagram";
import AiChatPanel from "../components/ai/AiChatPanel";
import AiInsightCard from "../components/ai/AiInsightCard";
import TechnicalKnowledgeAdvisor from "../components/ai/TechnicalKnowledgeAdvisor";
import ActionTracker from "../components/executive/ActionTracker";
import AdvancedAnalyticsPanel, { type AdvancedAnalyticsPayload } from "../components/executive/AdvancedAnalyticsPanel";
import ExecutiveLightModeToggle from "../components/executive/ExecutiveLightModeToggle";
import ManagementDecisionBrief, { type ActionItem, type DecisionBriefItem } from "../components/executive/ManagementDecisionBrief";
import PredictiveWarningPanel from "../components/executive/PredictiveWarningPanel";
import ScenarioPlanner from "../components/executive/ScenarioPlanner";
import UnifiedIntelligenceSearch from "../components/executive/UnifiedIntelligenceSearch";
import OutputStudioDownloadButton from "../components/OutputStudioDownloadButton";

type ReportKey = "executive_dashboard" | "master_dashboard" | "elite_svg_charts" | "linked_executive_dashboard";

type ReportArtifact = {
  html: string;
  pdf: string;
  pptx: string;
  docx?: string;
  assessment_status?: string;
  source_scope?: string;
  files?: Record<string, { name: string; bytes: number; sha256: string }>;
};

type SourceChartSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
};

type SourceChartPayload = {
  id: string;
  tab: string;
  title: string;
  type: "grouped_bar" | ReferenceChartType;
  status: "ready" | "partial" | "draft" | "awaiting_data";
  message: string;
  labels: string[];
  series: SourceChartSeries[];
  source_lineage: { files: string[]; required_columns: string[] };
  validation: Array<{ file: string; source_row: string; field: string; message: string }>;
  scenario?: { scenario_id: string; analyst_status: string; activity_count: number } | null;
};

type ProjectChartPayloads = {
  catalog_version: string;
  project_id: string;
  project_key: string;
  charts: SourceChartPayload[];
  ready_count: number;
  draft_count: number;
  awaiting_count: number;
  validation: Array<{ file: string; source_row: string; field: string; message: string }>;
};

type ProjectRecord = {
  project_id: string;
  project_key: string;
  project_folder_name: string;
  project_display_name: string;
  sector: string;
  status: string;
  contract_value: number | null;
  paid_amount: number | null;
  spent_amount: number | null;
  remaining_value: number | null;
  planned_progress: number | null;
  actual_progress: number | null;
  progress_variance: number | null;
  bac: number | null;
  pv: number | null;
  ev: number | null;
  ac: number | null;
  sv: number | null;
  cv: number | null;
  eac: number | null;
  etc: number | null;
  vac: number | null;
  spi: number | null;
  cpi: number | null;
  risk_score: number | null;
  risk_record_count?: number;
  delay_days: number | null;
  delay_assessment?: string | null;
  delay_event_count?: number;
  claims_exposure: number | null;
  claimed_days?: number | null;
  planned_start?: string | null;
  planned_finish?: string | null;
  forecast_finish?: string | null;
  schedule_health?: string | null;
  cost_health?: string | null;
  delay_exposure?: string | null;
  claim_exposure_level?: string | null;
  data_confidence?: string | null;
  decision_priority?: string | null;
  decision_reasons?: Array<Record<string, string>>;
  data_quality: number | null;
  data_quality_components?: {
    metric_completeness?: number;
    required_source_completeness?: number;
    required_source_sets?: string[];
  };
  decision_required: boolean;
  activity_count: number;
  milestone_count: number;
  last_updated: string | null;
  meeting_url?: string | null;
  source_files: Record<string, number>;
  metric_sources?: Record<string, { source: string; aggregation: string }>;
  chart_payloads?: ProjectChartPayloads;
  advanced_analytics?: AdvancedAnalyticsPayload;
  features: FeaturePayload;
  reports: Record<ReportKey, string>;
  report_artifacts?: Partial<Record<ReportKey, ReportArtifact>> & Record<string, ReportArtifact | undefined>;
};

// The portfolio payload deliberately excludes large feature tables. Those are loaded
// only after the user selects a project, keeping the executive dashboard responsive.
type ProjectSummary = Omit<ProjectRecord, "features" | "advanced_analytics">;

type SectorRecord = {
  sector: string;
  project_count: number;
  contract_value: number;
  paid_amount: number;
  spent_amount: number;
  average_progress: number | null;
  average_spi: number | null;
  average_cpi: number | null;
  average_risk_score: number | null;
  delayed_projects: number;
  decisions_required: number;
};

type FileRecord = {
  name: string;
  relative_path: string;
  extension: string;
  size_kb: number;
  modified: string;
};

type DetectorRecord = {
  name: string;
  status: string;
  detail: string;
};

type TablePreview = {
  file: string;
  exists: boolean;
  row_count: number;
  column_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  source_path?: string;
};

const EMPTY_TABLE_ROWS: Record<string, unknown>[] = [];
const EMPTY_TABLE_COLUMNS: string[] = [];

type XlsxSummary = {
  file: string;
  exists: boolean;
  sheets?: Array<{
    name: string;
    row_count: number;
    column_count: number;
    columns: string[];
    rows: Record<string, unknown>[];
    truncated?: boolean;
  }>;
  error?: string;
};

type FourPipelineAssessment = {
  project_id: string;
  project_key: string;
  analysis_run_id?: string;
  assessment_profile: "evidence_backed" | "qualified" | "readiness_only" | string;
  assessment_status: string;
  determination_status?: string;
  source_scope: string;
  summary?: Record<string, unknown>;
  gates?: Array<Record<string, unknown>>;
  missing_actions?: string[];
  pipeline_rows?: Array<Record<string, unknown>>;
  source_inventory?: Array<Record<string, unknown>>;
  evidence_ledger?: Array<Record<string, unknown>>;
};

type ContractControlSnapshot = {
  status?: Record<string, unknown>;
  controls?: {
    project_id: string;
    project_key: string;
    source_scope: string;
    generic_guidance_status?: string;
    contract_source_count?: number;
    clause_control_count?: number;
    evidence_mapping_count?: number;
    contract_authority_register?: Array<Record<string, unknown>>;
    clause_controls?: Array<Record<string, unknown>>;
    evidence_ledger?: Array<Record<string, unknown>>;
  };
};

type FeaturePayload = {
  overview: {
    data_sources: Record<string, number>;
    source_tables: Record<string, TablePreview>;
    workspace_tables?: Record<string, TablePreview>;
  };
  letters_intelligence: {
    folder: string;
    inbox_files: FileRecord[];
    inbox_file_count: number;
    workbook: XlsxSummary;
    workbook_tables?: XlsxSummary;
    detectors: DetectorRecord[];
  };
  delay_analysis: {
    folder: string;
    logic_mode?: string;
    controlled_tia: {
      status: string;
      approval_status: string;
      message: string;
      workflow_tabs: string[];
      source_integrity?: {
        release_configured?: boolean;
        release_type?: string;
        files?: Array<Record<string, unknown>>;
        inventory?: Array<Record<string, unknown>>;
        archive?: Record<string, unknown>;
        validation_findings?: Array<Record<string, unknown>>;
        missing_files?: string[];
        signature?: Record<string, unknown>;
        master?: Record<string, unknown>;
        embedded_payload?: Record<string, unknown>;
        project_match?: boolean;
      };
      schedule_cpm?: {
        status?: string;
        xer_pairs?: Array<Record<string, unknown>>;
        approved_matrix?: Array<Record<string, unknown>>;
        relationship_evidence?: Array<Record<string, unknown>>;
        cpm_controls?: string[];
      };
      events_and_fragnets?: { status?: string; events?: Array<Record<string, unknown>>; fragnet_controls?: string[] };
      concurrency_and_entitlement?: {
        status?: string;
        gross_included_event_movement_days?: number | null;
        concurrency_adjustment_days?: number | null;
        integrated_eot_calendar_days?: number | null;
        event_positions?: Array<Record<string, unknown>>;
        evidence_matrix?: Array<Record<string, unknown>>;
        controls?: string[];
      };
      eot_position?: {
        status?: string;
        label?: string;
        message?: string;
        project_finish_milestone_id?: string;
        ground_works_milestone_id?: string;
        baseline_project_finish?: string | null;
        impacted_project_finish?: string | null;
        integrated_eot_calendar_days?: number | null;
        gross_included_event_movement_days?: number | null;
        concurrency_adjustment_days?: number | null;
        included_event_positions?: Array<Record<string, unknown>>;
        excluded_event_positions?: Array<Record<string, unknown>>;
      };
      charts?: Array<{
        view: string;
        id: string;
        title: string;
        type: ReferenceChartType;
        labels: string[];
        series: SourceChartSeries[];
        status?: string;
        note?: string;
        lineage?: string;
        size?: "small" | "medium" | "large";
      }>;
      ai_scope?: { status?: string; message?: string };
      missing_evidence?: string[];
      reconciliation_items?: Array<Record<string, unknown>>;
      source_fingerprint?: string | null;
      automatic_draft?: boolean;
      last_run_at?: string | null;
      run_id?: string;
    };
    legacy_status?: string;
    detectors: DetectorRecord[];
  };
  four_pipeline?: FourPipelineAssessment;
  contract_claims: {
    folder: string;
    source_files: FileRecord[];
    evidence_files: FileRecord[];
    database: {
      exists: boolean;
      tables: Record<string, number | null>;
      error: string | null;
    };
    knowledge_base?: {
      exists: boolean;
      tables: Record<string, TablePreview>;
      error: string | null;
    };
    clause_library: XlsxSummary;
    clause_library_tables?: XlsxSummary;
    controlled_assessment?: ContractControlSnapshot;
    detectors: DetectorRecord[];
  };
  outputs_and_watchers: {
    outputs_folder: string;
    output_files: FileRecord[];
    watchers: DetectorRecord[];
  };
};

type SubmittedTiaPayload = {
  available: boolean;
  status: string;
  scope_note: string;
  governance_principle?: string;
  decision_gates?: string[];
  submitted_results?: Record<string, unknown>[];
  level4_reconciliation?: Record<string, unknown>[];
  evidence_status_controls?: Record<string, unknown>[];
  evidence_gaps?: string[];
  model_integrity_warnings?: string[];
  fragnet_comparison?: Record<string, unknown>[];
  event_register?: Record<string, unknown>[];
  event_folders?: Array<{ name: string; file_count: number; xer_count: number; pdf_count: number; xlsx_count: number }>;
  visuals?: Array<{ name: string; relative_path: string; url: string }>;
  source_files?: FileRecord[];
  recommended_next_moves?: string[];
  source_governance?: {
    assessment_version?: string;
    project_id: string;
    project_display_name?: string;
    source_scope: string;
    status: string;
    summary?: Record<string, unknown>;
    event_register?: Record<string, unknown>[];
    fragnet_register?: Record<string, unknown>[];
    relationship_register?: Record<string, unknown>[];
    evidence_gaps?: Array<Record<string, unknown>>;
    reconciliation_warnings?: Array<Record<string, unknown>>;
  };
};

type SubmittedTiaVisualPayload = {
  available: boolean;
  status: string;
  scope_note: string;
  evidentiary_note: string;
  visuals: Array<{
    name: string;
    label: string;
    category: string;
    relative_path: string;
    url: string;
  }>;
};

const projects = portfolio.projects as unknown as ProjectSummary[];
const sectors = portfolio.sectors as SectorRecord[];
const totals = portfolio.totals;
const warningSummary = (portfolio as { warning_summary?: Record<string, number> }).warning_summary;
const decisionBrief = ((portfolio as { decision_brief?: DecisionBriefItem[] }).decision_brief || []) as DecisionBriefItem[];
const DECISION_DASHBOARD_KEY = "__decision_making_dashboard__";
// The complete project-scoped TIA workflow is a visible project tab. Its
// data remains isolated to the selected project and its formal outputs remain
// in Output Studio.
const INTERNAL_TIA_SURFACE_ENABLED = true;

const reportTabs: Array<{ key: ReportKey; label: string; note: string }> = [
  { key: "executive_dashboard", label: "Executive Dashboard", note: "Portfolio-style project summary" },
  { key: "master_dashboard", label: "Master Dashboard", note: "Detailed section dashboard" },
  { key: "elite_svg_charts", label: "Elite SVG Charts", note: "Digital chart package" },
  { key: "linked_executive_dashboard", label: "Linked Dashboard", note: "Linked executive HTML" }
];

const workspaceTabs = [
  "Overview",
  "WBS",
  "Activities",
  "Milestones",
  "S-Curve",
  "EVM Analysis",
  "Analytics Intelligence",
  "Contracts",
  "Letters Intelligence",
  "Risks",
  "Delay Analysis - Time Impact Analysis",
  "Contract & Claims Intelligence Center",
  "Technical Advisor",
  "Conference",
  "Output Studio"
] as const;

type WorkspaceTab = (typeof workspaceTabs)[number];
const visibleWorkspaceTabs: WorkspaceTab[] = workspaceTabs.filter(
  (tab) => INTERNAL_TIA_SURFACE_ENABLED || tab !== "Delay Analysis - Time Impact Analysis"
);

function numberValue(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "N/A";
  return `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function metricSource(project: ProjectRecord, metric: string, fallback: string) {
  return project.metric_sources?.[metric]?.source || fallback;
}

function statusTone(value: number | null | undefined, target = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "neutral";
  if (value >= target) return "good";
  if (value >= target * 0.9) return "watch";
  return "critical";
}

function HoloKpi({
  title,
  value,
  note,
  tone = "neutral"
}: {
  title: string;
  value: string;
  note: string;
  tone?: "cyan" | "gold" | "blue" | "green" | "red" | "violet" | "neutral" | "good" | "watch" | "critical";
}) {
  return (
    <article className={`holo-kpi tone-${tone}`}>
      <div className="holo-kpi__signal" />
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function portfolioDecisionMermaid() {
  const projectCount = numberValue(portfolio.project_count);
  const sectorCount = numberValue(portfolio.sector_count);
  const decisionCount = numberValue(totals.decisions_required);
  const delayedCount = numberValue(totals.delayed_projects);
  const highRiskCount = numberValue(totals.high_risk_projects);
  const averageSpi = numberValue(totals.average_spi, 2);
  const averageCpi = numberValue(totals.average_cpi, 2);
  return `flowchart LR
    A["Project Folders\\n${projectCount} projects / ${sectorCount} sectors"] --> B["Generated Data Layer\\nPortfolio JSON + project JSON"]
    B --> C["Executive Controls\\nSPI ${averageSpi} / CPI ${averageCpi}"]
    B --> D["Risk and Delay Signals\\n${delayedCount} delayed / ${highRiskCount} high risk"]
    C --> E{"Management Decision Gate\\n${decisionCount} decisions required"}
    D --> E
    E --> F["Technical Knowledge Advisor\\nQuestion bank + portfolio evidence"]
    F --> G["Decision Brief\\nOwner / evidence / impact / deadline"]`;
}

function ProjectConsole({ selectedProject }: { selectedProject: ProjectRecord }) {
  return (
    <section className="project-console">
      <div className="console-head">
        <div>
          <p className="eyebrow">Active Project Digital Twin</p>
          <h2>{selectedProject.project_display_name}</h2>
          <span>{selectedProject.sector} / {selectedProject.status} / Last update: {selectedProject.last_updated || "N/A"}</span>
        </div>
        <b className={`decision-pill ${selectedProject.decision_required ? "critical" : "good"}`}>
          {selectedProject.decision_required ? "Decision Required" : "No Immediate Decision"}
        </b>
      </div>
      <div className="console-grid">
        <HoloKpi title="Contract Value" value={money(selectedProject.contract_value)} note="Selected project value" tone="gold" />
        <HoloKpi title="Actual Progress" value={percent(selectedProject.actual_progress)} note={`Planned ${percent(selectedProject.planned_progress)}`} tone="cyan" />
        <HoloKpi title="SPI" value={numberValue(selectedProject.spi, 2)} note="Schedule performance" tone={statusTone(selectedProject.spi) as "good" | "watch" | "critical" | "neutral"} />
        <HoloKpi title="CPI" value={numberValue(selectedProject.cpi, 2)} note="Cost performance" tone={statusTone(selectedProject.cpi) as "good" | "watch" | "critical" | "neutral"} />
        <HoloKpi title="Activities" value={numberValue(selectedProject.activity_count)} note="Activity records loaded" tone="blue" />
      </div>
    </section>
  );
}

function MiniMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function displayCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return numberValue(value, Number.isInteger(value) ? 0 : 2);
  return String(value);
}

function recordsToTable(file: string, rows: Array<Record<string, unknown>> | undefined): TablePreview {
  const safeRows = rows || [];
  const columns = Array.from(new Set(safeRows.flatMap((row) => Object.keys(row))));
  return {
    file,
    exists: true,
    row_count: safeRows.length,
    column_count: columns.length,
    columns,
    rows: safeRows.slice(0, 200),
    truncated: safeRows.length > 200,
    source_path: file
  };
}

function FeatureSvg({ mode }: { mode: "letters" | "delay" | "claims" | "watcher" | "portfolio" }) {
  const palette = {
    letters: ["#39d7d2", "#63a8ff", "#d6a23a"],
    delay: ["#d6a23a", "#fb7185", "#39d7d2"],
    claims: ["#a78bfa", "#d6a23a", "#63a8ff"],
    watcher: ["#4ade80", "#39d7d2", "#63a8ff"],
    portfolio: ["#39d7d2", "#d6a23a", "#a78bfa"]
  }[mode];
  return (
    <svg className="feature-svg" viewBox="0 0 520 220" role="img" aria-label={`${mode} feature diagram`}>
      <defs>
        <linearGradient id={`grad-${mode}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={palette[0]} />
          <stop offset="55%" stopColor={palette[1]} />
          <stop offset="100%" stopColor={palette[2]} />
        </linearGradient>
        <filter id={`soft-${mode}`}>
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="18" y="22" width="484" height="176" rx="28" fill="rgba(4,13,24,.72)" stroke={`url(#grad-${mode})`} />
      <path d="M60 150 C130 42 210 166 275 86 S390 56 455 118" fill="none" stroke={`url(#grad-${mode})`} strokeWidth="8" strokeLinecap="round" filter={`url(#soft-${mode})`} />
      {[70, 180, 290, 405].map((x, index) => (
        <g key={x}>
          <circle cx={x} cy={index % 2 ? 76 : 144} r="22" fill={palette[index % palette.length]} filter={`url(#soft-${mode})`} />
          <circle cx={x} cy={index % 2 ? 76 : 144} r="8" fill="#06101e" />
        </g>
      ))}
      <text x="44" y="58" fill="#f4fbff" fontSize="18" fontWeight="800">{mode.toUpperCase()}</text>
      <text x="44" y="180" fill="#9bb8ca" fontSize="13">Project-scoped data and analytics flow</text>
    </svg>
  );
}

function FileList({ title, files, emptyText = "No files detected" }: { title: string; files: FileRecord[]; emptyText?: string }) {
  return (
    <section className="feature-card">
      <div className="feature-card-head">
        <h3>{title}</h3>
        <span>{files.length} files</span>
      </div>
      {files.length === 0 ? (
        <p className="empty-note">{emptyText}</p>
      ) : (
        <div className="file-list">
          {files.slice(0, 14).map((file) => (
            <div key={file.relative_path}>
              <b>{file.name}</b>
              <span>{file.extension.toUpperCase()} / {numberValue(file.size_kb, 1)} KB / {file.modified}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TablePreviewPanel({ table, title }: { table: TablePreview | undefined; title?: string }) {
  if (!table || !table.exists) {
    return (
      <section className="feature-card">
        <div className="feature-card-head"><h3>{title || "Table Preview"}</h3><span>Missing</span></div>
        <p className="empty-note">No source table detected for this selected project.</p>
      </section>
    );
  }
  const columns = table.columns.slice(0, 8);
  return (
    <section className="feature-card table-preview-card">
      <div className="feature-card-head">
        <h3>{title || table.file}</h3>
        <span>{table.row_count} rows / {table.column_count} cols</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.slice(0, 6).map((row, index) => (
              <tr key={index}>
                {columns.map((column) => <td key={column}>{displayCell(row[column])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ProjectChartMode =
  | "overview"
  | "wbs"
  | "activities"
  | "milestones"
  | "s-curve"
  | "evm"
  | "analytics"
  | "contracts"
  | "letters"
  | "risks"
  | "claims"
  | "technical";

type ProjectChartPoint = {
  label: string;
  value: number | null | undefined;
  display: string;
  color: string;
};

type ReferenceChartType = "line" | "bar" | "horizontal_bar" | "doughnut" | "radar";
type ReferenceChartSpec = {
  id: string;
  title: string;
  type: ReferenceChartType;
  labels: string[];
  series: SourceChartSeries[];
  status?: string;
  note?: string;
  lineage?: string;
  size?: "small" | "medium" | "large";
};

function referenceChartTone(status?: string) {
  const normalized = (status || "info").toLowerCase();
  if (normalized.includes("critical") || normalized.includes("blocked")) return "critical";
  if (normalized.includes("warning") || normalized.includes("draft") || normalized.includes("partial")) return "warning";
  if (normalized.includes("ready") || normalized.includes("healthy") || normalized.includes("verified")) return "success";
  return "info";
}

function ReferenceChartCard({ chart }: { chart: ReferenceChartSpec }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    instanceRef.current?.destroy();
    const isDoughnut = chart.type === "doughnut";
    const isRadar = chart.type === "radar";
    const isHorizontal = chart.type === "horizontal_bar";
    const isLine = chart.type === "line";
    const palette = ["#06b6d4", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#3b82f6"];
    instanceRef.current = new Chart(canvas, {
      type: isDoughnut ? "doughnut" : isRadar ? "radar" : isLine ? "line" : "bar",
      data: {
        labels: chart.labels,
        datasets: chart.series.map((series, index) => ({
          label: series.label,
          data: series.values,
          borderColor: series.color || palette[index % palette.length],
          backgroundColor: isDoughnut ? chart.labels.map((_, item) => palette[item % palette.length]) : `${series.color || palette[index % palette.length]}${isLine ? "22" : "B8"}`,
          pointBackgroundColor: series.color || palette[index % palette.length],
          pointRadius: isLine ? 3 : 0,
          pointHoverRadius: 5,
          borderWidth: isLine || isRadar ? 2.5 : 0,
          tension: 0.35,
          fill: isLine ? false : isRadar,
          borderRadius: isDoughnut ? 0 : 6,
          maxBarThickness: 42,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        cutout: isDoughnut ? "68%" : undefined,
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: "#94a3b8", usePointStyle: true, pointStyle: "circle", padding: 14, font: { family: "Inter, Arial, sans-serif", size: 11, weight: 500 } } },
          tooltip: { backgroundColor: "rgba(15, 23, 42, 0.96)", titleColor: "#f1f5f9", bodyColor: "#cbd5e1", borderColor: "rgba(6, 182, 212, 0.28)", borderWidth: 1, padding: 11 },
        },
        scales: isDoughnut ? undefined : {
          x: { grid: { color: "rgba(148, 163, 184, 0.10)" }, ticks: { color: "#94a3b8", maxRotation: 34, font: { size: 10 } }, border: { color: "rgba(148, 163, 184, 0.12)" } },
          y: { grid: { color: "rgba(148, 163, 184, 0.10)" }, ticks: { color: "#94a3b8", font: { size: 10 } }, border: { color: "rgba(148, 163, 184, 0.12)" }, beginAtZero: true },
          r: { grid: { color: "rgba(148, 163, 184, 0.16)" }, angleLines: { color: "rgba(148, 163, 184, 0.16)" }, pointLabels: { color: "#94a3b8", font: { size: 10 } }, ticks: { display: false, backdropColor: "transparent" } },
        },
      },
    });
    return () => instanceRef.current?.destroy();
  }, [chart]);

  return (
    <section className={`reference-chart-card reference-chart-${chart.type}`} data-chart-id={chart.id}>
      <header className="reference-chart-header">
        <h3>{chart.title}</h3>
        <span className={`reference-chart-badge ${referenceChartTone(chart.status)}`}>{chart.status || "Source backed"}</span>
      </header>
      {chart.note ? <p className="reference-chart-note">{chart.note}</p> : null}
      <div className={`reference-chart-canvas ${chart.size || "medium"}`}><canvas ref={canvasRef} aria-label={chart.title} role="img" /></div>
      {chart.lineage ? <footer className="reference-chart-lineage">{chart.lineage}</footer> : null}
    </section>
  );
}

function compactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1_000_000_000) return `EGP ${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `EGP ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `EGP ${(value / 1_000).toFixed(1)}K`;
  return money(value);
}

function ProjectSmartChart({ project, mode }: { project: ProjectRecord; mode: ProjectChartMode }) {
  const claims = project.features.contract_claims;
  const pointsByMode: Record<ProjectChartMode, { title: string; note: string; points: ProjectChartPoint[] }> = {
    overview: {
      title: "Project Position",
      note: "Progress and earned-value indices from the selected project.",
      points: [
        { label: "Planned", value: project.planned_progress === null ? null : project.planned_progress * 100, display: percent(project.planned_progress), color: "#63a8ff" },
        { label: "Actual", value: project.actual_progress === null ? null : project.actual_progress * 100, display: percent(project.actual_progress), color: "#39d7d2" },
        { label: "SPI", value: project.spi === null ? null : project.spi * 100, display: numberValue(project.spi, 2), color: "#d6a23a" },
        { label: "CPI", value: project.cpi === null ? null : project.cpi * 100, display: numberValue(project.cpi, 2), color: "#a78bfa" }
      ]
    },
    wbs: {
      title: "Work Breakdown Coverage",
      note: "Record availability in the selected project planning structure.",
      points: [
        { label: "WBS", value: project.features.overview.source_tables.wbs?.row_count, display: numberValue(project.features.overview.source_tables.wbs?.row_count), color: "#63a8ff" },
        { label: "Activities", value: project.activity_count, display: numberValue(project.activity_count), color: "#39d7d2" },
        { label: "Milestones", value: project.milestone_count, display: numberValue(project.milestone_count), color: "#d6a23a" },
        { label: "Progress rows", value: project.source_files.progress, display: numberValue(project.source_files.progress), color: "#a78bfa" }
      ]
    },
    activities: {
      title: "Activity Control Signals",
      note: "Selected-project schedule and control record counts.",
      points: [
        { label: "Activities", value: project.activity_count, display: numberValue(project.activity_count), color: "#39d7d2" },
        { label: "Progress", value: project.source_files.progress, display: numberValue(project.source_files.progress), color: "#63a8ff" },
        { label: "EVM", value: project.source_files.evm, display: numberValue(project.source_files.evm), color: "#d6a23a" },
        { label: "Delay events", value: project.source_files.delay_events, display: numberValue(project.source_files.delay_events), color: "#fb7185" }
      ]
    },
    milestones: {
      title: "Milestone Delivery Position",
      note: "Progress and schedule performance for the selected project.",
      points: [
        { label: "Planned", value: project.planned_progress === null ? null : project.planned_progress * 100, display: percent(project.planned_progress), color: "#63a8ff" },
        { label: "Actual", value: project.actual_progress === null ? null : project.actual_progress * 100, display: percent(project.actual_progress), color: "#39d7d2" },
        { label: "SPI", value: project.spi === null ? null : project.spi * 100, display: numberValue(project.spi, 2), color: "#d6a23a" },
        { label: "Milestones", value: project.milestone_count, display: numberValue(project.milestone_count), color: "#a78bfa" }
      ]
    },
    "s-curve": {
      title: "Progress Position",
      note: "This compares the currently available planned and actual progress values; it is not a reconstructed time-series curve.",
      points: [
        { label: "Planned", value: project.planned_progress === null ? null : project.planned_progress * 100, display: percent(project.planned_progress), color: "#63a8ff" },
        { label: "Actual", value: project.actual_progress === null ? null : project.actual_progress * 100, display: percent(project.actual_progress), color: "#39d7d2" },
        { label: "Variance", value: project.progress_variance === null ? null : Math.abs(project.progress_variance) * 100, display: percent(project.progress_variance), color: "#d6a23a" }
      ]
    },
    evm: {
      title: "Earned Value Position",
      note: "BAC, PV, EV, and AC from the selected-project control data.",
      points: [
        { label: "BAC", value: project.bac, display: compactCurrency(project.bac), color: "#63a8ff" },
        { label: "PV", value: project.pv, display: compactCurrency(project.pv), color: "#d6a23a" },
        { label: "EV", value: project.ev, display: compactCurrency(project.ev), color: "#39d7d2" },
        { label: "AC", value: project.ac, display: compactCurrency(project.ac), color: "#fb7185" }
      ]
    },
    analytics: {
      title: "Analytics Health Indicators",
      note: "Progress and earned-value indicators from the selected project.",
      points: [
        { label: "Actual", value: project.actual_progress === null ? null : project.actual_progress * 100, display: percent(project.actual_progress), color: "#39d7d2" },
        { label: "SPI", value: project.spi === null ? null : project.spi * 100, display: numberValue(project.spi, 2), color: "#d6a23a" },
        { label: "CPI", value: project.cpi === null ? null : project.cpi * 100, display: numberValue(project.cpi, 2), color: "#63a8ff" },
        { label: "Risk score", value: project.risk_score, display: numberValue(project.risk_score, 1), color: "#a78bfa" }
      ]
    },
    contracts: {
      title: "Commercial Position",
      note: "Contract, paid, spent, and remaining values from the selected project.",
      points: [
        { label: "Contract", value: project.contract_value, display: compactCurrency(project.contract_value), color: "#63a8ff" },
        { label: "Paid", value: project.paid_amount, display: compactCurrency(project.paid_amount), color: "#39d7d2" },
        { label: "Spent", value: project.spent_amount, display: compactCurrency(project.spent_amount), color: "#fb7185" },
        { label: "Remaining", value: project.remaining_value, display: compactCurrency(project.remaining_value), color: "#d6a23a" }
      ]
    },
    letters: {
      title: "Correspondence Intelligence Coverage",
      note: "Counts are taken only from the selected project letter, claim, and delay registers.",
      points: [
        { label: "Inbox", value: project.features.letters_intelligence.inbox_file_count, display: numberValue(project.features.letters_intelligence.inbox_file_count), color: "#39d7d2" },
        { label: "Workbook sheets", value: project.features.letters_intelligence.workbook_tables?.sheets?.length, display: numberValue(project.features.letters_intelligence.workbook_tables?.sheets?.length), color: "#63a8ff" },
        { label: "Claims", value: project.source_files.claims, display: numberValue(project.source_files.claims), color: "#d6a23a" },
        { label: "Delay events", value: project.source_files.delay_events, display: numberValue(project.source_files.delay_events), color: "#fb7185" }
      ]
    },
    risks: {
      title: "Risk Exposure Signals",
      note: "Risk score and source-backed control record counts for the selected project.",
      points: [
        { label: "Risk score", value: project.risk_score, display: numberValue(project.risk_score, 1), color: "#fb7185" },
        { label: "Risk rows", value: project.risk_record_count ?? project.source_files.risks, display: numberValue(project.risk_record_count ?? project.source_files.risks), color: "#d6a23a" },
        { label: "Delay events", value: project.delay_event_count ?? project.source_files.delay_events, display: numberValue(project.delay_event_count ?? project.source_files.delay_events), color: "#a78bfa" },
        { label: "Claims", value: project.source_files.claims, display: numberValue(project.source_files.claims), color: "#63a8ff" }
      ]
    },
    claims: {
      title: "Contract & Claims Summary",
      note: "Contract, evidence, claim, and knowledge-base records from the selected project.",
      points: [
        { label: "Contract files", value: claims.source_files.length, display: numberValue(claims.source_files.length), color: "#63a8ff" },
        { label: "Evidence files", value: claims.evidence_files.length, display: numberValue(claims.evidence_files.length), color: "#39d7d2" },
        { label: "Claims", value: project.source_files.claims, display: numberValue(project.source_files.claims), color: "#d6a23a" },
        { label: "Knowledge", value: Object.keys(claims.knowledge_base?.tables || {}).length, display: numberValue(Object.keys(claims.knowledge_base?.tables || {}).length), color: "#a78bfa" }
      ]
    },
    technical: {
      title: "Technical Advisory Context",
      note: "Source-backed project information available to the Technical Advisor.",
      points: [
        { label: "Activities", value: project.activity_count, display: numberValue(project.activity_count), color: "#39d7d2" },
        { label: "Risks", value: project.risk_record_count ?? project.source_files.risks, display: numberValue(project.risk_record_count ?? project.source_files.risks), color: "#fb7185" },
        { label: "Delays", value: project.delay_event_count ?? project.source_files.delay_events, display: numberValue(project.delay_event_count ?? project.source_files.delay_events), color: "#d6a23a" },
        { label: "Letters", value: project.features.letters_intelligence.inbox_file_count, display: numberValue(project.features.letters_intelligence.inbox_file_count), color: "#63a8ff" }
      ]
    }
  };
  const chart = pointsByMode[mode];
  const visiblePoints = chart.points.filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(point.value));
  if (!visiblePoints.length) return null;
  const chartTypes: Record<ProjectChartMode, ReferenceChartType> = {
    overview: "line", wbs: "bar", activities: "doughnut", milestones: "line", "s-curve": "line", evm: "bar",
    analytics: "radar", contracts: "bar", letters: "bar", risks: "doughnut", claims: "horizontal_bar", technical: "bar",
  };
  return <ReferenceChartCard chart={{
    id: `project.${mode}`,
    title: chart.title,
    type: chartTypes[mode],
    labels: visiblePoints.map((point) => point.label),
    series: [{ label: "Selected project", color: "#06b6d4", values: visiblePoints.map((point) => Number(point.value)) }],
    status: "Source backed",
    note: chart.note,
    lineage: `Selected project only | ${project.project_id}`,
    size: mode === "overview" || mode === "s-curve" || mode === "evm" ? "large" : "medium",
  }} />;
}

function sourceChartNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function sourceChartValue(chart: SourceChartPayload, value: number | null | undefined) {
  const numeric = sourceChartNumber(value);
  if (numeric === null) return "N/A";
  if (chart.id === "contracts.planned_vs_actual_cash_flow") return compactCurrency(numeric);
  if (chart.id === "delay.tia_recovery_scenario") return `${numeric.toFixed(1)}%`;
  return `${numberValue(numeric, 1)} days`;
}

function SourceChartCard({ chart, project }: { chart: SourceChartPayload; project: ProjectRecord }) {
  if (!chart.labels.length || !chart.series.length) {
    return (
      <section className="reference-chart-card chart-readiness-card">
        <header className="reference-chart-header">
          <h3>{chart.title}</h3>
          <span className={`reference-chart-badge ${referenceChartTone(chart.status)}`}>{chart.status.replaceAll("_", " ")}</span>
        </header>
        <div className="chart-readiness-content">
          <strong>Chart readiness</strong>
          <p>{chart.message}</p>
          <span>Required source: {chart.source_lineage.files.join(" or ")}</span>
        </div>
        <footer className="reference-chart-lineage">Project ID: {project.project_id}</footer>
      </section>
    );
  }
  const referenceType: ReferenceChartType = chart.type === "grouped_bar" ? "bar" : chart.type;
  return <ReferenceChartCard chart={{
    id: chart.id,
    title: chart.title,
    type: referenceType,
    labels: chart.labels,
    series: chart.series,
    status: chart.status,
    note: chart.message,
    lineage: `Source: ${chart.source_lineage.files.join(" + ")} | Project ID: ${project.project_id}`,
    size: chart.type === "line" ? "large" : "medium",
  }} />;
  /* Legacy SVG implementation kept unreachable temporarily to avoid changing chart payload behaviour while the Chart.js reference component is verified. */
  const values = chart.series.flatMap((series) => series.values.map(sourceChartNumber).filter((value): value is number => value !== null));
  const maxValue = Math.max(...values.map((value) => Math.abs(value)), 1);
  const primarySeries = chart.series[0];
  const doughnutValues = primarySeries?.values.map(sourceChartNumber) || [];
  const doughnutTotal = doughnutValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const doughnutColors = ["#a78bfa", "#39d7d2", "#63a8ff", "#d6a23a", "#fb7185"];
  let doughnutCursor = 0;
  const doughnutStops = doughnutValues.map((value, index) => {
    const start = doughnutCursor;
    doughnutCursor += doughnutTotal ? ((value || 0) / doughnutTotal) * 100 : 0;
    const color = doughnutColors[index % doughnutColors.length];
    return `${color} ${start}% ${doughnutCursor}%`;
  });
  const lineHeight = 142;
  const lineWidth = 620;
  const linePoints = (series: SourceChartSeries) => series.values
    .map((value, index) => {
      const numeric = sourceChartNumber(value);
      if (numeric === null) return null;
      const x = 36 + (index * (lineWidth - 72)) / Math.max(1, chart.labels.length - 1);
      const y = 22 + lineHeight - (Math.max(0, numeric) / maxValue) * lineHeight;
      return `${x},${y}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <section className="feature-card source-chart-card">
      <div className="feature-card-head"><h3>{chart.title}</h3></div>
      {chart.type === "doughnut" ? (
        <div className="source-chart-doughnut-layout">
          <div className="source-chart-doughnut" style={{ background: `conic-gradient(${doughnutStops.join(", ") || "#334155 0 100%"})` }}>
            <div><strong>{numberValue(doughnutTotal, 1)}</strong><span>days</span></div>
          </div>
          <div className="source-chart-legend">
            {chart.labels.map((label, index) => <div key={label}><span style={{ background: doughnutColors[index % doughnutColors.length] }} />{label}<b>{sourceChartValue(chart, chart.series[0]?.values[index])}</b></div>)}
          </div>
        </div>
      ) : chart.type === "line" ? (
        <div className="source-chart-line-wrap">
          <svg viewBox={`0 0 ${lineWidth} 220`} role="img" aria-label={`${chart.title} for ${project.project_display_name}`}>
            {[0, 1, 2, 3].map((line) => <line key={line} x1="30" y1={22 + line * (lineHeight / 3)} x2={lineWidth - 24} y2={22 + line * (lineHeight / 3)} className="project-chart-gridline" />)}
            {chart.series.map((series) => <polyline key={series.label} fill="none" stroke={series.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={linePoints(series)} />)}
            {chart.labels.map((label, index) => <text key={label} x={36 + (index * (lineWidth - 72)) / Math.max(1, chart.labels.length - 1)} y="194" textAnchor="middle" className="project-chart-label">{label}</text>)}
          </svg>
          <div className="source-chart-series">{chart.series.map((series) => <span key={series.label}><i style={{ background: series.color }} />{series.label}</span>)}</div>
        </div>
      ) : (
        <div className="source-chart-bars">
          {chart.labels.map((label, index) => (
            <div className="source-chart-bar-row" key={label}>
              <div className="source-chart-bar-label">{label}</div>
              <div className="source-chart-bar-tracks">
                {chart.series.map((series) => {
                  const value = sourceChartNumber(series.values[index]);
                  return <div className="source-chart-bar-track" key={series.label}><span style={{ width: `${value === null ? 0 : Math.max(2, (Math.abs(value) / maxValue) * 100)}%`, background: series.color }} /><b>{sourceChartValue(chart, value)}</b></div>;
                })}
              </div>
            </div>
          ))}
          <div className="source-chart-series">{chart.series.map((series) => <span key={series.label}><i style={{ background: series.color }} />{series.label}</span>)}</div>
        </div>
      )}
      <footer className="source-chart-lineage">Source: {chart.source_lineage.files.join(" + ")} | Project ID: {project.project_id}</footer>
    </section>
  );
}

function ProjectSourceChartGrid({ project, tab }: { project: ProjectRecord; tab: string }) {
  const payload = project.chart_payloads;
  if (!payload || payload.project_id !== project.project_id || payload.project_key !== project.project_key) {
    return null;
  }
  const tabCharts = payload.charts.filter((chart) => chart.tab === tab);
  if (!tabCharts.length) return null;
  return <div className="feature-stack source-chart-stack"><div className="source-chart-grid">{tabCharts.map((chart) => <SourceChartCard key={chart.id} chart={chart} project={project} />)}</div></div>;
}

function reportHtml(project: ProjectRecord, reportKey: ReportKey) {
  return project.report_artifacts?.[reportKey]?.html || project.reports[reportKey];
}

function ReportFormatDownloads({ project, reportKey }: { project: ProjectRecord; reportKey: ReportKey }) {
  const artifact = project.report_artifacts?.[reportKey];
  const formats = artifact
    ? ([
        ["HTML", artifact.html, "text/html"],
        ["PDF", artifact.pdf, "application/pdf"],
        ["PowerPoint", artifact.pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ] as const)
    : ([ ["HTML", project.reports[reportKey], "text/html"] ] as const);
  return (
    <div className="report-format-downloads" aria-label="Direct report downloads">
      {formats.map(([label, href]) => (
        <a key={label} href={href} download={href.split("/").pop()} rel="noopener">
          {label}
        </a>
      ))}
    </div>
  );
}

function GovernedTiaReportDownloads({ project }: { project: ProjectRecord }) {
  const artifact = project.report_artifacts?.tia_governed_assessment;
  if (!artifact?.html) return null;
  const formats: Array<[string, string | undefined, string]> = [
    ["HTML", artifact.html, "text/html"],
    ["PDF", artifact.pdf, "application/pdf"],
    ["PowerPoint", artifact.pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["Word", artifact.docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ];
  const availableFormats = formats.filter((item): item is [string, string, string] => typeof item[1] === "string" && item[1].length > 0);
  return (
    <section className="feature-card output-studio-tia-report">
      <div className="feature-card-head">
        <div>
          <h3>Governed Delay Analysis - Time Impact Analysis Assessment</h3>
          <small>Native XER source pairs, fragnets, relationships, evidence gaps, and reconciliation controls.</small>
        </div>
        <span>{artifact.assessment_status?.replaceAll("_", " ") || "Project scoped"}</span>
      </div>
      <p>
        Schedule movements are indicative only. This report does not present a final EOT, compensation, or entitlement conclusion without validated P6, concurrency, and contractual evidence.
      </p>
      <div className="report-format-downloads" aria-label="Governed Delay TIA report downloads">
        {availableFormats.map(([label, href]) => (
          <a key={label} href={href} download={href.split("/").pop()} rel="noopener">
            {label}
          </a>
        ))}
      </div>
    </section>
  );
}

function downloadTableCsv(table: TablePreview, name: string) {
  const headers = table.columns;
  const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escapeCsv).join(","), ...table.rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.endsWith(".csv") ? name : `${name}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProjectDataTable({
  table,
  title,
  fileName,
  empty = "No project data is available for this view."
}: {
  table: TablePreview | undefined;
  title: string;
  fileName?: string;
  empty?: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const rows = table?.rows ?? EMPTY_TABLE_ROWS;
  const columns = table?.columns ?? EMPTY_TABLE_COLUMNS;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = useMemo(
    () => normalizedQuery
      ? rows.filter((row) => columns.some((column) => String(row[column] ?? "").toLowerCase().includes(normalizedQuery)))
      : rows,
    [columns, normalizedQuery, rows]
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const displayRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  if (!table || !table.exists) {
    return <TablePreviewPanel table={table} title={title} />;
  }

  return (
    <section className="feature-card project-data-table">
      <div className="feature-card-head">
        <div><h3>{title}</h3><small>{table.file} / {table.row_count} rows / {table.column_count} columns</small></div>
        <div className="data-table-actions">
          <button type="button" onClick={() => downloadTableCsv(table, fileName || table.file)}>Download CSV</button>
        </div>
      </div>
      <div className="data-table-toolbar">
        <input
          aria-label={`Search ${title}`}
          placeholder="Search this project data"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
        />
        <span>{filteredRows.length} matching rows{table.truncated ? " / safety cap applied" : ""}</span>
      </div>
      {displayRows.length && columns.length ? (
        <div className="table-scroll project-data-table-scroll">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{displayRows.map((row, index) => <tr key={safePage * pageSize + index}>{columns.map((column) => <td key={column}>{displayCell(row[column])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <p className="empty-note">{empty}</p>}
      {filteredRows.length > pageSize ? (
        <div className="data-table-pagination">
          <button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
          <span>Page {safePage + 1} of {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button>
        </div>
      ) : null}
    </section>
  );
}

function ProjectTableSelector({
  title,
  tables,
  preferred = []
}: {
  title: string;
  tables: Record<string, TablePreview>;
  preferred?: string[];
}) {
  const names = Object.keys(tables);
  const initial = preferred.find((name) => names.includes(name)) || names[0] || "";
  const [selectedName, setSelectedName] = useState(initial);
  const table = tables[selectedName] || tables[names[0]];
  return (
    <div className="feature-stack">
      <div className="subview-select-row">
        <label>{title}<select value={selectedName} onChange={(event) => setSelectedName(event.target.value)}>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
      </div>
      <ProjectDataTable table={table} title={selectedName || title} />
    </div>
  );
}

function WorkbookDataPanel({ workbook, title, preferred = [] }: { workbook: XlsxSummary | undefined; title: string; preferred?: string[] }) {
  const sheets = workbook?.sheets || [];
  const tableMap = Object.fromEntries(sheets.map((sheet) => [sheet.name, {
    file: `${workbook?.file || title} / ${sheet.name}`,
    exists: Boolean(workbook?.exists),
    row_count: sheet.row_count,
    column_count: sheet.column_count,
    columns: sheet.columns,
    rows: sheet.rows,
    truncated: sheet.truncated,
  }]));
  if (!sheets.length) {
    return <section className="feature-card"><div className="feature-card-head"><h3>{title}</h3><span>Missing</span></div><p className="empty-note">No workbook records are available for this selected project.</p></section>;
  }
  return <ProjectTableSelector title={title} tables={tableMap} preferred={preferred} />;
}

function ModuleTabs({
  label,
  tabs,
  activeTab,
  onChange
}: {
  label: string;
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
}) {
  return (
    <nav className="module-tabs" aria-label={label}>
      {tabs.map((tab) => <button type="button" className={tab === activeTab ? "active" : ""} onClick={() => onChange(tab)} key={tab}>{tab}</button>)}
    </nav>
  );
}

function ObjectTable({
  rows,
  title,
  empty = "No submitted TIA records detected."
}: {
  rows: Record<string, unknown>[] | undefined;
  title: string;
  empty?: string;
}) {
  const visibleRows = rows || [];
  const columns = Array.from(new Set(visibleRows.flatMap((row) => Object.keys(row)))).slice(0, 8);
  return (
    <section className="feature-card table-preview-card">
      <div className="feature-card-head"><h3>{title}</h3><span>{visibleRows.length} rows</span></div>
      {visibleRows.length && columns.length ? (
        <div className="table-scroll">
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {visibleRows.slice(0, 10).map((row, index) => (
                <tr key={index}>{columns.map((column) => <td key={column}>{displayCell(row[column])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty-note">{empty}</p>}
    </section>
  );
}

function SubmittedTiaGuidePanel({ submitted }: { submitted: SubmittedTiaPayload }) {
  if (!submitted.available) {
    return (
      <section className="feature-card submitted-tia-empty">
        <div className="feature-card-head"><h3>Submitted TIA Logic</h3><span>Generic mode</span></div>
        <p>{submitted.scope_note}</p>
      </section>
    );
  }

  return (
    <div className="submitted-tia-stack">
      <section className="feature-card submitted-tia-principle">
        <div className="feature-card-head"><h3>Submitted TIA Governance Principle</h3><span>{submitted.status}</span></div>
        <p>{submitted.governance_principle}</p>
        <small>{submitted.scope_note}</small>
      </section>
      <section className="feature-card">
        <div className="feature-card-head"><h3>Mandatory Decision Gates</h3><span>{submitted.decision_gates?.length || 0}</span></div>
        <div className="tia-gate-grid">
          {(submitted.decision_gates || []).map((gate, index) => (
            <div key={gate}><b>{index + 1}</b><span>{gate}</span></div>
          ))}
        </div>
      </section>
      <ObjectTable rows={submitted.submitted_results} title="Submitted Event Results" />
      <ObjectTable rows={submitted.level4_reconciliation} title="Level 4 Reconciliation" />
      <ObjectTable rows={submitted.fragnet_comparison} title="Before / After Fragnet Comparison" />
      <div className="workspace-two">
        <section className="feature-card warning-card">
          <div className="feature-card-head"><h3>Model Integrity Warnings</h3><span>{submitted.model_integrity_warnings?.length || 0}</span></div>
          <ul className="compact-list">{(submitted.model_integrity_warnings || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section className="feature-card warning-card">
          <div className="feature-card-head"><h3>Evidence Gaps</h3><span>{submitted.evidence_gaps?.length || 0}</span></div>
          <ul className="compact-list">{(submitted.evidence_gaps || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>
      <ObjectTable rows={submitted.evidence_status_controls} title="Evidence Status Controls" />
      <ObjectTable rows={submitted.event_register} title="Contractual Event Register" />
      <section className="feature-card">
        <div className="feature-card-head"><h3>Event Packages</h3><span>{submitted.event_folders?.length || 0}</span></div>
        <div className="tia-event-grid">
          {(submitted.event_folders || []).map((folder) => (
            <article key={folder.name}>
              <h4>{folder.name}</h4>
              <span>{folder.file_count} files</span>
              <small>{folder.xer_count} XER / {folder.pdf_count} PDF / {folder.xlsx_count} XLSX</small>
            </article>
          ))}
        </div>
      </section>
      <section className="feature-card">
        <div className="feature-card-head"><h3>Recommended Engineer Next Moves</h3><span>{submitted.recommended_next_moves?.length || 0}</span></div>
        <ol className="compact-list">{(submitted.recommended_next_moves || []).map((item) => <li key={item}>{item}</li>)}</ol>
      </section>
    </div>
  );
}

function SubmittedTiaVisualsPanel({ submitted }: { submitted?: SubmittedTiaVisualPayload }) {
  const [category, setCategory] = useState("");
  const visuals = submitted?.visuals || [];
  const categories = Array.from(new Set(visuals.map((visual) => visual.category)));
  const activeCategory = categories.includes(category) ? category : categories[0];
  const visibleVisuals = visuals.filter((visual) => visual.category === activeCategory);
  if (!submitted?.available || !visuals.length) return null;
  return (
    <section className="feature-card submitted-tia-exhibits">
      <div className="feature-card-head"><h3>Submitted TIA Exhibit Visuals</h3><span>{visuals.length} source figures</span></div>
      <p>{submitted.evidentiary_note}</p>
      {categories.length > 1 ? <ModuleTabs label="Submitted TIA exhibit categories" tabs={categories} activeTab={activeCategory} onChange={setCategory} /> : null}
      <div className="tia-visual-grid">
        {visibleVisuals.map((visual) => (
          <figure key={visual.url}>
            <Image src={visual.url} alt={visual.label} width={1280} height={720} sizes="(max-width: 760px) 92vw, (max-width: 1240px) 45vw, 30vw" />
            <figcaption>{visual.label}</figcaption>
          </figure>
        ))}
      </div>
      <small className="submitted-tia-exhibits__scope">{submitted.scope_note}</small>
    </section>
  );
}

function selectedProjectTables(project: ProjectRecord) {
  return project.features.overview.workspace_tables || project.features.overview.source_tables;
}

function LettersIntelligencePanel({ project }: { project: ProjectRecord }) {
  const [view, setView] = useState("Inbox & Auto Ingest");
  const letters = project.features.letters_intelligence;
  const sheets = letters.workbook_tables?.sheets || [];
  const matchingSheets = (terms: string[]) => sheets.filter((sheet) => terms.some((term) => sheet.name.toLowerCase().includes(term)));
  const selectedWorkbook = { ...letters.workbook_tables, sheets: view === "Issue Threads" ? matchingSheets(["thread", "alert"]) : view === "Linked Correspondence" ? matchingSheets(["link", "relationship"]) : matchingSheets(["contractor", "consultant", "ace", "samco", "letter"]) } as XlsxSummary;
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <section className="feature-card">
          <div className="feature-card-head"><h3>Letters Intelligence</h3><span>Selected project only</span></div>
          <p>Correspondence is classified from the selected project&apos;s inbox and workbook. New files are collected by the local pipeline, then published to Vercel through the generated project JSON.</p>
          <div className="workspace-grid compact-grid">
            <MiniMetric label="Inbox Files" value={numberValue(letters.inbox_file_count)} note="Recognized project letters" />
            <MiniMetric label="Claims Rows" value={numberValue(project.source_files.claims)} note="Project claims register" />
            <MiniMetric label="Delay Events" value={numberValue(project.source_files.delay_events)} note="Project delay register" />
          </div>
        </section>
        <FeatureSvg mode="letters" />
      </div>
      <ProjectSmartChart project={project} mode="letters" />
      <ModuleTabs label="Letters Intelligence views" tabs={["Inbox & Auto Ingest", "Letter Registers", "Issue Threads", "Linked Correspondence", "AI Letter Review"]} activeTab={view} onChange={setView} />
      {view === "Inbox & Auto Ingest" ? <FileList title="Automatic Letter Inbox" files={letters.inbox_files} emptyText="No correspondence files were detected in this project inbox." /> : null}
      {view === "Letter Registers" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Letters Registers" preferred={["From Contractor", "From Consultant", "ACE", "SAMCO"]} /> : null}
      {view === "Issue Threads" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Issue Threads & Alerts" preferred={["Issue Threads", "Alerts"]} /> : null}
      {view === "Linked Correspondence" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Linked Correspondence Engine" preferred={["Contractor Links", "Consultant Links"]} /> : null}
      {view === "AI Letter Review" ? <div className="feature-stack"><AiInsightCard type="letters" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /></div> : null}
    </div>
  );
}

function ControlledTiaChartGrid({
  charts,
  view
}: {
  charts: NonNullable<FeaturePayload["delay_analysis"]["controlled_tia"]["charts"]> | undefined;
  view: string;
}) {
  const visibleCharts = (charts || []).filter((chart) => chart.view === view);
  if (!visibleCharts.length) {
    return (
      <section className="feature-card">
        <div className="feature-card-head"><h3>Chart Readiness</h3><span>Awaiting project evidence</span></div>
        <p>No source-backed chart is available for this controlled TIA view. The application does not substitute zero values, sample curves, or another project&apos;s data.</p>
      </section>
    );
  }
  return <div className="reference-chart-grid">{visibleCharts.map((chart) => <ReferenceChartCard key={chart.id} chart={chart} />)}</div>;
}

function DelayTiaParityPanel({ project }: { project: ProjectRecord }) {
  const [view, setView] = useState("Source Integrity");
  const delay = project.features.delay_analysis;
  const run = delay.controlled_tia;
  const integrity = run.source_integrity || {};
  const schedule = run.schedule_cpm || {};
  const events = run.events_and_fragnets || {};
  const concurrency = run.concurrency_and_entitlement || {};
  const eot = run.eot_position || {};
  const sourceTables = {
    "Approved Release Files": recordsToTable("Approved Release Files", integrity.files),
    "Archive Evidence Inventory": recordsToTable("Archive Evidence Inventory", integrity.inventory),
    "Approved Before / After Matrix": recordsToTable("Approved Before / After Matrix", schedule.approved_matrix),
    "Native XER Pair Register": recordsToTable("Native XER Pair Register", schedule.xer_pairs),
    "Relationship and Lag Evidence": recordsToTable("Relationship and Lag Evidence", schedule.relationship_evidence),
    "Event and Fragnet Register": recordsToTable("Event and Fragnet Register", events.events),
    "Concurrency Event Position": recordsToTable("Concurrency Event Position", concurrency.event_positions),
    "Entitlement and Evidence Matrix": recordsToTable("Entitlement and Evidence Matrix", concurrency.evidence_matrix),
    "Reconciliation Register": recordsToTable("Reconciliation Register", run.reconciliation_items),
    "Evidence Gaps": recordsToTable("Evidence Gaps", (run.missing_evidence || []).map((item) => ({ missing_evidence: item })))
  };
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <section className="feature-card">
          <div className="feature-card-head"><div><h3>Delay Analysis - Time Impact Analysis</h3><small>Controlled run for the selected project only. Historic generic TIA inputs are excluded.</small></div><span>{run.status.replaceAll("_", " ")}</span></div>
          <div className="workspace-grid compact-grid">
            <MiniMetric label="Controlled Status" value={run.status.replaceAll("_", " ")} note={run.message} />
            <MiniMetric label="Approval" value={run.approval_status.replaceAll("_", " ")} note="Manual approval is required for publication" />
            <MiniMetric label="Submitted EOT" value={eot.integrated_eot_calendar_days === undefined ? "N/A" : `${numberValue(eot.integrated_eot_calendar_days)} days`} note="Indicative - P6 verification required" />
            <MiniMetric label="Concurrency Adjustment" value={concurrency.concurrency_adjustment_days === undefined ? "N/A" : `${numberValue(concurrency.concurrency_adjustment_days)} days`} note="Submitted reconciliation only" />
          </div>
        </section>
        <section className="feature-card"><div className="feature-card-head"><h3>Evidence Boundary</h3><span>project_id enforced</span></div><p>Only this project&apos;s approved release, XER pairs, relationships, evidence references, controlled run, and project-scoped AI context are available. Another project&apos;s source package is never used as a fallback.</p></section>
      </div>
      <ModuleTabs label="Controlled TIA workflow" tabs={run.workflow_tabs} activeTab={view} onChange={setView} />
      {view === "Source Integrity" ? <div className="feature-stack"><ControlledTiaChartGrid charts={run.charts} view={view} /><section className="feature-card"><div className="feature-card-head"><h3>Controlled Archive</h3><span>{displayCell(integrity.archive?.integrity)}</span></div><p>{displayCell(integrity.archive?.message)}</p></section><ProjectTableSelector title="Approved Source Integrity" tables={sourceTables} preferred={["Approved Release Files", "Archive Evidence Inventory", "Evidence Gaps"]} /></div> : null}
      {view === "Schedule and CPM" ? <div className="feature-stack"><ControlledTiaChartGrid charts={run.charts} view={view} /><section className="feature-card"><div className="feature-card-head"><h3>Schedule and CPM Controls</h3><span>{displayCell(schedule.status)}</span></div><ul>{(schedule.cpm_controls || []).map((control) => <li key={control}>{control}</li>)}</ul></section><ProjectTableSelector title="Approved Matrix, Native XER, and CPM Evidence" tables={sourceTables} preferred={["Approved Before / After Matrix", "Native XER Pair Register", "Relationship and Lag Evidence"]} /></div> : null}
      {view === "Events and Fragnets" ? <div className="feature-stack"><ControlledTiaChartGrid charts={run.charts} view={view} /><section className="feature-card"><div className="feature-card-head"><h3>Event and Fragnet Controls</h3><span>{displayCell(events.status)}</span></div><ul>{(events.fragnet_controls || []).map((control) => <li key={control}>{control}</li>)}</ul></section><ProjectTableSelector title="Project Event and Fragnet Register" tables={sourceTables} preferred={["Event and Fragnet Register", "Approved Before / After Matrix"]} /></div> : null}
      {view === "Concurrency and Entitlement" ? <div className="feature-stack"><ControlledTiaChartGrid charts={run.charts} view={view} /><div className="workspace-grid compact-grid"><MiniMetric label="Gross Included Movement" value={concurrency.gross_included_event_movement_days === undefined ? "N/A" : `${numberValue(concurrency.gross_included_event_movement_days)} days`} note="EV01 Batch 02 plus EV02" /><MiniMetric label="Concurrency Adjustment" value={concurrency.concurrency_adjustment_days === undefined ? "N/A" : `${numberValue(concurrency.concurrency_adjustment_days)} days`} note="Submitted deduction" /><MiniMetric label="Integrated Submitted EOT" value={concurrency.integrated_eot_calendar_days === undefined ? "N/A" : `${numberValue(concurrency.integrated_eot_calendar_days)} days`} note="No automatic compensation conclusion" /></div><section className="feature-card"><div className="feature-card-head"><h3>Concurrency and Entitlement Controls</h3><span>{displayCell(concurrency.status)}</span></div><ul>{(concurrency.controls || []).map((control) => <li key={control}>{control}</li>)}</ul></section><ProjectTableSelector title="Concurrency and Entitlement Evidence" tables={sourceTables} preferred={["Concurrency Event Position", "Entitlement and Evidence Matrix", "Reconciliation Register"]} /></div> : null}
      {view === "EOT Position" ? <div className="feature-stack"><ControlledTiaChartGrid charts={run.charts} view={view} /><section className="feature-card"><div className="feature-card-head"><div><h3>{displayCell(eot.label)}</h3><small>{displayCell(eot.message)}</small></div><span>{displayCell(eot.status)}</span></div><div className="workspace-grid compact-grid"><MiniMetric label="EOT Milestone" value={displayCell(eot.project_finish_milestone_id)} note="Submitted EOT-driving project finish" /><MiniMetric label="Before Finish" value={displayCell(eot.baseline_project_finish)} note="Approved matrix" /><MiniMetric label="After Finish" value={displayCell(eot.impacted_project_finish)} note="Approved matrix" /><MiniMetric label="Integrated Position" value={eot.integrated_eot_calendar_days === undefined ? "N/A" : `${numberValue(eot.integrated_eot_calendar_days)} days`} note="Indicative - P6 verification required" /></div></section><ProjectTableSelector title="EOT Position and Publication Gates" tables={sourceTables} preferred={["Concurrency Event Position", "Reconciliation Register", "Evidence Gaps", "Native XER Pair Register"]} /></div> : null}
      {view === "AI Review and Run Control" ? <div className="feature-stack"><section className="feature-card"><div className="feature-card-head"><h3>AI Scope and Run Control</h3><span>{displayCell(run.ai_scope?.status)}</span></div><p>{displayCell(run.ai_scope?.message)}</p><p>Run ID: {displayCell(run.run_id)} | Last controlled draft: {displayCell(run.last_run_at)}</p></section><AiInsightCard type="delay" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /></div> : null}
    </div>
  );
}

function ContractClaimsParityPanel({ project }: { project: ProjectRecord }) {
  const [center, setCenter] = useState("Contract Clauses");
  const [view, setView] = useState("Contract Library");
  const claims = project.features.contract_claims;
  const knowledgeTables = claims.knowledge_base?.tables || {};
  const controlled = claims.controlled_assessment?.controls;
  const controlledTables = {
    "Project Clause Controls": recordsToTable("Project Clause Controls", controlled?.clause_controls),
    "Controlled Evidence Ledger": recordsToTable("Controlled Evidence Ledger", controlled?.evidence_ledger),
    "Contract Authority Register": recordsToTable("Contract Authority Register", controlled?.contract_authority_register)
  };
  const clauseTable = knowledgeTables.contract_clauses || knowledgeTables[Object.keys(knowledgeTables).find((name) => /clause/i.test(name)) || ""];
  const evidenceTables = Object.fromEntries(Object.entries(knowledgeTables).filter(([name]) => /evidence|document|mapping/i.test(name)));
  const claimTables = Object.fromEntries(Object.entries(knowledgeTables).filter(([name]) => /claim|trigger|defense|rebuttal|draft/i.test(name)));
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <section className="feature-card"><div className="feature-card-head"><h3>Contract & Claims Intelligence Center</h3></div><p>Contract clauses, evidence mappings, claim records, and AI analysis for the selected project.</p><div className="workspace-grid compact-grid"><MiniMetric label="Contract Files" value={numberValue(claims.source_files.length)} note="Contract source files" /><MiniMetric label="Evidence Files" value={numberValue(claims.evidence_files.length)} note="Evidence source files" /><MiniMetric label="Clauses" value={numberValue(controlled?.clause_control_count)} note="Clause records" /><MiniMetric label="Evidence Mappings" value={numberValue(controlled?.evidence_mapping_count)} note="Evidence ledger records" /></div></section>
        <FeatureSvg mode="claims" />
      </div>
      <ProjectSmartChart project={project} mode="claims" />
      <ModuleTabs label="Contract claims center" tabs={["Contract Clauses", "Claims Intelligence Center"]} activeTab={center} onChange={setCenter} />
      {center === "Contract Clauses" ? <div className="feature-stack"><ProjectDataTable table={clauseTable} title="Contract Clause Matching Engine" empty="No clause library is available for this selected project." /><ProjectTableSelector title="Clause Authority Register" tables={controlledTables} preferred={["Project Clause Controls", "Contract Authority Register"]} /><WorkbookDataPanel workbook={claims.clause_library_tables} title="Overall Contract Clause Library" /></div> : null}
      {center === "Claims Intelligence Center" ? <>
        <ModuleTabs label="Claims Intelligence views" tabs={["Upload & Extract", "Contract Library", "Ask Contract AI", "Evidence Mapping", "Client Rebuttal Engine", "Claim Builder", "Export Center"]} activeTab={view} onChange={setView} />
        {view === "Upload & Extract" ? <div className="workspace-two"><FileList title="Contract Source Repository" files={claims.source_files} /><FileList title="Project Evidence Repository" files={claims.evidence_files} /></div> : null}
        {view === "Contract Library" ? <div className="feature-stack"><ProjectDataTable table={clauseTable} title="Searchable Contract Claims Library" /><ProjectTableSelector title="Authority, Time-Bar, and Entitlement Controls" tables={controlledTables} preferred={["Project Clause Controls", "Contract Authority Register"]} /><WorkbookDataPanel workbook={claims.clause_library_tables} title="Contract Clause Library Workbook" /></div> : null}
        {view === "Ask Contract AI" ? <div className="feature-stack"><AiInsightCard type="contract" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /></div> : null}
        {view === "Evidence Mapping" ? <div className="feature-stack"><ProjectTableSelector title="Evidence Ledger" tables={controlledTables} preferred={["Controlled Evidence Ledger"]} /><ProjectTableSelector title="Evidence-to-Clause Mapping" tables={Object.keys(evidenceTables).length ? evidenceTables : knowledgeTables} preferred={["evidence_mappings", "evidence_documents"]} /><FileList title="Evidence Files" files={claims.evidence_files} /></div> : null}
        {view === "Client Rebuttal Engine" ? <div className="feature-stack"><AiInsightCard type="contract" projectKey={project.project_key} /><ProjectTableSelector title="Client Defenses and Contractor Rebuttals" tables={Object.keys(claimTables).length ? claimTables : knowledgeTables} preferred={["client_defenses", "contractor_rebuttals"]} /></div> : null}
        {view === "Claim Builder" ? <div className="feature-stack"><ProjectTableSelector title="Claim Categories, Triggers, and Drafts" tables={Object.keys(claimTables).length ? claimTables : knowledgeTables} preferred={["claim_categories", "claim_triggers", "claim_drafts"]} /><AiInsightCard type="contract" projectKey={project.project_key} /></div> : null}
        {view === "Export Center" ? <section className="feature-card"><div className="feature-card-head"><h3>Claim Source Controls</h3><span>Selected project only</span></div><p>Formal reports and files are intentionally available only in Output Studio. This view keeps the active project&apos;s clause, evidence, claim, and rebuttal source tables available for review.</p><ProjectTableSelector title="Claims Source Tables" tables={knowledgeTables} preferred={["contract_clauses", "evidence_mappings", "claim_categories", "claim_triggers"]} /></section> : null}
      </> : null}
    </div>
  );
}

function ConferencePanel({ project }: { project: ProjectRecord }) {
  const meetingUrl = project.meeting_url?.trim();
  const canEmbed = Boolean(meetingUrl && !meetingUrl.includes("teams.microsoft.com") && !meetingUrl.includes("zoom.us"));
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <div>
          <h3>Conference Call</h3>
          <p>
            Use this panel during review meetings while the project tabs remain available on the same page.
            The call link is project-specific and can be changed in the selected project `project.json`.
          </p>
        </div>
        <section className="conference-card">
          <FeatureSvg mode="watcher" />
          <div className="conference-actions">
            {meetingUrl ? (
              <a href={meetingUrl} target="_blank" rel="noreferrer">Join Conference</a>
            ) : (
              <span>Add `meeting_url` to this project&apos;s `project.json` to activate the join button.</span>
            )}
          </div>
        </section>
      </div>
      {meetingUrl && canEmbed ? (
        <>
          <iframe className="wide-embed conference-embed" src={meetingUrl} title={`${project.project_display_name} conference`} />
        </>
      ) : (
        <section className="feature-card">
          <div className="feature-card-head">
            <h3>Same-Page Meeting Setup</h3>
            <span>{meetingUrl ? "External Join" : "Not Configured"}</span>
          </div>
          <p>
            Teams and Zoom usually block iframe embedding for security, so the dashboard keeps the project visible
            and opens the meeting in a controlled new browser tab when required. Google Meet links may also require
            account permission before joining.
          </p>
        </section>
      )}
    </div>
  );
}

function WorkspaceTabContent({
  project,
  activeTab,
  selectedReport,
  setSelectedReport
}: {
  project: ProjectRecord;
  activeTab: WorkspaceTab;
  selectedReport: ReportKey;
  setSelectedReport: (key: ReportKey) => void;
}) {
  const workspaceTables = selectedProjectTables(project);
  if (activeTab === "Overview") {
    return (
      <div className="feature-stack">
        <AiInsightCard type="summary" projectKey={project.project_key} />
        <div className="workspace-grid">
          <MiniMetric label="Project" value={project.project_folder_name} note={project.project_display_name} />
          <MiniMetric label="Status" value={project.status} note={`${project.sector} sector`} />
          <MiniMetric label="Contract Value" value={money(project.contract_value)} note={metricSource(project, "contract_value", "Project source value")} />
          <MiniMetric label="Remaining Value" value={money(project.remaining_value)} note="Contract value less paid amount" />
          <MiniMetric label="Planned Progress" value={percent(project.planned_progress)} note={metricSource(project, "planned_progress", "Planned progress source")} />
          <MiniMetric label="Actual Progress" value={percent(project.actual_progress)} note={metricSource(project, "actual_progress", "Actual progress source")} />
          <MiniMetric label="Baseline Finish" value={project.planned_finish || "N/A"} note={`Forecast ${project.forecast_finish || "N/A"}`} />
        </div>
        <div className="workspace-two">
          <FeatureSvg mode="portfolio" />
          <ProjectDataTable table={workspaceTables.projects} title="Project Overview Source" />
        </div>
        <ProjectSourceChartGrid project={project} tab="Overview" />
      </div>
    );
  }

  if (activeTab === "WBS") {
    return (
      <div className="feature-stack">
        <div className="workspace-grid">
          <MiniMetric label="WBS Rows" value={numberValue(project.features.overview.source_tables.wbs?.row_count)} note="Work breakdown records" />
          <MiniMetric label="Activity Rows" value={numberValue(project.source_files.activities)} note="Activity records linked to WBS" />
          <MiniMetric label="Project Scope" value={project.sector} note="Sector-based project grouping" />
        </div>
        <div className="workspace-two">
          <ProjectDataTable table={workspaceTables.wbs} title="WBS Source Table" />
        </div>
        <ProjectSourceChartGrid project={project} tab="WBS" />
      </div>
    );
  }

  if (activeTab === "Activities") {
    return (
      <div className="feature-stack">
        <div className="workspace-grid">
          <MiniMetric label="Activities Loaded" value={numberValue(project.activity_count)} note="Activity source records" />
          <MiniMetric label="Progress Records" value={numberValue(project.source_files.progress)} note="Progress update rows" />
          <MiniMetric label="EVM Records" value={numberValue(project.source_files.evm)} note="Earned value rows" />
          <MiniMetric label="Delay Events" value={numberValue(project.source_files.delay_events)} note="Delay event records" />
        </div>
        <ProjectSourceChartGrid project={project} tab="Activities" />
        <ProjectDataTable table={workspaceTables.activities} title="Activities Register" />
      </div>
    );
  }

  if (activeTab === "Milestones") {
    return (
      <div className="feature-stack">
        <div className="workspace-grid">
          <MiniMetric label="Milestones" value={numberValue(project.milestone_count)} note="Milestone records loaded" />
          <MiniMetric label="Schedule Health" value={numberValue(project.spi, 2)} note="SPI schedule indicator" />
          <MiniMetric label="Delayed Days" value={numberValue(project.delay_days)} note="Delay days from project data" />
        </div>
        <ProjectSourceChartGrid project={project} tab="Milestones" />
        <ProjectDataTable table={workspaceTables.milestones} title="Milestone Register" />
      </div>
    );
  }

  if (activeTab === "S-Curve") {
    return (
      <div className="feature-stack">
        <ProjectSourceChartGrid project={project} tab="S-Curve" />
        <ProjectDataTable table={workspaceTables.s_curve} title="S-Curve Source" />
      </div>
    );
  }

  if (activeTab === "EVM Analysis") {
    return (
      <div className="feature-stack">
        <div className="workspace-grid">
          <MiniMetric label="BAC" value={money(project.bac)} note={metricSource(project, "bac", "Budget at completion")} />
          <MiniMetric label="PV" value={money(project.pv)} note={metricSource(project, "pv", "Planned value")} />
          <MiniMetric label="EV" value={money(project.ev)} note={metricSource(project, "ev", "Earned value")} />
          <MiniMetric label="AC" value={money(project.ac)} note={metricSource(project, "ac", "Actual cost")} />
          <MiniMetric label="SPI" value={numberValue(project.spi, 2)} note="EV / PV" />
          <MiniMetric label="CPI" value={numberValue(project.cpi, 2)} note="EV / AC" />
          <MiniMetric label="SV" value={money(project.sv)} note="EV less PV" />
          <MiniMetric label="CV" value={money(project.cv)} note="EV less AC" />
          <MiniMetric label="EAC" value={money(project.eac)} note="BAC / CPI" />
          <MiniMetric label="ETC" value={money(project.etc)} note="EAC less AC" />
          <MiniMetric label="VAC" value={money(project.vac)} note="BAC less EAC" />
        </div>
        <ProjectSourceChartGrid project={project} tab="EVM Analysis" />
        <ProjectDataTable table={workspaceTables.evm} title="EVM Source Table" />
      </div>
    );
  }

  if (activeTab === "Analytics Intelligence") {
    return <div className="feature-stack"><ProjectSmartChart project={project} mode="analytics" /><ProjectSourceChartGrid project={project} tab="Analytics Intelligence" /><AdvancedAnalyticsPanel analytics={project.advanced_analytics} /></div>;
  }

  if (activeTab === "Contracts") {
    return (
      <div className="feature-stack">
        <div className="workspace-grid">
          <MiniMetric label="Contract Value" value={money(project.contract_value)} note={metricSource(project, "contract_value", "Current contract value")} />
          <MiniMetric label="Paid Amount" value={money(project.paid_amount)} note={metricSource(project, "paid_amount", "Payment file amount")} />
          <MiniMetric label="Spent Amount" value={money(project.spent_amount)} note={metricSource(project, "spent_amount", "Actual cost")} />
          <MiniMetric label="Remaining" value={money(project.remaining_value)} note="Commercial balance" />
          <MiniMetric label="Contract Rows" value={numberValue(project.source_files.contracts)} note="Contract records" />
          <MiniMetric label="Payment Rows" value={numberValue(project.source_files.payments)} note="Payment records" />
        </div>
        <ProjectSourceChartGrid project={project} tab="Contracts" />
        <div className="workspace-two">
          <ProjectDataTable table={workspaceTables.contracts} title="Contracts Register" />
          <ProjectDataTable table={workspaceTables.payments} title="Payments Register" />
        </div>
      </div>
    );
  }

  if (activeTab === "Risks") {
    return (
      <div className="feature-stack">
        <AiInsightCard type="risk" projectKey={project.project_key} />
        <div className="workspace-grid">
          <MiniMetric label="Risk Score" value={numberValue(project.risk_score, 1)} note={metricSource(project, "risk_score", "Risk register indicator")} />
          <MiniMetric label="Risk Records" value={numberValue(project.risk_record_count ?? project.source_files.risks)} note="Risk rows loaded" />
          <MiniMetric label="Decision Required" value={project.decision_required ? "Yes" : "No"} note="Rule-based management trigger" />
          <MiniMetric label="Delay Days" value={numberValue(project.delay_days)} note="Delay exposure" />
        </div>
        <ProjectSourceChartGrid project={project} tab="Risks" />
        <ProjectDataTable table={workspaceTables.risks} title="Risk Register" />
      </div>
    );
  }

  if (activeTab === "Letters Intelligence") return <LettersIntelligencePanel project={project} />;

  if (INTERNAL_TIA_SURFACE_ENABLED && activeTab === "Delay Analysis - Time Impact Analysis") return <DelayTiaParityPanel project={project} />;

  if (activeTab === "Contract & Claims Intelligence Center") return <ContractClaimsParityPanel project={project} />;

  if (activeTab === "Technical Advisor") {
    return (
      <div className="feature-stack">
        <ProjectSmartChart project={project} mode="technical" />
        <UnifiedIntelligenceSearch
          mode="project"
          projectKey={project.project_key}
          projectName={project.project_display_name}
        />
        <TechnicalKnowledgeAdvisor
          mode="project"
          projectKey={project.project_key}
          projectName={project.project_display_name}
        />
        <ActionTracker scopeKey={`project:${project.project_key}`} />
      </div>
    );
  }

  if (activeTab === "Conference") {
    return <ConferencePanel project={project} />;
  }

  return (
    <section className="glass-panel report-hologram output-studio-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Output Studio</p>
          <h2>{project.project_display_name}</h2>
        </div>
        <span>Same-page generated outputs</span>
      </div>
      <div className="report-switcher">
        {reportTabs.map((tab) => (
          <button
            type="button"
            key={tab.key}
            className={tab.key === selectedReport ? "report-tab active" : "report-tab"}
            onClick={() => setSelectedReport(tab.key)}
          >
            <b>{tab.label}</b>
            <span>{tab.note}</span>
          </button>
        ))}
      </div>
      <OutputStudioDownloadButton
        href={reportHtml(project, selectedReport)}
        label={`Download ${reportTabs.find((tab) => tab.key === selectedReport)?.label || "Report"}`}
      />
      <ReportFormatDownloads project={project} reportKey={selectedReport} />
      {INTERNAL_TIA_SURFACE_ENABLED ? <GovernedTiaReportDownloads project={project} /> : null}
      <FileList title="Automatic Project Outputs" files={project.features.outputs_and_watchers.output_files} />
      <iframe src={reportHtml(project, selectedReport)} title={`${project.project_display_name} - ${selectedReport}`} />
    </section>
  );
}

function ProjectWorkspace({
  project,
  selectedReport,
  setSelectedReport
}: {
  project: ProjectRecord;
  selectedReport: ReportKey;
  setSelectedReport: (key: ReportKey) => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("Overview");
  return (
    <section className="project-workspace chart-reference-workspace">
      <ProjectConsole selectedProject={project} />
      <div className="section-header workspace-subhead">
        <div>
          <p className="eyebrow">Project Tabs</p>
          <h2>{project.project_display_name}</h2>
        </div>
        <span>{project.sector} / {project.project_folder_name}</span>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Project workspace tabs">
        {visibleWorkspaceTabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={tab === activeTab ? "workspace-tab active" : "workspace-tab"}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="workspace-content">
        <WorkspaceTabContent
          project={project}
          activeTab={activeTab}
          selectedReport={selectedReport}
          setSelectedReport={setSelectedReport}
        />
      </div>
    </section>
  );
}

type OperationsPanel = "portfolio" | "delivery" | "decisions" | "intelligence";

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value * 100));
}

function PortfolioVisuals({
  projects: visibleProjects,
  sectors: visibleSectors,
  panel
}: {
  projects: ProjectSummary[];
  sectors: SectorRecord[];
  panel: OperationsPanel;
}) {
  const chartProjects = visibleProjects.length ? visibleProjects : projects;
  const chartSectors = visibleSectors.length ? visibleSectors : sectors;
  const maxContract = Math.max(...chartSectors.map((sector) => sector.contract_value || 0), 1);
  const totalSectorValue = chartSectors.reduce((sum, sector) => sum + (sector.contract_value || 0), 0) || 1;

  if (panel === "portfolio") {
    return (
      <div className="operations-chart-grid">
        <section className="ops-chart-card">
          <div className="ops-chart-head"><div><span>Portfolio Composition</span><b>Sector allocation</b></div><small>{chartSectors.length} sectors</small></div>
          <div className="sector-composition">
            <div
              className="sector-donut"
              style={{
                background: `conic-gradient(${chartSectors.map((sector, index) => {
                  const colors = ["#39d7d2", "#63a8ff", "#d6a23a", "#a78bfa", "#4ade80"];
                  const start = chartSectors.slice(0, index).reduce((sum, item) => sum + ((item.contract_value || 0) / totalSectorValue) * 100, 0);
                  const finish = start + ((sector.contract_value || 0) / totalSectorValue) * 100;
                  return `${colors[index % colors.length]} ${start}% ${finish}%`;
                }).join(", ")})`
              }}
            >
              <div><b>{numberValue(chartProjects.length)}</b><span>projects</span></div>
            </div>
            <div className="chart-legend">
              {chartSectors.map((sector, index) => <span key={sector.sector}><i className={`legend-dot dot-${index % 5}`} />{sector.sector}<b>{numberValue((sector.contract_value / totalSectorValue) * 100, 0)}%</b></span>)}
            </div>
          </div>
        </section>
        <section className="ops-chart-card">
          <div className="ops-chart-head"><div><span>Project Signals</span><b>Delivery health</b></div><small>Actual versus planned</small></div>
          <div className="project-pulse-list">
            {chartProjects.map((project) => (
              <article key={project.project_key}>
                <div><span>{project.project_display_name}</span><b>{percent(project.actual_progress)}</b></div>
                <div className="pulse-track"><i className="pulse-plan" style={{ width: `${clampPercent(project.planned_progress)}%` }} /><i className="pulse-actual" style={{ width: `${clampPercent(project.actual_progress)}%` }} /></div>
                <small>Planned {percent(project.planned_progress)} | {project.status}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (panel === "delivery") {
    return (
      <div className="operations-chart-grid">
        <section className="ops-chart-card">
          <div className="ops-chart-head"><div><span>Contract Allocation</span><b>Value by sector</b></div><small>Source: portfolio JSON</small></div>
          <div className="value-bar-chart">
            {chartSectors.map((sector, index) => (
              <article key={sector.sector}>
                <div><span>{sector.sector}</span><b>{money(sector.contract_value)}</b></div>
                <div><i className={`bar-fill bar-${index % 5}`} style={{ width: `${Math.max(4, (sector.contract_value / maxContract) * 100)}%` }} /></div>
                <small>{numberValue(sector.project_count)} projects | paid {money(sector.paid_amount)}</small>
              </article>
            ))}
          </div>
        </section>
        <section className="ops-chart-card">
          <div className="ops-chart-head"><div><span>Schedule Position</span><b>SPI operating field</b></div><small>1.00 is plan</small></div>
          <svg className="operations-scatter" viewBox="0 0 640 330" role="img" aria-label="Project schedule performance chart">
            <line x1="72" y1="270" x2="600" y2="270" /><line x1="72" y1="62" x2="72" y2="270" />
            <line className="scatter-target" x1="72" y1="166" x2="600" y2="166" />
            <text x="10" y="74">Ahead</text><text x="10" y="274">Behind</text><text x="520" y="312">Actual progress</text>
            {chartProjects.map((project, index) => {
              const x = 102 + clampPercent(project.actual_progress) * 4.55;
              const spi = project.spi === null || project.spi === undefined || !Number.isFinite(project.spi) ? 0 : Math.min(1.5, Math.max(0, project.spi));
              const y = 270 - (spi / 1.5) * 188;
              const color = project.decision_required ? "#fb7185" : project.status === "Delayed" ? "#d6a23a" : "#39d7d2";
              return <g key={project.project_key}><circle cx={x} cy={y} r={13 + index * 2} fill={color} /><text x={x + 16} y={y + 4}>{project.project_folder_name}</text></g>;
            })}
          </svg>
          <p className="chart-note">Markers use the actual project SPI and reported actual progress.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="operations-chart-grid">
      <section className="ops-chart-card risk-grid-card">
        <div className="ops-chart-head"><div><span>Decision Heatmap</span><b>Priority and evidence confidence</b></div><small>Portfolio signals</small></div>
        <div className="risk-heatmap">
          <span className="heat-label high">High action</span><span className="heat-label medium">Watch</span><span className="heat-label low">Routine</span>
          {chartProjects.map((project, index) => {
            const vertical = project.decision_required ? 18 : project.status === "Delayed" ? 48 : 76;
            const horizontal = project.data_confidence === "Low" ? 72 : project.data_confidence === "Medium" ? 48 : 24;
            return <button type="button" title={`${project.project_display_name}: ${project.decision_priority || "N/A"}`} style={{ left: `${horizontal + index * 4}%`, top: `${vertical + index * 3}%` }} key={project.project_key}>{project.project_folder_name.slice(0, 3).toUpperCase()}</button>;
          })}
        </div>
        <p className="chart-note">Vertical position reflects decision trigger; horizontal position reflects reported data confidence. This is an evidence awareness view, not a risk calculation replacement.</p>
      </section>
      <MermaidDiagram chart={portfolioDecisionMermaid()} title="Portfolio Decision Flow" />
    </div>
  );
}

function DecisionOperationsDashboard() {
  const [panel, setPanel] = useState<OperationsPanel>("portfolio");
  const [sectorFilter, setSectorFilter] = useState("All sectors");
  const [lightMode, setLightMode] = useState(false);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const visibleProjects = useMemo(
    () => sectorFilter === "All sectors" ? projects : projects.filter((project) => project.sector === sectorFilter),
    [sectorFilter]
  );
  const visibleSectors = useMemo(
    () => sectorFilter === "All sectors" ? sectors : sectors.filter((sector) => sector.sector === sectorFilter),
    [sectorFilter]
  );

  return (
    <div className={lightMode ? "digital-operations executive-light-mode" : "digital-operations"}>
      <section className="operations-hero">
        <div className="operations-brand"><Image src="/assets/logo.png" alt="SAMCO Egypt" width={58} height={58} priority /><div><span>Samco Egypt</span><b>Decision Making Dashboard</b><small>Portfolio command layer | source-backed management intelligence</small></div></div>
        <div className="operations-hero-controls">
          <label><span>Portfolio lens</span><select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}><option>All sectors</option>{sectors.map((sector) => <option key={sector.sector}>{sector.sector}</option>)}</select></label>
          <ExecutiveLightModeToggle enabled={lightMode} onChange={setLightMode} />
        </div>
      </section>
      <div className="operations-kpi-grid">
        <HoloKpi title="Active Projects" value={numberValue(visibleProjects.length)} note={`${visibleSectors.length} sectors in view`} tone="cyan" />
        <HoloKpi title="Contract Value" value={money(visibleProjects.reduce((sum, project) => sum + (project.contract_value || 0), 0))} note="Filtered portfolio value" tone="gold" />
        <HoloKpi title="Delivery Position" value={percent(visibleProjects.reduce((sum, project) => sum + (project.actual_progress || 0), 0) / Math.max(visibleProjects.length, 1))} note="Reported actual progress" tone="blue" />
        <HoloKpi title="Delayed Projects" value={numberValue(visibleProjects.filter((project) => project.status === "Delayed" || (project.delay_days || 0) > 0).length)} note="Schedule attention signals" tone="red" />
        <HoloKpi title="Decisions Required" value={numberValue(visibleProjects.filter((project) => project.decision_required).length)} note="Threshold-based management gates" tone="violet" />
      </div>
      <nav className="operations-tabs" aria-label="Decision dashboard views">
        {([
          ["portfolio", "Portfolio Pulse"],
          ["delivery", "Delivery & Value"],
          ["decisions", "Risk & Decisions"],
          ["intelligence", "AI Intelligence"]
        ] as Array<[OperationsPanel, string]>).map(([key, label]) => <button type="button" className={panel === key ? "active" : ""} onClick={() => setPanel(key)} key={key}>{label}</button>)}
      </nav>
      {panel === "portfolio" || panel === "delivery" ? <PortfolioVisuals projects={visibleProjects} sectors={visibleSectors} panel={panel} /> : null}
      {panel === "decisions" ? <div className="operations-stack"><PortfolioVisuals projects={visibleProjects} sectors={visibleSectors} panel={panel} /><PredictiveWarningPanel projects={visibleProjects} warningSummary={warningSummary} /><ManagementDecisionBrief items={decisionBrief.filter((item) => sectorFilter === "All sectors" || item.sector === sectorFilter)} onAddAction={(item) => setActions((current) => [...current, item])} /><ActionTracker scopeKey="portfolio" seedActions={actions} /></div> : null}
      {panel === "intelligence" ? <div className="operations-stack"><UnifiedIntelligenceSearch mode="portfolio" /><TechnicalKnowledgeAdvisor mode="portfolio" /><ScenarioPlanner projects={visibleProjects} portfolioContractValue={visibleProjects.reduce((sum, project) => sum + (project.contract_value || 0), 0)} /></div> : null}
    </div>
  );
}

function DigitalOperationsApp() {
  const [scope, setScope] = useState(DECISION_DASHBOARD_KEY);
  const [selectedReport, setSelectedReport] = useState<ReportKey>("executive_dashboard");
  const [projectDetails, setProjectDetails] = useState<ProjectRecord | null>(null);
  const [projectLoadState, setProjectLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const selectedProjectSummary = projects.find((project) => project.project_key === scope) || projects[0];
  const isDecisionDashboard = scope === DECISION_DASHBOARD_KEY;
  const selectScope = (nextScope: string) => {
    setScope(nextScope);
  };

  useEffect(() => {
    const requestedProject = new URLSearchParams(window.location.search).get("project");
    if (requestedProject && projects.some((project) => project.project_key === requestedProject)) {
      setScope(requestedProject);
    }
  }, []);

  useEffect(() => {
    if (isDecisionDashboard || !selectedProjectSummary) {
      setProjectDetails(null);
      setProjectLoadState("idle");
      return;
    }

    let cancelled = false;
    setProjectDetails(null);
    setProjectLoadState("loading");
    const projectKey = selectedProjectSummary.project_key;

    fetch(`/data/projects/${encodeURIComponent(projectKey)}.json`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Project payload request failed (${response.status}).`);
        return response.json() as Promise<ProjectRecord>;
      })
      .then((payload) => {
        if (payload.project_key !== projectKey || payload.project_id !== selectedProjectSummary.project_id) {
          throw new Error("Project payload identity validation failed.");
        }
        if (!cancelled) {
          setProjectDetails(payload);
          setProjectLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectDetails(null);
          setProjectLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDecisionDashboard, selectedProjectSummary]);

  return (
    <main className="future-shell operations-shell">
      <header className="operations-command-bar">
        <div className="command-identity"><span>PIH / 01</span><b>Digital Operations</b></div>
        <label className="scope-control"><span>Operating scope</span><select value={scope} onChange={(event) => selectScope(event.target.value)}><option value={DECISION_DASHBOARD_KEY}>Decision Making Dashboard</option>{projects.map((project) => <option value={project.project_key} key={project.project_key}>{project.sector} / {project.project_display_name}</option>)}</select></label>
        <div className="command-status"><i /><span>{isDecisionDashboard ? "Portfolio mode" : `${selectedProjectSummary.sector} project mode`}</span></div>
      </header>
      {isDecisionDashboard ? <DecisionOperationsDashboard /> : (
        projectLoadState === "loading" ? <section className="feature-card project-load-state"><h2>Loading {selectedProjectSummary.project_display_name}</h2><p>Validating the selected project payload and source boundary.</p></section>
          : projectDetails ? <ProjectWorkspace project={projectDetails} selectedReport={selectedReport} setSelectedReport={setSelectedReport} />
            : <section className="feature-card project-load-state"><h2>{selectedProjectSummary.project_display_name}</h2><p>{projectLoadState === "error" ? "The selected project payload failed its identity or availability check. Regenerate the verified project pipeline." : "Project workspace data is not available. Regenerate the verified website data pipeline for this selected project."}</p></section>
      )}
      <footer className="operations-footer">Designed &amp; Created | <strong>Engr. Ahmed Labib</strong><span>Source-backed controls | Project-isolated intelligence</span></footer>
      <AiChatPanel projectKey={isDecisionDashboard ? undefined : selectedProjectSummary.project_key} projectName={isDecisionDashboard ? "Decision Making Dashboard" : selectedProjectSummary.project_display_name} sector={isDecisionDashboard ? undefined : selectedProjectSummary.sector} />
    </main>
  );
}

export default function HomePage() {
  return <DigitalOperationsApp />;
}
