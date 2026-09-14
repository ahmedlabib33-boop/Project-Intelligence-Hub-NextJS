/**
 * Evidence-pack export.
 *
 * Produces the set of CSVs a delay or revision review has to be able to show:
 * what was analysed, under which assumptions, what the engine recalculated,
 * and — when two files are loaded — exactly what changed between them.
 *
 * The summary sheet deliberately records the assumptions and the stored-vs-
 * recalculated gap alongside the results, so a reader can see what the numbers
 * rest on rather than having to trust them.
 */

import type { Analysis } from "./analysis";
import type { Comparison } from "./compare";
import { downloadCsv, formatDate, formatNum } from "./format";
import { CONSTRAINT, type Link, type ProjectView, type Task } from "./model";
import type { AnalyzerOptions } from "./options";

type Sheet = { name: string; header: string[]; rows: unknown[][] };

function summarySheet(P: ProjectView, an: Analysis, opts: AnalyzerOptions, cmp: Comparison | null): Sheet {
  const rows: unknown[][] = [
    ["Source file", P.S.fileName],
    ["Project", `${P.longName || P.name} (${P.projId})`],
    ["Exported", new Date().toISOString()],
    ["", ""],
    ["— SCOPE —", ""],
    ["Activities", P.tasks.length],
    ["Relationships", P.links.length],
    ["Calendars", P.S.calList.length],
    ["WBS nodes", P.wbsAll.length],
    ["", ""],
    ["— DATES —", ""],
    ["Data date", formatDate(P.dataDate)],
    ["Stored project finish", formatDate(P.finish)],
    ["Recalculated finish", formatDate(an.calcFinish)],
    ["Must finish by", formatDate(P.mustFinish ?? null)],
    ["Activities drifting > 1 day", `${an.drift.count} (max ${an.drift.max} d)`],
    ["  of which P6 placed later / earlier", `${an.drift.later} / ${an.drift.earlier}`],
    ["  reading of the difference", an.drift.interpretation],
    ["", ""],
    ["— CRITICALITY —", ""],
    ["Longest path activities", an.longestPath.length],
    ["Longest path duration (calendar days)", an.lpDuration],
    ["Critical activities", an.stat.critical],
    ["Near critical", an.stat.near],
    ["Negative float", an.stat.negative],
    ["CPLI", an.cpli ?? "not applicable (no must-finish date)"],
    ["", ""],
    ["— QUALITY —", ""],
    ["Health score", `${an.score}%`],
    ["Checks passed / warned / failed", `${an.passCount} / ${an.warnCount} / ${an.failCount}`],
    ["Open ends", an.openEnds.length],
    ["Out-of-sequence relationships", an.outOfSequence.length],
    ["Activities in circular logic", an.inCycle.length],
    ["Hard constraints", an.hardConstraints.length],
    ["", ""],
    ["— ASSUMPTIONS THIS RUN USED —", ""],
    [
      "Lag calendar",
      `${an.lagCalendarMode} — ${
        an.lagCalendarSource === "file"
          ? "read from SCHEDOPTIONS"
          : an.lagCalendarSource === "inferred"
            ? "inferred: the file carries no SCHEDOPTIONS, so the mode that best reproduces the stored dates was used"
            : "P6 default; the file carries no SCHEDOPTIONS and offered nothing to infer from"
      }`,
    ],
    ["Retained logic", opts.retainedLogic ? "on" : "off"],
    ["Late dates run back from", an.lateFromProjEnd ? "project must-finish date" : "latest calculated early finish"],
    ["Calendars read from clndr_data", `${P.S.calList.filter((c) => c.parsed).length} of ${P.S.calList.length}`],
    ["Critical threshold (total float ≤)", `${opts.tfCritical} d`],
    ["Near-critical threshold (≤)", `${opts.tfNear} d`],
    ["High float threshold (>)", `${opts.highFloat} d`],
    ["High duration threshold (>)", `${opts.highDuration} d`],
    ["Long lag threshold (>)", `${opts.longLag} d`],
    ["", ""],
    ["— STATUS —", ""],
    [
      "Verification",
      "DRAFT / CONDITIONAL. Every figure here is recalculated by the browser engine from this XER. " +
        "It must be reproduced in a controlled native Primavera P6 copy before being issued or relied on contractually.",
    ],
  ];

  if (cmp) {
    rows.push(
      ["", ""],
      ["— COMPARISON A → B —", ""],
      ["Schedule A", cmp.PA.S.fileName],
      ["Schedule B", cmp.PB.S.fileName],
      ["Match basis", opts.matchBy],
      ["Similarity", `${cmp.similarity}%`],
      ["Activities matched", `${cmp.matched.length} (${cmp.matchRate}%)`],
      ["Modified / unchanged", `${cmp.summaryCounts.modified} / ${cmp.unchanged}`],
      ["Added in B / removed from A", `${cmp.added.length} / ${cmp.removed.length}`],
      ["Likely renamed", cmp.renames.length],
      ["Relationships added / removed / changed", `${cmp.rel.added.length} / ${cmp.rel.removed.length} / ${cmp.rel.changed.length}`],
      ["Project finish variance (days)", cmp.finishVar],
      ["Data date movement (days)", cmp.dataDateVar],
      ["Became critical / left critical", `${cmp.crit.entered.length} / ${cmp.crit.left.length}`],
      ["BEI", cmp.bei ?? "not calculable"],
      ["Fields excluded from the diff", Object.keys(opts.fieldsOff).filter((k) => opts.fieldsOff[k]).join(", ") || "none"],
    );
  }

  return { name: "00_analysis_summary", header: ["Item", "Value"], rows };
}

