// Example: How to integrate AI components into your existing dashboard page
// Copy the relevant parts into your actual page file

"use client";

import { useState } from "react";
import AiChatPanel from "@/components/AiChatPanel";
import AiInsightCard from "@/components/AiInsightCard";

export default function DecisionMakingDashboard() {
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedSector, setSelectedSector] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Your existing header, sidebar, project selector */}

      <main className="p-6">
        {/* Project selector */}
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="mb-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select a project...</option>
          <option value="lmd-bridge">LMD Bridge & Road Interchange</option>
          <option value="roya-big-project">ROYA-BIG PROJECT PHASE01</option>
          <option value="sophia-mall">Sophia Mall Mixed-Use</option>
          <option value="suez-tunnel">Suez Tunnel Civil & MEP</option>
        </select>

        {/* Tab navigation */}
        <div className="flex gap-2 mb-4">
          {["overview", "risk", "delay", "letters", "contract"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${
                activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content with AI insights */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            {/* Your existing Overview content */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Project Overview</h2>
              {/* ... existing content ... */}
            </div>

            {/* AI Executive Summary Card */}
            <AiInsightCard type="summary" projectId={selectedProject} />
          </div>
        )}

        {activeTab === "risk" && (
          <div className="space-y-4">
            {/* Your existing Risk Matrix content */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Risk Matrix</h2>
              {/* ... existing content ... */}
            </div>

            {/* AI Risk Assessment Card */}
            <AiInsightCard type="risk" projectId={selectedProject} />
          </div>
        )}

        {activeTab === "delay" && (
          <div className="space-y-4">
            {/* Your existing Delay Analysis content */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Delay Analysis</h2>
              {/* ... existing content ... */}
            </div>

            {/* AI Delay Analysis Card */}
            <AiInsightCard type="delay" projectId={selectedProject} />
          </div>
        )}

        {activeTab === "letters" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Letters Intelligence</h2>
            </div>
            <AiInsightCard type="letters" projectId={selectedProject} />
          </div>
        )}

        {activeTab === "contract" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Contract & Claims</h2>
            </div>
            <AiInsightCard type="contract" projectId={selectedProject} />
          </div>
        )}
      </main>

      {/* Floating AI Chat Panel — appears on all pages */}
      <AiChatPanel projectId={selectedProject} sector={selectedSector} />
    </div>
  );
}
