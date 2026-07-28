import Link from "next/link";
import portfolio from "../../../../public/data/portfolio.json";

type ProjectRecord = {
  project_key: string;
  project_display_name: string;
  sector: string;
  status: string;
  contract_value: number | null;
  paid_amount: number | null;
  actual_progress: number | null;
  planned_progress: number | null;
  spi: number | null;
  cpi: number | null;
  risk_score: number | null;
  delay_days: number | null;
  data_quality: number | null;
  last_updated: string | null;
  reports: Record<string, string>;
  source_files: Record<string, number>;
};

const projects = portfolio.projects as ProjectRecord[];

export function generateStaticParams() {
  return projects.map((project) => ({ projectKey: project.project_key }));
}

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

export default async function ProjectPage({ params }: { params: Promise<{ projectKey: string }> }) {
  const { projectKey } = await params;
  const project = projects.find((item) => item.project_key === projectKey);
  if (!project) {
    return (
      <main>
        <section className="hero"><h1>Project not found</h1><Link href="/">Back to portfolio</Link></section>
      </main>
    );
  }

  const reports = [
    ["Executive Dashboard", project.reports.executive_dashboard],
    ["Master Dashboard", project.reports.master_dashboard],
    ["Elite SVG Charts", project.reports.elite_svg_charts],
    ["Linked Executive Dashboard", project.reports.linked_executive_dashboard]
  ];

  return (
    <main>
      <section className="hero compact">
        <div>
          <Link href="/" className="back-link">Back to portfolio</Link>
          <p className="eyebrow">{project.sector}</p>
          <h1>{project.project_display_name}</h1>
          <p>Project website generated from this project folder only. Last source update: {project.last_updated || "N/A"}.</p>
        </div>
      </section>

      <section className="kpi-grid">
        <article className="kpi-card"><span>Contract Value</span><strong>{money(project.contract_value)}</strong><small>{project.status}</small></article>
        <article className="kpi-card"><span>Paid Amount</span><strong>{money(project.paid_amount)}</strong><small>Payment source data</small></article>
        <article className="kpi-card"><span>Actual Progress</span><strong>{percent(project.actual_progress)}</strong><small>Planned: {percent(project.planned_progress)}</small></article>
        <article className="kpi-card"><span>SPI / CPI</span><strong>{numberValue(project.spi, 2)} / {numberValue(project.cpi, 2)}</strong><small>EVM indicators</small></article>
        <article className="kpi-card"><span>Risk Score</span><strong>{numberValue(project.risk_score, 1)}</strong><small>Project risk files</small></article>
        <article className="kpi-card"><span>Data Quality</span><strong>{numberValue(project.data_quality, 1)}%</strong><small>Source completeness</small></article>
      </section>

      <section className="tabs report-tabs">
        {reports.map(([label], index) => (
          <input key={label} id={`report-${index}`} name="report-tab" type="radio" defaultChecked={index === 0} />
        ))}
        <div className="tab-labels">
          {reports.map(([label], index) => <label key={label} htmlFor={`report-${index}`}>{label}</label>)}
        </div>
        <div className="tab-panels">
          {reports.map(([label, src], index) => (
            <section key={label} id={`report-panel-${index}`} className="tab-panel report-panel">
              <div className="section-title"><h2>{label}</h2><a href={src} target="_blank">Open full page</a></div>
              <iframe src={src} title={label} />
            </section>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Source Data Register</h2>
        <div className="source-grid">
          {Object.entries(project.source_files).map(([name, count]) => (
            <span key={name}>{name}<b>{count}</b></span>
          ))}
        </div>
      </section>
    </main>
  );
}
