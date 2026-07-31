"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
  advanced_analytics?: AdvancedAnalyticsPayload;
  features: FeaturePayload;
  reports: Record<ReportKey, string>;
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

type GuardrailSummary = {
  status: string;
  mode: string;
  ok: boolean;
  block_count: number;
  warn_count: number;
  issue_count: number;
  report_path: string;
  last_checked: string;
  top_issues?: Array<{
    effective_severity: string;
    project_display_name: string;
    field: string;
    message: string;
  }>;
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
    submitted_tia?: SubmittedTiaPayload;
    templates: TablePreview[];
    template_tables?: TablePreview[];
    required_file_count: number;
    recognized_file_count: number;
    missing_required_files: string[];
    schedule_tables: Record<string, TablePreview>;
    schedule_workspace_tables?: Record<string, TablePreview>;
    detectors: DetectorRecord[];
  };
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
};

const projects = portfolio.projects as unknown as ProjectSummary[];
const sectors = portfolio.sectors as SectorRecord[];
const totals = portfolio.totals;
const warningSummary = (portfolio as { warning_summary?: Record<string, number> }).warning_summary;
const decisionBrief = ((portfolio as { decision_brief?: DecisionBriefItem[] }).decision_brief || []) as DecisionBriefItem[];
const guardrails = (portfolio as { guardrails?: GuardrailSummary }).guardrails;
const DECISION_DASHBOARD_KEY = "__decision_making_dashboard__";

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
  "Delays",
  "Time Impact",
  "Risks",
  "Delay Analysis - Time Impact Analysis",
  "Contract & Claims Intelligence Center",
  "Technical Advisor",
  "Conference",
  "Output Studio"
] as const;

type WorkspaceTab = (typeof workspaceTabs)[number];

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

function portfolioDecisionMermaid(selectedProject: ProjectSummary) {
  const projectCount = numberValue(portfolio.project_count);
  const sectorCount = numberValue(portfolio.sector_count);
  const decisionCount = numberValue(totals.decisions_required);
  const delayedCount = numberValue(totals.delayed_projects);
  const highRiskCount = numberValue(totals.high_risk_projects);
  const averageSpi = numberValue(totals.average_spi, 2);
  const averageCpi = numberValue(totals.average_cpi, 2);
  const selected = selectedProject.project_folder_name.replace(/"/g, "'");
  return `flowchart LR
    A["Project Folders\\n${projectCount} projects / ${sectorCount} sectors"] --> B["Generated Data Layer\\nPortfolio JSON + project JSON"]
    B --> C["Executive Controls\\nSPI ${averageSpi} / CPI ${averageCpi}"]
    B --> D["Risk and Delay Signals\\n${delayedCount} delayed / ${highRiskCount} high risk"]
    C --> E{"Management Decision Gate\\n${decisionCount} decisions required"}
    D --> E
    E --> F["Technical Knowledge Advisor\\nQuestion bank + portfolio evidence"]
    F --> G["Decision Brief\\nOwner / evidence / impact / deadline"]
    G --> H["Same Page Project Deep Dive\\nSelected: ${selected}"]
    H --> I["Project Workspace Tabs\\nOverview / EVM / Letters / Delay / Claims / Outputs"]
    I --> J["Action Closure\\nUpdate source files and regenerate outputs"]`;
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
        <HoloKpi title="Data Quality" value={`${numberValue(selectedProject.data_quality, 1)}%`} note="Source completeness" tone="violet" />
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

function DataStatus({ label, count }: { label: string; count: number | undefined }) {
  const available = Boolean(count && count > 0);
  return (
    <span className={available ? "data-status available" : "data-status missing"}>
      {label}<b>{available ? `${count} rows` : "No data"}</b>
    </span>
  );
}

function displayCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return numberValue(value, Number.isInteger(value) ? 0 : 2);
  return String(value);
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
      <text x="44" y="180" fill="#9bb8ca" fontSize="13">Project-scoped detector and analytics flow</text>
    </svg>
  );
}

