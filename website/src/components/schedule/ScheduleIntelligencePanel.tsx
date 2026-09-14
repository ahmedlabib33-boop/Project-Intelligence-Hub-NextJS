"use client";

import XerAnalyzerWorkspace from "./XerAnalyzerWorkspace";

const STAGES = [
  "Create schedule — Tender / Detailed",
  "Load XER",
  "Analyse & DCMA health",
  "Planning library",
  "Activity mapping",
  "Mitigation · Recovery · Revised",
  "Compare & export",
];

/**
 * Schedule Intelligence — one layer, one pipeline. A single loaded schedule
 * and a single calendar-aware CPM drive analysis, the editable planning
 * library, activity mapping and every Mitigation, Recovery and Revised
 * scenario.
 */
export default function ScheduleIntelligencePanel({ projectName }: { projectName: string }) {
  return (
    <div className="schedule-intelligence">
      <section className="schedule-intelligence-hero">
        <div>
          <p>Schedule Intelligence · one pipeline</p>
          <h2>Create, analyse, plan and recover {projectName} in one pipeline</h2>
          <span>
            Create a tender or detailed schedule, or load a Primavera P6 XER. The same calendar-aware CPM — the one that reproduces P6&apos;s stored finish — drives the
            health analysis, the editable planning library and activity mapping, and Mitigation, Recovery and Revised programme
            scenarios, then compares any two revisions.
          </span>
        </div>
        <div className="schedule-intelligence-hero-badge">
          <b>Source protected</b>
          <span>Browser-local processing<br />P6 verification remains mandatory</span>
        </div>
      </section>
      <ol className="pl-pipeline" aria-label="Pipeline stages">
        {STAGES.map((stage, i) => (
          <li key={stage}><b>{i + 1}</b>{stage}</li>
        ))}
      </ol>
      <XerAnalyzerWorkspace projectName={projectName} />
    </div>
  );
}
