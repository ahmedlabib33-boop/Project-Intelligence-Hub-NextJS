"use client";

/**
 * Single-schedule analysis views: dashboard, activities, logic, critical path,
 * float paths, health/DCMA, WBS, resources, calendars and the raw XER tables.
 */

import { useMemo, useState } from "react";
import type { Analysis, Check } from "../../../lib/xer/analysis";
import type { Comparison } from "../../../lib/xer/compare";
import { clamp, downloadCsv, formatDate, formatMoney, formatNum, groupBy, percent, sortBy, uniq } from "../../../lib/xer/format";
import { CONSTRAINT, HARD_CONSTRAINTS, type Link, type ProjectView, type Task, type WbsNode } from "../../../lib/xer/model";
import type { AnalyzerOptions } from "../../../lib/xer/options";
import type { XerRow } from "../../../lib/xer/parse";
import {
  constraintTag, dateCell, deltaCell, filterTasks, floatCell, PathChain, percentCell, scoreTone, statusTag,
  type ActivityFilter, type AdHocFilter,
} from "./helpers";
import { Badge, Bars, Card, type Column, DataTable, Kpi, Kpis, LineChart, SectionTitle } from "./ui";

export type TabKey =
  | "dash" | "act" | "logic" | "crit" | "float" | "health"
  | "gantt" | "wbs" | "res" | "cal" | "raw" | "cmp"
  | "lib" | "map" | "scen" | "ml" | "tender";

export type ViewCtx = {
  P: ProjectView;
  an: Analysis;
  opts: AnalyzerOptions;
  filter: ActivityFilter;
  setFilter: (next: ActivityFilter) => void;
  adhoc: AdHocFilter;
  setAdhoc: (next: AdHocFilter) => void;
  goTab: (tab: TabKey) => void;
  /** Jump to the activity list under an ad-hoc filter. */
  drill: (label: string, test: (t: Task) => boolean) => void;
  openTask: (t: Task, view?: ProjectView) => void;
  openCheck: (check: Check) => void;
  cmp: Comparison | null;
  scope: "A" | "B";
};

/* ------------------------------------------------------------ dashboard */