function DetectorGrid({ detectors }: { detectors: DetectorRecord[] }) {
  return (
    <div className="detector-grid">
      {detectors.map((detector) => (
        <article className="detector-card" key={detector.name}>
          <span className={detector.status.toLowerCase().includes("missing") || detector.status.toLowerCase().includes("needs") ? "detector-badge alert" : "detector-badge"}>
            {detector.status}
          </span>
          <h3>{detector.name}</h3>
          <p>{detector.detail}</p>
        </article>
      ))}
    </div>
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
      <section className="feature-card">
        <div className="feature-card-head"><h3>Submitted TIA Visual Audit</h3><span>{submitted.visuals?.length || 0}</span></div>
        <div className="tia-visual-grid">
          {(submitted.visuals || []).slice(0, 6).map((visual) => (
            <figure key={visual.url}>
              <Image src={visual.url} alt={visual.name} width={960} height={540} sizes="(max-width: 760px) 92vw, 33vw" />
              <figcaption>{visual.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
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
      <ModuleTabs label="Letters Intelligence views" tabs={["Inbox & Auto Ingest", "Letter Registers", "Issue Threads", "Linked Correspondence", "AI Letter Review"]} activeTab={view} onChange={setView} />
      {view === "Inbox & Auto Ingest" ? <><DetectorGrid detectors={letters.detectors} /><FileList title="Automatic Letter Inbox" files={letters.inbox_files} emptyText="No correspondence files were detected in this project inbox." /></> : null}
      {view === "Letter Registers" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Letters Registers" preferred={["From Contractor", "From Consultant", "ACE", "SAMCO"]} /> : null}
      {view === "Issue Threads" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Issue Threads & Alerts" preferred={["Issue Threads", "Alerts"]} /> : null}
      {view === "Linked Correspondence" ? <WorkbookDataPanel workbook={selectedWorkbook.sheets?.length ? selectedWorkbook : letters.workbook_tables} title="Linked Correspondence Engine" preferred={["Contractor Links", "Consultant Links"]} /> : null}
      {view === "AI Letter Review" ? <div className="feature-stack"><AiInsightCard type="letters" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /></div> : null}
    </div>
  );
}

function DelayTiaParityPanel({ project }: { project: ProjectRecord }) {
  const [view, setView] = useState("Uploads");
  const [includeIfc, setIncludeIfc] = useState(true);
  const [includeRfi, setIncludeRfi] = useState(true);
  const [includePayments, setIncludePayments] = useState(true);
  const [includeMitigation, setIncludeMitigation] = useState(true);
  const delay = project.features.delay_analysis;
  const templateTables = Object.fromEntries((delay.template_tables || delay.templates).map((table) => [table.file, table]));
  const scheduleTables = delay.schedule_workspace_tables || delay.schedule_tables;
  const eventTables = Object.fromEntries(Object.entries(templateTables).filter(([name]) => /ifc|rfi|payment|concurrency|master|p6|relationship|contract/i.test(name)));
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <section className="feature-card">
          <div className="feature-card-head"><h3>Delay Analysis - Time Impact Analysis</h3><span>{delay.logic_mode || "Project TIA readiness"}</span></div>
          <p>All TIA evidence is retained per project. Schedule movement remains indicative until the P6 fragnet, critical path, float, concurrency, mitigation, and entitlement tests are confirmed.</p>
          <div className="workspace-grid compact-grid">
            <MiniMetric label="Recognized Files" value={numberValue(delay.recognized_file_count)} note={`Required ${delay.required_file_count}`} />
            <MiniMetric label="Delay Events" value={numberValue(project.delay_event_count)} note="Project event register" />
            <MiniMetric label="Delay Days" value={numberValue(project.delay_days)} note="Not verified EOT" />
            <MiniMetric label="Data Status" value={delay.missing_required_files.length ? "Needs Files" : "Ready"} note={`${delay.missing_required_files.length} missing required files`} />
          </div>
        </section>
        <FeatureSvg mode="delay" />
      </div>
      <ModuleTabs label="Delay TIA views" tabs={["Uploads", "Tables & Conclusion", "MEP Activities", "AI - TIA", "Question", "Download Reports"]} activeTab={view} onChange={setView} />
      {view === "Uploads" ? <>
        <DetectorGrid detectors={delay.detectors} />
        <section className="feature-card"><div className="feature-card-head"><h3>Include / Exclude Supposed Delay Streams</h3><span>Scenario scope only</span></div><div className="stream-toggle-grid">
          <label><input type="checkbox" checked={includeIfc} onChange={(event) => setIncludeIfc(event.target.checked)} /> IFC support events</label>
          <label><input type="checkbox" checked={includeRfi} onChange={(event) => setIncludeRfi(event.target.checked)} /> RFI support events</label>
          <label><input type="checkbox" checked={includePayments} onChange={(event) => setIncludePayments(event.target.checked)} /> Payment support events</label>
          <label><input type="checkbox" checked={includeMitigation} onChange={(event) => setIncludeMitigation(event.target.checked)} /> Contractor mitigation evidence</label>
        </div><p className="empty-note">These controls change the review scope only. They do not calculate or grant EOT, and contractor supply stays excluded from employer delay entitlement.</p></section>
        <ProjectTableSelector title="Required Delay TIA Source Files" tables={templateTables} preferred={["01-project_metadata_template.csv", "02- master_activity_steel_analysis.csv", "04- p6_activity_export.csv", "11-concurrency_matrix_template.updated.csv"]} />
      </> : null}
      {view === "Tables & Conclusion" ? <>
        <AiInsightCard type="delay" projectKey={project.project_key} />
        <SubmittedTiaGuidePanel submitted={delay.submitted_tia || { available: false, status: "Missing", scope_note: "No submitted TIA guide detected." }} />
        <ProjectTableSelector title="TIA Evidence Tables" tables={eventTables} preferred={["11-concurrency_matrix_template.updated.csv", "04- p6_activity_export.csv", "02- master_activity_steel_analysis.csv"]} />
      </> : null}
      {view === "MEP Activities" ? <><ProjectTableSelector title="MEP Activities and Civil Interface Logic" tables={scheduleTables} preferred={["MEP Activities", "MEP Schedule", "MEP Civil Logic", "BL Schedule"]} /><WorkbookDataPanel workbook={project.features.letters_intelligence.workbook_tables} title="Related Letters Intelligence References" /></> : null}
      {view === "AI - TIA" ? <><SubmittedTiaGuidePanel submitted={delay.submitted_tia || { available: false, status: "Missing", scope_note: "No submitted TIA guide detected." }} /><ProjectTableSelector title="Active TIA File Priority and Dependency Evidence" tables={templateTables} preferred={["01-project_metadata_template.csv", "02- master_activity_steel_analysis.csv", "04- p6_activity_export.csv", "05- relationship_file.csv", "11-concurrency_matrix_template.updated.csv"]} /></> : null}
      {view === "Question" ? <div className="feature-stack"><AiInsightCard type="delay" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /><ProjectTableSelector title="Question Evidence Source" tables={eventTables} preferred={["11-concurrency_matrix_template.updated.csv", "09-rfi_status.csv", "07-ifc_conflict.csv"]} /></div> : null}
      {view === "Download Reports" ? <section className="feature-card"><div className="feature-card-head"><h3>Delay TIA Generated Outputs</h3><span>HTML reports</span></div><p>Download the selected project&apos;s generated Delay TIA and executive report files. Source data stays project-isolated.</p><OutputStudioDownloadButton href={project.reports.elite_svg_charts} label="Download Delay TIA Charts" /><FileList title="Available Project Outputs" files={project.features.outputs_and_watchers.output_files} /></section> : null}
    </div>
  );
}

function ContractClaimsParityPanel({ project }: { project: ProjectRecord }) {
  const [center, setCenter] = useState("Contract Clauses");
  const [view, setView] = useState("Contract Library");
  const claims = project.features.contract_claims;
  const knowledgeTables = claims.knowledge_base?.tables || {};
  const clauseTable = knowledgeTables.contract_clauses || knowledgeTables[Object.keys(knowledgeTables).find((name) => /clause/i.test(name)) || ""];
  const evidenceTables = Object.fromEntries(Object.entries(knowledgeTables).filter(([name]) => /evidence|document|mapping/i.test(name)));
  const claimTables = Object.fromEntries(Object.entries(knowledgeTables).filter(([name]) => /claim|trigger|defense|rebuttal|draft/i.test(name)));
  return (
    <div className="feature-stack">
      <div className="workspace-two">
        <section className="feature-card"><div className="feature-card-head"><h3>Contract & Claims Intelligence Center</h3><span>Selected project only</span></div><p>The library, evidence register, clause search, claim records, and AI analysis use only this project&apos;s contract folder and SQLite knowledge base.</p><div className="workspace-grid compact-grid"><MiniMetric label="Contract Files" value={numberValue(claims.source_files.length)} note="Project contract source" /><MiniMetric label="Evidence Files" value={numberValue(claims.evidence_files.length)} note="Project evidence source" /><MiniMetric label="Claims Rows" value={numberValue(project.source_files.claims)} note="Project claims register" /><MiniMetric label="Knowledge Tables" value={numberValue(Object.keys(knowledgeTables).length)} note="Project database only" /></div></section>
        <FeatureSvg mode="claims" />
      </div>
      <ModuleTabs label="Contract claims center" tabs={["Contract Clauses", "Claims Intelligence Center"]} activeTab={center} onChange={setCenter} />
      {center === "Contract Clauses" ? <div className="feature-stack"><ProjectDataTable table={clauseTable} title="Contract Clause Matching Engine" empty="No clause library is available for this selected project." /><WorkbookDataPanel workbook={claims.clause_library_tables} title="Overall Contract Clause Library" /></div> : null}
      {center === "Claims Intelligence Center" ? <>
        <ModuleTabs label="Claims Intelligence views" tabs={["Upload & Extract", "Contract Library", "Ask Contract AI", "Evidence Mapping", "Client Rebuttal Engine", "Claim Builder", "Export Center"]} activeTab={view} onChange={setView} />
        {view === "Upload & Extract" ? <><DetectorGrid detectors={claims.detectors} /><div className="workspace-two"><FileList title="Contract Source Repository" files={claims.source_files} /><FileList title="Project Evidence Repository" files={claims.evidence_files} /></div><section className="feature-card"><div className="feature-card-head"><h3>Local Pipeline Status</h3><span>Read-only Vercel view</span></div><p>Add or replace source files in this project&apos;s local folder. The watcher rebuilds the project knowledge base and publishes the updated isolated data to Vercel. The public site does not write into another project or overwrite source files.</p></section></> : null}
        {view === "Contract Library" ? <div className="feature-stack"><ProjectDataTable table={clauseTable} title="Searchable Contract Claims Library" /><WorkbookDataPanel workbook={claims.clause_library_tables} title="Contract Clause Library Workbook" /></div> : null}
        {view === "Ask Contract AI" ? <div className="feature-stack"><AiInsightCard type="contract" projectKey={project.project_key} /><UnifiedIntelligenceSearch mode="project" projectKey={project.project_key} projectName={project.project_display_name} /></div> : null}
        {view === "Evidence Mapping" ? <div className="feature-stack"><ProjectTableSelector title="Evidence-to-Clause Mapping" tables={Object.keys(evidenceTables).length ? evidenceTables : knowledgeTables} preferred={["evidence_mappings", "evidence_documents"]} /><FileList title="Evidence Files" files={claims.evidence_files} /></div> : null}
        {view === "Client Rebuttal Engine" ? <div className="feature-stack"><AiInsightCard type="contract" projectKey={project.project_key} /><ProjectTableSelector title="Client Defenses and Contractor Rebuttals" tables={Object.keys(claimTables).length ? claimTables : knowledgeTables} preferred={["client_defenses", "contractor_rebuttals"]} /></div> : null}
        {view === "Claim Builder" ? <div className="feature-stack"><ProjectTableSelector title="Claim Categories, Triggers, and Drafts" tables={Object.keys(claimTables).length ? claimTables : knowledgeTables} preferred={["claim_categories", "claim_triggers", "claim_drafts"]} /><AiInsightCard type="contract" projectKey={project.project_key} /></div> : null}
        {view === "Export Center" ? <section className="feature-card"><div className="feature-card-head"><h3>Export Center</h3><span>Project outputs</span></div><p>Download the active project&apos;s source-backed Output Studio report. Individual source tables above can also be exported as CSV.</p><OutputStudioDownloadButton href={project.reports.master_dashboard} label="Download Master Dashboard" /><FileList title="Automatic HTML Outputs" files={project.features.outputs_and_watchers.output_files} /></section> : null}
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
          <DataStatus label="Meeting Link" count={meetingUrl ? 1 : 0} />
          <DataStatus label="Project Tabs Available" count={workspaceTabs.length} />
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
          <OutputStudioDownloadButton />
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
          <iframe src={project.reports.master_dashboard} title={`${project.project_display_name} master dashboard WBS`} />
        </div>
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
        <ProjectDataTable table={workspaceTables.milestones} title="Milestone Register" />
      </div>
    );
  }

  if (activeTab === "S-Curve") {
    return (
      <div className="workspace-two">
        <div>
          <h3>S-Curve</h3>
          <p>Uses the selected project progress and generated dashboard outputs. If the source S-curve file is missing, the report remains available with controlled source notes.</p>
          <DataStatus label="S-Curve Rows" count={project.features.overview.source_tables.s_curve?.row_count} />
          <DataStatus label="Progress Updates" count={project.source_files.progress} />
          <ProjectDataTable table={workspaceTables.s_curve} title="S-Curve Source" />
        </div>
        <iframe src={project.reports.linked_executive_dashboard} title={`${project.project_display_name} linked dashboard`} />
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
        <ProjectDataTable table={workspaceTables.evm} title="EVM Source Table" />
      </div>
    );
  }

  if (activeTab === "Analytics Intelligence") {
    return <AdvancedAnalyticsPanel analytics={project.advanced_analytics} />;
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
        <div className="workspace-two">
          <ProjectDataTable table={workspaceTables.contracts} title="Contracts Register" />
          <ProjectDataTable table={workspaceTables.payments} title="Payments Register" />
        </div>
      </div>
    );
  }

  if (activeTab === "Delays") {
    return (
      <div className="feature-stack">
        <AiInsightCard type="delay" projectKey={project.project_key} />
        <div className="workspace-grid">
          <MiniMetric label="Delay Days" value={numberValue(project.delay_days)} note={metricSource(project, "delay_days", "Delay exposure from project data")} />
          <MiniMetric label="Delay Events" value={numberValue(project.delay_event_count ?? project.source_files.delay_events)} note="Delay event rows loaded" />
          <MiniMetric label="SPI" value={numberValue(project.spi, 2)} note="Schedule performance signal" />
          <MiniMetric label="Decision Required" value={project.decision_required ? "Yes" : "No"} note="Delay or performance trigger" />
        </div>
        <div className="workspace-two">
          <FeatureSvg mode="delay" />
          <ProjectDataTable table={workspaceTables.delay_events} title="Delay Events Register" />
        </div>
      </div>
    );
  }

  if (activeTab === "Time Impact") {
    return (
      <div className="feature-stack">
        <div className="workspace-two">
          <section className="feature-card">
            <div className="feature-card-head"><h3>Time Impact Position</h3><span>{project.features.delay_analysis.logic_mode || "Project-scoped"}</span></div>
            <p>Shows the selected project&apos;s time-impact evidence, recognized TIA inputs, and generated time-impact outputs without mixing data from other projects.</p>
            <DataStatus label="Recognized TIA Files" count={project.features.delay_analysis.recognized_file_count} />
            <DataStatus label="Required TIA Files" count={project.features.delay_analysis.required_file_count} />
            <DataStatus label="Delay Events" count={project.source_files.delay_events} />
          </section>
          <FeatureSvg mode="delay" />
        </div>
        <ProjectTableSelector title="Time Impact Evidence Tables" tables={Object.fromEntries((project.features.delay_analysis.template_tables || project.features.delay_analysis.templates).map((table) => [table.file, table]))} preferred={["04- p6_activity_export.csv", "11-concurrency_matrix_template.updated.csv", "05- relationship_file.csv"]} />
        <iframe className="wide-embed" src={project.reports.elite_svg_charts} title={`${project.project_display_name} time impact charts`} />
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
        <ProjectDataTable table={workspaceTables.risks} title="Risk Register" />
      </div>
    );
  }

  if (activeTab === "Letters Intelligence") return <LettersIntelligencePanel project={project} />;

  if (activeTab === "Delay Analysis - Time Impact Analysis") return <DelayTiaParityPanel project={project} />;

  if (activeTab === "Contract & Claims Intelligence Center") return <ContractClaimsParityPanel project={project} />;

  if (activeTab === "Technical Advisor") {
    return (
      <div className="feature-stack">
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
        href={project.reports[selectedReport]}
        label={`Download ${reportTabs.find((tab) => tab.key === selectedReport)?.label || "Report"}`}
      />
      <DetectorGrid detectors={project.features.outputs_and_watchers.watchers} />
      <FileList title="Automatic HTML Outputs" files={project.features.outputs_and_watchers.output_files} />
      <iframe src={project.reports[selectedReport]} title={`${project.project_display_name} - ${selectedReport}`} />
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
    <section className="project-workspace">
      <ProjectConsole selectedProject={project} />
      <div className="section-header workspace-subhead">
        <div>
          <p className="eyebrow">Project Tabs</p>
          <h2>{project.project_display_name}</h2>
        </div>
        <span>{project.sector} / {project.project_folder_name}</span>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Project workspace tabs">
        {workspaceTabs.map((tab) => (
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
          <p className="chart-note">Markers use the actual project SPI and reported actual progress. Out-of-range values are retained in source data and monitored through guardrails.</p>
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
      <MermaidDiagram chart={portfolioDecisionMermaid(chartProjects[0] || projects[0])} title="Portfolio Decision Flow" />
    </div>
  );
}

function DecisionOperationsDashboard({
  onChooseProject
}: {
  onChooseProject: (projectKey: string) => void;
}) {
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
        <HoloKpi title="Data Trust" value={`${numberValue(visibleProjects.reduce((sum, project) => sum + (project.data_quality || 0), 0) / Math.max(visibleProjects.length, 1), 1)}%`} note={guardrails?.status || "Data guardrails"} tone="green" />
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
      <section className="operations-project-rail">
        <div><span>Project Deep Dive</span><b>Open any project in the same page</b><small>Each selection remains bound to its own generated project JSON, data sources, reports, letters, Delay TIA, and claims context.</small></div>
        <div className="project-rail-buttons">{visibleProjects.map((project) => <button type="button" key={project.project_key} onClick={() => onChooseProject(project.project_key)}>{project.project_display_name}<small>{project.sector} | {project.status}</small></button>)}</div>
      </section>
    </div>
  );
}

function DigitalOperationsApp() {
  const [scope, setScope] = useState(DECISION_DASHBOARD_KEY);
  const [selectedReport, setSelectedReport] = useState<ReportKey>("executive_dashboard");
  const [projectDetails, setProjectDetails] = useState<ProjectRecord | null>(null);
  const [projectLoadError, setProjectLoadError] = useState("");
  const selectedProjectSummary = projects.find((project) => project.project_key === scope) || projects[0];
  const isDecisionDashboard = scope === DECISION_DASHBOARD_KEY;
  const selectScope = (nextScope: string) => {
    setScope(nextScope);
    setProjectDetails(null);
    setProjectLoadError("");
  };

  useEffect(() => {
    if (isDecisionDashboard) return;
    let cancelled = false;
    fetch(`/data/projects/${encodeURIComponent(scope)}.json`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Selected project data is not available.");
        return response.json() as Promise<ProjectRecord>;
      })
      .then((payload) => {
        if (!cancelled && payload.project_key === scope) setProjectDetails(payload);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProjectLoadError(error instanceof Error ? error.message : "Unable to load selected project data.");
      });
    return () => { cancelled = true; };
  }, [isDecisionDashboard, scope]);

  return (
    <main className="future-shell operations-shell">
      <header className="operations-command-bar">
        <div className="command-identity"><span>PIH / 01</span><b>Digital Operations</b></div>
        <label className="scope-control"><span>Operating scope</span><select value={scope} onChange={(event) => selectScope(event.target.value)}><option value={DECISION_DASHBOARD_KEY}>Decision Making Dashboard</option>{projects.map((project) => <option value={project.project_key} key={project.project_key}>{project.sector} / {project.project_display_name}</option>)}</select></label>
        <div className="command-status"><i /><span>{isDecisionDashboard ? "Portfolio mode" : `${selectedProjectSummary.sector} project mode`}</span></div>
      </header>
      {isDecisionDashboard ? <DecisionOperationsDashboard onChooseProject={selectScope} /> : (
        projectDetails ? <ProjectWorkspace project={projectDetails} selectedReport={selectedReport} setSelectedReport={setSelectedReport} /> : <section className="feature-card project-load-state"><h2>{selectedProjectSummary.project_display_name}</h2><p>{projectLoadError || "Loading the complete project controls workspace..."}</p></section>
      )}
      <footer className="operations-footer">Designed &amp; Created | <strong>Engr. Ahmed Labib</strong><span>Source-backed controls | Project-isolated intelligence</span></footer>
      <AiChatPanel projectKey={isDecisionDashboard ? undefined : selectedProjectSummary.project_key} projectName={isDecisionDashboard ? "Decision Making Dashboard" : selectedProjectSummary.project_display_name} sector={isDecisionDashboard ? undefined : selectedProjectSummary.sector} />
    </main>
  );
}

export default function HomePage() {
  return <DigitalOperationsApp />;
}


