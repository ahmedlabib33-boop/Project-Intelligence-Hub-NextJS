"use client";

/**
 * Activity mapping — ties each schedule activity to a planning-library
 * activity code, its crews, remaining quantity and resource sets. Every value
 * is editable in place; code rules map whole groups at once. The result is the
 * productivity basis Mitigation / Recovery / Revised works from.
 */

import { useMemo, useRef, useState } from "react";
import type { Analysis } from "../../../lib/xer/analysis";
import { formatNum } from "../../../lib/xer/format";
import type { ProjectView, Task } from "../../../lib/xer/model";
import type { AnalyzerOptions } from "../../../lib/xer/options";
import { cellText, type LibraryIndex } from "../../../lib/planning/library";
import {
  clearActivityMappings, deleteRule, effectiveMapping, parseMappingJson, resolveMapped, setActivityMapping,
  suggestLibraryActivities, upsertRule, type MappedActivity, type MappingStore,
} from "../../../lib/planning/mapping";
import { Badge, Card, Drawer, Kpi, Kpis, SectionTitle } from "../xer/ui";
import { downloadBlob } from "./LibraryWorkspace";

type Scope = "driving" | "critical" | "incomplete" | "mapped" | "unmapped" | "issues";
const PAGE = 100;

const num = (v: string) => {
  const n = Number.parseFloat(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};

export default function MappingView({
  P,
  an,
  opts,
  index,
  store,
  onChange,
  onOpenTask,
}: {
  P: ProjectView;
  an: Analysis;
  opts: AnalyzerOptions;
  index: LibraryIndex;
  store: MappingStore;
  onChange: (next: MappingStore) => void;
  onOpenTask: (t: Task) => void;
}) {
  const [scope, setScope] = useState<Scope>("driving");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [threshold, setThreshold] = useState(0.45);
  const [drawer, setDrawer] = useState<Task | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rule, setRule] = useState({ codeType: "", codeValue: "", libraryCode: "", crews: [] as string[], includeEquipment: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const work = useMemo(() => P.tasks.filter((t) => !t.done && !t.isMile && !t.isLOE && !t.isWBSsum), [P]);
  const resolved = useMemo(() => new Map(work.map((t) => [t.id, resolveMapped(P, index, store, t)])), [P, work, index, store]);
  const driving = useMemo(() => new Set(an.longestPath.map((t) => t.id)), [an]);

  const libraryOptions = useMemo(
    () => Array.from(index.activities.entries()).map(([code, row]) => ({ code, label: `${code} — ${cellText(row.description)}` })),
    [index],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return work.filter((t) => {
      const m = resolved.get(t.id)!;
      if (scope === "driving" && !driving.has(t.id)) return false;
      if (scope === "critical" && !(t.c.tf !== null && t.c.tf <= opts.tfNear)) return false;
      if (scope === "mapped" && !m.mapping.libraryCode) return false;
      if (scope === "unmapped" && m.mapping.libraryCode) return false;
      if (scope === "issues" && !(m.mapping.libraryCode && m.issues.length)) return false;
      if (q && !`${t.code} ${t.name} ${t.wbsPath} ${m.mapping.libraryCode}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [work, resolved, scope, query, driving, opts]);

  const stats = useMemo(() => {
    let mapped = 0;
    let rated = 0;
    let quantified = 0;
    let byRule = 0;
    for (const m of resolved.values()) {
      if (!m.mapping.libraryCode) continue;
      mapped++;
      if (m.via === "rule") byRule++;
      if (m.production && m.production > 0) rated++;
      if (m.quantity && m.quantity > 0) quantified++;
    }
    const drivingMapped = an.longestPath.filter((t) => resolved.get(t.id)?.mapping.libraryCode).length;
    return { mapped, rated, quantified, byRule, drivingMapped };
  }, [resolved, an]);

  const codeTypes = useMemo(() => {
    const map = new Map<string, Map<string, { count: number; sample: string }>>();
    for (const t of work) {
      for (const c of t.codes) {
        const values = map.get(c.type) || new Map();
        const entry = values.get(c.code) || { count: 0, sample: t.name };
        entry.count++;
        values.set(c.code, entry);
        map.set(c.type, values);
      }
    }
    return map;
  }, [work]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 6000);
  };

  const patch = (t: Task, values: Parameters<typeof setActivityMapping>[2]) => onChange(setActivityMapping(store, t.code, values));

  const autoMap = () => {
    let next = store;
    let applied = 0;
    for (const t of rows) {
      if (effectiveMapping(next, t).mapping.libraryCode) continue;
      const best = suggestLibraryActivities(index, t, 1)[0];
      if (!best || best.score < threshold) continue;
      next = setActivityMapping(next, t.code, { libraryCode: best.code, crews: best.crews });
      applied++;
    }
    onChange(next);
    flash(applied ? `Mapped ${applied} activities from suggestions scoring ${threshold} or more — review them before relying on the rates.` : "No unmapped activity in this view has a suggestion above the threshold.");
  };

  const ruleCrews = rule.libraryCode ? (index.labour.get(rule.libraryCode) || []).map((r) => cellText(r.crew)) : [];
  const drawerMapped = drawer ? resolved.get(drawer.id) || resolveMapped(P, index, store, drawer) : null;

  return (
    <div className="xer-view pl-mapping">
      <datalist id="pl-activity-codes">
        {libraryOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </datalist>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        className="xer-hidden-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            onChange(parseMappingJson(await file.text()));
            flash(`Imported mapping from ${file.name}.`);
          } catch (cause) {
            flash(cause instanceof Error ? cause.message : "The mapping file could not be read.");
          }
        }}
      />

      <Kpis>
        <Kpi label="Work activities" value={formatNum(work.length)} note="Incomplete, excluding milestones and LOE" />
        <Kpi label="Mapped" value={formatNum(stats.mapped)} note={`${formatNum(stats.byRule)} by code rule`} tone={stats.mapped ? "ok" : "warn"} onClick={() => setScope("mapped")} />
        <Kpi label="With a production rate" value={formatNum(stats.rated)} note="Usable by the scenario engine" tone={stats.rated ? "ok" : "warn"} />
        <Kpi label="With a remaining quantity" value={formatNum(stats.quantified)} note="Needed to re-estimate from the rate" />
        <Kpi
          label="Driving path mapped"
          value={`${formatNum(stats.drivingMapped)} / ${formatNum(an.longestPath.filter((t) => !t.isMile && !t.done).length)}`}
          note="Where recovery levers act first"
          tone="info"
          onClick={() => setScope("driving")}
        />
      </Kpis>

      <Card eyebrow="Code rules" title="Map every activity carrying one P6 activity-code value" aside={`${store.rules.length} rule(s)`}>
        <div className="xer-toolbar">
          <select className="xer-select" value={rule.codeType} onChange={(e) => setRule({ ...rule, codeType: e.target.value, codeValue: "" })}>
            <option value="">Activity code type…</option>
            {Array.from(codeTypes.keys()).map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select className="xer-select" value={rule.codeValue} disabled={!rule.codeType} onChange={(e) => setRule({ ...rule, codeValue: e.target.value })}>
            <option value="">Value…</option>
            {Array.from(codeTypes.get(rule.codeType)?.entries() || []).sort((a, b) => b[1].count - a[1].count).map(([value, info]) => (
              <option key={value} value={value}>{value} · {info.count} — {info.sample.slice(0, 40)}</option>
            ))}
          </select>
          <input
            className="xer-input"
            list="pl-activity-codes"
            placeholder="Library activity code"
            value={rule.libraryCode}
            onChange={(e) => setRule({ ...rule, libraryCode: e.target.value.split(" ")[0], crews: [] })}
          />
          {ruleCrews.length ? (
            <select
              className="xer-select"
              multiple
              size={Math.min(3, ruleCrews.length)}
              value={rule.crews}
              onChange={(e) => setRule({ ...rule, crews: Array.from(e.target.selectedOptions).map((o) => o.value) })}
              title="Crews that do this work (none selected = all)"
            >
              {ruleCrews.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : null}
          <label className="xer-field">
            <input type="checkbox" checked={rule.includeEquipment} onChange={(e) => setRule({ ...rule, includeEquipment: e.target.checked })} />
            <span>Include equipment</span>
          </label>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            disabled={!rule.codeType || !rule.codeValue || !index.activities.has(rule.libraryCode)}
            onClick={() => {
              onChange(upsertRule(store, rule));
              flash(`Rule added: ${rule.codeType} = ${rule.codeValue} → ${rule.libraryCode}.`);
            }}
          >
            Add rule
          </button>
        </div>
        {store.rules.length ? (
          <table className="xer-mini-table">
            <thead><tr><th>Code</th><th>Library activity</th><th>Crews</th><th>Equipment</th><th className="xer-num">Activities</th><th /></tr></thead>
            <tbody>
              {store.rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.codeType} = <b>{r.codeValue}</b></td>
                  <td>{r.libraryCode} — {cellText(index.activities.get(r.libraryCode)?.description) || <Badge tone="bad">unknown code</Badge>}</td>
                  <td>{r.crews.join(", ") || "All"}</td>
                  <td>{r.includeEquipment ? "Yes" : "No"}</td>
                  <td className="xer-num">{formatNum(work.filter((t) => t.codes.some((c) => c.type === r.codeType && c.code === r.codeValue)).length)}</td>
                  <td><button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange(deleteRule(store, r.id))}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="xer-muted xer-note">No rules yet. An activity&apos;s own mapping always overrides a rule.</p>
        )}
      </Card>

      <Card eyebrow="Activity mapping" title="Schedule activities ↔ planning library" aside="Edit any cell · changes flow straight to the scenario engine">
        <div className="xer-toolbar">
          <div className="xer-subtabs">
            {([
              ["driving", "Driving path"], ["critical", "Critical & near"], ["incomplete", "All work"],
              ["mapped", "Mapped"], ["unmapped", "Unmapped"], ["issues", "With issues"],
            ] as [Scope, string][]).map(([key, label]) => (
              <button key={key} type="button" className={scope === key ? "active" : ""} onClick={() => { setScope(key); setLimit(PAGE); }}>
                {label}
              </button>
            ))}
          </div>
          <input className="xer-input" type="search" placeholder="Search ID, name, WBS, code…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
          <label className="xer-field">
            <span>Suggestion score ≥</span>
            <input className="xer-input xer-input-num" type="number" step={0.05} min={0} max={2} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 0)} />
          </label>
          <button type="button" className="xer-btn xer-btn-sm" onClick={autoMap}>Auto-map this view</button>
          <button
            type="button"
            className="xer-btn xer-btn-sm"
            onClick={() => {
              const codes = rows.map((t) => t.code).filter((c) => store.byTaskCode[c]);
              if (codes.length && window.confirm(`Clear the activity mappings of ${codes.length} activities in this view? Code rules stay.`)) {
                onChange(clearActivityMappings(store, codes));
              }
            }}
          >
            Clear view mappings
          </button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => downloadBlob(`${P.name}-activity-mapping.json`, JSON.stringify(store, null, 2), "application/json")}>Export</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => fileRef.current?.click()}>Import</button>
          <span className="xer-table-count">{formatNum(rows.length)} activities</span>
        </div>
        {notice ? <p className="xer-busy">{notice}</p> : null}

        <div className="schedule-intelligence-scroll">
          <table className="schedule-intelligence-table xer-table pl-grid" style={{ minWidth: 1480 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Activity</th>
                <th style={{ textAlign: "right" }}>Rem. (d)</th>
                <th style={{ textAlign: "right" }}>TF (d)</th>
                <th>Library activity</th>
                <th>Crews</th>
                <th style={{ textAlign: "right" }}>Quantity</th>
                <th>UOM</th>
                <th style={{ textAlign: "right" }}>Output / set-day</th>
                <th style={{ textAlign: "right" }}>Sets</th>
                <th style={{ textAlign: "right" }}>Max sets</th>
                <th style={{ textAlign: "right" }}>Rate-based (d)</th>
                <th style={{ textAlign: "right" }}>Cost / set-day</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((t) => {
                const m = resolved.get(t.id)!;
                return <MappingRow key={t.id} t={t} m={m} driving={driving.has(t.id)} patch={patch} onOpenTask={onOpenTask} onEdit={() => setDrawer(t)} />;
              })}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className="schedule-intelligence-empty"><b>No activity in this view.</b></div> : null}
        {rows.length > limit ? (
          <button type="button" className="xer-btn xer-more" onClick={() => setLimit(limit + PAGE)}>
            Show {formatNum(Math.min(PAGE, rows.length - limit))} more <small>· {formatNum(rows.length - limit)} hidden</small>
          </button>
        ) : null}
        <p className="xer-muted xer-note">
          <b>Sets</b> defaults to the whole number of resource sets the file&apos;s remaining duration implies at the library rate. A quantity
          taken from the XER comes from the activity&apos;s material resources — confirm it is in the library&apos;s unit before re-estimating. Enter the sets actually on site to confirm them — Revised re-estimation uses confirmed sets only, and added-set actions on unconfirmed sets are flagged high risk.
        </p>
      </Card>

      {drawer && drawerMapped ? (
        <MappingDrawer P={P} t={drawer} m={drawerMapped} index={index} onPatch={(v) => patch(drawer, v)} onClose={() => setDrawer(null)} onOpenTask={onOpenTask} />
      ) : null}
    </div>
  );
}

function MappingRow({
  t, m, driving, patch, onOpenTask, onEdit,
}: {
  t: Task;
  m: MappedActivity;
  driving: boolean;
  patch: (t: Task, values: Parameters<typeof setActivityMapping>[2]) => void;
  onOpenTask: (t: Task) => void;
  onEdit: () => void;
}) {
  const rateBased = m.productivityDays;
  const variance = m.varianceDays;
  const own = m.via === "activity";
  return (
    <tr className={m.mapping.libraryCode && m.issues.length ? "pl-row-issue" : undefined}>
      <td>
        <button type="button" className="pl-link xer-mono" onClick={() => onOpenTask(t)}>{t.code}</button>
        {driving ? <Badge tone="bad">driving</Badge> : null}
      </td>
      <td className="pl-name" title={t.wbsPath}>{t.name}</td>
      <td className="pl-num">{formatNum(t.rd, 1)}</td>
      <td className="pl-num">{t.c.tf === null ? "—" : formatNum(t.c.tf, 1)}</td>
      <td>
        <input
          key={`${t.id}:${m.mapping.libraryCode}`}
          className="pl-cell-input pl-code-input"
          list="pl-activity-codes"
          defaultValue={m.mapping.libraryCode}
          placeholder="Code…"
          onBlur={(e) => {
            const code = e.target.value.trim().split(" ")[0];
            if (code !== m.mapping.libraryCode) patch(t, { libraryCode: code, crews: [] });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {m.basis ? <small className="pl-sub">{m.basis.description}{m.via === "rule" ? " · rule" : ""}</small> : null}
      </td>
      <td>
        {m.basis ? <button type="button" className="pl-link" onClick={onEdit}>{m.mapping.crews.length ? m.mapping.crews.join(", ") : "All crews"}</button> : <span className="xer-dim">—</span>}
      </td>
      <td className="pl-num">
        <input
          key={`${t.id}:q:${m.mapping.quantity}`}
          className="pl-cell-input pl-num-input"
          inputMode="decimal"
          defaultValue={own && m.mapping.quantity !== null ? String(m.mapping.quantity) : ""}
          placeholder={m.quantity !== null ? formatNum(m.quantity, 1) : "—"}
          title={m.quantitySource}
          disabled={!m.mapping.libraryCode}
          onBlur={(e) => {
            const v = num(e.target.value);
            if (v !== m.mapping.quantity) patch(t, { quantity: v });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td>{m.basis?.uom || ""}</td>
      <td className="pl-num">
        <input
          key={`${t.id}:p:${m.mapping.productionOverride}`}
          className="pl-cell-input pl-num-input"
          inputMode="decimal"
          defaultValue={m.mapping.productionOverride !== null ? String(m.mapping.productionOverride) : ""}
          placeholder={m.basis?.dailyProduction ? formatNum(m.basis.dailyProduction, 2) : "—"}
          title={m.basis?.governing ? `Library: ${m.basis.governing}` : ""}
          disabled={!m.mapping.libraryCode}
          onBlur={(e) => {
            const v = num(e.target.value);
            if (v !== m.mapping.productionOverride) patch(t, { productionOverride: v });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="pl-num">
        <input
          key={`${t.id}:s:${m.mapping.currentSets}`}
          className="pl-cell-input pl-num-input pl-narrow"
          inputMode="decimal"
          defaultValue={m.mapping.currentSets !== null ? String(m.mapping.currentSets) : ""}
          placeholder={m.basis ? formatNum(m.currentSets, 0) : "—"}
          title={m.impliedSets !== null ? `The file's duration implies ${formatNum(m.impliedSets, 2)} sets` : ""}
          disabled={!m.mapping.libraryCode}
          onBlur={(e) => {
            const v = num(e.target.value);
            if (v !== m.mapping.currentSets) patch(t, { currentSets: v });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="pl-num">
        <input
          key={`${t.id}:x:${m.mapping.maxSets}`}
          className="pl-cell-input pl-num-input pl-narrow"
          inputMode="decimal"
          defaultValue={m.mapping.maxSets !== null ? String(m.mapping.maxSets) : ""}
          placeholder={m.basis ? formatNum(m.maxSets, 0) : "—"}
          disabled={!m.mapping.libraryCode}
          onBlur={(e) => {
            const v = num(e.target.value);
            if (v !== m.mapping.maxSets) patch(t, { maxSets: v });
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="pl-num">
        {rateBased === null ? <span className="xer-dim">—</span> : (
          <>
            {formatNum(rateBased, 1)}
            <small className={`pl-sub ${variance !== null && Math.abs(variance) > Math.max(1, t.rd * 0.2) ? "xer-tone-text-warn" : ""}`}>
              {variance === null ? "" : `${variance > 0 ? "+" : ""}${formatNum(variance, 1)} vs file`}
            </small>
          </>
        )}
      </td>
      <td className="pl-num">{m.basis ? formatNum(m.costPerDay, 0) : <span className="xer-dim">—</span>}</td>
      <td>
        <button type="button" className="xer-btn xer-btn-sm" onClick={onEdit}>
          Edit{m.mapping.libraryCode && m.issues.length ? <i>{m.issues.length}</i> : null}
        </button>
      </td>
    </tr>
  );
}

function MappingDrawer({
  P, t, m, index, onPatch, onClose, onOpenTask,
}: {
  P: ProjectView;
  t: Task;
  m: MappedActivity;
  index: LibraryIndex;
  onPatch: (values: Parameters<typeof setActivityMapping>[2]) => void;
  onClose: () => void;
  onOpenTask: (t: Task) => void;
}) {
  const suggestions = useMemo(() => suggestLibraryActivities(index, t, 6), [index, t]);
  const crews = m.mapping.libraryCode ? (index.labour.get(m.mapping.libraryCode) || []).map((r) => cellText(r.crew)) : [];
  return (
    <Drawer title={t.code} subtitle={t.name} onClose={onClose}>
      <div className="xer-drawer-actions">
        <button type="button" className="xer-btn xer-btn-sm" onClick={() => onOpenTask(t)}>Open activity details</button>
        <button type="button" className="xer-btn xer-btn-sm" onClick={() => onPatch({ libraryCode: "", crews: [], quantity: null, currentSets: null, maxSets: null, productionOverride: null, note: "" })}>
          Clear this mapping
        </button>
      </div>

      <SectionTitle>Suggested library activities</SectionTitle>
      {suggestions.length ? (
        <table className="xer-mini-table">
          <tbody>
            {suggestions.map((s) => (
              <tr key={s.code} className="xer-tr-click" onClick={() => onPatch({ libraryCode: s.code, crews: s.crews })}>
                <td className="xer-mono">{s.code}</td>
                <td>{s.description}{s.crews.length ? <small className="pl-sub">{s.crews.join(", ")}</small> : null}</td>
                <td className="xer-num">{s.score}</td>
                <td>{m.mapping.libraryCode === s.code ? <Badge tone="ok">mapped</Badge> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="xer-muted">No library activity shares words with this activity — type a code in the table.</p>
      )}

      {m.basis ? (
        <>
          <SectionTitle>Crews doing this work</SectionTitle>
          {crews.map((c) => (
            <label key={c} className="xer-check-field">
              <input
                type="checkbox"
                checked={m.mapping.crews.includes(c)}
                onChange={(e) => onPatch({ crews: e.target.checked ? [...m.mapping.crews, c] : m.mapping.crews.filter((x) => x !== c) })}
              />
              <span><b>{c}</b><small>{m.mapping.crews.length ? "" : "No crew selected — every crew of the code counts"}</small></span>
            </label>
          ))}
          <label className="xer-check-field">
            <input type="checkbox" checked={m.mapping.includeEquipment} onChange={(e) => onPatch({ includeEquipment: e.target.checked })} />
            <span><b>Include the activity&apos;s equipment set</b><small>Adds its machines to the set cost and lets equipment output govern.</small></span>
          </label>

          <SectionTitle>Resource set per working day</SectionTitle>
          <table className="xer-mini-table">
            <thead><tr><th>Resource</th><th className="xer-num">Output</th><th className="xer-num">Hours</th><th className="xer-num">Rate / h</th><th className="xer-num">Cost / day</th></tr></thead>
            <tbody>
              {m.basis.crews.map((c) => (
                <tr key={c.crew}>
                  <td>{c.crew}{m.basis!.governing === c.crew ? <Badge tone="warn">governs</Badge> : null}</td>
                  <td className="xer-num">{formatNum(c.dailyProduction, 2)} {c.uom}</td>
                  <td className="xer-num">{formatNum(c.crewHoursPerDay, 0)}</td>
                  <td className="xer-num">{formatNum(c.ratePerHour, 2)}</td>
                  <td className="xer-num">{formatNum(c.costPerDay, 0)}</td>
                </tr>
              ))}
              {m.basis.machines.map((x) => (
                <tr key={x.machineType}>
                  <td>{x.machineType} × {x.count}{m.basis!.governing === "Equipment set" ? <Badge tone="warn">set governs</Badge> : null}</td>
                  <td className="xer-num">{formatNum(m.basis!.equipmentProduction, 2)}</td>
                  <td className="xer-num" />
                  <td className="xer-num">{formatNum(x.ratePerHour, 2)}</td>
                  <td className="xer-num">{formatNum(x.costPerDay, 0)}</td>
                </tr>
              ))}
              <tr>
                <td><b>One set</b></td>
                <td className="xer-num"><b>{formatNum(m.production, 2)} {m.basis.uom}</b></td>
                <td /><td />
                <td className="xer-num"><b>{formatNum(m.costPerDay, 0)}</b></td>
              </tr>
            </tbody>
          </table>

          <SectionTitle>Productivity check</SectionTitle>
          <dl className="xer-kv">
            <div><dt>Remaining quantity</dt><dd>{m.quantity === null ? "Not available" : `${formatNum(m.quantity, 2)} ${m.basis.uom}`} · {m.quantitySource}</dd></div>
            <div><dt>File remaining duration</dt><dd>{formatNum(m.remainingDays, 1)} d on {t.calName}</dd></div>
            <div><dt>Sets implied by the file</dt><dd>{m.impliedSets === null ? "—" : formatNum(m.impliedSets, 2)}</dd></div>
            <div><dt>Current / max sets</dt><dd>{formatNum(m.currentSets, 2)} / {formatNum(m.maxSets, 2)}</dd></div>
            <div><dt>Rate-based remaining duration</dt><dd>{m.productivityDays === null ? "—" : `${formatNum(m.productivityDays, 1)} d (${m.varianceDays !== null && m.varianceDays > 0 ? "+" : ""}${formatNum(m.varianceDays, 1)} vs file)`}</dd></div>
          </dl>
          <label className="xer-field xer-field-block">
            <span>Note</span>
            <input key={`${t.id}:n:${m.mapping.note}`} className="xer-input" defaultValue={m.mapping.note} onBlur={(e) => e.target.value !== m.mapping.note && onPatch({ note: e.target.value })} />
          </label>
          {m.issues.length ? (
            <>
              <SectionTitle>Issues</SectionTitle>
              <ul className="xer-findings">{m.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </>
          ) : null}
        </>
      ) : null}

      <SectionTitle>P6 activity codes</SectionTitle>
      <div className="xer-tag-row">
        {t.codes.length ? t.codes.map((c) => <Badge key={`${c.type}-${c.code}`} tone="mut">{c.type}: {c.code}</Badge>) : <span className="xer-dim">None</span>}
      </div>
      <SectionTitle>XER resources</SectionTitle>
      <table className="xer-mini-table">
        <tbody>
          {t.rsrcs.map((r, i) => {
            const res = P.S.rsrcById[r.rsrc_id] || {};
            return (
              <tr key={`${r.rsrc_id}-${i}`}>
                <td>{res.rsrc_name || r.rsrc_id}</td>
                <td>{(res.rsrc_type || "").replace("RT_", "")}</td>
                <td className="xer-num">remaining {r.remain_qty}</td>
                <td className="xer-num">budget {r.target_qty}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Drawer>
  );
}
