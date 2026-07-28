"use client";

import { useMemo, useState } from "react";

type ScenarioProject = {
  project_key: string;
  project_display_name: string;
  contract_value: number | null;
  spent_amount: number | null;
  actual_progress: number | null;
  planned_progress: number | null;
  delay_days: number | null;
  spi: number | null;
  cpi: number | null;
};

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function numberValue(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

export default function ScenarioPlanner({
  projects,
  portfolioContractValue
}: {
  projects: ScenarioProject[];
  portfolioContractValue: number | null;
}) {
  const [projectKey, setProjectKey] = useState(projects[0]?.project_key || "");
  const [delayAdjustment, setDelayAdjustment] = useState(7);
  const [progressAdjustment, setProgressAdjustment] = useState(-2);
  const [costAdjustment, setCostAdjustment] = useState(0);
  const project = projects.find((item) => item.project_key === projectKey) || projects[0];

  const result = useMemo(() => {
    if (!project) return null;
    const actualProgress = Math.max(0, Math.min(1, (project.actual_progress || 0) + (progressAdjustment / 100)));
    const spent = (project.spent_amount || 0) + costAdjustment;
    const bac = project.contract_value || 0;
    const ev = bac * actualProgress;
    const pv = bac * (project.planned_progress || 0);
    const spi = pv > 0 ? ev / pv : null;
    const cpi = spent > 0 ? ev / spent : null;
    const totalDelay = (project.delay_days || 0) + delayAdjustment;
    const portfolioWeight = portfolioContractValue && bac ? bac / portfolioContractValue : null;
    return { actualProgress, spent, spi, cpi, totalDelay, portfolioWeight };
  }, [project, delayAdjustment, progressAdjustment, costAdjustment, portfolioContractValue]);

  return (
    <section className="glass-panel scenario-planner">
      <div className="section-header">
        <div>
          <p className="eyebrow">Scenario Mode</p>
          <h2>What If This Project Slips?</h2>
        </div>
        <span>Temporary UI calculation</span>
      </div>
      <div className="scenario-controls">
        <label>
          <span>Project</span>
          <select value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            {projects.map((item) => <option value={item.project_key} key={item.project_key}>{item.project_display_name}</option>)}
          </select>
        </label>
        <label>
          <span>Delay days adjustment</span>
          <input type="number" value={delayAdjustment} onChange={(event) => setDelayAdjustment(Number(event.target.value) || 0)} />
        </label>
        <label>
          <span>Progress adjustment %</span>
          <input type="number" value={progressAdjustment} onChange={(event) => setProgressAdjustment(Number(event.target.value) || 0)} />
        </label>
        <label>
          <span>Spent adjustment</span>
          <input type="number" value={costAdjustment} onChange={(event) => setCostAdjustment(Number(event.target.value) || 0)} />
        </label>
      </div>
      {result && (
        <div className="scenario-results">
          <article><span>Scenario Progress</span><b>{percent(result.actualProgress)}</b></article>
          <article><span>Scenario SPI</span><b>{numberValue(result.spi, 2)}</b></article>
          <article><span>Scenario CPI</span><b>{numberValue(result.cpi, 2)}</b></article>
          <article><span>Total Delay Exposure</span><b>{numberValue(result.totalDelay, 0)} days</b></article>
          <article><span>Spent Amount</span><b>{money(result.spent)}</b></article>
          <article><span>Portfolio Weight</span><b>{percent(result.portfolioWeight)}</b></article>
        </div>
      )}
      <p className="scenario-note">Scenario mode never writes back to source data. Update the project files to make permanent changes.</p>
    </section>
  );
}
