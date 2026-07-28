"use client";

import { useEffect, useMemo, useState } from "react";
import type { ActionItem } from "./ManagementDecisionBrief";

const emptyAction: ActionItem = {
  decisionId: "",
  project: "",
  issue: "",
  owner: "",
  priority: "Medium",
  dueDate: "",
  evidenceStatus: "Medium",
  action: "",
  status: "Open"
};

export default function ActionTracker({
  scopeKey,
  seedActions = []
}: {
  scopeKey: string;
  seedActions?: ActionItem[];
}) {
  const storageKey = `pih-actions:${scopeKey}`;
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [draft, setDraft] = useState<ActionItem>(emptyAction);

  useEffect(() => {
    try {
      setActions(JSON.parse(localStorage.getItem(storageKey) || "[]"));
    } catch {
      setActions([]);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!seedActions.length) return;
    setActions((current) => {
      const existing = new Set(current.map((item) => item.decisionId));
      const merged = [...seedActions.filter((item) => !existing.has(item.decisionId)), ...current];
      localStorage.setItem(storageKey, JSON.stringify(merged));
      return merged;
    });
  }, [seedActions, storageKey]);

  const openCount = useMemo(() => actions.filter((item) => item.status !== "Closed").length, [actions]);

  function save(next: ActionItem[]) {
    setActions(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return (
    <section className="glass-panel action-tracker">
      <div className="section-header">
        <div>
          <p className="eyebrow">Decision Log</p>
          <h2>Action Tracker</h2>
        </div>
        <span>{openCount} open actions</span>
      </div>
      <div className="action-form">
        <input placeholder="Issue" value={draft.issue} onChange={(event) => setDraft({ ...draft, issue: event.target.value })} />
        <input placeholder="Owner" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} />
        <input placeholder="Due date" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
        <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
        <button
          type="button"
          onClick={() => {
            if (!draft.issue.trim()) return;
            const item = { ...draft, decisionId: draft.decisionId || `MANUAL-${Date.now()}`, status: draft.status || "Open" };
            save([item, ...actions]);
            setDraft(emptyAction);
          }}
        >
          Add action
        </button>
      </div>
      <div className="action-table">
        <div className="action-row head">
          <span>Project</span><span>Issue</span><span>Owner</span><span>Priority</span><span>Status</span>
        </div>
        {actions.length ? actions.map((item) => (
          <div className="action-row" key={item.decisionId}>
            <span>{item.project || "Portfolio"}</span>
            <span>{item.issue}</span>
            <span>{item.owner || "N/A"}</span>
            <span>{item.priority}</span>
            <select value={item.status} onChange={(event) => save(actions.map((action) => action.decisionId === item.decisionId ? { ...action, status: event.target.value } : action))}>
              <option>Open</option>
              <option>In Progress</option>
              <option>Closed</option>
            </select>
          </div>
        )) : <div className="empty-intel">No actions yet. Convert a decision item or add a management action.</div>}
      </div>
    </section>
  );
}
