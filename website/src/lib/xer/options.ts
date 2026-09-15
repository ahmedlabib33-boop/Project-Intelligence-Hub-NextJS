/**
 * Analyzer settings. The standalone tool kept these on a global; here they are
 * passed explicitly so a React tree can hold them in state and so two
 * schedules are always analysed under identical assumptions.
 */

export type MatchBy = "code" | "name" | "code+wbs";

export type AnalyzerOptions = {
  hoursPerDay: number;
  autoHoursPerDay: boolean;
  /** Total float at or below this is critical. */
  tfCritical: number;
  /** Total float at or below this (and above `tfCritical`) is near-critical. */
  tfNear: number;
  highFloat: number;
  highDuration: number;
  longLag: number;
  retainedLogic: boolean;
  /** Exclude LOE / WBS-summary activities from logic checks. */
  ignoreLOE: boolean;
  matchBy: MatchBy;
  /** Days of tolerance before a date difference counts as a change. */
  dateTol: number;
  durTol: number;
  fuzzyRename: boolean;
  /** Comparison fields switched off, keyed by field id. */
  fieldsOff: Record<string, boolean>;
};

export const DEFAULT_OPTIONS: AnalyzerOptions = {
  hoursPerDay: 8,
  autoHoursPerDay: true,
  tfCritical: 0,
  tfNear: 10,
  highFloat: 44,
  highDuration: 44,
  longLag: 5,
  retainedLogic: true,
  ignoreLOE: true,
  matchBy: "code",
  dateTol: 0,
  durTol: 0,
  fuzzyRename: true,
  fieldsOff: {},
};

/**
 * Identity of the settings that change CPM/check results. Views cache analysis
 * against this so that cosmetic settings do not force a recompute.
 */
export function analysisKey(o: AnalyzerOptions): string {
  return [
    o.hoursPerDay, o.tfCritical, o.tfNear, o.highFloat,
    o.highDuration, o.longLag, o.retainedLogic, o.ignoreLOE,
  ].join("|");
}
