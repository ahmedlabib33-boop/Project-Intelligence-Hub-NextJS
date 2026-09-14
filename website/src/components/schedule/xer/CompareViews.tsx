"use client";

/**
 * Two-schedule comparison workspace: summary, activity differences, logic
 * differences, date variance, critical-path movement, structure/calendars,
 * impact ranking and a before/after Gantt overlay.
 */

import { useMemo, useState } from "react";
import {
  COMPARE_FIELDS, fieldDisplay,
  type ActivityDiff, type Comparison, type RelDiff,
} from "../../../lib/xer/compare";
import type { CalendarSummary, WorkCalendar } from "../../../lib/xer/calendar";
import { clamp, formatDate, formatDelta, formatMoney, formatNum, percent, sortBy, uniq } from "../../../lib/xer/format";
import type { ProjectView, Task, WbsNode } from "../../../lib/xer/model";
import type { AnalyzerOptions } from "../../../lib/xer/options";
import { dateCell, deltaCell, floatCell, PathChain } from "./helpers";
import { Badge, Bars, Card, type Column, DataTable, Kpi, Kpis, SectionTitle } from "./ui";
import { DiffBlock } from "./ActivityDrawer";

export type CompareTab = "sum" | "act" | "logic" | "var" | "crit" | "struct" | "impact" | "gantt";

export const COMPARE_TABS: [CompareTab, string][] = [
  ["sum", "Summary"],
  ["act", "Activity differences"],
  ["logic", "Logic differences"],
  ["var", "Date variance"],
  ["crit", "Critical path movement"],
  ["struct", "Structure & calendars"],
  ["impact", "Impact analysis"],
  ["gantt", "Gantt overlay"],
];

export type CompareCtx = {
  cmp: Comparison;
  opts: AnalyzerOptions;
  openTask: (t: Task, view?: ProjectView) => void;
  openDiff: (d: ActivityDiff) => void;
};

/* -------------------------------------------------------------- summary */

export function CompareSummary({ ctx, goTab }: { ctx: CompareCtx; goTab: (t: CompareTab) => void }) {
  const { cmp } = ctx;
  const s = cmp.summaryCounts;
  const pairCount = cmp.diffs.length;

  const categoryBars = Object.entries(cmp.catCount)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, tone: "blue" }));

  const fieldBars = Object.entries(cmp.fieldCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([label, value]) => ({ label, value, tone: "violet" }));

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Similarity" value={`${cmp.similarity}%`} note={`${cmp.matchRate}% of activities matched by ID`} tone={cmp.similarity >= 95 ? "ok" : cmp.similarity >= 70 ? "warn" : "crit"} />
        <Kpi label="Project finish variance" value={formatDelta(cmp.finishVar, 1, " d")} note={`${formatDate(cmp.PA.finish)} → ${formatDate(cmp.PB.finish)}`} tone={(cmp.finishVar || 0) > 0.5 ? "crit" : (cmp.finishVar || 0) < -0.5 ? "ok" : ""} />
        <Kpi label="Data date movement" value={formatDelta(cmp.dataDateVar, 0, " d")} note={`${formatDate(cmp.PA.dataDate)} → ${formatDate(cmp.PB.dataDate)}`} />
        <Kpi label="Modified activities" value={formatNum(s.modified)} note={`of ${formatNum(pairCount)} matched`} tone="warn" onClick={() => goTab("act")} />
        <Kpi label="Added in B" value={formatNum(s.added)} note="new scope" tone="ok" onClick={() => goTab("act")} />
        <Kpi label="Removed from A" value={formatNum(s.removed)} note="deleted scope" tone="crit" onClick={() => goTab("act")} />
        <Kpi label="Unchanged" value={formatNum(s.unchanged)} note="identical in every compared field" />
        <Kpi label="Likely renamed" value={formatNum(s.renamed)} note="matched by description" />
        <Kpi label="Relationships added" value={formatNum(s.relAdded)} tone="ok" onClick={() => goTab("logic")} />
        <Kpi label="Relationships removed" value={formatNum(s.relRemoved)} tone="crit" onClick={() => goTab("logic")} />
        <Kpi label="Relationships changed" value={formatNum(s.relChanged)} note="type or lag" tone="warn" onClick={() => goTab("logic")} />
        {cmp.bei !== null ? <Kpi label="BEI (B against A)" value={formatNum(cmp.bei, 2)} note="≥ 0.95 target" tone={cmp.bei >= 0.95 ? "ok" : "crit"} /> : null}
      </Kpis>

      {cmp.matchRate < 5 ? (
        <div className="xer-callout xer-callout-warn">
          <b>These two files share almost no activity IDs.</b> They are being treated as a full replacement rather than
          a revision. Try matching by activity name in the comparison settings, or check that the intended files were
          loaded — the renamed-activity detector may still pair them up.
        </div>
      ) : null}

      <div className="xer-grid xer-grid-2">
        <Card eyebrow="Change profile" title="Where the differences are">
          {categoryBars.length ? <Bars data={categoryBars} /> : <p className="xer-muted">No field-level differences.</p>}
        </Card>
        <Card eyebrow="Change profile" title="Change mix">
          <Bars
            data={[
              { label: "Unchanged", value: s.unchanged, tone: "mut" },
              { label: "Modified", value: s.modified, tone: "warn" },
              { label: "Added in B", value: s.added, tone: "ok" },
              { label: "Removed from A", value: s.removed, tone: "bad" },
            ]}
          />
        </Card>
      </div>

      <Card eyebrow="Change profile" title="Most frequently changed fields">
        {fieldBars.length ? <Bars data={fieldBars} /> : <p className="xer-muted">None.</p>}
      </Card>

      <Card eyebrow="Programme level" title="Project comparison">
        <DataTable
          rows={cmp.proj}
          rowKey={(r) => r.l}
          pageSize={40}
          exportName="project-comparison"
          minWidth={800}
          columns={[
            { k: "l", label: "Metric", cell: (r) => r.l },
            {
              k: "a", label: "Schedule A",
              cell: (r) => (r.t === "date" ? formatDate(r.a as Date) || "—" : r.t === "money" ? formatMoney(r.a as number) : r.t === "num" ? formatNum(r.a as number, 0) + (r.u || "") : String(r.a || "—")),
            },
            {
              k: "b", label: "Schedule B",
              cell: (r) => (r.t === "date" ? formatDate(r.b as Date) || "—" : r.t === "money" ? formatMoney(r.b as number) : r.t === "num" ? formatNum(r.b as number, 0) + (r.u || "") : String(r.b || "—")),
            },
            {
              k: "d", label: "Variance", align: "right",
              cell: (r) => {
                if (!r.changed) return <span className="xer-dim">—</span>;
                if (r.t === "text") return <Badge tone="mod">changed</Badge>;
                // For finish dates, float, constraints and open ends a rise is the worse outcome.
                const riseIsBad = /finish|float|constraint|out-of-seq|open ends/i.test(r.l);
                return deltaCell(r.delta, r.t === "money" ? 0 : 1, r.t === "date" ? " d" : r.u || "", riseIsBad);
              },
              sort: (r) => r.delta,
            },
            { k: "s", label: "", cell: (r) => (r.changed ? <Badge tone="mod">≠</Badge> : <Badge tone="ok">=</Badge>) },
          ]}
        />
      </Card>
    </div>
  );
}

