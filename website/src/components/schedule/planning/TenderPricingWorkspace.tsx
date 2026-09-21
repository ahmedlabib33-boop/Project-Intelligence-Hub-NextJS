"use client";

/**
 * Tender Pricing editor — material/labor/equipment/concrete-mix reference
 * rates, commercial bid-build-up assumptions, and per-sector BOQs with a live
 * Bid Summary (Direct Cost → Grand Total). Every rate is editable; every
 * computed value (material cost/unit, direct unit rate, line amount, and the
 * whole bid build-up) recalculates immediately, the same way the source
 * workbook's formulas do — nothing computed is stored.
 */

import { useMemo, useRef, useState } from "react";
import {
  addBoqItem, addBoqSection, addEquipment, addLabor, addMaterial,
  computeBidSummary, computeBoqItem, deleteBoqRows, deleteEquipment, deleteLabor, deleteMaterials,
  exportTenderWorkbook, parseTenderPricingJson, readTenderWorkbookFile,
  RISK_LEVELS, SECTOR_LABEL, SECTORS,
  updateBidSummaryConfig, updateBoqRow, updateEquipment, updateLabor, updateMaterial, updateThresholds,
  type BoqRow, type RiskLevel, type Sector, type TenderPricing,
} from "../../../lib/planning/tenderPricing";
import { downloadBlob } from "./LibraryWorkspace";
import { Badge, Card, Kpi, Kpis, SectionTitle } from "../xer/ui";

const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

type SubTab = "materials" | "labor" | "equipment" | "mixes" | "thresholds" | "boq" | "summary";
const SUB_TABS: { k: SubTab; label: string }[] = [
  { k: "materials", label: "Materials" },
  { k: "labor", label: "Labor" },
  { k: "equipment", label: "Equipment" },
  { k: "mixes", label: "Concrete mixes" },
  { k: "thresholds", label: "Commercial assumptions" },
  { k: "boq", label: "BOQ" },
  { k: "summary", label: "Bid summary" },
];

