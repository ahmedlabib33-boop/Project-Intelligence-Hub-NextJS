/**
 * Tender Pricing module — a second, separate reference library alongside the
 * Planning Library (activities/crews/productivity). This one holds material,
 * labor and equipment rates, concrete mix costs, commercial bid-build-up
 * assumptions (overheads, contingency, escalation, profit, bonds, insurance,
 * financing, VAT) and per-sector Bills of Quantities, and computes a live
 * Bid Summary (Direct Cost → Grand Total) exactly matching the formula chain
 * in the source "Tender Bid Calculation & Pricing Workbook — Egypt".
 *
 * Every computed value (material cost/unit, direct unit rate, amount, and the
 * whole Bid Summary) is derived at read time from the raw editable tables —
 * nothing computed is stored, so editing a rate anywhere it's used recalculates
 * immediately everywhere, the same way the source spreadsheet's formulas do.
 */

import type { SheetData } from "./xlsx";
import { readXlsx, writeXlsx } from "./xlsx";

export type Id = string;
export const newId = (): Id => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ------------------------------------------------------------- raw tables */

export type MaterialRate = {
  id: Id; code: string; category: string; description: string; unit: string;
  avgPrice: number; low: number; high: number; confidence: string; source: string;
};

export type LaborRate = { id: Id; code: string; trade: string; unit: string; low: number; high: number; avg: number; source: string };
export type EquipmentRate = { id: Id; code: string; name: string; unit: string; low: number; high: number; avg: number; source: string };

export type ConcreteMix = {
  id: Id; grade: string; description: string;
  cementKgM3: number; sandM3M3: number; gravelM3M3: number;
  cementCost: number; sandCost: number; gravelCost: number;
  admixtureAllowance: number; batchingCost: number; totalCost: number;
};

export type RiskLevel = "Low" | "Medium" | "High" | "Very High";
export const RISK_LEVELS: RiskLevel[] = ["Low", "Medium", "High", "Very High"];

export type Sector = "buildings" | "roads" | "bridges" | "tunnels";
export const SECTORS: Sector[] = ["buildings", "roads", "bridges", "tunnels"];
export const SECTOR_LABEL: Record<Sector, string> = { buildings: "Buildings", roads: "Roads", bridges: "Bridges", tunnels: "Tunnels" };

export type Thresholds = {
  contingency: { id: Id; riskLevel: RiskLevel; pct: number; basis: string }[];
  siteOverheadPct: number;
  headOfficeOverheadPct: number;
  profitMargins: { id: Id; sector: Sector; min: number; target: number; max: number }[];
  escalation: { annualRatePct: number; durationMonths: number; allowancePct: number; note: string };
  bonds: { bidBondPct: number; performanceBondPct: number; advancePaymentPct: number; apgPct: number; retentionPct: number; bankGuaranteeCommissionPct: number };
  insurance: { carPct: number; tplPct: number; workmenCompPct: number };
  taxes: { vatPct: number; withholdingTaxPct: number; stampDutyPct: number };
  wastageDefaults: { id: Id; material: string; pct: number }[];
  financing: { costOfCapitalPct: number; paymentCycleDays: number; financingAllowancePct: number };
};

/** Bonds+Insurance and Financing summary rates feeding the Bid Summary, as their own editable line — matches the source dashboard's own summary rows rather than re-deriving from every Thresholds sub-item. */
export type BidSummaryConfig = {
  included: boolean;
  riskLevel: RiskLevel;
  profitMarginPct: number | null; // null = use the sector's Target margin from thresholds
  bondsInsurancePct: number;
  referenceQuantity: number;
};

export type BoqRow =
  | { id: Id; kind: "section"; label: string }
  | {
      id: Id; kind: "item"; item: number | null; description: string; unit: string; quantity: number;
      materialCode: string; wastagePctOverride: number | null;
      laborCostPerUnit: number; equipmentCostPerUnit: number; subcontractorRatePerUnit: number; notes: string;
    };

export type TenderPricing = {
  schema: "tender-pricing/1";
  name: string;
  source: string;
  updatedAt: string;
  materials: MaterialRate[];
  labor: LaborRate[];
  equipment: EquipmentRate[];
  concreteMixes: ConcreteMix[];
  thresholds: Thresholds;
  boq: Record<Sector, BoqRow[]>;
  bidSummary: Record<Sector, BidSummaryConfig>;
  audit: { at: string; action: string; detail: string }[];
};

