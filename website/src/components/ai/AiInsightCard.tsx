"use client";

import { useEffect, useState } from "react";

type InsightType = "summary" | "risk" | "delay" | "letters" | "contract";

type AiInsightCardProps = {
  type: InsightType;
  projectKey: string;
};

const endpointByType: Record<InsightType, string> = {
  summary: "/api/summarize-project",
  risk: "/api/summarize-project",
  delay: "/api/analyze-delay",
  letters: "/api/analyze-letters",
  contract: "/api/analyze-contract"
};

const titleByType: Record<InsightType, string> = {
  summary: "AI Executive Insight",
  risk: "AI Risk Insight",
  delay: "AI Delay Insight",
  letters: "AI Letters Insight",
  contract: "AI Contract Insight"
};

export default function AiInsightCard({ type, projectKey }: AiInsightCardProps) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadInsight() {
    if (!projectKey) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpointByType[type], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "AI insight failed.");
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI insight failed.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInsight();
    }, 0);
    return () => window.clearTimeout(timer);
    // The requested context is intentionally reloaded when its project or insight type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, type]);

  function renderList(label: string, values: unknown) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return (
      <div className="ai-insight-list">
        <b>{label}</b>
        <ul>
          {values.slice(0, 5).map((item, index) => <li key={index}>{String(item)}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <section className="ai-insight-card">
      <div className="ai-insight-head">
        <div>
          <span>Groq analysis</span>
          <h3>{titleByType[type]}</h3>
        </div>
        <button type="button" onClick={() => void loadInsight()} disabled={loading}>
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>
      {error ? <p className="ai-insight-error">{error}</p> : null}
      {!error && loading ? <p className="ai-insight-muted">Generating source-backed insight...</p> : null}
      {!error && data ? (
        <div className="ai-insight-body">
          {"summary" in data ? <p>{String(data.summary)}</p> : null}
          {"criticalPathImpact" in data ? <p>{String(data.criticalPathImpact)}</p> : null}
          {"riskExposure" in data ? <p><b>Risk exposure:</b> {String(data.riskExposure)}</p> : null}
          {"claimExposure" in data ? <p><b>Claim exposure:</b> {String(data.claimExposure)}</p> : null}
          {renderList("Actions", data.actions)}
          {renderList("Risks", data.risks)}
          {renderList("Themes", data.themes)}
          {renderList("Critical letters", data.criticalLetters)}
          {renderList("Action items", data.actionItems)}
          {renderList("Deadlines", data.deadlines)}
          {renderList("Delay events", data.delayEvents)}
          {renderList("Recovery options", data.recoveryOptions)}
          {renderList("Key clauses", data.keyClauses)}
          {renderList("Recommendations", data.recommendations)}
          <small>{String(data.provider || "AI")} / {String(data.model || "model unavailable")}</small>
        </div>
      ) : null}
      <p className="ai-disclaimer">AI-generated. Verify before acting.</p>
    </section>
  );
}