function activitySheet(P: ProjectView): Sheet {
  return {
    name: "01_activities",
    header: [
      "Activity ID", "Activity name", "WBS path", "Type", "Status", "Calendar",
      "Original duration (d)", "Remaining duration (d)", "% complete",
      "Start", "Finish", "Actual start", "Actual finish",
      "Stored total float (d)", "Stored free float (d)",
      "Recalculated ES", "Recalculated EF", "Recalculated LS", "Recalculated LF",
      "Recalculated total float (d)", "Recalculated free float (d)",
      "On longest path", "Float path", "Constraint", "Constraint date",
      "Predecessors", "Successors", "Budget cost",
    ],
    rows: P.tasks.map((t) => [
      t.code, t.name, t.wbsPath, t.typeName, t.statusName, t.calName,
      t.od.toFixed(2), t.rd.toFixed(2), t.pct,
      formatDate(t.start), formatDate(t.finish), formatDate(t.actStart), formatDate(t.actEnd),
      t.tf === null ? "" : t.tf.toFixed(2), t.ff === null ? "" : t.ff.toFixed(2),
      formatDate(t.c.es), formatDate(t.c.ef), formatDate(t.c.ls), formatDate(t.c.lf),
      t.c.tf === null || t.c.tf === undefined ? "" : t.c.tf.toFixed(2),
      t.c.ff === null || t.c.ff === undefined ? "" : t.c.ff.toFixed(2),
      t.c.lp ? "yes" : "", t.c.fp || "",
      t.cstrType ? CONSTRAINT[t.cstrType] || t.cstrType : "", formatDate(t.cstrDate),
      t.preds.length + t.extPreds.length, t.succs.length + t.extSuccs.length,
      t.budget || "",
    ]),
  };
}

function relationshipSheet(P: ProjectView): Sheet {
  const row = (l: Link) => [
    l.pred ? l.pred.code : "(external)",
    l.pred ? l.pred.name : "",
    l.succ ? l.succ.code : "(external)",
    l.succ ? l.succ.name : "",
    l.type,
    l.lag.toFixed(2),
    l.driving ? "yes" : "",
    l.external ? "yes" : "",
    l.succ && l.succ.tf !== null ? l.succ.tf.toFixed(2) : "",
  ];
  return {
    name: "02_relationships",
    header: ["Predecessor", "Predecessor name", "Successor", "Successor name", "Type", "Lag (d)", "Driving", "External", "Successor total float (d)"],
    rows: P.links.map(row),
  };
}

