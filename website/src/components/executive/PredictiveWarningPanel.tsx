import SourceConfidenceBadge from "./SourceConfidenceBadge";

type ProjectWarningRecord = {
  project_key: string;
  project_display_name: string;
  sector: string;
  schedule_health?: string | null;
  cost_health?: string | null;
  delay_exposure?: string | null;
  claim_exposure_level?: string | null;
  data_confidence?: string | null;
  data_quality?: number | null;
  decision_priority?: string | null;
  last_updated?: string | null;
  source_files?: Record<string, number>;
};

type WarningTotals = {
  schedule_critical?: number;
  cost_critical?: number;
  delay_high?: number;
  claims_high?: number;
  low_confidence?: number;
  high_priority?: number;
};

function countSources(project: ProjectWarningRecord) {
  return Object.values(project.source_files || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

function warningTone(value?: string | null) {
  if (value === "Critical" || value === "High" || value === "Low") return "critical";
  if (value === "Watchlist" || value === "Medium") return "watch";
  if (value === "Healthy") return "good";
  return "neutral";
}

export default function PredictiveWarningPanel({
  projects,
  warningSummary
}: {
  projects: ProjectWarningRecord[];
  warningSummary?: WarningTotals;
}) {
  const priorityProjects = [...projects]
    .filter((project) => ["High", "Critical"].includes(String(project.decision_priority)))
    .slice(0, 6);

  const warnings = [
    { label: "Schedule", value: warningSummary?.schedule_critical ?? 0, note: "Critical SPI projects" },
    { label: "Cost", value: warningSummary?.cost_critical ?? 0, note: "Critical CPI projects" },
    { label: "Delay", value: warningSummary?.delay_high ?? 0, note: "High delay exposure" },
    { label: "Claims / EOT", value: warningSummary?.claims_high ?? 0, note: "High claim exposure" },
    { label: "Data Trust", value: warningSummary?.low_confidence ?? 0, note: "Low confidence projects" },
    { label: "Priority", value: warningSummary?.high_priority ?? 0, note: "High-priority decisions" }
  ];

  return (
    <section className="glass-panel predictive-warning-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Predictive Warnings</p>
          <h2>Early Management Signals</h2>
        </div>
        <span>Derived from project JSON</span>
      </div>
      <div className="warning-grid">
        {warnings.map((warning) => (
          <article className={`warning-card ${warning.value > 0 ? "needs-attention" : "stable"}`} key={warning.label}>
            <span>{warning.label}</span>
            <strong>{warning.value}</strong>
            <small>{warning.note}</small>
          </article>
        ))}
      </div>
      <div className="priority-project-list">
        {priorityProjects.length ? priorityProjects.map((project) => (
          <article className="priority-project-card" key={project.project_key}>
            <div>
              <h3>{project.project_display_name}</h3>
              <p>{project.sector}</p>
            </div>
            <div className="health-strip">
              <span className={`health-pill ${warningTone(project.schedule_health)}`}>Schedule {project.schedule_health || "N/A"}</span>
              <span className={`health-pill ${warningTone(project.cost_health)}`}>Cost {project.cost_health || "N/A"}</span>
              <span className={`health-pill ${warningTone(project.delay_exposure)}`}>Delay {project.delay_exposure || "N/A"}</span>
              <span className={`health-pill ${warningTone(project.claim_exposure_level)}`}>Claims {project.claim_exposure_level || "N/A"}</span>
            </div>
            <SourceConfidenceBadge
              confidence={project.data_confidence}
              dataQuality={project.data_quality}
              lastUpdated={project.last_updated}
              sourceCount={countSources(project)}
              compact
            />
          </article>
        )) : (
          <div className="empty-intel">No high-priority project warning is currently triggered by the available data.</div>
        )}
      </div>
    </section>
  );
}
