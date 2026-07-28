"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Loader2, Lightbulb } from "lucide-react";

interface AiInsightCardProps {
  type: "summary" | "risk" | "delay" | "letters" | "contract";
  projectId?: string;
}

const ENDPOINTS: Record<string, string> = {
  summary: "/api/summarize-project",
  risk: "/api/summarize-project",
  delay: "/api/analyze-delay",
  letters: "/api/analyze-letters",
  contract: "/api/analyze-contract",
};

const TITLES: Record<string, string> = {
  summary: "AI Executive Summary",
  risk: "AI Risk Assessment",
  delay: "AI Delay Analysis",
  letters: "AI Letters Intelligence",
  contract: "AI Contract Insight",
};

export default function AiInsightCard({ type, projectId }: AiInsightCardProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchInsight = async () => {
    if (!projectId) {
      setLoading(false);
      setError("Select a project to see AI insights.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(ENDPOINTS[type], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (err: any) {
      setError(err.message || "Failed to load insight.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsight();
  }, [projectId, type]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Generating AI insight...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-amber-700">
          <AlertTriangle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (type) {
      case "summary":
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{data?.summary}</p>
            {data?.actions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Recommended Actions</p>
                <ul className="space-y-1">
                  {data.actions.map((a: string, i: number) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-blue-500">•</span>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {data?.risks?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Key Risks</p>
                <ul className="space-y-1">
                  {data.risks.map((r: string, i: number) => (
                    <li key={i} className="text-sm text-red-600 flex gap-2"><AlertTriangle size={14} />{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {data?.health && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                data.health === "Green" ? "bg-green-100 text-green-700" :
                data.health === "Yellow" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-700"
              }`}>{data.health}</span>
            )}
          </div>
        );
      case "delay":
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">{data?.criticalPathImpact}</p>
            {data?.delayEvents?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Delay Events</p>
                <ul className="space-y-1">
                  {data.delayEvents.map((e: string, i: number) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-amber-500">•</span>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {data?.recoveryOptions?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Recovery Options</p>
                <ul className="space-y-1">
                  {data.recoveryOptions.map((o: string, i: number) => (
                    <li key={i} className="text-sm text-green-700 flex gap-2"><span className="text-green-500">→</span>{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      default:
        return <p className="text-sm text-slate-700">{JSON.stringify(data, null, 2)}</p>;
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-slate-800">{TITLES[type]}</h3>
        </div>
        <button onClick={fetchInsight} className="rounded p-1 hover:bg-slate-100 transition-colors" title="Refresh">
          <RefreshCw size={14} className="text-slate-400" />
        </button>
      </div>
      {renderContent()}
      <p className="mt-3 text-[10px] text-slate-400">AI-generated — verify before acting · {data?.provider} · {data?.model}</p>
    </div>
  );
}