/* --------------------------------------------------------------- empty */

function emptyThresholds(): Thresholds {
  return {
    contingency: [
      { id: newId(), riskLevel: "Low", pct: 0.03, basis: "Repetitive, well-defined scope, firm BOQ, familiar site" },
      { id: newId(), riskLevel: "Medium", pct: 0.06, basis: "Some design/ground uncertainty, moderate site risk" },
      { id: newId(), riskLevel: "High", pct: 0.10, basis: "Significant uncertainty, difficult ground/logistics" },
      { id: newId(), riskLevel: "Very High", pct: 0.15, basis: "Major unknowns, specialized/first-of-kind works" },
    ],
    siteOverheadPct: 0.10,
    headOfficeOverheadPct: 0.06,
    profitMargins: [
      { id: newId(), sector: "buildings", min: 0.06, target: 0.10, max: 0.15 },
      { id: newId(), sector: "roads", min: 0.05, target: 0.08, max: 0.12 },
      { id: newId(), sector: "bridges", min: 0.07, target: 0.12, max: 0.18 },
      { id: newId(), sector: "tunnels", min: 0.10, target: 0.15, max: 0.22 },
    ],
    escalation: { annualRatePct: 0.15, durationMonths: 12, allowancePct: 0.075, note: "Replace with the contract's own index-linked price-adjustment formula if one is stipulated." },
    bonds: { bidBondPct: 0.015, performanceBondPct: 0.05, advancePaymentPct: 0.15, apgPct: 0.15, retentionPct: 0.05, bankGuaranteeCommissionPct: 0.02 },
    insurance: { carPct: 0.004, tplPct: 0.0015, workmenCompPct: 0.015 },
    taxes: { vatPct: 0.14, withholdingTaxPct: 0.03, stampDutyPct: 0.005 },
    wastageDefaults: [],
    financing: { costOfCapitalPct: 0.22, paymentCycleDays: 60, financingAllowancePct: 0.0361643835616438 },
  };
}

export function emptyTenderPricing(name = "Tender pricing"): TenderPricing {
  const boq = {} as Record<Sector, BoqRow[]>;
  const bidSummary = {} as Record<Sector, BidSummaryConfig>;
  for (const s of SECTORS) {
    boq[s] = [];
    bidSummary[s] = { included: true, riskLevel: "Medium", profitMarginPct: null, bondsInsurancePct: 0.0095, referenceQuantity: 0 };
  }
  return {
    schema: "tender-pricing/1", name, source: "manual", updatedAt: new Date().toISOString(),
    materials: [], labor: [], equipment: [], concreteMixes: [], thresholds: emptyThresholds(), boq, bidSummary,
    audit: [],
  };
}

/* ------------------------------------------------------------- lookups */

export function materialByCode(tp: TenderPricing, code: string): MaterialRate | null {
  const needle = code.trim().toUpperCase();
  return tp.materials.find((m) => m.code.trim().toUpperCase() === needle) || null;
}

function auditPush(tp: TenderPricing, action: string, detail: string): TenderPricing {
  const audit = [{ at: new Date().toISOString(), action, detail }, ...tp.audit].slice(0, 500);
  return { ...tp, audit, updatedAt: new Date().toISOString() };
}

/* -------------------------------------------------------- live calculation */

export type ComputedBoqItem = {
  materialUnitPrice: number | null;
  wastagePct: number;
  materialCostPerUnit: number;
  directUnitRate: number;
  amount: number;
  materialFound: boolean;
};

export function computeBoqItem(tp: TenderPricing, row: Extract<BoqRow, { kind: "item" }>): ComputedBoqItem {
  const material = row.materialCode ? materialByCode(tp, row.materialCode) : null;
  const materialUnitPrice = material ? material.avgPrice : null;
  const wastagePct = row.wastagePctOverride ?? 0;
  const materialCostPerUnit = materialUnitPrice ? materialUnitPrice * (1 + wastagePct) : 0;
  const directUnitRate = materialCostPerUnit + row.laborCostPerUnit + row.equipmentCostPerUnit + row.subcontractorRatePerUnit;
  const amount = row.quantity * directUnitRate;
  return { materialUnitPrice, wastagePct, materialCostPerUnit, directUnitRate, amount, materialFound: !row.materialCode || !!material };
}

