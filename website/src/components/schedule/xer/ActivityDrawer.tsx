"use client";

/**
 * Activity detail drawer — stored data, the recalculated CPM, logic both ways,
 * resources, codes, findings, and (when two files are loaded) the A→B diff.
 */

import type { ReactNode } from "react";
import { dayDiff, formatDate, formatDelta, formatMoney, formatNum, num } from "../../../lib/xer/format";
import { CONSTRAINT, PCT_TYPE, type Link, type ProjectView, type Task } from "../../../lib/xer/model";
import type { ActivityDiff } from "../../../lib/xer/compare";
import { Badge, Drawer, KeyValues, SectionTitle } from "./ui";
import { statusTag } from "./helpers";

function dash(value: string): string {
  return value.trim() && value.trim() !== "→" ? value : "—";
}

function RelTable({
  links,
  direction,
  onPick,
}: {
  links: Link[];
  direction: "pred" | "succ";
  onPick: (t: Task) => void;
}) {
  if (!links.length) return <p className="xer-muted">None.</p>;
  return (
    <table className="xer-mini-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Type</th>
          <th className="xer-num">Lag</th>
          <th>Driving</th>
        </tr>
      </thead>
      <tbody>
        {links.map((l, i) => {
          const other = direction === "pred" ? l.pred : l.succ;
          return (
            <tr
              key={`${l.id}-${i}`}
              className={other ? "xer-tr-click" : undefined}
              onClick={other ? () => onPick(other) : undefined}
            >
              <td className="xer-mono">{other ? other.code : "(external)"}</td>
              <td>{other ? other.name : ""}</td>
              <td>{l.type}</td>
              <td className="xer-num">{formatNum(l.lag, 1)}d</td>
              <td>{l.driving && direction === "pred" ? <Badge tone="bad">driving</Badge> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DiffBlock({ diff }: { diff: ActivityDiff }) {
  if (!diff.changes.length && !diff.logicChanges.length) {
    return <p className="xer-muted">No differences detected.</p>;
  }
  return (
    <div className="xer-diff">
      {diff.changes.map((c) => (
        <div key={c.key} className="xer-diff-row">
          <span className="xer-diff-label">{c.label}</span>
          <span className="xer-diff-a">{c.aDisp}</span>
          <i className="xer-diff-arrow">→</i>
          <span className="xer-diff-b">{c.bDisp}</span>
          {c.delta !== null && c.delta !== 0 ? (
            <span className="xer-diff-delta">{formatDelta(c.delta, 1)}</span>
          ) : null}
        </div>
      ))}
      {diff.logicChanges.map((l, i) => (
        <div key={`logic-${i}`} className="xer-diff-row xer-diff-logic">
          <Badge tone={l.kind === "add" ? "add" : l.kind === "del" ? "del" : "mod"}>
            {l.kind === "add" ? "added" : l.kind === "del" ? "removed" : "changed"}
          </Badge>
          <span>{l.txt}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityDrawer({
  P,
  task,
  diff,
  onPick,
  onClose,
}: {
  P: ProjectView;
  task: Task;
  diff?: ActivityDiff | null;
  onPick: (t: Task) => void;
  onClose: () => void;
}) {
  const c = task.c;
  const an = P.an;

  const findings: string[] = [];
  if (an) {
    if (an.noPred.includes(task)) findings.push("No predecessor (open start)");
    if (an.noSucc.includes(task)) findings.push("No successor (open finish)");
    if (an.inCycle.includes(task)) findings.push("Part of a circular logic loop");
    if (an.hardConstraints.includes(task)) findings.push("Hard constraint");
    for (const invalid of an.invalidDates) if (invalid.task === task) findings.push(invalid.why);
    for (const oos of an.outOfSequence) {
      if (oos.succ === task) findings.push(`Out of sequence: ${oos.reason} (${oos.pred.code})`);
    }
  }

  const driftDays = task.finish && c.ef ? dayDiff(task.finish, c.ef) : null;

  const identity: [string, ReactNode][] = [
    ["Activity ID", <span key="code" className="xer-mono">{task.code}</span>],
    ["Name", task.name],
    ["WBS", task.wbsPath + (task.wbsName ? ` — ${task.wbsName}` : "")],
    ["Type", task.typeName],
    ["Status", statusTag(task)],
    ["Calendar", `${task.calName} (${task.cal.summary().days}d/wk · ${task.cal.dayHours}h/d)`],
    ["% complete", `${task.pct}%${task.pctType ? ` (${PCT_TYPE[task.pctType] || task.pctType})` : ""}`],
  ];

  const stored: [string, ReactNode][] = [
    ["Start", dash(`${formatDate(task.start, true)}${task.actStart ? "  (actual)" : ""}`)],
    ["Finish", dash(`${formatDate(task.finish, true)}${task.actEnd ? "  (actual)" : ""}`)],
    ["Original duration", `${formatNum(task.od, 1)} d`],
    ["Remaining duration", `${formatNum(task.rd, 1)} d`],
    ["Early start / finish", dash(`${formatDate(task.earlyStart)} → ${formatDate(task.earlyEnd)}`)],
    ["Late start / finish", dash(`${formatDate(task.lateStartD)} → ${formatDate(task.lateFinish)}`)],
    ["Total float", task.tf === null ? "—" : `${formatNum(task.tf, 1)} d`],
    ["Free float", task.ff === null ? "—" : `${formatNum(task.ff, 1)} d`],
    ["Constraint", task.cstrType ? `${CONSTRAINT[task.cstrType] || task.cstrType} @ ${formatDate(task.cstrDate)}` : "—"],
    [
      "Secondary constraint",
      task.cstrType2 ? `${CONSTRAINT[task.cstrType2] || task.cstrType2} @ ${formatDate(task.cstrDate2)}` : "—",
    ],
  ];

  const recalculated: [string, ReactNode][] = [
    ["Early start / finish", dash(`${formatDate(c.es, true)} → ${formatDate(c.ef, true)}`)],
    ["Late start / finish", dash(`${formatDate(c.ls, true)} → ${formatDate(c.lf, true)}`)],
    ["Total float", c.tf === null || c.tf === undefined ? "—" : `${formatNum(c.tf, 1)} d`],
    ["Free float", c.ff === null || c.ff === undefined ? "—" : `${formatNum(c.ff, 1)} d`],
    ["On longest path", c.lp ? <Badge tone="bad">Yes</Badge> : "No"],
    ["Float path", c.fp ? String(c.fp) : "—"],
    ["Drift vs stored finish", driftDays === null ? "—" : formatDelta(driftDays, 1, " d")],
  ];

  return (
    <Drawer title={task.code} subtitle={task.name} onClose={onClose}>
      <KeyValues rows={identity} />

      <SectionTitle>Dates as stored in the file</SectionTitle>
      <KeyValues rows={stored} />

      <SectionTitle>Recalculated CPM (this engine)</SectionTitle>
      <p className="xer-muted xer-note">
        A calendar-aware forward/backward pass over the file&apos;s own data. Differences from the stored dates are
        reported, not corrected — confirm against a native P6 run before relying on them.
      </p>
      <KeyValues rows={recalculated} />

      <SectionTitle>Predecessors ({task.preds.length + task.extPreds.length})</SectionTitle>
      <RelTable links={task.preds.concat(task.extPreds)} direction="pred" onPick={onPick} />

      <SectionTitle>Successors ({task.succs.length + task.extSuccs.length})</SectionTitle>
      <RelTable links={task.succs.concat(task.extSuccs)} direction="succ" onPick={onPick} />

      {task.rsrcs.length ? (
        <>
          <SectionTitle>Resources &amp; cost</SectionTitle>
          <table className="xer-mini-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="xer-num">Budget units</th>
                <th className="xer-num">Actual</th>
                <th className="xer-num">Remaining</th>
                <th className="xer-num">Budget cost</th>
              </tr>
            </thead>
            <tbody>
              {task.rsrcs.map((r, i) => {
                const rs = P.S.rsrcById[r.rsrc_id] || {};
                return (
                  <tr key={`${r.rsrc_id}-${i}`}>
                    <td>
                      {rs.rsrc_short_name || r.rsrc_id}
                      {rs.rsrc_name ? ` — ${rs.rsrc_name}` : ""}
                    </td>
                    <td className="xer-num">{formatNum(num(r.target_qty), 1)}</td>
                    <td className="xer-num">{formatNum(num(r.act_reg_qty) + num(r.act_ot_qty), 1)}</td>
                    <td className="xer-num">{formatNum(num(r.remain_qty), 1)}</td>
                    <td className="xer-num">{formatMoney(num(r.target_cost))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}

      {task.codes.length ? (
        <>
          <SectionTitle>Activity codes</SectionTitle>
          <div className="xer-tag-row">
            {task.codes.map((code, i) => (
              <Badge key={`${code.codeId}-${i}`} tone="mut">
                {code.type}: {code.code}
                {code.desc ? ` — ${code.desc}` : ""}
              </Badge>
            ))}
          </div>
        </>
      ) : null}

      {task.udfs.length ? (
        <>
          <SectionTitle>User-defined fields</SectionTitle>
          <KeyValues rows={task.udfs.map((u) => [u.name, u.value] as [string, ReactNode])} />
        </>
      ) : null}

      {task.memos.length ? (
        <>
          <SectionTitle>Notebook</SectionTitle>
          {task.memos.map((memo, i) => (
            <p key={i} className="xer-muted">
              {memo.text.slice(0, 600)}
            </p>
          ))}
        </>
      ) : null}

      {findings.length ? (
        <>
          <SectionTitle>Findings</SectionTitle>
          <ul className="xer-findings">
            {findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        </>
      ) : null}

      {diff ? (
        <>
          <SectionTitle>Comparison A → B</SectionTitle>
          <DiffBlock diff={diff} />
        </>
      ) : null}
    </Drawer>
  );
}
