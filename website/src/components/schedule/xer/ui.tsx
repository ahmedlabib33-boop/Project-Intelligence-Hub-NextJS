"use client";

/**
 * Shared presentation primitives for the XER analyzer.
 *
 * These deliberately reuse the app's existing `schedule-intelligence-*`
 * card / KPI / table classes so the analyzer reads as part of the Hub rather
 * than as an embedded third-party tool.
 */

import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv, formatDate, formatNum } from "../../../lib/xer/format";

/* ------------------------------------------------------------------ card */

export function Card({
  eyebrow,
  title,
  aside,
  children,
  className = "",
}: {
  eyebrow?: string;
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`schedule-intelligence-card ${className}`.trim()}>
      {(eyebrow || title || aside) && (
        <div className="schedule-intelligence-card-head">
          <div>
            {eyebrow ? <p>{eyebrow}</p> : null}
            {title ? <h3>{title}</h3> : null}
          </div>
          {aside ? <span>{aside}</span> : null}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------- kpi */

export type KpiTone = "" | "crit" | "warn" | "ok" | "info";

export function Kpis({ children }: { children: ReactNode }) {
  return <section className="schedule-intelligence-kpis xer-kpis">{children}</section>;
}

export function Kpi({
  label,
  value,
  note,
  tone = "",
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: KpiTone;
  onClick?: () => void;
}) {
  const className = `xer-kpi${tone ? ` xer-kpi-${tone}` : ""}${onClick ? " xer-kpi-click" : ""}`;
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </>
  );
  if (onClick) {
    return (
      <article className={className}>
        <button type="button" onClick={onClick}>
          {body}
        </button>
      </article>
    );
  }
  return <article className={className}>{body}</article>;
}

/* ----------------------------------------------------------------- badge */

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`xer-badge xer-badge-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------ bar series */

export type BarDatum = { label: string; value: number; tone?: string; onClick?: () => void; note?: string };

/** Horizontal distribution bars — used for float bands, durations, WBS split. */
export function Bars({ data, unit = "" }: { data: BarDatum[]; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.some((d) => d.value)) {
    return <p className="xer-muted">No values in range.</p>;
  }
  return (
    <div className="xer-bars">
      {data.map((d) => {
        const row = (
          <>
            <span className="xer-bars-label">{d.label}</span>
            <span className="xer-bars-track">
              <span
                className={`xer-bars-fill${d.tone ? ` xer-tone-${d.tone}` : ""}`}
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </span>
            <span className="xer-bars-value">
              {formatNum(d.value)}
              {unit}
            </span>
          </>
        );
        return d.onClick ? (
          <button type="button" key={d.label} className="xer-bars-row xer-bars-click" onClick={d.onClick} title={d.note}>
            {row}
          </button>
        ) : (
          <div key={d.label} className="xer-bars-row" title={d.note}>
            {row}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ line chart */

export type Series = { name: string; tone: string; points: { x: Date; y: number }[]; dashed?: boolean };

/**
 * Compact cumulative-curve chart. Inline SVG rather than a chart library —
 * the app already ships Chart.js, but this needs one shape and must stay
 * legible inside a dashboard card.
 */
export function LineChart({
  series,
  marker,
  markerLabel,
  height = 190,
}: {
  series: Series[];
  marker?: Date | null;
  markerLabel?: string;
  height?: number;
}) {
  const points = series.flatMap((s) => s.points);
  if (points.length < 2) return <p className="xer-muted">Not enough dated activities to draw a curve.</p>;

  const xs = points.map((p) => +p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys, 1);
  const W = 1000;
  const H = height;
  const padL = 44;
  const padB = 22;
  const padT = 8;
  const padR = 8;

  const sx = (x: number) => padL + ((x - minX) / Math.max(1, maxX - minX)) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - y / maxY) * (H - padT - padB);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => minX + ((maxX - minX) * i) / (xTickCount - 1));

  return (
    <div className="xer-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cumulative activity completion">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} className="xer-chart-grid" />
            <text x={padL - 6} y={sy(v) + 3} className="xer-chart-ylabel">{v}</text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={i} x={sx(v)} y={H - 6} className="xer-chart-xlabel" textAnchor={i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle"}>
            {formatDate(new Date(v))}
          </text>
        ))}
        {marker ? (
          <g>
            <line x1={sx(+marker)} x2={sx(+marker)} y1={padT} y2={H - padB} className="xer-chart-marker" />
            {markerLabel ? (
              <text x={sx(+marker) + 4} y={padT + 10} className="xer-chart-xlabel">{markerLabel}</text>
            ) : null}
          </g>
        ) : null}
        {series.map((s) => {
          if (s.points.length < 2) return null;
          const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(+p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          return <path key={s.name} d={d} className={`xer-chart-line xer-chart-${s.tone}`} strokeDasharray={s.dashed ? "5 4" : undefined} />;
        })}
      </svg>
      <div className="xer-legend xer-legend-wrap">
        {series.map((s) => (
          <span key={s.name}>
            <i className={`xer-tone-${s.tone}`} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- data table */

export type Column<T> = {
  k: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** Sort/export key. Omit to make the column unsortable. */
  sort?: (row: T) => string | number | null;
  /** Plain-text value for CSV export; falls back to `sort`. */
  csv?: (row: T) => string | number | null;
  align?: "left" | "right";
  width?: string;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  onRowClick,
  empty = "Nothing to show.",
  pageSize = 200,
  toolbar,
  exportName,
  minWidth = 860,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  searchText?: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
  pageSize?: number;
  toolbar?: ReactNode;
  exportName?: string;
  minWidth?: number;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [limit, setLimit] = useState(pageSize);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((row) => searchText(row).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((c) => c.k === sortKey);
    if (!column || !column.sort) return filtered;
    const get = column.sort;
    return filtered.slice().sort((x, y) => {
      const a = get(x);
      const b = get(y);
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (a < b ? -1 : a > b ? 1 : 0) * sortDir;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const visible = sorted.slice(0, limit);

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 1 ? -1 : 1);
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };

  const exportCsv = () => {
    if (!exportName) return;
    const header = columns.map((c) => c.label);
    const body = sorted.map((row) =>
      columns.map((c) => {
        const value = c.csv ? c.csv(row) : c.sort ? c.sort(row) : "";
        return value === null || value === undefined ? "" : value;
      }),
    );
    downloadCsv(`${exportName}.csv`, header, body);
  };

  return (
    <div className="xer-table-wrap">
      <div className="xer-table-top">
        {searchText ? (
          <input
            className="xer-input"
            type="search"
            value={query}
            placeholder="Search…"
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(pageSize);
            }}
          />
        ) : null}
        {toolbar}
        <span className="xer-table-count">
          {formatNum(sorted.length)}
          {sorted.length !== rows.length ? ` of ${formatNum(rows.length)}` : ""} rows
        </span>
        {exportName ? (
          <button type="button" className="xer-btn xer-btn-sm" onClick={exportCsv} disabled={!sorted.length}>
            Export CSV
          </button>
        ) : null}
      </div>

      {sorted.length ? (
        <>
          <div className="schedule-intelligence-scroll">
            <table className="schedule-intelligence-table xer-table" style={{ minWidth }}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.k}
                      style={{ width: c.width, textAlign: c.align === "right" ? "right" : "left" }}
                      className={c.sort ? "xer-th-sortable" : undefined}
                      onClick={c.sort ? () => toggleSort(c.k) : undefined}
                    >
                      {c.label}
                      {sortKey === c.k ? <i className="xer-sort">{sortDir === 1 ? "▲" : "▼"}</i> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr
                    key={rowKey(row, index)}
                    className={onRowClick ? "xer-tr-click" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.k} style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > visible.length ? (
            <button type="button" className="xer-btn xer-more" onClick={() => setLimit(limit + pageSize)}>
              Show {formatNum(Math.min(pageSize, sorted.length - visible.length))} more
              <small> · {formatNum(sorted.length - visible.length)} hidden</small>
            </button>
          ) : null}
        </>
      ) : (
        <div className="schedule-intelligence-empty">
          <b>{empty}</b>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="xer-overlay" aria-label="Close details" onClick={onClose} />
      <aside className="xer-drawer" role="dialog" aria-label={title}>
        <header>
          <div>
            <b>{title}</b>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" className="xer-btn xer-btn-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="xer-drawer-body">{children}</div>
      </aside>
    </>
  );
}

/** Definition list used inside the drawer. */
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!shown.length) return null;
  return (
    <dl className="xer-kv">
      {shown.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="xer-section-title">{children}</h4>;
}