export function computeSectorDirectCost(tp: TenderPricing, sector: Sector): number {
  return tp.boq[sector]
    .filter((r): r is Extract<BoqRow, { kind: "item" }> => r.kind === "item")
    .reduce((sum, row) => sum + computeBoqItem(tp, row).amount, 0);
}

export type BidSummaryResult = {
  sector: Sector;
  included: boolean;
  directCost: number;
  siteOverheadPct: number; siteOverheadAmount: number;
  headOfficeOverheadPct: number; headOfficeOverheadAmount: number;
  subtotalAfterOverheads: number;
  riskLevel: RiskLevel; contingencyPct: number; contingencyAmount: number;
  escalationPct: number; escalationAmount: number;
  subtotalBeforeProfit: number;
  profitMarginPct: number; profitAmount: number;
  netBidPrice: number;
  bondsInsurancePct: number; bondsInsuranceAmount: number;
  financingPct: number; financingAmount: number;
  priceBeforeVat: number;
  vatPct: number; vatAmount: number;
  grandTotal: number;
  referenceQuantity: number; bidPricePerUnit: number | null;
  marginCheck: "BELOW MINIMUM" | "AT/ABOVE TARGET" | "ABOVE MAXIMUM — REVIEW" | "N/A";
};

export function computeBidSummary(tp: TenderPricing, sector: Sector): BidSummaryResult {
  const config = tp.bidSummary[sector];
  const t = tp.thresholds;
  const directCostRaw = config.included ? computeSectorDirectCost(tp, sector) : 0;

  const siteOverheadAmount = directCostRaw * t.siteOverheadPct;
  const headOfficeOverheadAmount = directCostRaw * t.headOfficeOverheadPct;
  const subtotalAfterOverheads = directCostRaw + siteOverheadAmount + headOfficeOverheadAmount;

  const contingencyPct = t.contingency.find((c) => c.riskLevel === config.riskLevel)?.pct ?? 0;
  const contingencyAmount = subtotalAfterOverheads * contingencyPct;
  const escalationAmount = subtotalAfterOverheads * t.escalation.allowancePct;
  const subtotalBeforeProfit = subtotalAfterOverheads + contingencyAmount + escalationAmount;

  const margin = t.profitMargins.find((m) => m.sector === sector);
  const profitMarginPct = config.profitMarginPct ?? margin?.target ?? 0;
  const profitAmount = subtotalBeforeProfit * profitMarginPct;
  const netBidPrice = subtotalBeforeProfit + profitAmount;

  const bondsInsuranceAmount = netBidPrice * config.bondsInsurancePct;
  const financingAmount = (netBidPrice + bondsInsuranceAmount) * t.financing.financingAllowancePct;
  const priceBeforeVat = netBidPrice + bondsInsuranceAmount + financingAmount;
  const vatAmount = priceBeforeVat * t.taxes.vatPct;
  const grandTotal = priceBeforeVat + vatAmount;

  const bidPricePerUnit = config.referenceQuantity > 0 ? grandTotal / config.referenceQuantity : null;
  const marginCheck: BidSummaryResult["marginCheck"] = !margin || !config.included
    ? "N/A"
    : profitMarginPct < margin.min ? "BELOW MINIMUM" : profitMarginPct > margin.max ? "ABOVE MAXIMUM — REVIEW" : "AT/ABOVE TARGET";

  return {
    sector, included: config.included, directCost: directCostRaw,
    siteOverheadPct: t.siteOverheadPct, siteOverheadAmount,
    headOfficeOverheadPct: t.headOfficeOverheadPct, headOfficeOverheadAmount,
    subtotalAfterOverheads,
    riskLevel: config.riskLevel, contingencyPct, contingencyAmount,
    escalationPct: t.escalation.allowancePct, escalationAmount,
    subtotalBeforeProfit,
    profitMarginPct, profitAmount,
    netBidPrice,
    bondsInsurancePct: config.bondsInsurancePct, bondsInsuranceAmount,
    financingPct: t.financing.financingAllowancePct, financingAmount,
    priceBeforeVat,
    vatPct: t.taxes.vatPct, vatAmount,
    grandTotal,
    referenceQuantity: config.referenceQuantity, bidPricePerUnit,
    marginCheck,
  };
}

