/**
 * Formatting, parsing and small collection helpers shared by the XER analyzer.
 * Ported from the standalone single-file analyzer so that every view formats
 * numbers, dates and deltas identically.
 */

export const DAY = 86_400_000;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse to a finite number, falling back to 0. */
export function num(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse to a finite number, preserving "no value" as null. */
export function numOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse an XER date string (`YYYY-MM-DD [HH:MM]`) as a local-time Date. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  return new Date(+match[1], +match[2] - 1, +match[3], match[4] ? +match[4] : 0, match[5] ? +match[5] : 0);
}

export function formatDate(date: Date | null | undefined, withTime = false): string {
  if (!date) return "";
  const base = `${String(date.getDate()).padStart(2, "0")}-${MON[date.getMonth()]}-${String(date.getFullYear()).slice(2)}`;
  if (!withTime) return base;
  return `${base} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDateLong(date: Date | null | undefined): string {
  if (!date) return "";
  return `${String(date.getDate()).padStart(2, "0")}-${MON[date.getMonth()]}-${date.getFullYear()}`;
}

/** Calendar-day difference b − a, to two decimals. */
export function dayDiff(a: Date | null | undefined, b: Date | null | undefined): number | null {
  if (!a || !b) return null;
  return Math.round(((+b - +a) / DAY) * 100) / 100;
}

export function formatNum(value: number | null | undefined, dec = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatDelta(value: number | null | undefined, dec = 1, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(dec)}${suffix}`;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function percent(part: number, whole: number): number {
  return whole ? (part / whole) * 100 : 0;
}

export function sortBy<T>(items: T[], key: (item: T) => string | number | null | undefined, dir: 1 | -1 = 1): T[] {
  return items.slice().sort((x, y) => {
    const a = key(x);
    const b = key(y);
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    return (a < b ? -1 : a > b ? 1 : 0) * dir;
  });
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Stable id for client-generated rows (checks, paths). */
export function uid(prefix = "u"): string {
  return prefix + Math.random().toString(36).slice(2, 9);
}

/* ------------------------------------------------------------------ CSV */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(",")]
    .concat(rows.map((row) => row.map(csvCell).join(",")))
    .join("\r\n");
}

/** Browser-only: stream a CSV to the user's downloads with a UTF-8 BOM. */
export function downloadCsv(name: string, header: string[], rows: unknown[][]): void {
  const blob = new Blob(["﻿" + toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[^\w.\- ]/g, "_");
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 400);
}