export function DashboardView({ ctx }: { ctx: ViewCtx }) {
  const { P, an, opts, cmp } = ctx;
  const s = an.stat;

  const relBars = [
    { label: "FS", value: an.byRelType.FS, tone: "blue" },
    { label: "SS", value: an.byRelType.SS, tone: "ok" },
    { label: "FF", value: an.byRelType.FF, tone: "warn" },
    { label: "SF", value: an.byRelType.SF, tone: "bad" },
  ];

  const wbsBars = sortBy(an.wbsBreak, (d) => d.value, -1)
    .slice(0, 12)
    .map((d) => ({
      label: (d.label || d.name).slice(0, 28),
      value: d.value,
      tone: d.minTF !== null && d.minTF <= 0 ? "crit" : d.minTF !== null && d.minTF <= opts.tfNear ? "warn" : "blue",
      note: `${d.name} · lowest total float ${d.minTF === null ? "—" : formatNum(d.minTF, 1)} d`,
      onClick: () => {
        ctx.setFilter({ ...ctx.filter, wbs: d.wbs.id });
        ctx.goTab("act");
      },
    }));

  const issues: [string, number, () => void][] = [
    ["Open ends", an.openEnds.length, () => ctx.drill("Open ends", (t) => an.openEnds.includes(t))],
    ["Out-of-sequence relationships", an.outOfSequence.length, () => ctx.goTab("logic")],
    ["Circular logic", an.inCycle.length, () => ctx.goTab("logic")],
    ["Hard constraints", an.hardConstraints.length, () => ctx.drill("Hard constraints", (t) => an.hardConstraints.includes(t))],
    ["Leads (negative lag)", an.leads.length, () => ctx.goTab("logic")],
    [`Long lags (> ${opts.longLag}d)`, an.longLags.length, () => ctx.goTab("logic")],
    ["Invalid / contradictory dates", an.invalidTasks.length, () => ctx.drill("Invalid dates", (t) => an.invalidTasks.includes(t))],
    ["Negative float", s.negative, () => ctx.drill("Negative float", (t) => t.tf !== null && t.tf < 0)],
  ];

  const milestones = sortBy(P.tasks.filter((t) => t.isMile), (t) => +(t.finish || t.start || new Date(8.64e15)));

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Activities" value={formatNum(s.total)} note={`${formatNum(s.milestones)} milestones · ${formatNum(s.loe)} LOE`} onClick={() => ctx.goTab("act")} />
        <Kpi label="Complete" value={formatNum(s.complete)} note={`${formatNum(s.pctCount, 1)}% of activities`} tone="ok" onClick={() => ctx.drill("Completed", (t) => t.done)} />
        <Kpi label="In progress" value={formatNum(s.inProgress)} note="started, not finished" onClick={() => ctx.drill("In progress", (t) => t.started && !t.done)} />
        <Kpi label="Overall % complete" value={`${formatNum(s.pct, 1)}%`} note="duration weighted" />
        <Kpi label="Critical" value={formatNum(s.critical)} note={`TF ≤ ${opts.tfCritical}d`} tone="crit" onClick={() => { ctx.setFilter({ ...ctx.filter, crit: "c" }); ctx.goTab("act"); }} />
        <Kpi label="Near critical" value={formatNum(s.near)} note={`≤ ${opts.tfNear}d`} tone="warn" onClick={() => { ctx.setFilter({ ...ctx.filter, crit: "n" }); ctx.goTab("act"); }} />
        <Kpi label="Negative float" value={formatNum(s.negative)} note={s.negative ? "behind a constraint" : "none"} tone={s.negative ? "crit" : "ok"} onClick={() => { ctx.setFilter({ ...ctx.filter, crit: "neg" }); ctx.goTab("act"); }} />
        <Kpi label="Relationships" value={formatNum(s.links)} note={`${formatNum(an.fsPct, 0)}% finish-start`} onClick={() => ctx.goTab("logic")} />
        <Kpi label="Open ends" value={formatNum(an.openEnds.length)} note="no predecessor or successor" tone={an.openEnds.length ? "warn" : "ok"} onClick={() => ctx.drill("Open ends", (t) => an.openEnds.includes(t))} />
        <Kpi label="Out of sequence" value={formatNum(an.outOfSequence.length)} note="relationships violated" tone={an.outOfSequence.length ? "crit" : "ok"} onClick={() => ctx.goTab("logic")} />
        <Kpi label="Health score" value={`${an.score}%`} note={`${an.failCount} failed checks`} tone={scoreTone(an.score)} onClick={() => ctx.goTab("health")} />
        <Kpi label="Remaining duration" value={`${formatNum(s.remDur, 0)} d`} note="sum of incomplete work" />
        {cmp ? (
          <Kpi
            label="A → B differences"
            value={formatNum(cmp.summaryCounts.added + cmp.summaryCounts.removed + cmp.summaryCounts.modified)}
            note={`${cmp.similarity}% similar`}
            tone="warn"
            onClick={() => ctx.goTab("cmp")}
          />
        ) : null}
      </Kpis>

      <div className="xer-grid">
        <Card eyebrow="Distribution" title="Total float">
          <Bars
            unit=""
            data={an.floatDist.map((band) => ({
              label: band.label,
              value: band.value,
              tone: band.tone,
              onClick: () => ctx.drill(`Float band ${band.label}`, band.filter),
            }))}
          />
        </Card>

        <Card eyebrow="Distribution" title="Original duration">
          <Bars
            data={an.durDist.map((band) => ({
              label: band.label,
              value: band.value,
              tone: band.tone,
              onClick: () => ctx.drill(`Duration ${band.label}`, band.filter),
            }))}
          />
        </Card>

        <Card eyebrow="Network" title="Relationship types" aside={`${formatNum(an.linksInternal.length)} links`}>
          <Bars data={relBars} />
          <p className="xer-muted xer-note">
            DCMA looks for at least 90% finish-start. This network is {formatNum(an.fsPct, 1)}% FS.
          </p>
        </Card>

        <Card eyebrow="Quality" title="Logic issues at a glance">
          <div className="xer-issues">
            {issues.map(([label, count, onClick]) => (
              <button type="button" key={label} className="xer-issue-row" onClick={onClick}>
                <span>{label}</span>
                <Badge tone={count === 0 ? "ok" : count < 10 ? "warn" : "bad"}>{formatNum(count)}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <Card eyebrow="Progress" title="Cumulative activity completion" className="xer-span2">
          {an.curve.length > 1 ? (
            <>
              <LineChart
                marker={P.dataDate}
                markerLabel="Data date"
                series={[
                  { name: "Planned (target finish)", tone: "violet", points: an.curve.map((p) => ({ x: p.date, y: p.cumPlan })) },
                  { name: "Actual + forecast", tone: "blue", points: an.curve.map((p) => ({ x: p.date, y: p.cumFc })), dashed: true },
                  { name: "Actual", tone: "ok", points: an.curve.filter((p) => p.cumAct > 0).map((p) => ({ x: p.date, y: p.cumAct })) },
                ]}
              />
              <p className="xer-muted xer-note">
                Activity counts by month of finish, cumulative. Counts activities, not value or duration — a weighted
                S-curve needs cost or man-hour loading.
              </p>
            </>
          ) : (
            <p className="xer-muted">No dated activities to curve.</p>
          )}
        </Card>

        <Card eyebrow="Structure" title="Activities by WBS (level 2)" className="xer-span2">
          {wbsBars.length ? (
            <>
              <Bars data={wbsBars} />
              <p className="xer-muted xer-note">
                Bar colour reflects the lowest total float inside the branch — red means the branch carries critical work.
              </p>
            </>
          ) : (
            <p className="xer-muted">No WBS in this file.</p>
          )}
        </Card>

        <Card
          eyebrow="Driving logic"
          title="Longest path"
          aside={an.longestPath.length ? `${an.longestPath.length} activities` : undefined}
          className="xer-span2"
        >
          {an.longestPath.length ? (
            <>
              <p className="xer-muted xer-note">
                {formatNum(an.longestPath.length)} activities · {formatNum(an.lpDuration, 0)} calendar days · ends{" "}
                {formatDate(an.calcFinish)}
              </p>
              <PathChain tasks={an.longestPath} critical max={26} onPick={(t) => ctx.openTask(t)} />
              <button type="button" className="xer-btn xer-btn-sm xer-mt" onClick={() => ctx.goTab("crit")}>
                Open critical path view
              </button>
            </>
          ) : (
            <p className="xer-muted">No longest path could be traced — check for circular logic or missing dates.</p>
          )}
        </Card>

        {milestones.length ? (
          <Card eyebrow="Contract control" title="Milestones" className="xer-span2">
            <DataTable
              rows={milestones}
              rowKey={(t) => t.id}
              pageSize={12}
              minWidth={640}
              onRowClick={(t) => ctx.openTask(t)}
              exportName="milestones"
              columns={[
                { k: "code", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
                { k: "name", label: "Milestone", cell: (t) => t.name, sort: (t) => t.name },
                { k: "date", label: "Date", cell: (t) => dateCell(t.finish || t.start, t.actEnd || t.actStart), sort: (t) => +(t.finish || t.start || 0), csv: (t) => formatDate(t.finish || t.start) },
                { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
                { k: "st", label: "Status", cell: (t) => statusTag(t), sort: (t) => t.status },
              ]}
            />
          </Card>
        ) : null}

        {s.budget ? (
          <Card eyebrow="Cost" title="Budget and spend">
            <Bars
              data={[
                { label: "Actual", value: Math.round(s.actual), tone: "ok" },
                { label: "Remaining", value: Math.round(s.remain), tone: "blue" },
              ]}
            />
            <p className="xer-muted xer-note">
              Budget {formatMoney(s.budget)} · actual {formatMoney(s.actual)} · remaining {formatMoney(s.remain)} ·{" "}
              {formatNum(percent(s.actual, s.budget), 1)}% spent
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- activities */

function FilterBar({ ctx }: { ctx: ViewCtx }) {
  const { P, opts, filter, setFilter, cmp } = ctx;
  const set = (patch: Partial<ActivityFilter>) => setFilter({ ...filter, ...patch });

  return (
    <div className="xer-toolbar">
      <input
        className="xer-input"
        type="search"
        value={filter.q}
        placeholder="Search ID, name, WBS…"
        onChange={(e) => set({ q: e.target.value })}
      />
      <select className="xer-select" value={filter.wbs} onChange={(e) => set({ wbs: e.target.value })}>
        <option value="">All WBS</option>
        {P.wbsAll
          .filter((w) => w.level <= 3)
          .map((w) => (
            <option key={w.id} value={w.id}>
              {" ".repeat(w.level * 2)}
              {w.code || w.name} — {w.name.slice(0, 40)}
            </option>
          ))}
      </select>
      <select className="xer-select" value={filter.status} onChange={(e) => set({ status: e.target.value as ActivityFilter["status"] })}>
        <option value="">All status</option>
        <option value="ns">Not started</option>
        <option value="ip">In progress</option>
        <option value="cp">Completed</option>
      </select>
      <select className="xer-select" value={filter.type} onChange={(e) => set({ type: e.target.value as ActivityFilter["type"] })}>
        <option value="">All types</option>
        <option value="task">Tasks only</option>
        <option value="ms">Milestones</option>
        <option value="loe">LOE / WBS summary</option>
      </select>
      <select className="xer-select" value={filter.crit} onChange={(e) => set({ crit: e.target.value as ActivityFilter["crit"] })}>
        <option value="">All float</option>
        <option value="c">Critical (TF ≤ {opts.tfCritical}d)</option>
        <option value="n">Near critical (≤ {opts.tfNear}d)</option>
        <option value="neg">Negative float</option>
        <option value="lp">Longest path</option>
      </select>
      <label className="xer-field">
        <span>Finish ≥</span>
        <input className="xer-input" type="date" value={filter.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="xer-field">
        <span>Start ≤</span>
        <input className="xer-input" type="date" value={filter.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      {cmp ? (
        <select className="xer-select" value={filter.changed} onChange={(e) => set({ changed: e.target.value as ActivityFilter["changed"] })}>
          <option value="">A/B: all</option>
          <option value="y">Changed only</option>
          <option value="n">Unchanged only</option>
        </select>
      ) : null}
      {ctx.adhoc ? (
        <span className="xer-chip">
          Filter: {ctx.adhoc.label}
          <button type="button" onClick={() => ctx.setAdhoc(null)} aria-label="Clear drill-through filter">
            ✕
          </button>
        </span>
      ) : null}
      <button
        type="button"
        className="xer-btn xer-btn-sm"
        onClick={() => {
          setFilter({ q: "", wbs: "", status: "", type: "", crit: "", floatMax: "", from: "", to: "", changed: "" });
          ctx.setAdhoc(null);
        }}
      >
        Clear filters
      </button>
    </div>
  );
}

export function ActivitiesView({ ctx }: { ctx: ViewCtx }) {
  const { P, opts, cmp } = ctx;

  const changedTest = useMemo(() => {
    if (!cmp) return undefined;
    return (t: Task) => {
      const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
      return !!d && (d.changes.length > 0 || d.logicChanges.length > 0);
    };
  }, [cmp]);

  const rows = useMemo(
    () => filterTasks(P, ctx.filter, opts, ctx.adhoc, changedTest),
    [P, ctx.filter, opts, ctx.adhoc, changedTest],
  );

  const columns: Column<Task>[] = [
    { k: "code", label: "Activity ID", width: "120px", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
    { k: "name", label: "Activity name", width: "280px", cell: (t) => t.name, sort: (t) => t.name },
    { k: "wbs", label: "WBS", width: "150px", cell: (t) => <span title={`${t.wbsPath} — ${t.wbsName}`}>{t.wbsPath}</span>, sort: (t) => t.wbsPath },
    { k: "st", label: "Status", cell: (t) => statusTag(t), sort: (t) => t.status },
    { k: "od", label: "OD", align: "right", cell: (t) => formatNum(t.od, 1), sort: (t) => t.od },
    { k: "rd", label: "RD", align: "right", cell: (t) => formatNum(t.rd, 1), sort: (t) => t.rd },
    { k: "start", label: "Start", cell: (t) => dateCell(t.start, t.actStart), sort: (t) => +(t.start || 0), csv: (t) => formatDate(t.start) },
    { k: "finish", label: "Finish", cell: (t) => dateCell(t.finish, t.actEnd), sort: (t) => +(t.finish || 0), csv: (t) => formatDate(t.finish) },
    { k: "tf", label: "Total float", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
    { k: "lp", label: "LP", cell: (t) => (t.c && t.c.lp ? <Badge tone="bad">LP</Badge> : null), sort: (t) => (t.c && t.c.lp ? 0 : 1) },
    { k: "pct", label: "%", align: "right", cell: (t) => percentCell(t.pct), sort: (t) => t.pct, csv: (t) => t.pct },
    { k: "cstr", label: "Constraint", cell: (t) => constraintTag(t), sort: (t) => (t.cstrType ? CONSTRAINT[t.cstrType] || t.cstrType : "") },
    { k: "cal", label: "Calendar", cell: (t) => t.calName, sort: (t) => t.calName },
  ];

  if (cmp) {
    columns.push({
      k: "ab",
      label: "A/B",
      cell: (t) => {
        const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
        if (!d) return <Badge tone={ctx.scope === "B" ? "add" : "del"}>{ctx.scope === "B" ? "added" : "removed"}</Badge>;
        const count = d.changes.length + d.logicChanges.length;
        return count ? <Badge tone="mod">{count} change{count > 1 ? "s" : ""}</Badge> : <Badge tone="mut">same</Badge>;
      },
      sort: (t) => {
        const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
        return d ? -(d.changes.length + d.logicChanges.length) : -999;
      },
    });
  }

  return (
    <div className="xer-view">
      <FilterBar ctx={ctx} />
      <Card>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          searchText={(t) => `${t.code} ${t.name} ${t.wbsPath} ${t.statusName}`}
          onRowClick={(t) => ctx.openTask(t)}
          exportName="activities"
          minWidth={1400}
          empty="No activities match the current filters."
        />
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- logic */

type LogicTab = "rel" | "open" | "oos" | "cyc" | "dang" | "lag" | "red" | "cst";

export function LogicView({ ctx }: { ctx: ViewCtx }) {
  const { P, an, opts } = ctx;
  const [sub, setSub] = useState<LogicTab>("rel");
  const [relType, setRelType] = useState<string>("");

  const linkColumns: Column<Link>[] = [
    { k: "p", label: "Predecessor", cell: (l) => <span className="xer-mono">{l.pred ? l.pred.code : "(ext)"}</span>, sort: (l) => (l.pred ? l.pred.code : "") },
    { k: "pn", label: "Predecessor name", cell: (l) => (l.pred ? l.pred.name : ""), sort: (l) => (l.pred ? l.pred.name : "") },
    { k: "s", label: "Successor", cell: (l) => <span className="xer-mono">{l.succ ? l.succ.code : "(ext)"}</span>, sort: (l) => (l.succ ? l.succ.code : "") },
    { k: "sn", label: "Successor name", cell: (l) => (l.succ ? l.succ.name : ""), sort: (l) => (l.succ ? l.succ.name : "") },
    { k: "t", label: "Type", cell: (l) => <Badge tone={l.type === "FS" ? "mut" : "warn"}>{l.type}</Badge>, sort: (l) => l.type },
    { k: "lag", label: "Lag (d)", align: "right", cell: (l) => <span className={l.lag < 0 ? "xer-num xer-tone-text-bad" : "xer-num"}>{formatNum(l.lag, 1)}</span>, sort: (l) => l.lag },
    { k: "drv", label: "Driving", cell: (l) => (l.driving ? <Badge tone="bad">driving</Badge> : null), sort: (l) => (l.driving ? 0 : 1) },
    { k: "tf", label: "Succ TF", align: "right", cell: (l) => (l.succ ? floatCell(l.succ.tf, opts) : "—"), sort: (l) => (l.succ ? l.succ.tf : null) },
  ];

  const linkTable = (rows: Link[], name: string) => (
    <DataTable
      rows={rows}
      columns={linkColumns}
      rowKey={(l, i) => `${l.id}-${i}`}
      searchText={(l) => `${l.pred ? `${l.pred.code} ${l.pred.name}` : ""} ${l.succ ? `${l.succ.code} ${l.succ.name}` : ""}`}
      onRowClick={(l) => l.succ && ctx.openTask(l.succ)}
      exportName={name}
      minWidth={1000}
    />
  );

  const tabs: [LogicTab, string, number][] = [
    ["rel", "Relationships", an.linksInternal.length],
    ["open", "Open ends", an.openEnds.length],
    ["oos", "Out of sequence", an.outOfSequence.length],
    ["cyc", "Circular logic", an.inCycle.length],
    ["dang", "Dangling logic", an.danglingStart.length + an.danglingFinish.length],
    ["lag", "Leads & lags", an.leads.length + an.lags.length],
    ["red", "Redundant / duplicate", an.redundant.length + an.duplicateLinks.length],
    ["cst", "Constraints", an.constrained.length],
  ];

  const taskMini: Column<Task>[] = [
    { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
    { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
    { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
  ];

  return (
    <div className="xer-view">
      <div className="xer-subtabs">
        {tabs.map(([key, label, count]) => (
          <button type="button" key={key} className={sub === key ? "active" : ""} onClick={() => setSub(key)}>
            {label} <i>{formatNum(count)}</i>
          </button>
        ))}
      </div>

      {sub === "rel" ? (
        <>
          <Kpis>
            <Kpi label="Total relationships" value={formatNum(P.links.length)} note={`${formatNum(P.links.filter((l) => l.external).length)} external`} />
            <Kpi label="Finish-Start" value={formatNum(an.byRelType.FS)} note={`${formatNum(an.fsPct, 1)}% of network`} tone={an.fsPct >= 90 ? "ok" : "warn"} />
            <Kpi label="Start-Start" value={formatNum(an.byRelType.SS)} />
            <Kpi label="Finish-Finish" value={formatNum(an.byRelType.FF)} />
            <Kpi label="Start-Finish" value={formatNum(an.byRelType.SF)} note="should be rare" tone={an.byRelType.SF ? "warn" : "ok"} />
            <Kpi label="With lag" value={formatNum(an.lags.length)} note={`${formatNum(percent(an.lags.length, an.linksInternal.length), 1)}%`} />
            <Kpi label="With lead" value={formatNum(an.leads.length)} note="negative lag" tone={an.leads.length ? "crit" : "ok"} />
          </Kpis>
          <Card
            eyebrow="Network"
            title="All relationships"
            aside={
              <select className="xer-select" value={relType} onChange={(e) => setRelType(e.target.value)}>
                <option value="">All types</option>
                <option value="FS">FS</option>
                <option value="SS">SS</option>
                <option value="FF">FF</option>
                <option value="SF">SF</option>
              </select>
            }
          >
            {linkTable(relType ? P.links.filter((l) => l.type === relType) : P.links, "relationships")}
          </Card>
        </>
      ) : null}

      {sub === "open" ? (
        <div className="xer-grid xer-grid-2">
          <Card eyebrow="Open start" title={`No predecessor (${an.noPred.length})`}>
            <DataTable rows={an.noPred} columns={taskMini} rowKey={(t) => t.id} searchText={(t) => `${t.code} ${t.name}`} onRowClick={(t) => ctx.openTask(t)} exportName="no-predecessor" minWidth={480} />
          </Card>
          <Card eyebrow="Open finish" title={`No successor (${an.noSucc.length})`}>
            <DataTable rows={an.noSucc} columns={taskMini} rowKey={(t) => t.id} searchText={(t) => `${t.code} ${t.name}`} onRowClick={(t) => ctx.openTask(t)} exportName="no-successor" minWidth={480} />
          </Card>
        </div>
      ) : null}

      {sub === "oos" ? (
        <Card eyebrow="Logic quality" title={`Out-of-sequence progress — ${an.outOfSequence.length} relationship(s)`}>
          <p className="xer-muted xer-note">
            Work has been executed in a way the network logic does not allow. Each row is a relationship whose
            predecessor and successor actual dates contradict the link type — these are the relationships P6 resolves
            with retained logic or progress override, and they distort the remaining critical path.
          </p>
          <DataTable
            rows={an.outOfSequence}
            rowKey={(o, i) => `${o.link.id}-${i}`}
            searchText={(o) => `${o.pred.code} ${o.succ.code} ${o.pred.name} ${o.succ.name} ${o.reason}`}
            onRowClick={(o) => ctx.openTask(o.succ)}
            exportName="out-of-sequence"
            minWidth={1200}
            columns={[
              { k: "p", label: "Predecessor", cell: (o) => <span className="xer-mono">{o.pred.code}</span>, sort: (o) => o.pred.code },
              { k: "pn", label: "Predecessor name", cell: (o) => o.pred.name, sort: (o) => o.pred.name },
              { k: "ps", label: "Pred status", cell: (o) => o.pred.statusName, sort: (o) => o.pred.status },
              { k: "pf", label: "Pred finish", cell: (o) => dateCell(o.pred.finish, o.pred.actEnd), sort: (o) => +(o.pred.finish || 0), csv: (o) => formatDate(o.pred.finish) },
              { k: "t", label: "Rel", cell: (o) => o.link.type, sort: (o) => o.link.type },
              { k: "s", label: "Successor", cell: (o) => <span className="xer-mono">{o.succ.code}</span>, sort: (o) => o.succ.code },
              { k: "sn", label: "Successor name", cell: (o) => o.succ.name, sort: (o) => o.succ.name },
              { k: "ss", label: "Succ start", cell: (o) => dateCell(o.succ.actStart || o.succ.start, o.succ.actStart), sort: (o) => +(o.succ.actStart || o.succ.start || 0), csv: (o) => formatDate(o.succ.actStart || o.succ.start) },
              { k: "r", label: "Finding", cell: (o) => o.reason, sort: (o) => o.reason },
            ]}
          />
        </Card>
      ) : null}

      {sub === "cyc" ? (
        <Card eyebrow="Logic quality" title="Circular logic loops">
          {an.cycles.length ? (
            an.cycles.map((cycle, i) => (
              <div key={i} className="xer-loop">
                <p className="xer-muted">Loop {i + 1} — {cycle.length - 1} activities</p>
                <PathChain tasks={cycle} critical onPick={(t) => ctx.openTask(t)} />
              </div>
            ))
          ) : (
            <p className="xer-muted">No circular logic detected — the network is acyclic.</p>
          )}
        </Card>
      ) : null}

      {sub === "dang" ? (
        <div className="xer-grid xer-grid-2">
          <Card eyebrow="Logic quality" title={`Dangling starts — no FS/SS predecessor (${an.danglingStart.length})`}>
            <DataTable
              rows={an.danglingStart}
              rowKey={(t) => t.id}
              searchText={(t) => `${t.code} ${t.name}`}
              onRowClick={(t) => ctx.openTask(t)}
              exportName="dangling-start"
              minWidth={560}
              columns={[
                ...taskMini.slice(0, 2),
                { k: "p", label: "Predecessor types", cell: (t) => uniq(t.preds.map((l) => l.type)).join(", "), sort: (t) => uniq(t.preds.map((l) => l.type)).join(",") },
              ]}
            />
          </Card>
          <Card eyebrow="Logic quality" title={`Dangling finishes — no FS/FF successor (${an.danglingFinish.length})`}>
            <DataTable
              rows={an.danglingFinish}
              rowKey={(t) => t.id}
              searchText={(t) => `${t.code} ${t.name}`}
              onRowClick={(t) => ctx.openTask(t)}
              exportName="dangling-finish"
              minWidth={560}
              columns={[
                ...taskMini.slice(0, 2),
                { k: "s", label: "Successor types", cell: (t) => uniq(t.succs.map((l) => l.type)).join(", "), sort: (t) => uniq(t.succs.map((l) => l.type)).join(",") },
              ]}
            />
          </Card>
        </div>
      ) : null}

      {sub === "lag" ? (
        <>
          <Kpis>
            <Kpi label="Leads (negative lag)" value={formatNum(an.leads.length)} note="DCMA target: 0" tone={an.leads.length ? "crit" : "ok"} />
            <Kpi label="Lags" value={formatNum(an.lags.length)} note={`${formatNum(percent(an.lags.length, an.linksInternal.length), 1)}% of links`} tone={percent(an.lags.length, an.linksInternal.length) > 5 ? "warn" : "ok"} />
            <Kpi label={`Lag > ${opts.longLag} days`} value={formatNum(an.longLags.length)} note="review for missing scope" tone={an.longLags.length ? "warn" : "ok"} />
            <Kpi label="Largest lag" value={`${formatNum(Math.max(0, ...an.lags.map((l) => l.lag)), 1)} d`} />
            <Kpi label="Largest lead" value={`${formatNum(Math.min(0, ...an.leads.map((l) => l.lag)), 1)} d`} />
          </Kpis>
          <Card eyebrow="Network" title="Relationships carrying lead or lag">
            {linkTable(sortBy(an.leads.concat(an.lags), (l) => Math.abs(l.lag), -1), "leads-lags")}
          </Card>
        </>
      ) : null}

      {sub === "red" ? (
        <>
          <Card eyebrow="Logic quality" title={`Redundant relationships (${an.redundant.length})`}>
            <p className="xer-muted xer-note">
              A direct finish-start link that a longer path through the network already implies. Removing them
              simplifies the logic without changing dates.
            </p>
            {linkTable(an.redundant, "redundant")}
          </Card>
          <Card eyebrow="Logic quality" title={`Duplicate relationships (${an.duplicateLinks.length})`}>
            {linkTable(an.duplicateLinks, "duplicate-links")}
          </Card>
        </>
      ) : null}

      {sub === "cst" ? (
        <>
          <Kpis>
            <Kpi label="Constrained activities" value={formatNum(an.constrained.length)} note={`${formatNum(percent(an.constrained.length, P.tasks.length), 1)}% of schedule`} />
            <Kpi label="Hard constraints" value={formatNum(an.hardConstraints.length)} note="override network logic" tone={an.hardConstraints.length ? "crit" : "ok"} />
            <Kpi label="Soft constraints" value={formatNum(an.softConstraints.length)} />
          </Kpis>
          <Card eyebrow="Constraints" title="All constrained activities">
            <DataTable
              rows={an.constrained}
              rowKey={(t) => t.id}
              searchText={(t) => `${t.code} ${t.name}`}
              onRowClick={(t) => ctx.openTask(t)}
              exportName="constraints"
              minWidth={1100}
              columns={[
                { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
                { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
                { k: "t", label: "Constraint", cell: (t) => <Badge tone={HARD_CONSTRAINTS.includes(t.cstrType) ? "bad" : "warn"}>{CONSTRAINT[t.cstrType] || t.cstrType}</Badge>, sort: (t) => t.cstrType },
                { k: "d", label: "Date", cell: (t) => dateCell(t.cstrDate), sort: (t) => +(t.cstrDate || 0), csv: (t) => formatDate(t.cstrDate) },
                { k: "t2", label: "Secondary", cell: (t) => (t.cstrType2 ? CONSTRAINT[t.cstrType2] || t.cstrType2 : ""), sort: (t) => t.cstrType2 },
                { k: "d2", label: "Date", cell: (t) => dateCell(t.cstrDate2), sort: (t) => +(t.cstrDate2 || 0), csv: (t) => formatDate(t.cstrDate2) },
                { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
                { k: "f", label: "Finish", cell: (t) => dateCell(t.finish, t.actEnd), sort: (t) => +(t.finish || 0), csv: (t) => formatDate(t.finish) },
              ]}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- critical path */

export function CriticalView({ ctx }: { ctx: ViewCtx }) {
  const { P, an, opts } = ctx;
  const lp = an.longestPath;
  const critical = sortBy(
    P.tasks.filter((t) => !t.done && t.tf !== null && t.tf <= opts.tfCritical),
    (t) => +(t.start || 0),
  );
  const driftDays = an.calcFinish && P.finish ? Math.abs((+an.calcFinish - +P.finish) / 86_400_000) : 0;

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Longest path" value={formatNum(lp.length)} note="driving activities" tone="crit" />
        <Kpi label="Critical by float" value={formatNum(critical.length)} note={`TF ≤ ${opts.tfCritical} d`} />
        <Kpi label="Path duration" value={`${formatNum(an.lpDuration, 0)} d`} note={`${formatDate(an.calcStart)} → ${formatDate(an.calcFinish)}`} />
        <Kpi label="Recalculated finish" value={formatDate(an.calcFinish) || "—"} note={`stored: ${formatDate(P.finish) || "—"}`} tone={driftDays > 1 ? "warn" : "ok"} />
        <Kpi label="Longest-path float" value={lp.length && lp[lp.length - 1].tf !== null ? `${formatNum(lp[lp.length - 1].tf, 1)} d` : "—"} note="float on the driving chain" />
        {an.cpli !== undefined ? <Kpi label="CPLI" value={formatNum(an.cpli, 2)} note="≥ 0.95 target" tone={an.cpli >= 0.95 ? "ok" : "crit"} /> : null}
      </Kpis>

      <Card eyebrow="Driving logic" title="Longest path">
        {lp.length ? (
          <>
            <PathChain tasks={lp} critical max={80} onPick={(t) => ctx.openTask(t)} />
            <DataTable
              rows={lp}
              rowKey={(t) => t.id}
              onRowClick={(t) => ctx.openTask(t)}
              exportName="longest-path"
              minWidth={1200}
              columns={[
                { k: "i", label: "#", align: "right", cell: (t) => lp.indexOf(t) + 1, sort: (t) => lp.indexOf(t) },
                { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
                { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
                { k: "w", label: "WBS", cell: (t) => t.wbsPath, sort: (t) => t.wbsPath },
                { k: "rd", label: "RD", align: "right", cell: (t) => formatNum(t.rd, 1), sort: (t) => t.rd },
                { k: "s", label: "Start", cell: (t) => dateCell(t.c.es), sort: (t) => +(t.c.es || 0), csv: (t) => formatDate(t.c.es) },
                { k: "f", label: "Finish", cell: (t) => dateCell(t.c.ef), sort: (t) => +(t.c.ef || 0), csv: (t) => formatDate(t.c.ef) },
                { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
                {
                  k: "dr",
                  label: "Driven by",
                  cell: (t) => (
                    <span className="xer-mono xer-dim">
                      {t.c.drivers.length
                        ? t.c.drivers.map((l) => `${l.pred!.code} ${l.type}${l.lag ? `${l.lag > 0 ? "+" : ""}${l.lag}d` : ""}`).join(", ")
                        : t.c.constrained
                          ? `constraint: ${CONSTRAINT[t.cstrType] || t.cstrType || CONSTRAINT[t.cstrType2] || ""}`
                          : t.started
                            ? "in progress at data date"
                            : "data date"}
                    </span>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <p className="xer-muted">The longest path could not be traced — check for circular logic or missing dates.</p>
        )}
      </Card>

      <Card eyebrow="Total float" title={`Critical activities (${critical.length})`}>
        <DataTable
          rows={critical}
          rowKey={(t) => t.id}
          searchText={(t) => `${t.code} ${t.name} ${t.wbsPath}`}
          onRowClick={(t) => ctx.openTask(t)}
          exportName="critical"
          minWidth={1100}
          columns={[
            { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
            { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
            { k: "w", label: "WBS", cell: (t) => t.wbsPath, sort: (t) => t.wbsPath },
            { k: "st", label: "Status", cell: (t) => statusTag(t), sort: (t) => t.status },
            { k: "rd", label: "RD", align: "right", cell: (t) => formatNum(t.rd, 1), sort: (t) => t.rd },
            { k: "s", label: "Start", cell: (t) => dateCell(t.start, t.actStart), sort: (t) => +(t.start || 0), csv: (t) => formatDate(t.start) },
            { k: "f", label: "Finish", cell: (t) => dateCell(t.finish, t.actEnd), sort: (t) => +(t.finish || 0), csv: (t) => formatDate(t.finish) },
            { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
            { k: "lp", label: "On LP", cell: (t) => (t.c.lp ? <Badge tone="bad">yes</Badge> : null), sort: (t) => (t.c.lp ? 0 : 1) },
          ]}
        />
      </Card>

      {an.drift.count ? (
        <Card
          eyebrow="Verification"
          title={`Stored dates vs recalculated CPM — ${an.drift.count} activities differ by more than a day`}
        >
          <p className="xer-muted xer-note">
            This engine re-runs the forward and backward pass using each activity&apos;s own calendar and the file&apos;s
            own lag-calendar setting. {an.drift.interpretation} P6 places {formatNum(an.drift.later)} of these later
            and {formatNum(an.drift.earlier)} earlier. Confirm in native P6 before drawing a conclusion from either set
            of dates.
          </p>
          <DataTable
            rows={an.drift.list.slice(0, 500)}
            rowKey={(d, i) => `${d.task.id}-${i}`}
            searchText={(d) => `${d.task.code} ${d.task.name}`}
            onRowClick={(d) => ctx.openTask(d.task)}
            exportName="cpm-drift"
            minWidth={900}
            columns={[
              { k: "c", label: "ID", cell: (d) => <span className="xer-mono">{d.task.code}</span>, sort: (d) => d.task.code },
              { k: "n", label: "Name", cell: (d) => d.task.name, sort: (d) => d.task.name },
              { k: "s", label: "Stored finish", cell: (d) => dateCell(d.task.finish), sort: (d) => +(d.task.finish || 0), csv: (d) => formatDate(d.task.finish) },
              { k: "r", label: "Recalculated", cell: (d) => dateCell(d.task.c.ef), sort: (d) => +(d.task.c.ef || 0), csv: (d) => formatDate(d.task.c.ef) },
              { k: "d", label: "Drift (d)", align: "right", cell: (d) => deltaCell(d.days), sort: (d) => Math.abs(d.days || 0), csv: (d) => d.days },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- float paths */

export function FloatPathsView({ ctx }: { ctx: ViewCtx }) {
  const { an, opts } = ctx;
  const paths = an.floatPaths;

  if (!paths.length) {
    return (
      <div className="xer-view">
        <div className="schedule-intelligence-empty schedule-intelligence-empty-large">
          <b>No float paths could be computed</b>
          <span>Check that the file carries float values and that the network is acyclic.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="xer-view">
      <p className="xer-muted xer-note">
        Paths are traced through driving relationships, lowest float first — path 1 is the longest path. This mirrors
        P6&apos;s multiple float path analysis without requiring it to have been run.
        {an.storedFloatPaths.length
          ? ` This file also carries ${an.storedFloatPaths.length} P6-stored float paths.`
          : ""}
      </p>

      <Kpis>
        {paths.slice(0, 8).map((p) => (
          <Kpi
            key={p.index}
            label={`Path ${p.index}`}
            value={`${formatNum(p.tf, 1)} d`}
            note={`${p.tasks.length} activities · ends ${formatDate(p.finish)}`}
            tone={p.index === 1 ? "crit" : p.tf <= opts.tfNear ? "warn" : ""}
            onClick={() => ctx.drill(`Float path ${p.index}`, (t) => t.c && t.c.fp === p.index)}
          />
        ))}
      </Kpis>

      {paths.slice(0, 12).map((p) => (
        <Card
          key={p.index}
          eyebrow={`Float path ${p.index}`}
          title={`Total float ${formatNum(p.tf, 1)} d · ${p.tasks.length} activities`}
          aside={`${formatDate(p.start)} → ${formatDate(p.finish)}`}
        >
          <PathChain tasks={p.tasks} critical={p.index === 1} max={40} onPick={(t) => ctx.openTask(t)} />
          <DataTable
            rows={p.tasks}
            rowKey={(t) => t.id}
            pageSize={50}
            onRowClick={(t) => ctx.openTask(t)}
            exportName={`float-path-${p.index}`}
            minWidth={860}
            columns={[
              { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
              { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
              { k: "rd", label: "RD", align: "right", cell: (t) => formatNum(t.rd, 1), sort: (t) => t.rd },
              { k: "s", label: "Start", cell: (t) => dateCell(t.start, t.actStart), sort: (t) => +(t.start || 0), csv: (t) => formatDate(t.start) },
              { k: "f", label: "Finish", cell: (t) => dateCell(t.finish, t.actEnd), sort: (t) => +(t.finish || 0), csv: (t) => formatDate(t.finish) },
              { k: "tf", label: "TF", align: "right", cell: (t) => floatCell(t.tf, opts), sort: (t) => t.tf },
            ]}
          />
        </Card>
      ))}

      {an.storedFloatPaths.length ? (
        <Card
          eyebrow="From the file"
          title={`P6-stored float paths (${an.storedFloatPaths.length})`}
          aside="written by a multiple-float-path run"
        >
          <p className="xer-muted xer-note">
            These come from the XER itself — P6 wrote them during a multiple-float-path calculation. Where they differ
            from the traced paths above, the file was edited after that run.
          </p>
          <DataTable
            rows={an.storedFloatPaths}
            rowKey={(p) => String(p.index)}
            pageSize={30}
            exportName="stored-float-paths"
            minWidth={700}
            columns={[
              { k: "i", label: "Path", align: "right", cell: (p) => p.index, sort: (p) => p.index },
              { k: "n", label: "Activities", align: "right", cell: (p) => formatNum(p.tasks.length), sort: (p) => p.tasks.length },
              { k: "tf", label: "Lowest TF", align: "right", cell: (p) => (p.tf >= 1e9 ? "—" : formatNum(p.tf, 1)), sort: (p) => p.tf },
              {
                k: "chain", label: "Leading activities",
                cell: (p) => <span className="xer-mono xer-dim">{p.tasks.slice(0, 8).map((t) => t.code).join(" → ")}{p.tasks.length > 8 ? " …" : ""}</span>,
              },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- health */

/** One row per finding — the activity or relationship behind each failed check. */
function exportHealth(ctx: ViewCtx): void {
  const rows: unknown[][] = [];
  for (const check of ctx.an.checks) {
    if (!check.items.length) {
      rows.push([check.cat, check.name, check.status.toUpperCase(), check.count, `${formatNum(check.pctv, 1)}%`, "", "", check.desc]);
      continue;
    }
    for (const item of check.items) {
      let ref = "";
      let detail = "";
      if (item && typeof item === "object" && "link" in item) {
        const l = (item as { link: Link; reason?: string }).link;
        ref = `${l.pred?.code || "(ext)"} → ${l.succ?.code || "(ext)"}`;
        detail = `${l.type}${l.lag ? ` ${l.lag > 0 ? "+" : ""}${formatNum(l.lag, 1)}d` : ""}${(item as { reason?: string }).reason ? ` · ${(item as { reason?: string }).reason}` : ""}`;
      } else if (item && typeof item === "object" && "task" in item) {
        const t = (item as { task: Task; days: number | null }).task;
        ref = t.code;
        detail = `${t.name} · drift ${formatNum((item as { days: number | null }).days || 0, 1)}d`;
      } else {
        const t = item as Task;
        ref = t.code;
        detail = t.name;
      }
      rows.push([check.cat, check.name, check.status.toUpperCase(), check.count, `${formatNum(check.pctv, 1)}%`, ref, detail, check.desc]);
    }
  }
  downloadCsv(
    `${ctx.P.name}_schedule_health_findings.csv`,
    ["Category", "Check", "Status", "Check count", "Check %", "Reference", "Detail", "Description"],
    rows,
  );
}

export function HealthView({ ctx }: { ctx: ViewCtx }) {
  const { an } = ctx;
  const groups = groupBy(an.checks, (c) => c.cat);
  const failWarn = an.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const byCategory = groupBy(failWarn, (c) => c.cat.split("·")[0].trim());
  const categoryBars = Array.from(byCategory.entries()).map(([label, list]) => ({
    label,
    value: list.length,
    tone: list.some((c) => c.status === "fail") ? "bad" : "warn",
  }));

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Health score" value={`${an.score}%`} note={`weighted across ${an.checks.length} checks`} tone={scoreTone(an.score)} />
        <Kpi label="Passed" value={formatNum(an.passCount)} tone="ok" />
        <Kpi label="Warnings" value={formatNum(an.warnCount)} tone="warn" />
        <Kpi label="Failures" value={formatNum(an.failCount)} tone="crit" />
      </Kpis>

      <Card
        eyebrow="Summary"
        title="Failures and warnings by category"
        aside={
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => exportHealth(ctx)}>
            Export findings
          </button>
        }
      >
        {categoryBars.length ? (
          <Bars data={categoryBars} />
        ) : (
          <p className="xer-muted">No failures or warnings — every check passed.</p>
        )}
        <p className="xer-muted xer-note">
          Checks are weighted by severity and follow the DCMA 14-point assessment thresholds. They describe the state of
          the file as delivered; they do not modify it.
        </p>
      </Card>

      <Card eyebrow="Transparency" title="Assumptions this recalculation used">
        <table className="xer-mini-table">
          <tbody>
            <tr>
              <td>Lag calendar</td>
              <td>
                <span className="xer-mono">{an.lagCalendarMode}</span>{" "}
                {an.lagCalendarSource === "file" ? (
                  <Badge tone="ok">from SCHEDOPTIONS</Badge>
                ) : an.lagCalendarSource === "inferred" ? (
                  <Badge tone="warn">inferred — file carries no SCHEDOPTIONS</Badge>
                ) : (
                  <Badge tone="warn">P6 default — file carries no SCHEDOPTIONS</Badge>
                )}
              </td>
            </tr>
            <tr>
              <td>Retained logic</td>
              <td>
                {ctx.opts.retainedLogic ? "on" : "off"}
                {ctx.P.schedOpt.raw && ctx.P.schedOpt.raw.sched_retained_logic
                  ? ` · file says ${ctx.P.schedOpt.retainedLogic ? "retained logic" : "progress override"}`
                  : ""}
              </td>
            </tr>
            <tr>
              <td>Late dates run back from</td>
              <td>{an.lateFromProjEnd ? "project must-finish date" : "latest calculated early finish"}</td>
            </tr>
            <tr>
              <td>Calendars read from clndr_data</td>
              <td>
                {ctx.P.S.calList.filter((c) => c.parsed).length} of {ctx.P.S.calList.length}
                {ctx.P.S.calList.some((c) => !c.parsed) ? " — the rest assume a 5×8 week" : ""}
              </td>
            </tr>
            <tr>
              <td>Stored vs recalculated finish</td>
              <td>
                {formatDate(ctx.P.finish) || "—"} → {formatDate(an.calcFinish) || "—"}
                {an.drift.count ? ` · ${formatNum(an.drift.count)} activities differ by more than a day` : " · no material drift"}
              </td>
            </tr>
            <tr>
              <td>Reading of the difference</td>
              <td>{an.drift.interpretation}</td>
            </tr>
          </tbody>
        </table>
        <p className="xer-muted xer-note">
          These are the settings the recalculation ran under. Where they disagree with the controlled P6 copy, the P6
          result governs.
        </p>
      </Card>

      {Array.from(groups.entries()).map(([category, list]) => (
        <Card key={category} eyebrow="Assessment" title={category}>
          <div className="xer-checks">
            {list.map((check) => (
              <button type="button" key={check.id} className="xer-check-row" onClick={() => ctx.openCheck(check)}>
                <i className={`xer-check-dot xer-tone-${check.status === "fail" ? "bad" : check.status === "warn" ? "warn" : check.status === "pass" ? "ok" : "blue"}`} />
                <span className="xer-check-name">
                  <b>{check.name}</b>
                  <small>
                    {check.desc}
                    {check.info ? ` · ${check.info}` : ""}
                  </small>
                </span>
                <span className="xer-check-count">
                  {formatNum(check.count)} {check.unit === "ratio" ? "" : check.unit === "relationships" ? "rels" : "acts"}
                </span>
                <span className="xer-check-pct">{check.unit === "ratio" ? "" : `${formatNum(check.pctv, 1)}%`}</span>
                <Badge tone={check.status === "fail" ? "bad" : check.status === "warn" ? "warn" : check.status === "pass" ? "ok" : "info"}>
                  {check.status.toUpperCase()}
                </Badge>
              </button>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Gantt */

type GanttSort = "start" | "finish" | "tf" | "wbs";

/** Month tick marks across the visible span, thinned to stay legible. */
function monthTicks(min: number, max: number): { at: number; label: string }[] {
  const out: { at: number; label: string }[] = [];
  const span = max - min;
  if (span <= 0) return out;
  const start = new Date(min);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  if (+cursor < min) cursor.setMonth(cursor.getMonth() + 1);
  const months: Date[] = [];
  while (+cursor <= max && months.length < 400) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const step = Math.max(1, Math.ceil(months.length / 14));
  months.forEach((d, i) => {
    if (i % step) return;
    out.push({
      at: ((+d - min) / span) * 100,
      label: `${MON_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    });
  });
  return out;
}

const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function GanttView({ ctx }: { ctx: ViewCtx }) {
  const { P, opts, cmp } = ctx;
  const [sort, setSort] = useState<GanttSort>("start");
  const [showFloat, setShowFloat] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [limit, setLimit] = useState(400);

  const changedTest = useMemo(() => {
    if (!cmp) return undefined;
    return (t: Task) => {
      const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
      return !!d && (d.changes.length > 0 || d.logicChanges.length > 0);
    };
  }, [cmp]);

  const all = useMemo(() => {
    const list = filterTasks(P, ctx.filter, opts, ctx.adhoc, changedTest);
    return sortBy(list, (t) =>
      sort === "start" ? +(t.start || 0)
        : sort === "finish" ? +(t.finish || 0)
          : sort === "tf" ? (t.tf === null ? 1e9 : t.tf)
            : `${t.wbsPath}${t.code}`,
    );
  }, [P, ctx.filter, ctx.adhoc, opts, sort, changedTest]);

  const rows = all.slice(0, limit);

  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    const note = (d: Date | null | undefined) => {
      if (!d) return;
      min = Math.min(min, +d);
      max = Math.max(max, +d);
    };
    for (const t of rows) {
      note(t.start);
      note(t.finish);
      if (showFloat) note(t.lateFinish);
      if (cmp && overlay) {
        const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
        const other = d ? (ctx.scope === "B" ? d.a : d.b) : null;
        note(other?.start);
        note(other?.finish);
      }
    }
    note(P.dataDate);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    // A little breathing room either side so end bars are not flush with the edge.
    const pad = (max - min) * 0.01;
    return { min: min - pad, max: max + pad, span: max - min + pad * 2 };
  }, [rows, showFloat, overlay, cmp, ctx.scope, P.dataDate]);

  const pos = (d: Date | null | undefined) => (bounds && d ? clamp(((+d - bounds.min) / bounds.span) * 100, 0, 100) : null);
  const ticks = bounds ? monthTicks(bounds.min, bounds.max) : [];
  const dataDateAt = pos(P.dataDate);

  return (
    <div className="xer-view">
      <FilterBar ctx={ctx} />

      <div className="xer-toolbar">
        <label className="xer-field">
          <span>Sort</span>
          <select className="xer-select" value={sort} onChange={(e) => setSort(e.target.value as GanttSort)}>
            <option value="start">Start date</option>
            <option value="finish">Finish date</option>
            <option value="tf">Total float</option>
            <option value="wbs">WBS</option>
          </select>
        </label>
        <label className="xer-field">
          <input type="checkbox" checked={showFloat} onChange={(e) => setShowFloat(e.target.checked)} />
          <span>Float bar</span>
        </label>
        {cmp ? (
          <label className="xer-field">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            <span>Overlay schedule {ctx.scope === "B" ? "A" : "B"}</span>
          </label>
        ) : null}
        <label className="xer-field">
          <span>Rows</span>
          <select className="xer-select" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[200, 400, 1000, 2500].map((n) => (
              <option key={n} value={n}>{formatNum(n)}</option>
            ))}
          </select>
        </label>
        <span className="xer-dim">
          {formatNum(rows.length)}
          {rows.length < all.length ? ` of ${formatNum(all.length)}` : ""} activities
        </span>
      </div>

      <div className="xer-legend xer-legend-wrap">
        <i className="xer-tone-blue" /> Not started
        <i className="xer-tone-ok" /> In progress
        <i className="xer-tone-bad" /> Critical
        <i className="xer-tone-mut" /> Complete
        {cmp && overlay ? <><i className="xer-tone-violet" /> Other schedule</> : null}
        {showFloat ? <><i className="xer-legend-float" /> Total float</> : null}
      </div>

      <Card>
        {!bounds || !rows.length ? (
          <p className="xer-muted">No dated activities match the current filters.</p>
        ) : (
          <>
            <div className="xer-gantt-axis">
              {ticks.map((t) => (
                <span key={t.label + t.at} style={{ left: `${t.at}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
            <div className="xer-gantt xer-gantt-single">
              {ticks.map((t) => (
                <i key={`grid-${t.at}`} className="xer-gantt-grid" style={{ left: `calc(${t.at}% * 0.72 + 28%)` }} />
              ))}
              {dataDateAt !== null ? (
                <i className="xer-gantt-now" style={{ left: `calc(${dataDateAt}% * 0.72 + 28%)` }} title={`Data date ${formatDate(P.dataDate)}`} />
              ) : null}
              {rows.map((t) => {
                const critical = t.tf !== null && t.tf <= opts.tfCritical && !t.done;
                const tone = t.done ? "mut" : t.started ? "ok" : critical ? "bad" : "blue";
                const s = pos(t.start);
                const f = pos(t.finish);
                const other = cmp && overlay
                  ? (() => {
                      const d = cmp.diffByIdA.get(t.id) || cmp.diffByIdB.get(t.id);
                      return d ? (ctx.scope === "B" ? d.a : d.b) : null;
                    })()
                  : null;
                const os = pos(other?.start);
                const of = pos(other?.finish);
                const floatFrom = showFloat && t.tf !== null && t.tf > 0 ? pos(t.finish) : null;
                const floatTo = showFloat && t.tf !== null && t.tf > 0 ? pos(t.lateFinish) : null;

                return (
                  <button
                    type="button"
                    key={t.id}
                    className="xer-gantt-row"
                    onClick={() => ctx.openTask(t)}
                    title={`${t.code} — ${t.name}\n${formatDate(t.start)} → ${formatDate(t.finish)}\nTF ${t.tf === null ? "—" : formatNum(t.tf, 1)}d · ${formatNum(t.pct, 0)}%`}
                  >
                    <span className="xer-gantt-label">
                      <b className="xer-mono">{t.code}</b>
                      <small>{t.name}</small>
                    </span>
                    <span className="xer-gantt-track">
                      {floatFrom !== null && floatTo !== null && floatTo > floatFrom ? (
                        <i className="xer-gantt-floatbar" style={{ left: `${floatFrom}%`, width: `${floatTo - floatFrom}%` }} />
                      ) : null}
                      {os !== null && of !== null && !other?.isMile ? (
                        <i className="xer-gantt-bar xer-gantt-ghost" style={{ left: `${os}%`, width: `${Math.max(0.4, of - os)}%` }} />
                      ) : null}
                      {t.isMile && f !== null ? (
                        <i className={`xer-gantt-mile xer-tone-${critical ? "bad" : "blue"}`} style={{ left: `${f}%` }} />
                      ) : s !== null && f !== null ? (
                        <i className={`xer-gantt-bar xer-tone-${tone}`} style={{ left: `${s}%`, width: `${Math.max(0.4, f - s)}%` }}>
                          {t.pct > 0 && t.pct < 100 ? <em style={{ width: `${t.pct}%` }} /> : null}
                        </i>
                      ) : null}
                    </span>
                    <span className="xer-gantt-var">{t.tf === null ? <span className="xer-dim">—</span> : floatCell(t.tf, opts)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ WBS */

export function WbsView({ ctx }: { ctx: ViewCtx }) {
  const { P, opts } = ctx;
  const rows: WbsNode[] = [];
  (function walk(list: WbsNode[]) {
    for (const w of list) {
      rows.push(w);
      walk(w.children);
    }
  })(P.wbsRoots);

  return (
    <div className="xer-view">
      <Card eyebrow="Structure" title="Work breakdown structure" aside="Click a row to filter the activity list">
        <DataTable
          rows={rows}
          rowKey={(w) => w.id}
          pageSize={300}
          searchText={(w) => `${w.code} ${w.name}`}
          exportName="wbs"
          minWidth={1100}
          onRowClick={(w) => {
            ctx.setFilter({ ...ctx.filter, wbs: w.id });
            ctx.goTab("act");
          }}
          columns={[
            {
              k: "c", label: "WBS code", sort: (w) => w.path,
              cell: (w) => (
                <span className="xer-mono" style={{ paddingLeft: `${w.level * 13}px` }}>
                  {w.children.length ? "▾ " : "  "}
                  {w.code || ""}
                </span>
              ),
            },
            { k: "n", label: "Name", cell: (w) => w.name, sort: (w) => w.name },
            { k: "t", label: "Activities", align: "right", cell: (w) => formatNum(w.stat?.count || 0), sort: (w) => w.stat?.count || 0 },
            { k: "d", label: "Complete", align: "right", cell: (w) => formatNum(w.stat?.done || 0), sort: (w) => w.stat?.done || 0 },
            { k: "p", label: "% complete", align: "right", cell: (w) => percentCell(w.stat?.pct || 0), sort: (w) => w.stat?.pct || 0, csv: (w) => Math.round(w.stat?.pct || 0) },
            { k: "s", label: "Start", cell: (w) => dateCell(w.stat?.start || null), sort: (w) => +(w.stat?.start || 0), csv: (w) => formatDate(w.stat?.start || null) },
            { k: "f", label: "Finish", cell: (w) => dateCell(w.stat?.finish || null), sort: (w) => +(w.stat?.finish || 0), csv: (w) => formatDate(w.stat?.finish || null) },
            { k: "tf", label: "Min TF", align: "right", cell: (w) => floatCell(w.stat?.minTF ?? null, opts), sort: (w) => w.stat?.minTF ?? null },
            { k: "b", label: "Budget", align: "right", cell: (w) => (w.stat?.budget ? formatMoney(w.stat.budget) : ""), sort: (w) => w.stat?.budget || 0 },
          ]}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ resources */

const RESOURCE_TYPE: Record<string, string> = { RT_Labor: "Labour", RT_Mat: "Material", RT_Equip: "Equipment" };

export function ResourcesView({ ctx }: { ctx: ViewCtx }) {
  const { P, an } = ctx;
  const s = an.stat;

  const rows = useMemo(() => {
    const map = new Map<string, {
      id: string; name: string; desc: string; type: string;
      tasks: number; qty: number; actQty: number; remQty: number; cost: number; actCost: number; remCost: number;
    }>();
    for (const t of P.tasks) {
      for (const r of t.rsrcs) {
        const meta = P.S.rsrcById[r.rsrc_id] || {};
        const entry = map.get(r.rsrc_id) || {
          id: r.rsrc_id, name: meta.rsrc_short_name || r.rsrc_id, desc: meta.rsrc_name || "", type: meta.rsrc_type || "",
          tasks: 0, qty: 0, actQty: 0, remQty: 0, cost: 0, actCost: 0, remCost: 0,
        };
        entry.tasks++;
        entry.qty += Number(r.target_qty) || 0;
        entry.actQty += (Number(r.act_reg_qty) || 0) + (Number(r.act_ot_qty) || 0);
        entry.remQty += Number(r.remain_qty) || 0;
        entry.cost += Number(r.target_cost) || 0;
        entry.actCost += (Number(r.act_reg_cost) || 0) + (Number(r.act_ot_cost) || 0);
        entry.remCost += Number(r.remain_cost) || 0;
        map.set(r.rsrc_id, entry);
      }
    }
    return Array.from(map.values());
  }, [P]);

  return (
    <div className="xer-view">
      <Kpis>
        <Kpi label="Resources used" value={formatNum(rows.length)} />
        <Kpi label="Assignments" value={formatNum(P.tasks.reduce((a, t) => a + t.rsrcs.length, 0))} />
        <Kpi label="Budgeted cost" value={formatMoney(s.budget)} />
        <Kpi label="Actual cost" value={formatMoney(s.actual)} note={`${formatNum(percent(s.actual, s.budget || 1), 1)}% spent`} />
        <Kpi label="Remaining cost" value={formatMoney(s.remain)} />
        <Kpi label="Activities without resources" value={formatNum(P.tasks.filter((t) => !t.rsrcs.length && !t.isMile).length)} />
      </Kpis>

      {rows.length ? (
        <Card eyebrow="Assignments" title="Resource summary">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            searchText={(r) => `${r.name} ${r.desc}`}
            exportName="resources"
            minWidth={1200}
            onRowClick={(r) => ctx.drill(`Resource ${r.name}`, (t) => t.rsrcs.some((x) => x.rsrc_id === r.id))}
            columns={[
              { k: "n", label: "Resource", cell: (r) => <span className="xer-mono">{r.name}</span>, sort: (r) => r.name },
              { k: "d", label: "Description", cell: (r) => r.desc, sort: (r) => r.desc },
              { k: "t", label: "Type", cell: (r) => RESOURCE_TYPE[r.type] || r.type, sort: (r) => r.type },
              { k: "a", label: "Activities", align: "right", cell: (r) => formatNum(r.tasks), sort: (r) => r.tasks },
              { k: "q", label: "Budget units", align: "right", cell: (r) => formatNum(r.qty, 1), sort: (r) => r.qty },
              { k: "aq", label: "Actual units", align: "right", cell: (r) => formatNum(r.actQty, 1), sort: (r) => r.actQty },
              { k: "rq", label: "Remaining units", align: "right", cell: (r) => formatNum(r.remQty, 1), sort: (r) => r.remQty },
              { k: "c", label: "Budget cost", align: "right", cell: (r) => formatMoney(r.cost), sort: (r) => r.cost },
              { k: "ac", label: "Actual cost", align: "right", cell: (r) => formatMoney(r.actCost), sort: (r) => r.actCost },
            ]}
          />
        </Card>
      ) : (
        <div className="schedule-intelligence-empty schedule-intelligence-empty-large">
          <b>This schedule carries no resource assignments</b>
          <span>Resource and cost checks will report as not applicable.</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ calendars */

const CALENDAR_TYPE: Record<string, string> = { CA_Base: "Global", CA_Rsrc: "Resource", CA_Project: "Project" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function shiftLabel(shift: [number, number]): string {
  const fmt = (h: number) =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  return `${fmt(shift[0])}–${fmt(shift[1])}`;
}

export function CalendarsView({ ctx }: { ctx: ViewCtx }) {
  const { P } = ctx;
  const [openId, setOpenId] = useState<string | null>(null);

  const usage = new Map<string, number>();
  for (const t of P.tasks) usage.set(t.calId, (usage.get(t.calId) || 0) + 1);
  const selected = openId ? P.S.calList.find((c) => c.id === openId) : null;

  return (
    <div className="xer-view">
      <Card eyebrow="Working time" title="Calendars in this file">
        <DataTable
          rows={P.S.calList}
          rowKey={(c) => c.id}
          searchText={(c) => c.name}
          exportName="calendars"
          minWidth={1100}
          onRowClick={(c) => setOpenId(c.id === openId ? null : c.id)}
          columns={[
            { k: "n", label: "Calendar", cell: (c) => c.name, sort: (c) => c.name },
            { k: "t", label: "Type", cell: (c) => CALENDAR_TYPE[c.type] || c.type, sort: (c) => c.type },
            { k: "d", label: "Default", cell: (c) => (c.isDefault ? <Badge tone="info">default</Badge> : null), sort: (c) => (c.isDefault ? 0 : 1) },
            { k: "w", label: "Work days/week", align: "right", cell: (c) => c.summary().days, sort: (c) => c.summary().days },
            { k: "h", label: "Hours/week", align: "right", cell: (c) => formatNum(c.summary().hours, 1), sort: (c) => c.summary().hours },
            { k: "hd", label: "Hours/day", align: "right", cell: (c) => formatNum(c.dayHours, 1), sort: (c) => c.dayHours },
            { k: "e", label: "Exceptions", align: "right", cell: (c) => c.exceptionList.length, sort: (c) => c.exceptionList.length },
            { k: "u", label: "Activities", align: "right", cell: (c) => formatNum(usage.get(c.id) || 0), sort: (c) => usage.get(c.id) || 0 },
            { k: "p", label: "Pattern", cell: (c) => <span className="xer-mono">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (c.week[i] > 0 ? d : "·")).join(" ")}</span> },
            { k: "parsed", label: "Detail", cell: (c) => (c.parsed ? <Badge tone="ok">parsed</Badge> : <Badge tone="warn">assumed 5×8</Badge>), sort: (c) => (c.parsed ? 0 : 1) },
          ]}
        />
      </Card>

      {selected ? (
        <Card eyebrow="Calendar detail" title={selected.name} aside={`${formatNum(usage.get(selected.id) || 0)} activities`}>
          <SectionTitle>Weekly pattern</SectionTitle>
          <table className="xer-mini-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="xer-num">Hours</th>
                <th>Shifts</th>
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day, i) => (
                <tr key={day}>
                  <td>{day}</td>
                  <td className="xer-num">{formatNum(selected.week[i], 1)}</td>
                  <td>{(selected.shifts[i] || []).map(shiftLabel).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.exceptionList.length ? (
            <>
              <SectionTitle>Exceptions ({selected.exceptionList.length})</SectionTitle>
              <DataTable
                rows={selected.exceptionList}
                rowKey={(e, i) => `${+e.date}-${i}`}
                pageSize={60}
                exportName={`calendar-exceptions-${selected.name}`}
                minWidth={520}
                columns={[
                  { k: "d", label: "Date", cell: (e) => formatDate(e.date), sort: (e) => +e.date, csv: (e) => formatDate(e.date) },
                  { k: "h", label: "Hours", align: "right", cell: (e) => formatNum(e.hours, 1), sort: (e) => e.hours },
                  { k: "t", label: "Type", cell: (e) => (e.hours > 0 ? "Working exception" : "Non-working (holiday)") },
                ]}
              />
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- raw tables */

export function RawTablesView({ ctx }: { ctx: ViewCtx }) {
  const { P } = ctx;
  const S = P.S;
  const [selected, setSelected] = useState<string>(S.tables[0]?.name || "");
  const table = S.raw.tables[selected];

  return (
    <div className="xer-view">
      <div className="xer-toolbar">
        <label className="xer-field">
          <span>XER table</span>
          <select className="xer-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {sortBy(S.tables, (t) => t.name).map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({formatNum(t.rows)} rows)
              </option>
            ))}
          </select>
        </label>
        <span className="xer-dim">File: {S.fileName}</span>
        {S.header ? (
          <span className="xer-dim">
            P6 export v{S.header.version} · {S.header.date} · {S.header.userFull || S.header.user} · {S.header.db}
          </span>
        ) : null}
      </div>

      {table ? (
        <Card eyebrow="Source data" title={`${selected} — ${formatNum(table.rows.length)} rows`}>
          <DataTable<XerRow>
            rows={table.rows}
            rowKey={(_row, i) => String(i)}
            pageSize={100}
            searchText={(r) => table.fields.map((f) => r[f]).join(" ")}
            exportName={selected}
            minWidth={Math.min(2400, Math.max(800, table.fields.length * 130))}
            columns={table.fields.slice(0, 26).map((f) => ({
              k: f,
              label: f,
              cell: (r) => r[f],
              sort: (r) => r[f],
            }))}
          />
        </Card>
      ) : (
        <div className="schedule-intelligence-empty">
          <b>Table not found</b>
        </div>
      )}
    </div>
  );
}