function longestPathSheet(an: Analysis): Sheet {
  return {
    name: "03_longest_path",
    header: ["#", "Activity ID", "Activity name", "WBS path", "Remaining duration (d)", "Start", "Finish", "Total float (d)", "Driven by"],
    rows: an.longestPath.map((t, i) => [
      i + 1, t.code, t.name, t.wbsPath, t.rd.toFixed(2),
      formatDate(t.c.es), formatDate(t.c.ef),
      t.tf === null ? "" : t.tf.toFixed(2),
      t.c.drivers.length
        ? t.c.drivers.map((l) => `${l.pred!.code} ${l.type}${l.lag ? `${l.lag > 0 ? "+" : ""}${l.lag}d` : ""}`).join("; ")
        : t.c.constrained ? "constraint" : t.started ? "in progress at data date" : "data date",
    ]),
  };
}

function healthSheet(an: Analysis): Sheet {
  const rows: unknown[][] = [];
  for (const check of an.checks) {
    if (!check.items.length) {
      rows.push([check.cat, check.name, check.status.toUpperCase(), check.count, formatNum(check.pctv, 1), "", "", check.desc]);
      continue;
    }
    for (const item of check.items) {
      let ref = "";
      let detail = "";
      if (item && typeof item === "object" && "link" in item) {
        const l = (item as { link: Link; reason?: string }).link;
        ref = `${l.pred?.code || "(ext)"} → ${l.succ?.code || "(ext)"}`;
        detail = `${l.type}${l.lag ? ` ${l.lag > 0 ? "+" : ""}${formatNum(l.lag, 1)}d` : ""}`;
        const reason = (item as { reason?: string }).reason;
        if (reason) detail += ` · ${reason}`;
      } else if (item && typeof item === "object" && "task" in item) {
        const entry = item as { task: Task; days: number | null };
        ref = entry.task.code;
        detail = `${entry.task.name} · drift ${formatNum(entry.days || 0, 1)}d`;
      } else {
        const t = item as Task;
        ref = t.code;
        detail = t.name;
      }
      rows.push([check.cat, check.name, check.status.toUpperCase(), check.count, formatNum(check.pctv, 1), ref, detail, check.desc]);
    }
  }
  return {
    name: "04_health_findings",
    header: ["Category", "Check", "Status", "Check count", "Check %", "Reference", "Detail", "Description"],
    rows,
  };
}

function outOfSequenceSheet(an: Analysis): Sheet {
  return {
    name: "05_out_of_sequence",
    header: ["Predecessor", "Predecessor name", "Predecessor status", "Predecessor finish", "Type", "Successor", "Successor name", "Successor actual start", "Finding"],
    rows: an.outOfSequence.map((o) => [
      o.pred.code, o.pred.name, o.pred.statusName, formatDate(o.pred.finish),
      o.link.type, o.succ.code, o.succ.name, formatDate(o.succ.actStart || o.succ.start), o.reason,
    ]),
  };
}