function Num({ value, onChange, small }: { value: number; onChange: (v: number) => void; small?: boolean }) {
  return (
    <input
      type="number"
      className={`xer-input ${small ? "xer-input-sm" : ""}`}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
    />
  );
}
function Txt({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="text" className="xer-input" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export default function TenderPricingWorkspace({ data, onChange, onReset }: {
  data: TenderPricing; onChange: (next: TenderPricing) => void; onReset: () => void;
}) {
  const [sub, setSub] = useState<SubTab>("materials");
  const [sector, setSector] = useState<Sector>("buildings");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 5000); };

  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const importFile = async (file: File) => {
    try {
      const isJson = file.name.toLowerCase().endsWith(".json");
      const next = isJson ? parseTenderPricingJson(await file.text()) : await readTenderWorkbookFile(file);
      onChange(next);
      flash(`Imported ${file.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    }
  };

  const exportXlsx = async () => {
    const bytes = await exportTenderWorkbook(data);
    downloadBlob(`${data.name || "tender-pricing"}.xlsx`, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  const exportJson = () => downloadBlob(`${data.name || "tender-pricing"}.json`, JSON.stringify(data, null, 2), "application/json");

  const materialOptions = useMemo(() => data.materials.map((m) => m.code).filter(Boolean), [data.materials]);

  return (
    <div className="xer-view pl-create">
      <Card
        eyebrow="Tender Pricing"
        title="Material, labor, equipment rates and per-sector BOQ pricing build-up"
        aside={<Badge tone="info">{data.materials.length} materials · {data.labor.length} labor · {data.equipment.length} equipment</Badge>}
      >
        <div className="pl-actions">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.json" className="xer-hidden-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => fileRef.current?.click()}>Import .xlsx / .json</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={() => void exportXlsx()}>Export Excel</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={exportJson}>Export JSON</button>
          <button type="button" className="xer-btn xer-btn-sm" onClick={onReset}>Reset to shipped workbook</button>
        </div>
        {notice ? <p className="xer-dim">{notice}</p> : null}
        {error ? <p className="xer-error">{error}</p> : null}
      </Card>

      <nav className="schedule-intelligence-tabs xer-tabs">
        {SUB_TABS.map((t) => (
          <button key={t.k} type="button" className={sub === t.k ? "active" : ""} onClick={() => { setSub(t.k); setSelected(new Set()); }}>
            {t.label}
          </button>
        ))}
      </nav>

      {sub === "materials" ? (
        <Card eyebrow="Reference rates" title="Fixed material prices" aside={
          <div className="pl-actions">
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange(addMaterial(data))}>Add row</button>
            {selected.size ? <button type="button" className="xer-btn xer-btn-sm" onClick={() => { onChange(deleteMaterials(data, Array.from(selected))); setSelected(new Set()); }}>Delete {selected.size}</button> : null}
          </div>
        }>
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th /><th>Code</th><th>Category</th><th>Description</th><th>Unit</th><th>Avg price</th><th>Low</th><th>High</th><th>Confidence</th><th>Source</th></tr></thead>
              <tbody>
                {data.materials.map((m) => (
                  <tr key={m.id}>
                    <td><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelected(m.id)} /></td>
                    <td><Txt value={m.code} onChange={(v) => onChange(updateMaterial(data, m.id, { code: v }))} /></td>
                    <td><Txt value={m.category} onChange={(v) => onChange(updateMaterial(data, m.id, { category: v }))} /></td>
                    <td><Txt value={m.description} onChange={(v) => onChange(updateMaterial(data, m.id, { description: v }))} /></td>
                    <td><Txt value={m.unit} onChange={(v) => onChange(updateMaterial(data, m.id, { unit: v }))} /></td>
                    <td><Num small value={m.avgPrice} onChange={(v) => onChange(updateMaterial(data, m.id, { avgPrice: v }))} /></td>
                    <td><Num small value={m.low} onChange={(v) => onChange(updateMaterial(data, m.id, { low: v }))} /></td>
                    <td><Num small value={m.high} onChange={(v) => onChange(updateMaterial(data, m.id, { high: v }))} /></td>
                    <td><Txt value={m.confidence} onChange={(v) => onChange(updateMaterial(data, m.id, { confidence: v }))} /></td>
                    <td><Txt value={m.source} onChange={(v) => onChange(updateMaterial(data, m.id, { source: v }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {sub === "labor" ? (
        <Card eyebrow="Reference rates" title="Labor daily wage rates" aside={
          <div className="pl-actions">
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange(addLabor(data))}>Add row</button>
            {selected.size ? <button type="button" className="xer-btn xer-btn-sm" onClick={() => { onChange(deleteLabor(data, Array.from(selected))); setSelected(new Set()); }}>Delete {selected.size}</button> : null}
          </div>
        }>
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th /><th>Code</th><th>Trade</th><th>Unit</th><th>Low</th><th>High</th><th>Avg</th><th>Source</th></tr></thead>
              <tbody>
                {data.labor.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                    <td><Txt value={r.code} onChange={(v) => onChange(updateLabor(data, r.id, { code: v }))} /></td>
                    <td><Txt value={r.trade} onChange={(v) => onChange(updateLabor(data, r.id, { trade: v }))} /></td>
                    <td><Txt value={r.unit} onChange={(v) => onChange(updateLabor(data, r.id, { unit: v }))} /></td>
                    <td><Num small value={r.low} onChange={(v) => onChange(updateLabor(data, r.id, { low: v }))} /></td>
                    <td><Num small value={r.high} onChange={(v) => onChange(updateLabor(data, r.id, { high: v }))} /></td>
                    <td><Num small value={r.avg} onChange={(v) => onChange(updateLabor(data, r.id, { avg: v }))} /></td>
                    <td><Txt value={r.source} onChange={(v) => onChange(updateLabor(data, r.id, { source: v }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {sub === "equipment" ? (
        <Card eyebrow="Reference rates" title="Equipment & plant rental rates" aside={
          <div className="pl-actions">
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange(addEquipment(data))}>Add row</button>
            {selected.size ? <button type="button" className="xer-btn xer-btn-sm" onClick={() => { onChange(deleteEquipment(data, Array.from(selected))); setSelected(new Set()); }}>Delete {selected.size}</button> : null}
          </div>
        }>
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th /><th>Code</th><th>Equipment</th><th>Unit</th><th>Low</th><th>High</th><th>Avg</th><th>Source</th></tr></thead>
              <tbody>
                {data.equipment.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                    <td><Txt value={r.code} onChange={(v) => onChange(updateEquipment(data, r.id, { code: v }))} /></td>
                    <td><Txt value={r.name} onChange={(v) => onChange(updateEquipment(data, r.id, { name: v }))} /></td>
                    <td><Txt value={r.unit} onChange={(v) => onChange(updateEquipment(data, r.id, { unit: v }))} /></td>
                    <td><Num small value={r.low} onChange={(v) => onChange(updateEquipment(data, r.id, { low: v }))} /></td>
                    <td><Num small value={r.high} onChange={(v) => onChange(updateEquipment(data, r.id, { high: v }))} /></td>
                    <td><Num small value={r.avg} onChange={(v) => onChange(updateEquipment(data, r.id, { avg: v }))} /></td>
                    <td><Txt value={r.source} onChange={(v) => onChange(updateEquipment(data, r.id, { source: v }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {sub === "mixes" ? (
        <Card eyebrow="Reference rates" title="Concrete mix design cost calculator">
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th>Grade</th><th>Description</th><th>Cement kg/m3</th><th>Total cost/m3</th></tr></thead>
              <tbody>
                {data.concreteMixes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.grade}</td><td>{r.description}</td><td>{money(r.cementKgM3)}</td><td>{money(r.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xer-dim">Mirrors the reference mix costs already carried as CONC-* codes in Materials — edit those directly to change BOQ pricing.</p>
        </Card>
      ) : null}

      {sub === "thresholds" ? (
        <>
          <Card eyebrow="Commercial assumptions" title="Overheads, contingency & profit">
            <div className="pl-form-row">
              <label>Site overhead % <Num small value={data.thresholds.siteOverheadPct} onChange={(v) => onChange(updateThresholds(data, { siteOverheadPct: v }))} /></label>
              <label>Head office overhead % <Num small value={data.thresholds.headOfficeOverheadPct} onChange={(v) => onChange(updateThresholds(data, { headOfficeOverheadPct: v }))} /></label>
            </div>
            <SectionTitle>Risk-based contingency</SectionTitle>
            <div className="xer-table-wrap">
              <table className="xer-table">
                <thead><tr><th>Risk level</th><th>Contingency %</th><th>Basis</th></tr></thead>
                <tbody>
                  {data.thresholds.contingency.map((c) => (
                    <tr key={c.id}>
                      <td>{c.riskLevel}</td>
                      <td><Num small value={c.pct} onChange={(v) => onChange(updateThresholds(data, {
                        contingency: data.thresholds.contingency.map((x) => (x.id === c.id ? { ...x, pct: v } : x)),
                      }))} /></td>
                      <td className="xer-dim">{c.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SectionTitle>Profit margin thresholds by sector</SectionTitle>
            <div className="xer-table-wrap">
              <table className="xer-table">
                <thead><tr><th>Sector</th><th>Min</th><th>Target</th><th>Max</th></tr></thead>
                <tbody>
                  {data.thresholds.profitMargins.map((m) => (
                    <tr key={m.id}>
                      <td>{SECTOR_LABEL[m.sector as Sector] || m.sector}</td>
                      <td><Num small value={m.min} onChange={(v) => onChange(updateThresholds(data, { profitMargins: data.thresholds.profitMargins.map((x) => (x.id === m.id ? { ...x, min: v } : x)) }))} /></td>
                      <td><Num small value={m.target} onChange={(v) => onChange(updateThresholds(data, { profitMargins: data.thresholds.profitMargins.map((x) => (x.id === m.id ? { ...x, target: v } : x)) }))} /></td>
                      <td><Num small value={m.max} onChange={(v) => onChange(updateThresholds(data, { profitMargins: data.thresholds.profitMargins.map((x) => (x.id === m.id ? { ...x, max: v } : x)) }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card eyebrow="Commercial assumptions" title="Escalation, bonds, insurance, taxes, financing">
            <div className="pl-form-row">
              <label>Escalation allowance % <Num small value={data.thresholds.escalation.allowancePct} onChange={(v) => onChange(updateThresholds(data, { escalation: { ...data.thresholds.escalation, allowancePct: v } }))} /></label>
              <label>VAT % <Num small value={data.thresholds.taxes.vatPct} onChange={(v) => onChange(updateThresholds(data, { taxes: { ...data.thresholds.taxes, vatPct: v } }))} /></label>
              <label>Financing allowance % <Num small value={data.thresholds.financing.financingAllowancePct} onChange={(v) => onChange(updateThresholds(data, { financing: { ...data.thresholds.financing, financingAllowancePct: v } }))} /></label>
            </div>
            <p className="xer-dim">Bonds ({pct(data.thresholds.bonds.bidBondPct)} bid bond, {pct(data.thresholds.bonds.performanceBondPct)} performance bond, {pct(data.thresholds.bonds.retentionPct)} retention) and insurance ({pct(data.thresholds.insurance.carPct)} CAR, {pct(data.thresholds.insurance.tplPct)} TPL) feed the Bid Summary via each sector&apos;s own editable &ldquo;Bonds &amp; Insurance %&rdquo; line — adjust that per sector in Bid Summary.</p>
          </Card>
        </>
      ) : null}

      {sub === "boq" ? (
        <Card eyebrow="Bill of Quantities" title={`BOQ — ${SECTOR_LABEL[sector]}`} aside={
          <div className="pl-actions">
            {SECTORS.map((s) => (
              <button key={s} type="button" className={`xer-btn xer-btn-sm ${sector === s ? "active" : ""}`} onClick={() => { setSector(s); setSelected(new Set()); }}>{SECTOR_LABEL[s]}</button>
            ))}
          </div>
        }>
          <div className="pl-actions">
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => onChange(addBoqItem(data, sector))}>Add item</button>
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => { const label = window.prompt("Section heading"); if (label) onChange(addBoqSection(data, sector, label)); }}>Add section</button>
            {selected.size ? <button type="button" className="xer-btn xer-btn-sm" onClick={() => { onChange(deleteBoqRows(data, sector, Array.from(selected))); setSelected(new Set()); }}>Delete {selected.size}</button> : null}
          </div>
          <div className="xer-table-wrap">
            <table className="xer-table">
              <thead><tr><th /><th>Item</th><th>Description</th><th>Unit</th><th>Qty</th><th>Material code</th><th>Wastage %</th><th>Labor $/u</th><th>Equip $/u</th><th>Subc $/u</th><th>Material $/u</th><th>Direct rate</th><th>Amount</th></tr></thead>
              <tbody>
                {data.boq[sector].map((r: BoqRow) => {
                  if (r.kind === "section") {
                    return <tr key={r.id} className="xer-section-row"><td /><td colSpan={12}><strong>{r.label}</strong></td></tr>;
                  }
                  const computed = computeBoqItem(data, r);
                  return (
                    <tr key={r.id} className={computed.materialFound ? "" : "xer-row-warn"}>
                      <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelected(r.id)} /></td>
                      <td>{r.item ?? "—"}</td>
                      <td><Txt value={r.description} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { description: v }))} /></td>
                      <td><Txt value={r.unit} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { unit: v }))} /></td>
                      <td><Num small value={r.quantity} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { quantity: v }))} /></td>
                      <td>
                        <input list="tender-material-codes" className="xer-input xer-input-sm" value={r.materialCode}
                          onChange={(e) => onChange(updateBoqRow(data, sector, r.id, { materialCode: e.target.value }))} />
                      </td>
                      <td><Num small value={r.wastagePctOverride ?? 0} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { wastagePctOverride: v }))} /></td>
                      <td><Num small value={r.laborCostPerUnit} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { laborCostPerUnit: v }))} /></td>
                      <td><Num small value={r.equipmentCostPerUnit} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { equipmentCostPerUnit: v }))} /></td>
                      <td><Num small value={r.subcontractorRatePerUnit} onChange={(v) => onChange(updateBoqRow(data, sector, r.id, { subcontractorRatePerUnit: v }))} /></td>
                      <td className="xer-dim">{money(computed.materialCostPerUnit)}</td>
                      <td className="xer-dim">{money(computed.directUnitRate)}</td>
                      <td><strong>{money(computed.amount)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="tender-material-codes">
              {materialOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <Kpis>
            <Kpi label="Direct cost" value={money(data.boq[sector].filter((r) => r.kind === "item").reduce((s, r) => s + (r.kind === "item" ? computeBoqItem(data, r).amount : 0), 0))} note={`${SECTOR_LABEL[sector]} BOQ total`} />
          </Kpis>
        </Card>
      ) : null}

      {sub === "summary" ? (
        <div className="pl-summary-grid">
          {SECTORS.map((s) => {
            const cfg = data.bidSummary[s];
            const r = computeBidSummary(data, s);
            return (
              <Card key={s} eyebrow="Bid summary" title={SECTOR_LABEL[s]} aside={<Badge tone={r.marginCheck === "BELOW MINIMUM" ? "crit" : r.marginCheck === "ABOVE MAXIMUM — REVIEW" ? "warn" : "ok"}>{r.marginCheck}</Badge>}>
                <div className="pl-form-row">
                  <label className="pl-checkbox"><input type="checkbox" checked={cfg.included} onChange={(e) => onChange(updateBidSummaryConfig(data, s, { included: e.target.checked }))} /> Include this scope</label>
                  <label>Risk level
                    <select className="xer-select" value={cfg.riskLevel} onChange={(e) => onChange(updateBidSummaryConfig(data, s, { riskLevel: e.target.value as RiskLevel }))}>
                      {RISK_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                    </select>
                  </label>
                  <label>Profit margin % override
                    <Num small value={cfg.profitMarginPct ?? r.profitMarginPct} onChange={(v) => onChange(updateBidSummaryConfig(data, s, { profitMarginPct: v }))} />
                  </label>
                  <label>Bonds & insurance %
                    <Num small value={cfg.bondsInsurancePct} onChange={(v) => onChange(updateBidSummaryConfig(data, s, { bondsInsurancePct: v }))} />
                  </label>
                  <label>Reference quantity
                    <Num small value={cfg.referenceQuantity} onChange={(v) => onChange(updateBidSummaryConfig(data, s, { referenceQuantity: v }))} />
                  </label>
                </div>
                <div className="xer-table-wrap">
                  <table className="xer-table">
                    <tbody>
                      <tr><td>Direct cost</td><td>{money(r.directCost)}</td></tr>
                      <tr><td>Site overhead ({pct(r.siteOverheadPct)})</td><td>{money(r.siteOverheadAmount)}</td></tr>
                      <tr><td>Head office overhead ({pct(r.headOfficeOverheadPct)})</td><td>{money(r.headOfficeOverheadAmount)}</td></tr>
                      <tr><td><strong>Subtotal after overheads</strong></td><td><strong>{money(r.subtotalAfterOverheads)}</strong></td></tr>
                      <tr><td>Contingency ({pct(r.contingencyPct)})</td><td>{money(r.contingencyAmount)}</td></tr>
                      <tr><td>Escalation ({pct(r.escalationPct)})</td><td>{money(r.escalationAmount)}</td></tr>
                      <tr><td><strong>Subtotal before profit</strong></td><td><strong>{money(r.subtotalBeforeProfit)}</strong></td></tr>
                      <tr><td>Profit ({pct(r.profitMarginPct)})</td><td>{money(r.profitAmount)}</td></tr>
                      <tr><td><strong>Net bid price</strong></td><td><strong>{money(r.netBidPrice)}</strong></td></tr>
                      <tr><td>Bonds & insurance ({pct(r.bondsInsurancePct)})</td><td>{money(r.bondsInsuranceAmount)}</td></tr>
                      <tr><td>Financing ({pct(r.financingPct)})</td><td>{money(r.financingAmount)}</td></tr>
                      <tr><td>Price before VAT</td><td>{money(r.priceBeforeVat)}</td></tr>
                      <tr><td>VAT ({pct(r.vatPct)})</td><td>{money(r.vatAmount)}</td></tr>
                      <tr className="xer-row-total"><td><strong>GRAND TOTAL BID PRICE (EGP)</strong></td><td><strong>{money(r.grandTotal)}</strong></td></tr>
                      {r.bidPricePerUnit !== null ? <tr><td>Bid price per unit</td><td>{money(r.bidPricePerUnit)}</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
          <Card eyebrow="Bid summary" title="Combined total (included scopes)">
            <Kpi label="Combined grand total" value={money(SECTORS.reduce((sum, s) => sum + (data.bidSummary[s].included ? computeBidSummary(data, s).grandTotal : 0), 0))} note="EGP" />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