export function computeCombinedTotal(tp: TenderPricing): number {
  return SECTORS.reduce((sum, s) => sum + (tp.bidSummary[s].included ? computeBidSummary(tp, s).grandTotal : 0), 0);
}

/* ---------------------------------------------------------------- CRUD */

export function updateMaterial(tp: TenderPricing, id: Id, patch: Partial<MaterialRate>): TenderPricing {
  return auditPush({ ...tp, materials: tp.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }, "edit_material", id);
}
export function addMaterial(tp: TenderPricing): TenderPricing {
  const row: MaterialRate = { id: newId(), code: "", category: "", description: "", unit: "", avgPrice: 0, low: 0, high: 0, confidence: "", source: "" };
  return auditPush({ ...tp, materials: [...tp.materials, row] }, "add_material", row.id);
}
export function deleteMaterials(tp: TenderPricing, ids: Id[]): TenderPricing {
  return auditPush({ ...tp, materials: tp.materials.filter((m) => !ids.includes(m.id)) }, "delete_material", ids.join(","));
}

export function updateLabor(tp: TenderPricing, id: Id, patch: Partial<LaborRate>): TenderPricing {
  return auditPush({ ...tp, labor: tp.labor.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, "edit_labor", id);
}
export function addLabor(tp: TenderPricing): TenderPricing {
  const row: LaborRate = { id: newId(), code: "", trade: "", unit: "day", low: 0, high: 0, avg: 0, source: "" };
  return auditPush({ ...tp, labor: [...tp.labor, row] }, "add_labor", row.id);
}
export function deleteLabor(tp: TenderPricing, ids: Id[]): TenderPricing {
  return auditPush({ ...tp, labor: tp.labor.filter((r) => !ids.includes(r.id)) }, "delete_labor", ids.join(","));
}

export function updateEquipment(tp: TenderPricing, id: Id, patch: Partial<EquipmentRate>): TenderPricing {
  return auditPush({ ...tp, equipment: tp.equipment.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, "edit_equipment", id);
}
export function addEquipment(tp: TenderPricing): TenderPricing {
  const row: EquipmentRate = { id: newId(), code: "", name: "", unit: "day", low: 0, high: 0, avg: 0, source: "" };
  return auditPush({ ...tp, equipment: [...tp.equipment, row] }, "add_equipment", row.id);
}
export function deleteEquipment(tp: TenderPricing, ids: Id[]): TenderPricing {
  return auditPush({ ...tp, equipment: tp.equipment.filter((r) => !ids.includes(r.id)) }, "delete_equipment", ids.join(","));
}

export function updateConcreteMix(tp: TenderPricing, id: Id, patch: Partial<ConcreteMix>): TenderPricing {
  return auditPush({ ...tp, concreteMixes: tp.concreteMixes.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, "edit_concrete_mix", id);
}

export function updateThresholds(tp: TenderPricing, patch: Partial<Thresholds>): TenderPricing {
  return auditPush({ ...tp, thresholds: { ...tp.thresholds, ...patch } }, "edit_thresholds", Object.keys(patch).join(","));
}

export function updateBidSummaryConfig(tp: TenderPricing, sector: Sector, patch: Partial<BidSummaryConfig>): TenderPricing {
  return auditPush(
    { ...tp, bidSummary: { ...tp.bidSummary, [sector]: { ...tp.bidSummary[sector], ...patch } } },
    "edit_bid_summary_config", sector,
  );
}

export function addBoqItem(tp: TenderPricing, sector: Sector): TenderPricing {
  const row: BoqRow = {
    id: newId(), kind: "item", item: null, description: "", unit: "", quantity: 0,
    materialCode: "", wastagePctOverride: null, laborCostPerUnit: 0, equipmentCostPerUnit: 0, subcontractorRatePerUnit: 0, notes: "",
  };
  return auditPush({ ...tp, boq: { ...tp.boq, [sector]: [...tp.boq[sector], row] } }, "add_boq_item", `${sector}:${row.id}`);
}
export function addBoqSection(tp: TenderPricing, sector: Sector, label: string): TenderPricing {
  const row: BoqRow = { id: newId(), kind: "section", label };
  return auditPush({ ...tp, boq: { ...tp.boq, [sector]: [...tp.boq[sector], row] } }, "add_boq_section", `${sector}:${label}`);
}
export function updateBoqRow(tp: TenderPricing, sector: Sector, id: Id, patch: Partial<BoqRow>): TenderPricing {
  return auditPush(
    { ...tp, boq: { ...tp.boq, [sector]: tp.boq[sector].map((r) => (r.id === id ? ({ ...r, ...patch } as BoqRow) : r)) } },
    "edit_boq_row", `${sector}:${id}`,
  );
}
export function deleteBoqRows(tp: TenderPricing, sector: Sector, ids: Id[]): TenderPricing {
  return auditPush(
    { ...tp, boq: { ...tp.boq, [sector]: tp.boq[sector].filter((r) => !ids.includes(r.id)) } },
    "delete_boq_rows", `${sector}:${ids.join(",")}`,
  );
}

/* --------------------------------------------------------------- import */

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number.parseFloat(v.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; }
  return 0;
}
function str(v: unknown): string { return v === null || v === undefined ? "" : String(v).trim(); }
function findSheet(sheets: SheetData[], name: string): SheetData | null {
  const needle = name.trim().toLowerCase();
  return sheets.find((s) => s.name.trim().toLowerCase() === needle) || null;
}
function headerRowIndex(sheet: SheetData, firstColumnHeader: string): number {
  const needle = firstColumnHeader.trim().toLowerCase();
  return sheet.rows.findIndex((r) => str(r[0]).toLowerCase() === needle);
}

const BOQ_SHEET_NAME: Record<Sector, string> = {
  buildings: "BOQ - Buildings", roads: "BOQ - Roads", bridges: "BOQ - Bridges", tunnels: "BOQ - Tunnels",
};

export function importTenderWorkbook(sheets: SheetData[], source: string): TenderPricing {
  const tp = emptyTenderPricing(source);

  const materialsSheet = findSheet(sheets, "Fixed Material Prices");
  if (materialsSheet) {
    const start = headerRowIndex(materialsSheet, "Code") + 1;
    for (const row of materialsSheet.rows.slice(start)) {
      if (!str(row[0])) continue;
      tp.materials.push({
        id: newId(), code: str(row[0]), category: str(row[1]), description: str(row[2]), unit: str(row[3]),
        avgPrice: num(row[4]), low: num(row[5]), high: num(row[6]), confidence: str(row[7]), source: str(row[8]),
      });
    }
  }

  const laborSheet = findSheet(sheets, "Labor & Equipment Rates");
  if (laborSheet) {
    const laborStart = headerRowIndex(laborSheet, "Code") + 1;
    const equipHeaderFrom = laborSheet.rows.findIndex((r, i) => i > 3 && str(r[0]).toUpperCase().includes("EQUIPMENT"));
    const equipStart = equipHeaderFrom >= 0 ? equipHeaderFrom + 2 : laborSheet.rows.length;
    for (let i = laborStart; i < equipStart; i++) {
      const row = laborSheet.rows[i];
      if (!row || !str(row[0]) || str(row[0]).toUpperCase().includes("EQUIPMENT")) continue;
      tp.labor.push({ id: newId(), code: str(row[0]), trade: str(row[1]), unit: str(row[2]), low: num(row[3]), high: num(row[4]), avg: num(row[5]), source: str(row[6]) });
    }
    for (let i = equipStart; i < laborSheet.rows.length; i++) {
      const row = laborSheet.rows[i];
      if (!row || !str(row[0])) continue;
      tp.equipment.push({ id: newId(), code: str(row[0]), name: str(row[1]), unit: str(row[2]), low: num(row[3]), high: num(row[4]), avg: num(row[5]), source: str(row[6]) });
    }
  }

  const mixSheet = findSheet(sheets, "Concrete Mix Calculator");
  if (mixSheet) {
    const start = headerRowIndex(mixSheet, "Grade") + 1;
    for (const row of mixSheet.rows.slice(start)) {
      if (!str(row[0])) continue;
      tp.concreteMixes.push({
        id: newId(), grade: str(row[0]), description: str(row[1]),
        cementKgM3: num(row[2]), sandM3M3: num(row[3]), gravelM3M3: num(row[4]),
        cementCost: num(row[5]), sandCost: num(row[6]), gravelCost: num(row[7]),
        admixtureAllowance: num(row[8]), batchingCost: num(row[9]), totalCost: num(row[10]),
      });
    }
  }

  for (const sector of SECTORS) {
    const sheet = findSheet(sheets, BOQ_SHEET_NAME[sector]);
    if (!sheet) continue;
    const start = headerRowIndex(sheet, "Item") + 1;
    const rows: BoqRow[] = [];
    for (const row of sheet.rows.slice(start)) {
      const first = str(row[0]);
      if (!first) continue;
      if (first.toUpperCase().startsWith("SUBTOTAL") || first.toUpperCase().startsWith("TOTAL")) continue;
      const itemNo = typeof row[0] === "number" ? row[0] : null;
      if (itemNo === null) {
        rows.push({ id: newId(), kind: "section", label: first });
        continue;
      }
      rows.push({
        id: newId(), kind: "item", item: itemNo, description: str(row[1]), unit: str(row[2]), quantity: num(row[3]),
        materialCode: str(row[4]), wastagePctOverride: row[6] !== null && row[6] !== undefined ? num(row[6]) : null,
        laborCostPerUnit: num(row[8]), equipmentCostPerUnit: num(row[9]), subcontractorRatePerUnit: num(row[10]), notes: str(row[13]),
      });
    }
    tp.boq[sector] = rows;
  }

  return auditPush(tp, "import_workbook", source);
}

/* ------------------------------------------------------------ JSON I/O */

export function parseTenderPricingJson(text: string): TenderPricing {
  const parsed = JSON.parse(text) as Partial<TenderPricing>;
  const empty = emptyTenderPricing(parsed.name || "Tender pricing");
  return {
    ...empty, ...parsed,
    thresholds: { ...empty.thresholds, ...(parsed.thresholds || {}) },
    boq: { ...empty.boq, ...(parsed.boq || {}) },
    bidSummary: { ...empty.bidSummary, ...(parsed.bidSummary || {}) },
  };
}

export async function readTenderWorkbookFile(file: File): Promise<TenderPricing> {
  const sheets = await readXlsx(await file.arrayBuffer());
  return importTenderWorkbook(sheets, file.name);
}

export function tenderPricingToSheets(tp: TenderPricing): SheetData[] {
  const sheets: SheetData[] = [];
  sheets.push({
    name: "Fixed Material Prices",
    rows: [["Code", "Category", "Material Description", "Unit", "Avg Price (EGP)", "Low", "High", "Confidence", "Source / Notes"],
      ...tp.materials.map((m) => [m.code, m.category, m.description, m.unit, m.avgPrice, m.low, m.high, m.confidence, m.source])],
  });
  sheets.push({
    name: "Labor Rates",
    rows: [["Code", "Trade", "Unit", "Low", "High", "Avg", "Source"], ...tp.labor.map((r) => [r.code, r.trade, r.unit, r.low, r.high, r.avg, r.source])],
  });
  sheets.push({
    name: "Equipment Rates",
    rows: [["Code", "Equipment", "Unit", "Low", "High", "Avg", "Source"], ...tp.equipment.map((r) => [r.code, r.name, r.unit, r.low, r.high, r.avg, r.source])],
  });
  for (const sector of SECTORS) {
    sheets.push({
      name: `BOQ - ${SECTOR_LABEL[sector]}`,
      rows: [
        ["Item", "Description", "Unit", "Quantity", "Material Code", "Wastage % Override", "Labor $/Unit", "Equipment $/Unit", "Subcontractor $/Unit", "Notes"],
        ...tp.boq[sector].map((r) => (r.kind === "section" ? [r.label] : [r.item, r.description, r.unit, r.quantity, r.materialCode, r.wastagePctOverride, r.laborCostPerUnit, r.equipmentCostPerUnit, r.subcontractorRatePerUnit, r.notes])),
      ],
    });
  }
  return sheets;
}

export async function exportTenderWorkbook(tp: TenderPricing): Promise<Uint8Array> {
  return writeXlsx(tenderPricingToSheets(tp));
}
