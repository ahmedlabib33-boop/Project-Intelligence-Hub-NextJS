"use client";

/**
 * Planning library editor — every table, row, value and field of the
 * activity list, CSI coding, crews, production rates and equipment rates is
 * editable here, and every edit flows straight into activity mapping and the
 * Mitigation / Recovery / Revised engine.
 */

import { useMemo, useRef, useState } from "react";
import {
  addField, addRow, addTable, deleteField, deleteRows, deleteTable, duplicateRow, libraryFromSheets, libraryToSheets,
  parseLibraryJson, updateCell, updateField, updateTable, validateLibrary, cellText,
  type FieldDef, type FieldType, type LibRow, type LibTable, type PlanningLibrary,
} from "../../../lib/planning/library";
import { readXlsx, writeXlsx } from "../../../lib/planning/xlsx";
import { formatNum } from "../../../lib/xer/format";
import { Badge, Card, Drawer, SectionTitle } from "../xer/ui";

const PAGE = 100;

export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
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

export default function LibraryWorkspace({
  library,
  onChange,
  onReset,
}: {
  library: PlanningLibrary;
  onChange: (next: PlanningLibrary) => void;
  onReset: () => void;
}) {
  const [tableKey, setTableKey] = useState(library.tables[0]?.key || "activities");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; field: string; value: string } | null>(null);
  const [sort, setSort] = useState<{ field: string; dir: 1 | -1 } | null>(null);
  const [showGroups, setShowGroups] = useState<Record<string, boolean>>({});
  const [showFields, setShowFields] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newField, setNewField] = useState<{ label: string; type: FieldType; group: string }>({ label: "", type: "text", group: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const table: LibTable | undefined = library.tables.find((t) => t.key === tableKey) || library.tables[0];
  const issues = useMemo(() => validateLibrary(library), [library]);
  const tableIssues = issues.filter((i) => table && i.table === table.key);
  const issueRows = new Set(tableIssues.map((i) => i.rowId).filter(Boolean) as string[]);

  const groups = useMemo(() => Array.from(new Set((table?.fields || []).map((f) => f.group).filter(Boolean) as string[])), [table]);
  const visibleFields = (table?.fields || []).filter((f) => !f.group || showGroups[`${table?.key}:${f.group}`]);

  const rows = useMemo(() => {
    if (!table) return [] as LibRow[];
    const q = query.trim().toLowerCase();
    let list = q
      ? table.rows.filter((r) => table.fields.some((f) => cellText(r[f.key]).toLowerCase().includes(q)))
      : table.rows;
    if (sort) {
      const field = table.fields.find((f) => f.key === sort.field);
      list = list.slice().sort((a, b) => {
        const x = a[sort.field];
        const y = b[sort.field];
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        if (field?.type === "number") return ((x as number) - (y as number)) * sort.dir;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * sort.dir;
      });
    }
    return list;
  }, [table, query, sort]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 6000);
  };

  const selectTable = (key: string) => {
    setTableKey(key);
    setQuery("");
    setLimit(PAGE);
    setSelected(new Set());
    setEditing(null);
    setSort(null);
  };

  const commit = () => {
    if (!editing || !table) return;
    onChange(updateCell(library, table.key, editing.id, editing.field, editing.value));
    setEditing(null);
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      if (/\.json$/i.test(file.name)) {
        const next = parseLibraryJson(await file.text());
        onChange(next);
        selectTable(next.tables[0]?.key || "activities");
        flash(`Imported ${file.name} — ${formatNum(next.tables.reduce((s, t) => s + t.rows.length, 0))} rows.`);
        return;
      }
      const sheets = await readXlsx(await file.arrayBuffer());
      const { library: next, report } = libraryFromSheets(sheets, file.name);
      onChange(next);
      selectTable(next.tables[0]?.key || "activities");
      flash(
        `Imported ${file.name}: ${report.sheetsRead.length} sheets read${report.sheetsSkipped.length ? `, ${report.sheetsSkipped.length} skipped (${report.sheetsSkipped.join(", ")})` : ""}. Salary and allowance data is never imported.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? `${file.name}: ${cause.message}` : `${file.name} could not be imported.`);
    }
  };

  if (!table) return null;

  const totalRows = library.tables.reduce((s, t) => s + t.rows.length, 0);

  return (
    <div className="xer-view pl-library">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.json"
        className="xer-hidden-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />

      <Card
        eyebrow="Planning library · feeds activity mapping and Mitigation / Recovery / Revised"
        title={library.name}
        aside={`${library.tables.length} tables · ${formatNum(totalRows)} rows`}
      >
        <div className="xer-toolbar">
          <label className="xer-field">
            <span>Name</span>
            <input className="xer-input" value={library.name} onChange={(e) => onChange({ ...library, name: e.target.value })} />
          </label>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => fileRef.current?.click()}>Import Excel / JSON</button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            onClick={() => downloadBlob(`${library.name}.xlsx`, writeXlsx(libraryToSheets(library)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
          >
            Export Excel
          </button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => downloadBlob(`${library.name}.json`, JSON.stringify(library, null, 2), "application/json")}>
            Export JSON
          </button>
          <button type="button" className={`xer-btn xer-btn-sm${showIssues ? " active" : ""}`} onClick={() => setShowIssues(!showIssues)}>
            Validation <i>{issues.length}</i>
          </button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            onClick={() => {
              const name = window.prompt("Name of the new table");
              if (!name) return;
              const { library: next, key } = addTable(library, name);
              onChange(next);
              selectTable(key);
            }}
          >
            Add table
          </button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            onClick={() => {
              if (window.confirm("Replace every table with the shipped library? Your edits in this browser will be lost unless exported first.")) onReset();
            }}
          >
            Reset to shipped library
          </button>
          <span className="xer-dim xer-ml-auto">Source {library.source} · saved in this browser {new Date(library.updatedAt).toLocaleString()}</span>
        </div>
        {notice ? <p className="xer-busy">{notice}</p> : null}
        {error ? <p className="xer-error">{error}</p> : null}
        {library.excluded.length ? (
          <details className="pl-excluded">
            <summary>Salary data is not held — {library.excluded.length} exclusions</summary>
            <ul className="xer-findings">{library.excluded.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        ) : null}
      </Card>

      {showIssues ? (
        <Card eyebrow="Library validation" title={issues.length ? `${issues.length} issues` : "No issues"} aside="Checked on every edit">
          {issues.length ? (
            <ul className="pl-issues">
              {issues.slice(0, 200).map((issue, i) => (
                <li key={`${issue.table}-${issue.rowId}-${i}`}>
                  <Badge tone={issue.severity === "error" ? "bad" : "warn"}>{issue.severity}</Badge>
                  <button type="button" className="pl-link" onClick={() => selectTable(issue.table)}>
                    {library.tables.find((t) => t.key === issue.table)?.label || issue.table}
                  </button>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="xer-muted">Every activity code is unique, every rate row resolves to a crew and machine rate, and no number is negative.</p>
          )}
        </Card>
      ) : null}

      <div className="pl-layout">
        <nav className="pl-tables" aria-label="Library tables">
          {library.tables.map((t) => (
            <button key={t.key} type="button" className={t.key === table.key ? "active" : ""} onClick={() => selectTable(t.key)}>
              <b>{t.label}</b>
              <span>
                {formatNum(t.rows.length)} rows · {t.fields.length} fields{t.custom ? " · custom" : ""}
              </span>
            </button>
          ))}
        </nav>

        <section className="schedule-intelligence-card pl-table-card">
          <div className="pl-table-head">
            <input
              className="pl-title-input"
              value={table.label}
              aria-label="Table name"
              onChange={(e) => onChange(updateTable(library, table.key, { label: e.target.value }))}
            />
            <input
              className="pl-desc-input"
              value={table.description}
              aria-label="Table description"
              onChange={(e) => onChange(updateTable(library, table.key, { description: e.target.value }))}
            />
          </div>

          <div className="xer-toolbar">
            <input
              className="xer-input"
              type="search"
              placeholder="Search this table…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
            />
            <button
              type="button"
              className="xer-btn xer-btn-sm"
              onClick={() => {
                const { library: next, id } = addRow(library, table.key);
                onChange(next);
                setQuery("");
                const first = table.fields[0];
                if (first) setEditing({ id, field: first.key, value: "" });
              }}
            >
              Add row
            </button>
            <button
              type="button"
              className="xer-btn xer-btn-sm"
              disabled={!selected.size}
              onClick={() => {
                if (!window.confirm(`Delete ${selected.size} row(s) from ${table.label}?`)) return;
                onChange(deleteRows(library, table.key, Array.from(selected)));
                setSelected(new Set());
              }}
            >
              Delete selected <i>{selected.size || ""}</i>
            </button>
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => setShowFields(true)}>
              Fields <i>{table.fields.length}</i>
            </button>
            {groups.map((g) => {
              const key = `${table.key}:${g}`;
              const count = table.fields.filter((f) => f.group === g).length;
              return (
                <label key={g} className="xer-field">
                  <input type="checkbox" checked={!!showGroups[key]} onChange={(e) => setShowGroups({ ...showGroups, [key]: e.target.checked })} />
                  <span>Show {g.toLowerCase()} ({count})</span>
                </label>
              );
            })}
            {table.custom ? (
              <button
                type="button"
                className="xer-btn xer-btn-sm"
                onClick={() => {
                  if (!window.confirm(`Delete the custom table ${table.label}?`)) return;
                  onChange(deleteTable(library, table.key));
                  selectTable(library.tables[0].key);
                }}
              >
                Delete table
              </button>
            ) : null}
            <span className="xer-table-count">
              {formatNum(rows.length)}
              {rows.length !== table.rows.length ? ` of ${formatNum(table.rows.length)}` : ""} rows · click any cell to edit
            </span>
          </div>

          <div className="schedule-intelligence-scroll">
            <table className="schedule-intelligence-table xer-table pl-grid" style={{ minWidth: Math.max(640, visibleFields.length * 132 + 110) }}>
              <thead>
                <tr>
                  <th className="pl-col-select">
                    <input
                      type="checkbox"
                      aria-label="Select all shown rows"
                      checked={rows.length > 0 && rows.slice(0, limit).every((r) => selected.has(r._id))}
                      onChange={(e) => {
                        const next = new Set(selected);
                        for (const r of rows.slice(0, limit)) {
                          if (e.target.checked) next.add(r._id);
                          else next.delete(r._id);
                        }
                        setSelected(next);
                      }}
                    />
                  </th>
                  {visibleFields.map((f) => (
                    <th
                      key={f.key}
                      className="xer-th-sortable"
                      style={{ textAlign: f.type === "number" ? "right" : "left" }}
                      onClick={() => setSort(sort && sort.field === f.key ? { field: f.key, dir: sort.dir === 1 ? -1 : 1 } : { field: f.key, dir: 1 })}
                      title={f.core ? "Used by the engine" : "Custom field"}
                    >
                      {f.label}
                      {f.core ? <i className="pl-core">●</i> : null}
                      {sort && sort.field === f.key ? <i className="xer-sort">{sort.dir === 1 ? "▲" : "▼"}</i> : null}
                    </th>
                  ))}
                  <th className="pl-col-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row) => (
                  <tr key={row._id} className={issueRows.has(row._id) ? "pl-row-issue" : undefined}>
                    <td className="pl-col-select">
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={selected.has(row._id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(row._id);
                          else next.delete(row._id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    {visibleFields.map((f) => {
                      const active = editing && editing.id === row._id && editing.field === f.key;
                      const value = row[f.key];
                      return (
                        <td
                          key={f.key}
                          className={`pl-cell${f.type === "number" ? " pl-num" : ""}`}
                          onClick={() => !active && setEditing({ id: row._id, field: f.key, value: cellText(value) })}
                        >
                          {active ? (
                            <input
                              autoFocus
                              className="pl-cell-input"
                              inputMode={f.type === "number" ? "decimal" : undefined}
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onBlur={commit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commit();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : value === null || value === undefined || value === "" ? (
                            <span className="xer-dim">—</span>
                          ) : f.type === "number" && typeof value === "number" ? (
                            formatNum(value, Number.isInteger(value) ? 0 : 2)
                          ) : (
                            String(value)
                          )}
                        </td>
                      );
                    })}
                    <td className="pl-col-actions">
                      <button type="button" className="pl-icon" title="Duplicate row" onClick={() => onChange(duplicateRow(library, table.key, row._id))}>⧉</button>
                      <button type="button" className="pl-icon" title="Delete row" onClick={() => onChange(deleteRows(library, table.key, [row._id]))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? <div className="schedule-intelligence-empty"><b>{table.rows.length ? "No row matches the search." : "This table is empty — add a row or import a workbook."}</b></div> : null}
          {rows.length > limit ? (
            <button type="button" className="xer-btn xer-more" onClick={() => setLimit(limit + PAGE)}>
              Show {formatNum(Math.min(PAGE, rows.length - limit))} more <small>· {formatNum(rows.length - limit)} hidden</small>
            </button>
          ) : null}
          {tableIssues.length ? <p className="xer-muted xer-note">{tableIssues.length} validation issue(s) in this table — rows are highlighted.</p> : null}
        </section>
      </div>

      <details className="pl-audit">
        <summary>Edit history ({library.audit.length})</summary>
        <ul className="xer-findings">
          {library.audit.slice(-40).reverse().map((a, i) => (
            <li key={`${a.at}-${i}`}>
              <span className="xer-dim">{new Date(a.at).toLocaleString()}</span> · <b>{a.table}</b> · {a.action} · {a.detail}
            </li>
          ))}
        </ul>
      </details>

      {showFields ? (
        <Drawer title={`${table.label} — fields`} subtitle="Core fields feed the engine: rename them freely; custom fields can be retyped or removed" onClose={() => setShowFields(false)}>
          {table.fields.map((field: FieldDef) => (
            <div key={field.key} className="pl-field-row">
              <input
                className="xer-input"
                defaultValue={field.label}
                aria-label="Field label"
                onBlur={(e) => e.target.value !== field.label && onChange(updateField(library, table.key, field.key, { label: e.target.value }))}
              />
              <select
                className="xer-select"
                value={field.type}
                disabled={field.core}
                onChange={(e) => onChange(updateField(library, table.key, field.key, { type: e.target.value as FieldType }))}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
              </select>
              {field.core ? <Badge tone="info">engine</Badge> : field.group ? <Badge tone="mut">{field.group}</Badge> : <Badge tone="mut">custom</Badge>}
              <button
                type="button"
                className="xer-btn xer-btn-sm"
                disabled={field.core}
                onClick={() => window.confirm(`Delete the field ${field.label} and its values?`) && onChange(deleteField(library, table.key, field.key))}
              >
                Delete
              </button>
            </div>
          ))}
          <SectionTitle>Add a field</SectionTitle>
          <div className="pl-field-row">
            <input className="xer-input" placeholder="Field name" value={newField.label} onChange={(e) => setNewField({ ...newField, label: e.target.value })} />
            <select className="xer-select" value={newField.type} onChange={(e) => setNewField({ ...newField, type: e.target.value as FieldType })}>
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <select className="xer-select" value={newField.group} onChange={(e) => setNewField({ ...newField, group: e.target.value })}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button
              type="button"
              className="xer-btn xer-btn-sm"
              disabled={!newField.label.trim()}
              onClick={() => {
                onChange(addField(library, table.key, newField.label, newField.type, newField.group || undefined));
                if (newField.group) setShowGroups({ ...showGroups, [`${table.key}:${newField.group}`]: true });
                setNewField({ label: "", type: "text", group: "" });
              }}
            >
              Add field
            </button>
          </div>
          <p className="xer-muted xer-note">
            A new column in the <b>Trades</b> group of labour rates or the <b>Machines</b> group of equipment rates becomes part of that
            activity&apos;s resource set; a machine column is costed from the equipment rates of the machine type with the same name.
          </p>
        </Drawer>
      ) : null}
    </div>
  );
}