/* --------------------------------------------------- activity differences */

type DiffRow = { kind: "mod" | "same" | "add" | "del" | "ren"; d?: ActivityDiff; t: Task; score?: number };

const KIND_LABEL: Record<DiffRow["kind"], string> = {
  mod: "modified", same: "same", add: "added", del: "removed", ren: "renamed",
};
const KIND_TONE: Record<DiffRow["kind"], string> = { mod: "mod", same: "mut", add: "add", del: "del", ren: "info" };

export function CompareActivities({ ctx }: { ctx: CompareCtx }) {
  const { cmp } = ctx;
  const [filter, setFilter] = useState<"all" | "modified" | "added" | "removed" | "unchanged" | "renamed">("all");
  const [category, setCategory] = useState("");

  const rows = useMemo<DiffRow[]>(() => {
    const out: DiffRow[] = [];
    if (filter === "renamed") {
      for (const r of cmp.renames) {
        out.push({ kind: "ren", d: cmp.diffs.find((d) => d.a === r.a), t: r.b, score: r.score });
      }
    } else {
      if (filter === "all" || filter === "modified") {
        for (const d of cmp.diffs) if (d.changes.length || d.logicChanges.length) out.push({ kind: "mod", d, t: d.b });
      }
      if (filter === "all" || filter === "unchanged") {
        for (const d of cmp.diffs) if (!d.changes.length && !d.logicChanges.length) out.push({ kind: "same", d, t: d.b });
      }
      if (filter === "all" || filter === "added") for (const t of cmp.added) out.push({ kind: "add", t });
      if (filter === "all" || filter === "removed") for (const t of cmp.removed) out.push({ kind: "del", t });
    }
    return out.filter((r) => !category || (r.d && r.d.cats.includes(category)));
  }, [cmp, filter, category]);

  const filters: [typeof filter, string, number][] = [
    ["all", "All", cmp.diffs.length + cmp.added.length + cmp.removed.length],
    ["modified", "Modified", cmp.summaryCounts.modified],
    ["added", "Added in B", cmp.added.length],
    ["removed", "Removed from A", cmp.removed.length],
    ["unchanged", "Unchanged", cmp.unchanged],
    ["renamed", "Renamed", cmp.renames.length],
  ];

  return (
    <div className="xer-view">
      <div className="xer-toolbar">
        {filters.map(([key, label, count]) => (
          <button type="button" key={key} className={`xer-btn xer-btn-sm${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>
            {label} <i>{formatNum(count)}</i>
          </button>
        ))}
        <select className="xer-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All change categories</option>
          {uniq(COMPARE_FIELDS.map((f) => f.cat)).concat(["Logic network"]).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <Card>
        <DataTable
          rows={rows}
          rowKey={(r, i) => `${r.t.id}-${r.kind}-${i}`}
          pageSize={150}
          searchText={(r) => `${r.t.code} ${r.t.name} ${r.d ? r.d.changes.map((x) => `${x.label} ${x.aDisp} ${x.bDisp}`).join(" ") : ""}`}
          exportName="activity-differences"
          minWidth={1500}
          onRowClick={(r) => (r.d ? ctx.openDiff(r.d) : ctx.openTask(r.t, r.kind === "del" ? cmp.PA : cmp.PB))}
          columns={[
            { k: "k", label: "", width: "94px", cell: (r) => <Badge tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>, sort: (r) => r.kind },
            { k: "c", label: "Activity ID", cell: (r) => <span className="xer-mono">{r.t.code}</span>, sort: (r) => r.t.code },
            { k: "n", label: "Activity name", cell: (r) => r.t.name, sort: (r) => r.t.name },
            { k: "w", label: "WBS", cell: (r) => r.t.wbsPath, sort: (r) => r.t.wbsPath },
            { k: "ch", label: "Changes", align: "right", cell: (r) => (r.d ? r.d.changes.length + r.d.logicChanges.length : "—"), sort: (r) => (r.d ? -(r.d.changes.length + r.d.logicChanges.length) : 0) },
            {
              k: "f", label: "What changed",
              cell: (r) => (
                <span title={r.d ? r.d.changes.map((x) => `${x.label}: ${x.aDisp} → ${x.bDisp}`).join("\n") : ""}>
                  {r.d ? uniq(r.d.changes.map((x) => x.label)).concat(r.d.logicChanges.length ? ["Logic"] : []).join(", ") : ""}
                </span>
              ),
            },
            { k: "sv", label: "Start var", align: "right", cell: (r) => deltaCell(r.d?.startVar ?? null), sort: (r) => (r.d ? Math.abs(r.d.startVar || 0) : null) },
            { k: "fv", label: "Finish var", align: "right", cell: (r) => deltaCell(r.d?.finishVar ?? null), sort: (r) => (r.d ? Math.abs(r.d.finishVar || 0) : null) },
            { k: "dv", label: "Dur var", align: "right", cell: (r) => deltaCell(r.d?.durVar ?? null), sort: (r) => (r.d ? Math.abs(r.d.durVar || 0) : null) },
            { k: "tv", label: "Float var", align: "right", cell: (r) => deltaCell(r.d?.tfVar ?? null, 1, "", false), sort: (r) => (r.d ? r.d.tfVar : null) },
            { k: "pv", label: "% var", align: "right", cell: (r) => (r.d && r.d.pctVar ? formatDelta(r.d.pctVar, 1, "%") : <span className="xer-dim">—</span>), sort: (r) => (r.d ? r.d.pctVar : null) },
            {
              k: "cr", label: "Critical",
              cell: (r) => {
                if (!r.d) return null;
                if (!r.d.critA && r.d.critB) return <Badge tone="bad">became critical</Badge>;
                if (r.d.critA && !r.d.critB) return <Badge tone="ok">off critical</Badge>;
                return r.d.critB ? <Badge tone="mut">critical</Badge> : null;
              },
            },
          ]}
        />
      </Card>
    </div>
  );
}

/** Side-by-side field table shown in the diff drawer. */
export function SideBySide({ diff, cmp }: { diff: ActivityDiff; cmp: Comparison }) {
  return (
    <table className="xer-mini-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Schedule A</th>
          <th>Schedule B</th>
        </tr>
      </thead>
      <tbody>
        {COMPARE_FIELDS.map((f) => {
          let va = "—";
          let vb = "—";
          try {
            va = fieldDisplay(f, f.get(diff.a, cmp.PA));
            vb = fieldDisplay(f, f.get(diff.b, cmp.PB));
          } catch {
            /* a field that does not apply to this file stays as an em dash */
          }
          return (
            <tr key={f.k} className={va !== vb ? "xer-row-diff" : undefined}>
              <td>{f.l}</td>
              <td>{va}</td>
              <td>{vb}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------ logic differences */

export function CompareLogic({ ctx }: { ctx: CompareCtx }) {
  const { cmp } = ctx;

  const sideColumns = (side: "a" | "b"): Column<RelDiff>[] => [
    { k: "p", label: "Predecessor", cell: (r) => <span className="xer-mono">{r[side]?.pred?.code || "(ext)"}</span>, sort: (r) => r[side]?.pred?.code || "" },
    { k: "pn", label: "Predecessor name", cell: (r) => r[side]?.pred?.name || "", sort: (r) => r[side]?.pred?.name || "" },
    { k: "s", label: "Successor", cell: (r) => <span className="xer-mono">{r[side]?.succ?.code || "(ext)"}</span>, sort: (r) => r[side]?.succ?.code || "" },
    { k: "sn", label: "Successor name", cell: (r) => r[side]?.succ?.name || "", sort: (r) => r[side]?.succ?.name || "" },
    { k: "t", label: "Type", cell: (r) => r[side]?.type || "", sort: (r) => r[side]?.type || "" },
    { k: "l", label: "Lag (d)", align: "right", cell: (r) => formatNum(r[side]?.lag ?? 0, 1), sort: (r) => r[side]?.lag ?? 0 },
  ];

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Relationships in A" value={formatNum(cmp.PA.links.length)} />
        <Kpi label="Relationships in B" value={formatNum(cmp.PB.links.length)} note={formatDelta(cmp.PB.links.length - cmp.PA.links.length, 0)} />
        <Kpi label="Added" value={formatNum(cmp.rel.added.length)} note="new logic" tone="ok" />
        <Kpi label="Removed" value={formatNum(cmp.rel.removed.length)} note="deleted logic" tone="crit" />
        <Kpi label="Type or lag changed" value={formatNum(cmp.rel.changed.length)} tone="warn" />
        <Kpi label="Identical" value={formatNum(cmp.rel.same.length)} />
      </Kpis>

      <Card eyebrow="Logic edits" title={`Relationships changed — type or lag (${cmp.rel.changed.length})`}>
        <DataTable
          rows={cmp.rel.changed}
          rowKey={(r, i) => `${r.key}-${i}`}
          pageSize={120}
          searchText={(r) => `${r.b?.pred?.code || ""} ${r.b?.pred?.name || ""} ${r.b?.succ?.code || ""} ${r.b?.succ?.name || ""}`}
          onRowClick={(r) => r.b?.succ && ctx.openTask(r.b.succ, cmp.PB)}
          exportName="relationships-changed"
          minWidth={1100}
          columns={[
            { k: "p", label: "Predecessor", cell: (r) => <span className="xer-mono">{r.b?.pred?.code || "(ext)"}</span>, sort: (r) => r.b?.pred?.code || "" },
            { k: "s", label: "Successor", cell: (r) => <span className="xer-mono">{r.b?.succ?.code || "(ext)"}</span>, sort: (r) => r.b?.succ?.code || "" },
            { k: "sn", label: "Successor name", cell: (r) => r.b?.succ?.name || "", sort: (r) => r.b?.succ?.name || "" },
            { k: "ta", label: "Type A", cell: (r) => r.a?.type || "", sort: (r) => r.a?.type || "" },
            { k: "tb", label: "Type B", cell: (r) => (r.typeChanged ? <Badge tone="mod">{r.b?.type}</Badge> : r.b?.type), sort: (r) => r.b?.type || "" },
            { k: "la", label: "Lag A", align: "right", cell: (r) => formatNum(r.a?.lag ?? 0, 1), sort: (r) => r.a?.lag ?? 0 },
            { k: "lb", label: "Lag B", align: "right", cell: (r) => (r.lagChanged ? <Badge tone="mod">{formatNum(r.b?.lag ?? 0, 1)}</Badge> : formatNum(r.b?.lag ?? 0, 1)), sort: (r) => r.b?.lag ?? 0 },
            { k: "d", label: "Lag Δ", align: "right", cell: (r) => deltaCell(r.lagDelta ?? null, 1, " d"), sort: (r) => Math.abs(r.lagDelta || 0) },
          ]}
        />
      </Card>

      <div className="xer-grid xer-grid-2">
        <Card eyebrow="Logic edits" title={`Added in B (${cmp.rel.added.length})`}>
          <DataTable
            rows={cmp.rel.added}
            rowKey={(r, i) => `${r.key}-${i}`}
            pageSize={100}
            columns={sideColumns("b")}
            searchText={(r) => `${r.b?.pred?.code || ""} ${r.b?.succ?.code || ""}`}
            onRowClick={(r) => r.b?.succ && ctx.openTask(r.b.succ, cmp.PB)}
            exportName="relationships-added"
            minWidth={760}
          />
        </Card>
        <Card eyebrow="Logic edits" title={`Removed from A (${cmp.rel.removed.length})`}>
          <DataTable
            rows={cmp.rel.removed}
            rowKey={(r, i) => `${r.key}-${i}`}
            pageSize={100}
            columns={sideColumns("a")}
            searchText={(r) => `${r.a?.pred?.code || ""} ${r.a?.succ?.code || ""}`}
            onRowClick={(r) => r.a?.succ && ctx.openTask(r.a.succ, cmp.PA)}
            exportName="relationships-removed"
            minWidth={760}
          />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- variance */

export function CompareVariance({ ctx }: { ctx: CompareCtx }) {
  const { cmp, opts } = ctx;
  const withVar = cmp.diffs.filter((d) => d.finishVar !== null && Math.abs(d.finishVar) > 0.01);
  const slipped = sortBy(withVar, (d) => d.finishVar, -1).slice(0, 15);
  const pulled = sortBy(withVar, (d) => d.finishVar).filter((d) => (d.finishVar || 0) < 0).slice(0, 15);

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Activities with date movement" value={formatNum(withVar.length)} note={`${formatNum(percent(withVar.length, cmp.diffs.length), 1)}% of matched`} />
        <Kpi label="Slipped" value={formatNum(withVar.filter((d) => (d.finishVar || 0) > 0).length)} note="finish later in B" tone="crit" />
        <Kpi label="Pulled earlier" value={formatNum(withVar.filter((d) => (d.finishVar || 0) < 0).length)} note="finish earlier in B" tone="ok" />
        <Kpi label="Largest slip" value={withVar.length ? formatDelta(Math.max(...withVar.map((d) => d.finishVar || 0)), 1, " d") : "—"} />
        <Kpi label="Largest gain" value={withVar.length ? formatDelta(Math.min(...withVar.map((d) => d.finishVar || 0)), 1, " d") : "—"} />
        <Kpi label="Average movement" value={withVar.length ? formatDelta(withVar.reduce((s, d) => s + (d.finishVar || 0), 0) / withVar.length, 1, " d") : "—"} />
        <Kpi label="Duration changes" value={formatNum(cmp.diffs.filter((d) => Math.abs(d.durVar) > 0.01).length)} note="original duration" tone="warn" />
        <Kpi label="Float degraded" value={formatNum(cmp.diffs.filter((d) => d.tfVar !== null && d.tfVar < 0).length)} note="less float in B" />
      </Kpis>

      <div className="xer-grid xer-grid-2">
        <Card eyebrow="Movement" title="Biggest slips (finish later in B)">
          {slipped.length ? (
            <Bars data={slipped.map((d) => ({ label: d.b.code, value: Math.round((d.finishVar || 0) * 10) / 10, tone: "bad", note: d.b.name, onClick: () => ctx.openTask(d.b, cmp.PB) }))} unit=" d" />
          ) : (
            <p className="xer-muted">None.</p>
          )}
        </Card>
        <Card eyebrow="Movement" title="Biggest gains (finish earlier in B)">
          {pulled.length ? (
            <Bars data={pulled.map((d) => ({ label: d.b.code, value: Math.abs(Math.round((d.finishVar || 0) * 10) / 10), tone: "ok", note: d.b.name, onClick: () => ctx.openTask(d.b, cmp.PB) }))} unit=" d" />
          ) : (
            <p className="xer-muted">None.</p>
          )}
        </Card>
      </div>

      <Card eyebrow="Movement" title="All date and duration movement">
        <DataTable
          rows={withVar}
          rowKey={(d) => d.b.id}
          pageSize={150}
          searchText={(d) => `${d.b.code} ${d.b.name}`}
          onRowClick={(d) => ctx.openTask(d.b, cmp.PB)}
          exportName="date-variance"
          minWidth={1700}
          columns={[
            { k: "c", label: "ID", cell: (d) => <span className="xer-mono">{d.b.code}</span>, sort: (d) => d.b.code },
            { k: "n", label: "Name", cell: (d) => d.b.name, sort: (d) => d.b.name },
            { k: "w", label: "WBS", cell: (d) => d.b.wbsPath, sort: (d) => d.b.wbsPath },
            { k: "sa", label: "Start A", cell: (d) => dateCell(d.a.start), sort: (d) => +(d.a.start || 0), csv: (d) => formatDate(d.a.start) },
            { k: "sb", label: "Start B", cell: (d) => dateCell(d.b.start), sort: (d) => +(d.b.start || 0), csv: (d) => formatDate(d.b.start) },
            { k: "sv", label: "Start Δ", align: "right", cell: (d) => deltaCell(d.startVar), sort: (d) => d.startVar },
            { k: "fa", label: "Finish A", cell: (d) => dateCell(d.a.finish), sort: (d) => +(d.a.finish || 0), csv: (d) => formatDate(d.a.finish) },
            { k: "fb", label: "Finish B", cell: (d) => dateCell(d.b.finish), sort: (d) => +(d.b.finish || 0), csv: (d) => formatDate(d.b.finish) },
            { k: "fv", label: "Finish Δ", align: "right", cell: (d) => deltaCell(d.finishVar), sort: (d) => d.finishVar },
            { k: "da", label: "OD A", align: "right", cell: (d) => formatNum(d.a.od, 1), sort: (d) => d.a.od },
            { k: "db", label: "OD B", align: "right", cell: (d) => formatNum(d.b.od, 1), sort: (d) => d.b.od },
            { k: "dv", label: "OD Δ", align: "right", cell: (d) => deltaCell(d.durVar), sort: (d) => d.durVar },
            { k: "ta", label: "TF A", align: "right", cell: (d) => floatCell(d.a.tf, opts), sort: (d) => d.a.tf },
            { k: "tb", label: "TF B", align: "right", cell: (d) => floatCell(d.b.tf, opts), sort: (d) => d.b.tf },
            { k: "tv", label: "TF Δ", align: "right", cell: (d) => deltaCell(d.tfVar, 1, "", false), sort: (d) => d.tfVar },
          ]}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------- critical path movement */

export function CompareCritical({ ctx }: { ctx: CompareCtx }) {
  const { cmp, opts } = ctx;
  const anA = cmp.PA.an!;
  const anB = cmp.PB.an!;

  const columns: Column<ActivityDiff>[] = [
    { k: "c", label: "ID", cell: (d) => <span className="xer-mono">{d.b.code}</span>, sort: (d) => d.b.code },
    { k: "n", label: "Name", cell: (d) => d.b.name, sort: (d) => d.b.name },
    { k: "w", label: "WBS", cell: (d) => d.b.wbsPath, sort: (d) => d.b.wbsPath },
    { k: "ta", label: "TF A", align: "right", cell: (d) => floatCell(d.a.tf, opts), sort: (d) => d.a.tf },
    { k: "tb", label: "TF B", align: "right", cell: (d) => floatCell(d.b.tf, opts), sort: (d) => d.b.tf },
    { k: "fv", label: "Finish Δ", align: "right", cell: (d) => deltaCell(d.finishVar), sort: (d) => d.finishVar },
  ];

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Critical in A" value={formatNum(anA.stat.critical)} />
        <Kpi label="Critical in B" value={formatNum(anB.stat.critical)} note={formatDelta(anB.stat.critical - anA.stat.critical, 0)} />
        <Kpi label="Became critical" value={formatNum(cmp.crit.entered.length)} note="new on the critical path" tone="crit" />
        <Kpi label="Left the critical path" value={formatNum(cmp.crit.left.length)} tone="ok" />
        <Kpi label="Longest path A" value={`${formatNum(anA.longestPath.length)} acts`} note={formatDate(anA.calcFinish)} />
        <Kpi label="Longest path B" value={`${formatNum(anB.longestPath.length)} acts`} note={formatDate(anB.calcFinish)} />
        <Kpi label="New on longest path" value={formatNum(cmp.crit.lpEntered.length)} note="driving in B but not in A" tone="warn" />
        <Kpi label="Off longest path" value={formatNum(cmp.crit.lpLeft.length)} note="was driving in A" />
      </Kpis>

      <div className="xer-grid xer-grid-2">
        <Card eyebrow="Movement" title={`Became critical (${cmp.crit.entered.length})`}>
          <DataTable rows={cmp.crit.entered} columns={columns} rowKey={(d) => d.b.id} pageSize={100} searchText={(d) => `${d.b.code} ${d.b.name}`} onRowClick={(d) => ctx.openTask(d.b, cmp.PB)} exportName="became-critical" minWidth={760} />
        </Card>
        <Card eyebrow="Movement" title={`No longer critical (${cmp.crit.left.length})`}>
          <DataTable rows={cmp.crit.left} columns={columns} rowKey={(d) => d.b.id} pageSize={100} searchText={(d) => `${d.b.code} ${d.b.name}`} onRowClick={(d) => ctx.openTask(d.b, cmp.PB)} exportName="left-critical" minWidth={760} />
        </Card>
      </div>

      <div className="xer-grid xer-grid-2">
        <Card eyebrow="Schedule A" title={`Longest path (${anA.longestPath.length} activities)`} aside={`ends ${formatDate(anA.calcFinish)}`}>
          <PathChain tasks={anA.longestPath} max={60} onPick={(t) => ctx.openTask(t, cmp.PA)} />
        </Card>
        <Card eyebrow="Schedule B" title={`Longest path (${anB.longestPath.length} activities)`} aside={`ends ${formatDate(anB.calcFinish)}`}>
          <PathChain tasks={anB.longestPath} critical max={60} onPick={(t) => ctx.openTask(t, cmp.PB)} />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- structure */

export function CompareStructure({ ctx }: { ctx: CompareCtx }) {
  const { cmp } = ctx;

  type StructKind = "add" | "del" | "mod";
  type WbsRow = { kind: StructKind; w: WbsNode; old: WbsNode | null };
  type CalRow = {
    kind: StructKind;
    c: WorkCalendar;
    prev: WorkCalendar | null;
    s1: CalendarSummary | null;
    s2: CalendarSummary | null;
  };

  const wbsRows: WbsRow[] = [
    ...cmp.wbsDiff.added.map((w) => ({ kind: "add" as const, w, old: null })),
    ...cmp.wbsDiff.removed.map((w) => ({ kind: "del" as const, w, old: null })),
    ...cmp.wbsDiff.changed.map((x) => ({ kind: "mod" as const, w: x.b, old: x.a })),
  ];

  const calRows: CalRow[] = [
    ...cmp.calDiff.added.map((c) => ({ kind: "add" as const, c, prev: null, s1: null, s2: null })),
    ...cmp.calDiff.removed.map((c) => ({ kind: "del" as const, c, prev: null, s1: null, s2: null })),
    ...cmp.calDiff.changed.map((x) => ({ kind: "mod" as const, c: x.b, prev: x.a, s1: x.s1, s2: x.s2 })),
  ];

  const kindTone = { add: "add", del: "del", mod: "mod" } as const;
  const kindLabelWbs = { add: "added", del: "removed", mod: "renamed" } as const;
  const kindLabelCal = { add: "added", del: "removed", mod: "changed" } as const;

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="WBS nodes added" value={formatNum(cmp.wbsDiff.added.length)} tone="ok" />
        <Kpi label="WBS nodes removed" value={formatNum(cmp.wbsDiff.removed.length)} tone="crit" />
        <Kpi label="WBS renamed" value={formatNum(cmp.wbsDiff.changed.length)} tone="warn" />
        <Kpi label="Calendars added" value={formatNum(cmp.calDiff.added.length)} />
        <Kpi label="Calendars removed" value={formatNum(cmp.calDiff.removed.length)} />
        <Kpi label="Calendars changed" value={formatNum(cmp.calDiff.changed.length)} note="working pattern" tone="warn" />
        <Kpi label="Resource differences" value={formatNum(cmp.rsrcDiff.length)} />
      </Kpis>

      <Card eyebrow="Structure" title="WBS differences">
        {wbsRows.length ? (
          <DataTable
            rows={wbsRows}
            rowKey={(r, i) => `${r.w.id}-${i}`}
            pageSize={120}
            searchText={(r) => `${r.w.path} ${r.w.name}`}
            exportName="wbs-differences"
            minWidth={900}
            columns={[
              { k: "k", label: "", cell: (r) => <Badge tone={kindTone[r.kind]}>{kindLabelWbs[r.kind]}</Badge>, sort: (r) => r.kind },
              { k: "p", label: "WBS path", cell: (r) => <span className="xer-mono">{r.w.path}</span>, sort: (r) => r.w.path },
              { k: "n", label: "Name", cell: (r) => r.w.name, sort: (r) => r.w.name },
              { k: "o", label: "Was", cell: (r) => r.old?.name || "", sort: (r) => r.old?.name || "" },
              { k: "t", label: "Activities", align: "right", cell: (r) => formatNum(r.w.stat?.count || 0), sort: (r) => r.w.stat?.count || 0 },
            ]}
          />
        ) : (
          <p className="xer-muted">The WBS is identical in both files.</p>
        )}
      </Card>

      <Card eyebrow="Working time" title="Calendar differences">
        {calRows.length ? (
          <DataTable
            rows={calRows}
            rowKey={(r, i) => `${r.c.id}-${i}`}
            pageSize={80}
            exportName="calendar-differences"
            minWidth={900}
            columns={[
              { k: "k", label: "", cell: (r) => <Badge tone={kindTone[r.kind]}>{kindLabelCal[r.kind]}</Badge>, sort: (r) => r.kind },
              { k: "n", label: "Calendar", cell: (r) => r.c.name, sort: (r) => r.c.name },
              { k: "d", label: "Work days/week", cell: (r) => (r.s1 ? `${r.s1.days} → ${r.s2!.days}` : String(r.c.summary().days)) },
              { k: "h", label: "Hours/week", cell: (r) => (r.s1 ? `${formatNum(r.s1.hours, 1)} → ${formatNum(r.s2!.hours, 1)}` : formatNum(r.c.summary().hours, 1)) },
              { k: "e", label: "Exceptions", cell: (r) => (r.s1 ? `${r.s1.exceptions} → ${r.s2!.exceptions}` : String(r.c.exceptionList.length)) },
              { k: "hd", label: "Hours/day", cell: (r) => (r.prev ? `${formatNum(r.prev.dayHours, 1)} → ${formatNum(r.c.dayHours, 1)}` : formatNum(r.c.dayHours, 1)) },
            ]}
          />
        ) : (
          <p className="xer-muted">Calendars are identical in both files.</p>
        )}
        <p className="xer-muted xer-note">
          A changed working pattern moves every date that depends on it. Treat any calendar difference as a material
          change to the programme, not a formatting difference.
        </p>
      </Card>

      <Card eyebrow="Resources" title="Resource and cost differences">
        {cmp.rsrcDiff.length ? (
          <DataTable
            rows={cmp.rsrcDiff}
            rowKey={(r) => r.name}
            pageSize={120}
            searchText={(r) => r.name}
            exportName="resource-differences"
            minWidth={1300}
            columns={[
              { k: "s", label: "", cell: (r) => <Badge tone={r.state === "added" ? "add" : r.state === "removed" ? "del" : "mod"}>{r.state}</Badge>, sort: (r) => r.state },
              { k: "n", label: "Resource", cell: (r) => <span className="xer-mono">{r.name}</span>, sort: (r) => r.name },
              { k: "ta", label: "Assignments A", align: "right", cell: (r) => formatNum(r.a.tasks), sort: (r) => r.a.tasks },
              { k: "tb", label: "Assignments B", align: "right", cell: (r) => formatNum(r.b.tasks), sort: (r) => r.b.tasks },
              { k: "tv", label: "Δ", align: "right", cell: (r) => deltaCell(r.taskVar, 0, "", false), sort: (r) => r.taskVar },
              { k: "qa", label: "Units A", align: "right", cell: (r) => formatNum(r.a.qty, 0), sort: (r) => r.a.qty },
              { k: "qb", label: "Units B", align: "right", cell: (r) => formatNum(r.b.qty, 0), sort: (r) => r.b.qty },
              { k: "qv", label: "Units Δ", align: "right", cell: (r) => deltaCell(r.qtyVar, 0, "", false), sort: (r) => r.qtyVar },
              { k: "ca", label: "Cost A", align: "right", cell: (r) => formatMoney(r.a.cost), sort: (r) => r.a.cost },
              { k: "cb", label: "Cost B", align: "right", cell: (r) => formatMoney(r.b.cost), sort: (r) => r.b.cost },
              { k: "cv", label: "Cost Δ", align: "right", cell: (r) => deltaCell(r.costVar, 0), sort: (r) => r.costVar },
            ]}
          />
        ) : (
          <p className="xer-muted">No resource differences (or neither file is resource loaded).</p>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- impact */

export function CompareImpact({ ctx }: { ctx: CompareCtx }) {
  const { cmp } = ctx;
  const rows = cmp.impact;

  return (
    <div className="xer-view">
      <div className="xer-callout">
        <b>Why did the finish date move {formatDelta(cmp.finishVar, 1, " days")}?</b> The ranking below weights each
        changed activity by how much its dates moved, whether its logic or duration was edited, and whether it sits on
        schedule B&apos;s driving chain. Items marked <Badge tone="bad">longest path</Badge> are the changes that can
        actually move the completion date. This is an ordering aid for investigation — the causal finding still has to
        be made in native P6.
      </div>

      <Card eyebrow="Ranked" title={`Drivers of the change (${rows.length})`}>
        {rows.length ? (
          <DataTable
            rows={rows}
            rowKey={(r, i) => `${r.d.b.id}-${i}`}
            pageSize={120}
            searchText={(r) => `${r.d.b.code} ${r.d.b.name}`}
            onRowClick={(r) => ctx.openDiff(r.d)}
            exportName="impact"
            minWidth={1400}
            columns={[
              { k: "r", label: "#", align: "right", cell: (r) => rows.indexOf(r) + 1 },
              { k: "lp", label: "", cell: (r) => (r.onLP ? <Badge tone="bad">longest path</Badge> : r.d.critB ? <Badge tone="warn">critical</Badge> : null), sort: (r) => (r.onLP ? 0 : r.d.critB ? 1 : 2) },
              { k: "c", label: "ID", cell: (r) => <span className="xer-mono">{r.d.b.code}</span>, sort: (r) => r.d.b.code },
              { k: "n", label: "Name", cell: (r) => r.d.b.name, sort: (r) => r.d.b.name },
              { k: "w", label: "WBS", cell: (r) => r.d.b.wbsPath, sort: (r) => r.d.b.wbsPath },
              {
                k: "ch", label: "What changed",
                cell: (r) => (
                  <span title={r.d.changes.map((x) => `${x.label}: ${x.aDisp} → ${x.bDisp}`).concat(r.d.logicChanges.map((l) => l.txt)).join("\n")}>
                    {uniq(r.d.changes.map((x) => x.label)).join(", ")}
                    {r.d.logicChanges.length ? `${r.d.changes.length ? " · " : ""}${r.d.logicChanges.length} logic edit${r.d.logicChanges.length > 1 ? "s" : ""}` : ""}
                  </span>
                ),
              },
              { k: "dv", label: "Dur Δ", align: "right", cell: (r) => deltaCell(r.d.durVar), sort: (r) => Math.abs(r.d.durVar) },
              { k: "fv", label: "Finish Δ", align: "right", cell: (r) => deltaCell(r.d.finishVar), sort: (r) => Math.abs(r.d.finishVar || 0) },
              { k: "tv", label: "Float Δ", align: "right", cell: (r) => deltaCell(r.d.tfVar, 1, "", false), sort: (r) => r.d.tfVar },
              { k: "wt", label: "Weight", align: "right", cell: (r) => formatNum(r.weight, 0), sort: (r) => r.weight },
            ]}
          />
        ) : (
          <p className="xer-muted">No duration, constraint, calendar or logic changes were found.</p>
        )}
      </Card>

      {cmp.missed.length ? (
        <Card
          eyebrow="Performance"
          title={`Missed activities (${cmp.missed.length})`}
          aside="planned complete by B's data date in A, but not actually complete"
        >
          <DataTable
            rows={cmp.missed}
            rowKey={(d) => d.b.id}
            pageSize={120}
            searchText={(d) => `${d.b.code} ${d.b.name}`}
            onRowClick={(d) => ctx.openTask(d.b, cmp.PB)}
            exportName="missed-activities"
            minWidth={1100}
            columns={[
              { k: "c", label: "ID", cell: (d) => <span className="xer-mono">{d.b.code}</span>, sort: (d) => d.b.code },
              { k: "n", label: "Name", cell: (d) => d.b.name, sort: (d) => d.b.name },
              { k: "fa", label: "Planned finish (A)", cell: (d) => dateCell(d.a.finish), sort: (d) => +(d.a.finish || 0), csv: (d) => formatDate(d.a.finish) },
              { k: "fb", label: "Current finish (B)", cell: (d) => dateCell(d.b.finish, d.b.actEnd), sort: (d) => +(d.b.finish || 0), csv: (d) => formatDate(d.b.finish) },
              { k: "v", label: "Slip", align: "right", cell: (d) => deltaCell(d.finishVar, 1, " d"), sort: (d) => d.finishVar },
              { k: "s", label: "Status in B", cell: (d) => d.b.statusName, sort: (d) => d.b.status },
              { k: "p", label: "% complete", align: "right", cell: (d) => `${formatNum(d.b.pct, 0)}%`, sort: (d) => d.b.pct },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- Gantt overlay */

type GanttMode = "changed" | "moved" | "crit" | "all";

export function CompareGantt({ ctx }: { ctx: CompareCtx }) {
  const { cmp } = ctx;
  const [mode, setMode] = useState<GanttMode>("changed");
  const [limit, setLimit] = useState(150);

  const rows = useMemo(() => {
    let list = cmp.diffs.slice();
    if (mode === "changed") list = list.filter((d) => d.changes.length || d.logicChanges.length);
    else if (mode === "moved") list = list.filter((d) => Math.abs(d.finishVar || 0) > 0.01);
    else if (mode === "crit") list = list.filter((d) => d.critA || d.critB);
    return sortBy(list, (d) => -Math.abs(d.finishVar || 0));
  }, [cmp, mode]);

  const visible = rows.slice(0, limit);

  // A single shared time axis across both revisions.
  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const d of visible) {
      for (const date of [d.a.start, d.a.finish, d.b.start, d.b.finish]) {
        if (!date) continue;
        min = Math.min(min, +date);
        max = Math.max(max, +date);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return { min, max, span: max - min };
  }, [visible]);

  const pos = (date: Date | null) => (bounds && date ? clamp(((+date - bounds.min) / bounds.span) * 100, 0, 100) : null);

  const modes: [GanttMode, string][] = [
    ["changed", "Changed"],
    ["moved", "Dates moved"],
    ["crit", "Critical either side"],
    ["all", "All matched"],
  ];

  return (
    <div className="xer-view">
      <div className="xer-toolbar">
        {modes.map(([key, label]) => (
          <button type="button" key={key} className={`xer-btn xer-btn-sm${mode === key ? " active" : ""}`} onClick={() => { setMode(key); setLimit(150); }}>
            {label}
          </button>
        ))}
        <span className="xer-dim">
          {formatNum(visible.length)} of {formatNum(rows.length)} activities
        </span>
        <span className="xer-legend">
          <i className="xer-legend-a" /> Schedule A
          <i className="xer-legend-b" /> Schedule B
        </span>
      </div>

      <Card eyebrow="Before / after" title="Gantt overlay" aside={bounds ? `${formatDate(new Date(bounds.min))} → ${formatDate(new Date(bounds.max))}` : undefined}>
        {!bounds ? (
          <p className="xer-muted">Not enough dated activities to draw an overlay.</p>
        ) : (
          <>
            <div className="xer-gantt">
              {visible.map((d) => {
                const aStart = pos(d.a.start);
                const aEnd = pos(d.a.finish);
                const bStart = pos(d.b.start);
                const bEnd = pos(d.b.finish);
                const slipped = (d.finishVar || 0) > 0;
                return (
                  <button type="button" key={d.b.id} className="xer-gantt-row" onClick={() => ctx.openDiff(d)} title={`${d.b.code} — ${d.b.name}`}>
                    <span className="xer-gantt-label">
                      <b className="xer-mono">{d.b.code}</b>
                      <small>{d.b.name}</small>
                    </span>
                    <span className="xer-gantt-track">
                      {aStart !== null && aEnd !== null ? (
                        <i className="xer-gantt-bar xer-gantt-a" style={{ left: `${aStart}%`, width: `${Math.max(0.4, aEnd - aStart)}%` }} />
                      ) : null}
                      {bStart !== null && bEnd !== null ? (
                        <i className={`xer-gantt-bar xer-gantt-b${slipped ? " slipped" : ""}`} style={{ left: `${bStart}%`, width: `${Math.max(0.4, bEnd - bStart)}%` }} />
                      ) : null}
                    </span>
                    <span className="xer-gantt-var">{deltaCell(d.finishVar, 1, " d")}</span>
                  </button>
                );
              })}
            </div>
            {rows.length > visible.length ? (
              <button type="button" className="xer-btn xer-more" onClick={() => setLimit(limit + 150)}>
                Show 150 more<small> · {formatNum(rows.length - visible.length)} hidden</small>
              </button>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

/** Drawer body for one activity diff, used from the comparison tables. */
export function DiffDetail({ diff, cmp, onOpenSide }: { diff: ActivityDiff; cmp: Comparison; onOpenSide: (t: Task, view: ProjectView) => void }) {
  return (
    <>
      <SectionTitle>Differences A → B</SectionTitle>
      <DiffBlock diff={diff} />
      <SectionTitle>Side by side</SectionTitle>
      <SideBySide diff={diff} cmp={cmp} />
      <div className="xer-drawer-actions">
        <button type="button" className="xer-btn xer-btn-sm" onClick={() => onOpenSide(diff.a, cmp.PA)}>
          Open in A
        </button>
        <button type="button" className="xer-btn xer-btn-sm" onClick={() => onOpenSide(diff.b, cmp.PB)}>
          Open in B
        </button>
      </div>
    </>
  );
}
