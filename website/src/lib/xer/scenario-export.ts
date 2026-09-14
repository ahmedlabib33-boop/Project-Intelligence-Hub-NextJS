/**
 * Controlled-copy XER export.
 *
 * Writes a scenario's remaining-duration and relationship edits into a copy of
 * the source file, line by line, so the proposal can be imported into
 * Primavera P6 as a separate project, rescheduled (F9) and verified there.
 * Every other byte of the file is kept; the stored dates in the copy are the
 * source's until P6 reschedules it. The source file is never modified.
 */

import type { CpmOverrides } from "./analysis";
import type { LoadedSchedule, ProjectView } from "./model";

export type XerExport = { text: string; tasksChanged: number; linksChanged: number };

const hours = (value: number) => String(Math.round(value * 100) / 100);

export function exportScenarioXer(S: LoadedSchedule, P: ProjectView, edits: CpmOverrides): XerExport {
  const newline = S.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = S.text.split(/\r\n|\n/);
  let table = "";
  let fields: Record<string, number> = {};
  let tasksChanged = 0;
  let linksChanged = 0;
  const rdHr = edits.rdHr || new Map<string, number>();
  const lagHr = edits.lagHr || new Map<string, number>();
  const relType = edits.relType || new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("%T\t")) {
      table = line.split("\t")[1].trim().toUpperCase();
      fields = {};
      continue;
    }
    if (line.startsWith("%F\t")) {
      fields = {};
      line.split("\t").slice(1).forEach((name, index) => {
        fields[name.trim()] = index + 1;
      });
      continue;
    }
    if (!line.startsWith("%R\t")) continue;

    if (table === "TASK" && rdHr.size) {
      const cells = line.split("\t");
      const id = cells[fields.task_id];
      if (cells[fields.proj_id] !== P.projId || !rdHr.has(id)) continue;
      const value = hours(rdHr.get(id)!);
      cells[fields.remain_drtn_hr_cnt] = value;
      // A not-started activity's original duration follows its remaining duration in P6.
      if (cells[fields.status_code] === "TK_NotStart" && fields.target_drtn_hr_cnt) cells[fields.target_drtn_hr_cnt] = value;
      lines[i] = cells.join("\t");
      tasksChanged++;
    } else if (table === "TASKPRED" && (lagHr.size || relType.size)) {
      const cells = line.split("\t");
      const id = cells[fields.task_pred_id];
      let changed = false;
      if (lagHr.has(id) && fields.lag_hr_cnt) {
        cells[fields.lag_hr_cnt] = hours(lagHr.get(id)!);
        changed = true;
      }
      if (relType.has(id) && fields.pred_type) {
        cells[fields.pred_type] = `PR_${relType.get(id)}`;
        changed = true;
      }
      if (changed) {
        lines[i] = cells.join("\t");
        linksChanged++;
      }
    }
  }
  return { text: lines.join(newline), tasksChanged, linksChanged };
}
