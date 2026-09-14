/**
 * P6 working-calendar engine.
 *
 * Parses the `clndr_data` blob carried in the XER CALENDAR table and exposes
 * shift-aware arithmetic: adding and subtracting work hours, measuring work
 * between two moments, and snapping a moment onto the first/last working
 * instant the way P6 places start and finish dates.
 *
 * A `clndr_data` blob looks like:
 *   (0||CalendarData()(0||DaysOfWeek()(0||1()(0||0(0||s|08:00|f|17:00)))...)
 *     (0||Exceptions()(0||0(d|39448)())...))
 *
 * Times are handled at day granularity: each working day contributes its total
 * shift hours, and an exception overrides a specific date outright.
 */

import { DAY, num } from "./format";
import type { XerRow } from "./parse";

/** XER date serials count from 30-Dec-1899. */
const XER_EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(serial: number): Date {
  const utc = new Date(XER_EPOCH + serial * DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** Collapse a Date to a comparable yyyymmdd integer. */
export function dateKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/** A Date on the same day as `date`, at decimal hour `hour`. */
export function atHour(date: Date, hour: number): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const h = Math.floor(hour + 1e-9);
  const m = Math.round((hour - h) * 60);
  out.setHours(h, m, 0, 0);
  return out;
}

/** Shift as [startHour, endHour] in decimal hours. */
export type Shift = [number, number];

export type CalendarException = { date: Date; hours: number; shifts: Shift[] };

export type CalendarSummary = { days: number; hours: number; exceptions: number };

/** Sunday-first default: a 5 × 8 working week, Mon–Fri. */
const DEFAULT_SHIFTS: Shift[][] = [
  [],
  [[8, 12], [13, 17]],
  [[8, 12], [13, 17]],
  [[8, 12], [13, 17]],
  [[8, 12], [13, 17]],
  [[8, 12], [13, 17]],
  [],
];

/** Guard against pathological calendars (all days non-working). */
const STEP_GUARD = 40_000;
const SNAP_GUARD = 4_000;

export class WorkCalendar {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly isDefault: boolean;
  readonly dayHours: number;
  readonly weekHours: number;
  readonly monthHours: number;
  readonly yearHours: number;
  /** Hours available per weekday, Sunday first. */
  week: number[] = [0, 8, 8, 8, 8, 8, 0];
  shifts: Shift[][] = DEFAULT_SHIFTS.map((day) => day.map((shift) => [...shift] as Shift));
  readonly exceptions = new Map<number, { hours: number; shifts: Shift[] }>();
  readonly exceptionList: CalendarException[] = [];
  /**
   * True only when the weekly working pattern was actually read out of
   * `clndr_data`. A calendar whose exceptions parsed but whose day pattern did
   * not still reports false, because the 5×8 fallback would otherwise be
   * presented as if it came from the file.
   */
  parsed = false;
  private parsedWeek = false;
  workWeekHours: number;

  constructor(row?: XerRow | null) {
    this.id = row ? row.clndr_id : "default";
    this.name = row ? row.clndr_name || "Calendar" : "Default 5x8";
    this.type = row ? row.clndr_type : "CA_Base";
    this.isDefault = row ? row.default_flag === "Y" : true;
    this.dayHours = row ? num(row.day_hr_cnt) || 8 : 8;
    this.weekHours = row ? num(row.week_hr_cnt) || 40 : 40;
    this.monthHours = row ? num(row.month_hr_cnt) || 172 : 172;
    this.yearHours = row ? num(row.year_hr_cnt) || 2000 : 2000;

    if (row && row.clndr_data) {
      try {
        this.parseData(row.clndr_data);
      } catch {
        /* fall back to the default week */
      }
      this.parsed = this.parsedWeek;
    }

    this.workWeekHours = this.week.reduce((a, b) => a + b, 0);
    if (this.workWeekHours <= 0) {
      this.week = [0, 8, 8, 8, 8, 8, 0];
      this.shifts = DEFAULT_SHIFTS.map((day) => day.map((shift) => [...shift] as Shift));
      this.workWeekHours = 40;
    }
  }

  private parseData(raw: string): void {
    const data = raw.replace(/\r|\n/g, "");

    // ---- days of week
    //
    // P6 writes at least two dialects of the shift block:
    //   (0||1()((0||0(0||s|08:00|f|17:00))))     — nested shift node
    //   (0||1()(  (0||0(s|08:00|f|16:00)())))    — flat shift node, padded
    // Rather than matching a whole day in one pattern, locate the day markers
    // and read every shift between one marker and the next. A day marker is
    // `(0||<1-7>()`; a shift node is `(0||<n>(s|…`, so requiring the empty
    // `()` reliably tells them apart.
    const dowIx = data.indexOf("DaysOfWeek()");
    if (dowIx >= 0) {
      const exIx = data.indexOf("Exceptions()");
      const viewIx = data.indexOf("(0||VIEW");
      const ends = [exIx, viewIx].filter((ix) => ix > dowIx);
      const segment = data.slice(dowIx, ends.length ? Math.min(...ends) : data.length);

      const markerRe = /\(0\|\|([1-7])\(\)/g;
      const markers: { dow: number; at: number }[] = [];
      let marker: RegExpExecArray | null;
      while ((marker = markerRe.exec(segment))) {
        // P6 numbers weekdays 1 = Sunday.
        markers.push({ dow: Number.parseInt(marker[1], 10) - 1, at: marker.index + marker[0].length });
      }

      if (markers.length) {
        const week = [0, 0, 0, 0, 0, 0, 0];
        const shifts: Shift[][] = [[], [], [], [], [], [], []];
        for (let i = 0; i < markers.length; i++) {
          const { dow, at } = markers[i];
          if (dow < 0 || dow > 6) continue;
          const until = i + 1 < markers.length ? markers[i + 1].at : segment.length;
          shifts[dow] = readShifts(segment.slice(at, until));
          week[dow] = shifts[dow].reduce((sum, [a, b]) => sum + (b - a), 0);
        }
        this.shifts = shifts;
        this.week = week;
        this.parsedWeek = true;
      }
    }

    // ---- exceptions
    const exIx = data.indexOf("Exceptions()");
    if (exIx >= 0) {
      const segment = data.slice(exIx);
      const re = /\(0\|\|\d+\(d\|(\d+)\)\(((?:[^()]|\([^()]*\))*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(segment))) {
        const date = serialToDate(Number.parseInt(match[1], 10));
        const shifts = readShifts(match[2]);
        const hours = shifts.reduce((sum, [a, b]) => sum + (b - a), 0);
        this.exceptions.set(dateKey(date), { hours, shifts });
        this.exceptionList.push({ date, hours, shifts });
      }
      this.exceptionList.sort((a, b) => +a.date - +b.date);
    }
  }

  /** Working shifts on a given date, honouring exceptions. */
  shiftsOn(date: Date): Shift[] {
    const exception = this.exceptions.get(dateKey(date));
    if (exception) {
      if (exception.shifts.length) return exception.shifts;
      return exception.hours > 0 ? [[8, 8 + exception.hours]] : [];
    }
    return this.shifts[date.getDay()] || [];
  }

  hoursOn(date: Date): number {
    let total = 0;
    for (const [start, end] of this.shiftsOn(date)) total += end - start;
    return total;
  }

  isWorking(date: Date): boolean {
    return this.hoursOn(date) > 0;
  }

  dayStartHour(date: Date): number {
    const shifts = this.shiftsOn(date);
    return shifts.length ? shifts[0][0] : 8;
  }

  dayEndHour(date: Date): number {
    const shifts = this.shiftsOn(date);
    return shifts.length ? shifts[shifts.length - 1][1] : 17;
  }

  /** Move `hours` of work forward from `from`. */
  add(from: Date | null, hours: number): Date | null {
    if (!from) return null;
    if (hours <= 1e-9) return new Date(from);
    let cursor = new Date(from);
    let remaining = hours;
    let guard = 0;
    while (guard++ < STEP_GUARD) {
      const dayStart = dateKey(cursor) === dateKey(from) ? from.getHours() + from.getMinutes() / 60 : 0;
      for (const [start, end] of this.shiftsOn(cursor)) {
        if (end <= dayStart) continue;
        const at = Math.max(dayStart, start);
        const available = end - at;
        if (remaining <= available + 1e-9) return atHour(cursor, at + remaining);
        remaining -= available;
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return cursor;
  }

  /** Move `hours` of work backward from `from`. */
  sub(from: Date | null, hours: number): Date | null {
    if (!from) return null;
    if (hours <= 1e-9) return new Date(from);
    let cursor = new Date(from);
    let remaining = hours;
    let guard = 0;
    while (guard++ < STEP_GUARD) {
      const dayEnd = dateKey(cursor) === dateKey(from) ? from.getHours() + from.getMinutes() / 60 : 24;
      const shifts = this.shiftsOn(cursor);
      for (let i = shifts.length - 1; i >= 0; i--) {
        const [start, end] = shifts[i];
        if (start >= dayEnd) continue;
        const at = Math.min(dayEnd, end);
        const available = at - start;
        if (remaining <= available + 1e-9) return atHour(cursor, at - remaining);
        remaining -= available;
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    return cursor;
  }

  /** Work hours between two moments; negative when `b` precedes `a`. */
  between(a: Date | null, b: Date | null): number {
    if (!a || !b) return 0;
    if (b < a) return -this.between(b, a);
    let cursor = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const aKey = dateKey(a);
    const bKey = dateKey(b);
    const aHour = a.getHours() + a.getMinutes() / 60;
    const bHour = b.getHours() + b.getMinutes() / 60;
    let total = 0;
    let guard = 0;
    while (guard++ < STEP_GUARD) {
      const key = dateKey(cursor);
      for (const [start, end] of this.shiftsOn(cursor)) {
        let lo = start;
        let hi = end;
        if (key === aKey) lo = Math.max(lo, aHour);
        if (key === bKey) hi = Math.min(hi, bHour);
        if (hi > lo) total += hi - lo;
      }
      if (key === bKey) break;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return total;
  }

  /** First working moment at or after `date` — how P6 places a start. */
  normalizeStart(date: Date | null): Date | null {
    if (!date) return null;
    let cursor = new Date(date);
    let hour = cursor.getHours() + cursor.getMinutes() / 60;
    let guard = 0;
    while (guard++ < SNAP_GUARD) {
      for (const [start, end] of this.shiftsOn(cursor)) {
        if (hour < start) return atHour(cursor, start);
        if (hour < end) {
          return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours(), cursor.getMinutes());
        }
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      hour = 0;
    }
    return cursor;
  }

  /** Last working moment at or before `date` — how P6 places a finish. */
  normalizeFinish(date: Date | null): Date | null {
    if (!date) return null;
    let cursor = new Date(date);
    let hour = cursor.getHours() + cursor.getMinutes() / 60;
    let guard = 0;
    while (guard++ < SNAP_GUARD) {
      const shifts = this.shiftsOn(cursor);
      for (let i = shifts.length - 1; i >= 0; i--) {
        const [start, end] = shifts[i];
        if (hour > end) return atHour(cursor, end);
        if (hour > start) {
          return new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours(), cursor.getMinutes());
        }
      }
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
      hour = 24;
    }
    return cursor;
  }

  workDaysBetween(a: Date | null, b: Date | null): number {
    return this.between(a, b) / (this.dayHours || 8);
  }

  summary(): CalendarSummary {
    const days = this.week.reduce((count, hours) => count + (hours > 0 ? 1 : 0), 0);
    return { days, hours: this.workWeekHours, exceptions: this.exceptionList.length };
  }
}

function readShifts(segment: string): Shift[] {
  const shifts: Shift[] = [];
  const re = /s\|(\d{1,2}):(\d{2})\|f\|(\d{1,2}):(\d{2})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment))) {
    const start = +match[1] + +match[2] / 60;
    let end = +match[3] + +match[4] / 60;
    // An end at or before the start means the shift runs past midnight; P6
    // clamps it at the day boundary rather than spilling into the next date.
    if (end <= start) end = 24;
    shifts.push([start, end]);
  }
  return shifts;
}

export const DEFAULT_CALENDAR = new WorkCalendar(null);

/**
 * Continuous calendar used when a project sets
 * `sched_calendar_on_relationship_lag = rcal_24Hour`: lag is then elapsed
 * time rather than working time.
 */
export const TWENTY_FOUR_HOUR_CALENDAR = (() => {
  const cal = new WorkCalendar(null);
  const allDay: Shift[][] = Array.from({ length: 7 }, () => [[0, 24] as Shift]);
  cal.shifts = allDay;
  cal.week = [24, 24, 24, 24, 24, 24, 24];
  cal.workWeekHours = 168;
  return cal;
})();
