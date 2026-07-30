import Image from "next/image";

type AnomalyItem = {
  activity_id: string;
  activity_name: string;
  anomaly_score: number;
  reason: string;
};

type ModelGovernance = {
  status: string;
  minimum_labelled_records: number;
  records_available: number;
  reason: string;
};

export type AdvancedAnalyticsPayload = {
  scope: string;
  data_profile: {
    activity_records: number;
    s_curve_periods: number;
    delay_event_records: number;
    risk_records: number;
    labelled_historical_outcome_records: number;
  };
  activity_anomalies: {
    status: string;
    method: string;
    flagged_count: number;
    message: string;
    items: AnomalyItem[];
  };
  s_curve_forecast: {
    status: string;
    method?: string;
    projected_completion_date?: string | null;
    months_to_target?: number | null;
    message: string;
  };
  s_curve_chart_url?: string | null;
  technical_topics: {
    status: string;
    method: string;
    source_text_records: number;
    topics: Array<{ term: string; count: number }>;
  };
  model_governance: {
    xgboost: ModelGovernance;
    pytorch: ModelGovernance;
    tensorflow: ModelGovernance;
  };
  disclaimer: string;
};

function statusLabel(value: string | null | undefined) {
  if (!value) return "Not available";
  return value.replaceAll("_", " ");
}

export default function AdvancedAnalyticsPanel({ analytics }: { analytics?: AdvancedAnalyticsPayload }) {
  if (!analytics) {
    return (
      <section className="feature-card">
        <div className="feature-card-head">
          <h3>Analytics Intelligence</h3>
          <span>Pending generation</span>
        </div>
        <p>Analytics will appear after the selected project data is processed. No information is taken from another project.</p>
      </section>
    );
  }

  const governance = [
    ["XGBoost", analytics.model_governance.xgboost],
    ["PyTorch", analytics.model_governance.pytorch],
    ["TensorFlow", analytics.model_governance.tensorflow]
  ] as const;

  return (
    <div className="feature-stack analytics-panel">
      <section className="feature-card">
        <div className="feature-card-head">
          <div>
            <h3>Project Analytics Intelligence</h3>
            <p>Source-backed screening and trend diagnostics for the selected project only.</p>
          </div>
          <span>{statusLabel(analytics.scope)}</span>
        </div>
        <div className="workspace-grid">
          <article className="mini-metric"><span>Activities screened</span><strong>{analytics.data_profile.activity_records}</strong><small>Project activity records</small></article>
          <article className="mini-metric"><span>Anomaly flags</span><strong>{analytics.activity_anomalies.flagged_count}</strong><small>{statusLabel(analytics.activity_anomalies.status)}</small></article>
          <article className="mini-metric"><span>Trend projection</span><strong>{analytics.s_curve_forecast.projected_completion_date || "N/A"}</strong><small>{statusLabel(analytics.s_curve_forecast.status)}</small></article>
        </div>
      </section>

      <div className="workspace-two analytics-chart-layout">
        <section className="feature-card">
          <div className="feature-card-head"><h3>S-Curve Trend</h3><span>{analytics.s_curve_forecast.method || "Data check"}</span></div>
          <p>{analytics.s_curve_forecast.message}</p>
          <div className="analytics-detail-row"><b>Source periods</b><span>{analytics.data_profile.s_curve_periods}</span></div>
          <div className="analytics-detail-row"><b>Indicative months to target</b><span>{analytics.s_curve_forecast.months_to_target ?? "N/A"}</span></div>
        </section>
        <section className="feature-card analytics-chart-card">
          {analytics.s_curve_chart_url ? (
            <Image src={analytics.s_curve_chart_url} alt="Selected project S-curve trend analysis" width={1200} height={600} unoptimized />
          ) : (
            <p className="empty-note">A chart will appear when the project has sufficient dated S-curve data.</p>
          )}
        </section>
      </div>

      <div className="workspace-two analytics-chart-layout">
        <section className="feature-card">
          <div className="feature-card-head"><h3>Activity Outlier Screen</h3><span>{analytics.activity_anomalies.method}</span></div>
          <p>{analytics.activity_anomalies.message}</p>
          {analytics.activity_anomalies.items.length ? (
            <div className="template-grid">
              {analytics.activity_anomalies.items.map((item) => (
                <div key={`${item.activity_id}-${item.anomaly_score}`}>
                  <b>{item.activity_id} - {item.activity_name}</b>
                  <span>{item.reason}; screening score {item.anomaly_score.toFixed(3)}</span>
                </div>
              ))}
            </div>
          ) : <p className="empty-note">No usable activity anomalies were returned. This is not a confirmation that the programme has no issues.</p>}
        </section>
        <section className="feature-card">
          <div className="feature-card-head"><h3>Technical Topics</h3><span>{analytics.technical_topics.method}</span></div>
          {analytics.technical_topics.topics.length ? (
            <div className="analytics-topic-list">
              {analytics.technical_topics.topics.map((topic) => <span key={topic.term}>{topic.term} <b>{topic.count}</b></span>)}
            </div>
          ) : <p className="empty-note">No project text is available for topic extraction.</p>}
          <p className="analytics-note">{analytics.technical_topics.source_text_records} project text records reviewed.</p>
        </section>
      </div>

      <section className="feature-card">
        <div className="feature-card-head"><h3>Predictive Model Governance</h3><span>Evidence gate</span></div>
        <p>Supervised and deep-learning models remain untrained until the selected project has validated labelled history. This prevents unsupported predictions.</p>
        <div className="workspace-grid">
          {governance.map(([name, item]) => (
            <article className="mini-metric" key={name}>
              <span>{name}</span><strong>{statusLabel(item.status)}</strong>
              <small>{item.records_available} of {item.minimum_labelled_records} labelled records required</small>
            </article>
          ))}
        </div>
      </section>
      <p className="analytics-disclaimer">{analytics.disclaimer}</p>
    </div>
  );
}