function differenceSheets(cmp: Comparison): Sheet[] {
  const activityRows: unknown[][] = [];
  for (const d of cmp.diffs) {
    if (!d.changes.length && !d.logicChanges.length) continue;
    activityRows.push([
      d.renamed ? "renamed" : "modified", d.b.code, d.b.name, d.b.wbsPath,
      d.changes.length + d.logicChanges.length,
      d.changes.map((c) => `${c.label}: ${c.aDisp} → ${c.bDisp}`).join(" | "),
      d.logicChanges.map((l) => l.txt).join(" | "),
      d.startVar ?? "", d.finishVar ?? "", d.durVar, d.tfVar ?? "", d.pctVar,
      d.critA ? "yes" : "", d.critB ? "yes" : "",
    ]);
  }
  for (const t of cmp.added) {
    activityRows.push(["added in B", t.code, t.name, t.wbsPath, "", "", "", "", "", t.od, "", "", "", t.tf !== null && t.tf <= 0 ? "yes" : ""]);
  }
  for (const t of cmp.removed) {
    activityRows.push(["removed from A", t.code, t.name, t.wbsPath, "", "", "", "", "", t.od, "", "", t.tf !== null && t.tf <= 0 ? "yes" : "", ""]);
  }

  const relRows: unknown[][] = [
    ...cmp.rel.added.map((r) => ["added in B", r.b?.pred?.code || "(ext)", r.b?.succ?.code || "(ext)", r.b?.succ?.name || "", "", r.b?.type || "", "", r.b?.lag ?? "", ""]),
    ...cmp.rel.removed.map((r) => ["removed from A", r.a?.pred?.code || "(ext)", r.a?.succ?.code || "(ext)", r.a?.succ?.name || "", r.a?.type || "", "", r.a?.lag ?? "", "", ""]),
    ...cmp.rel.changed.map((r) => ["changed", r.b?.pred?.code || "(ext)", r.b?.succ?.code || "(ext)", r.b?.succ?.name || "", r.a?.type || "", r.b?.type || "", r.a?.lag ?? "", r.b?.lag ?? "", r.lagDelta ?? ""]),
  ];

  return [
    {
      name: "06_activity_differences",
      header: ["Change", "Activity ID", "Activity name", "WBS path", "Change count", "Field changes", "Logic changes", "Start Δ (d)", "Finish Δ (d)", "Duration Δ (d)", "Float Δ (d)", "% Δ", "Critical in A", "Critical in B"],
      rows: activityRows,
    },
    {
      name: "07_relationship_differences",
      header: ["Change", "Predecessor", "Successor", "Successor name", "Type A", "Type B", "Lag A (d)", "Lag B (d)", "Lag Δ (d)"],
      rows: relRows,
    },
    {
      name: "08_impact_ranking",
      header: ["#", "On longest path", "Critical in B", "Activity ID", "Activity name", "WBS path", "What changed", "Duration Δ (d)", "Finish Δ (d)", "Float Δ (d)", "Weight"],
      rows: cmp.impact.map((r, i) => [
        i + 1, r.onLP ? "yes" : "", r.d.critB ? "yes" : "", r.d.b.code, r.d.b.name, r.d.b.wbsPath,
        [...new Set(r.d.changes.map((c) => c.label))].join(", ") + (r.d.logicChanges.length ? ` · ${r.d.logicChanges.length} logic edit(s)` : ""),
        r.d.durVar, r.d.finishVar ?? "", r.d.tfVar ?? "", Math.round(r.weight),
      ]),
    },
  ];
}

/**
 * Build and download the pack. Browsers rate-limit rapid successive
 * downloads, so the files are released on a short stagger.
 */
export function exportEvidencePack(
  P: ProjectView,
  an: Analysis,
  opts: AnalyzerOptions,
  cmp: Comparison | null,
): number {
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = `${P.name.replace(/[^\w.\- ]/g, "_")}_${stamp}`;

  const sheets: Sheet[] = [
    summarySheet(P, an, opts, cmp),
    activitySheet(P),
    relationshipSheet(P),
    longestPathSheet(an),
    healthSheet(an),
  ];
  if (an.outOfSequence.length) sheets.push(outOfSequenceSheet(an));
  if (cmp) sheets.push(...differenceSheets(cmp));

  sheets.forEach((sheet, i) => {
    window.setTimeout(() => downloadCsv(`${prefix}_${sheet.name}.csv`, sheet.header, sheet.rows), i * 350);
  });

  return sheets.length;
}
