"use client";

import SourceConfidenceBadge from "./SourceConfidenceBadge";

export type DecisionBriefItem = {
  decision_id: string;
  project_key: string;
  project_display_name: string;
  sector: string;
  priority: string;
  issue: string;
  trigger: string;
  impact: string;
  owner: string;
  evidence_status: string;
  urgency: string;
  recommended_action: string;
  last_updated?: string | null;
};

export type ActionItem = {
  decisionId: string;
  project: string;
  issue: string;
  owner: string;
  priority: string;
  dueDate: string;
  evidenceStatus: string;
  action: string;
  status: string;
};

export default function ManagementDecisionBrief({
  items,
  onAddAction
}: {
  items: DecisionBriefItem[];
  onAddAction?: (action: ActionItem) => void;
}) {
  return (
    <section className="glass-panel management-decision-brief">
      <div className="section-header">
        <div>
          <p className="eyebrow">Management Decision Brief</p>
          <h2>Executive Action Points</h2>
        </div>
        <span>{items.length} decision signals</span>
      </div>
      <div className="decision-brief-grid">
        {items.length ? items.map((item) => (
          <article className={`decision-card urgency-${item.urgency.toLowerCase()}`} key={item.decision_id}>
            <div className="decision-card-head">
              <div>
                <span>{item.sector}</span>
                <h3>{item.issue}</h3>
              </div>
              <b>{item.urgency}</b>
            </div>
            <dl>
              <div><dt>Project</dt><dd>{item.project_display_name}</dd></div>
              <div><dt>Trigger</dt><dd>{item.trigger}</dd></div>
              <div><dt>Impact</dt><dd>{item.impact}</dd></div>
              <div><dt>Owner</dt><dd>{item.owner}</dd></div>
              <div><dt>Action</dt><dd>{item.recommended_action}</dd></div>
            </dl>
            <div className="decision-card-foot">
              <SourceConfidenceBadge confidence={item.evidence_status} lastUpdated={item.last_updated} compact />
              <button
                type="button"
                onClick={() => onAddAction?.({
                  decisionId: item.decision_id,
                  project: item.project_display_name,
                  issue: item.issue,
                  owner: item.owner,
                  priority: item.urgency,
                  dueDate: "",
                  evidenceStatus: item.evidence_status,
                  action: item.recommended_action,
                  status: "Open"
                })}
              >
                Add to action tracker
              </button>
            </div>
          </article>
        )) : (
          <div className="empty-intel">No executive decision trigger was generated from the available project data.</div>
        )}
      </div>
    </section>
  );
}
