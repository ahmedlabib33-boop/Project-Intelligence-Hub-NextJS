"use client";

/**
 * Filtering and cell-rendering helpers shared by the analyzer views.
 */

import type { ReactNode } from "react";
import { formatDate, formatDelta, formatNum } from "../../../lib/xer/format";
import { CONSTRAINT, HARD_CONSTRAINTS, type Task } from "../../../lib/xer/model";
import type { AnalyzerOptions } from "../../../lib/xer/options";
import type { ProjectView } from "../../../lib/xer/model";
import { Badge } from "./ui";

/* ----------------------------------------------------------- filtering */

export type ActivityFilter = {
  q: string;
  wbs: string;
  status: "" | "ns" | "ip" | "cp";
  type: "" | "task" | "ms" | "loe";
  crit: "" | "c" | "n" | "neg" | "lp";
  floatMax: string;
  from: string;
  to: string;
  changed: "" | "y" | "n";
};

export const EMPTY_FILTER: ActivityFilter = {
  q: "", wbs: "", status: "", type: "", crit: "", floatMax: "", from: "", to: "", changed: "",
};

/** Ad-hoc filter pushed by a drill-through from a KPI, chart or check. */
export type AdHocFilter = { label: string; test: (t: Task) => boolean } | null;

export function filterTasks(
  P: ProjectView,
  filter: ActivityFilter,
  opts: AnalyzerOptions,
  adhoc: AdHocFilter,
  changedTest?: (t: Task) => boolean,
): Task[] {
  let list = P.tasks;

  if (filter.q) {
    const q = filter.q.toLowerCase();
    list = list.filter(
      (t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.wbsPath.toLowerCase().includes(q),
    );
  }
  if (filter.wbs) {
    const node = P.wbsById[filter.wbs];
    if (node) {
      const ids = new Set((node.allTasks || []).map((t) => t.id));
      list = list.filter((t) => ids.has(t.id));
    }
  }
  if (filter.status === "ns") list = list.filter((t) => !t.started);
  else if (filter.status === "ip") list = list.filter((t) => t.started && !t.done);
  else if (filter.status === "cp") list = list.filter((t) => t.done);

  if (filter.type === "ms") list = list.filter((t) => t.isMile);
  else if (filter.type === "task") list = list.filter((t) => !t.isMile && !t.isLOE && !t.isWBSsum);
  else if (filter.type === "loe") list = list.filter((t) => t.isLOE || t.isWBSsum);

  if (filter.crit === "c") list = list.filter((t) => t.tf !== null && t.tf <= opts.tfCritical && !t.done);
  else if (filter.crit === "n") {
    list = list.filter((t) => t.tf !== null && t.tf > opts.tfCritical && t.tf <= opts.tfNear && !t.done);
  } else if (filter.crit === "neg") list = list.filter((t) => t.tf !== null && t.tf < 0);
  else if (filter.crit === "lp") list = list.filter((t) => t.c && t.c.lp);

  if (filter.floatMax !== "") {
    const max = Number(filter.floatMax);
    if (Number.isFinite(max)) list = list.filter((t) => t.tf !== null && t.tf <= max);
  }
  if (filter.from) {
    const d = new Date(filter.from);
    list = list.filter((t) => t.finish && t.finish >= d);
  }
  if (filter.to) {
    const d = new Date(filter.to);
    d.setHours(23, 59);
    list = list.filter((t) => t.start && t.start <= d);
  }

  if (adhoc) list = list.filter(adhoc.test);

  if (filter.changed && changedTest) {
    if (filter.changed === "y") list = list.filter(changedTest);
    else list = list.filter((t) => !changedTest(t));
  }

  return list;
}

/* ------------------------------------------------------------- cells */

export function statusTag(t: Task): ReactNode {
  const tone = t.done ? "mut" : t.started ? "ok" : "info";
  return <Badge tone={tone}>{t.statusName}</Badge>;
}

/** Total float cell — red at or below the critical threshold, amber near it. */
export function floatCell(value: number | null, opts: AnalyzerOptions): ReactNode {
  if (value === null) return <span className="xer-dim">—</span>;
  const tone = value < 0 ? "bad" : value <= opts.tfCritical ? "crit" : value <= opts.tfNear ? "warn" : "";
  return <span className={tone ? `xer-num xer-tone-text-${tone}` : "xer-num"}>{formatNum(value, 1)}</span>;
}

/** Date cell; an actual date is marked with a trailing A. */
export function dateCell(date: Date | null, actual?: Date | null): ReactNode {
  if (!date) return <span className="xer-dim">—</span>;
  return (
    <span className={actual ? "xer-date-actual" : undefined}>
      {formatDate(date)}
      {actual ? " A" : ""}
    </span>
  );
}

/**
 * Signed variance cell. `goodWhenNegative` flips the colouring for metrics
 * where a smaller number is the better outcome (finish dates, slippage).
 */
export function deltaCell(value: number | null, dec = 1, suffix = "", goodWhenNegative = true): ReactNode {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return <span className="xer-dim">—</span>;
  }
  const bad = goodWhenNegative ? value > 0 : value < 0;
  return <span className={`xer-num xer-tone-text-${bad ? "bad" : "ok"}`}>{formatDelta(value, dec, suffix)}</span>;
}

export function constraintTag(t: Task): ReactNode {
  if (!t.cstrType) return null;
  const hard = HARD_CONSTRAINTS.includes(t.cstrType);
  return <Badge tone={hard ? "bad" : "warn"}>{CONSTRAINT[t.cstrType] || t.cstrType}</Badge>;
}

export function percentCell(pct: number): ReactNode {
  return (
    <div className="xer-pct">
      <span className="xer-num">{formatNum(pct, 0)}%</span>
      <span className="xer-pct-track">
        <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
    </div>
  );
}

/** Horizontal activity-code chain used for longest path, float paths and loops. */
export function PathChain({
  tasks,
  critical,
  max = 40,
  onPick,
}: {
  tasks: Task[];
  critical?: boolean;
  max?: number;
  onPick: (t: Task) => void;
}) {
  const shown = tasks.slice(0, max);
  return (
    <div className="xer-chain">
      {shown.map((t, i) => (
        <span key={`${t.id}-${i}`} className="xer-chain-item">
          {i ? <i className="xer-chain-arrow">→</i> : null}
          <button
            type="button"
            className={`xer-chain-node${critical ? " xer-chain-crit" : ""}`}
            title={t.name}
            onClick={() => onPick(t)}
          >
            {t.code}
          </button>
        </span>
      ))}
      {tasks.length > max ? <span className="xer-dim"> … +{formatNum(tasks.length - max)} more</span> : null}
    </div>
  );
}

/** Health-score tone shared by the dashboard widget and the health view. */
export function scoreTone(score: number): "ok" | "warn" | "crit" {
  return score >= 85 ? "ok" : score >= 65 ? "warn" : "crit";
}
