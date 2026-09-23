#!/usr/bin/env python3
"""One-off converter: real Tender Bid Calculation & Pricing Workbook (Egypt) ->
website/public/data/tender-pricing.json, matching the TenderPricing TS schema
in src/lib/planning/tenderPricing.ts exactly. Not part of the running app;
re-run only if the source workbook's reference rates are updated.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import openpyxl

SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "Tender Bid Calculation & Pricing Workbook - Egypt.xlsx"
OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "tender-pricing.json"

SECTOR_SHEET = {"buildings": "BOQ - Buildings", "roads": "BOQ - Roads", "bridges": "BOQ - Bridges", "tunnels": "BOQ - Tunnels"}
SECTOR_LABEL = {"buildings": "Buildings", "roads": "Roads", "bridges": "Bridges", "tunnels": "Tunnels"}


def new_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"seed-{counter[0]:04d}"


def cell(row, i):
    return row[i] if i < len(row) else None


def s(v) -> str:
    return "" if v is None else str(v).strip()


def n(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    wb = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    ids = [0]

    def rows_of(sheet_name, min_row=1):
        ws = wb[sheet_name]
        return list(ws.iter_rows(min_row=min_row, values_only=True))

    materials = []
    for r in rows_of("Fixed Material Prices", min_row=5):
        if not s(cell(r, 0)):
            continue
        materials.append({
            "id": new_id(ids), "code": s(cell(r, 0)), "category": s(cell(r, 1)), "description": s(cell(r, 2)),
            "unit": s(cell(r, 3)), "avgPrice": n(cell(r, 4)), "low": n(cell(r, 5)), "high": n(cell(r, 6)),
            "confidence": s(cell(r, 7)), "source": s(cell(r, 8)),
        })

    labor, equipment = [], []
    le_rows = rows_of("Labor & Equipment Rates")
    equip_header_at = next((i for i, r in enumerate(le_rows) if i > 3 and "EQUIPMENT" in s(cell(r, 0)).upper()), len(le_rows))
    for r in le_rows[5:equip_header_at]:
        if not s(cell(r, 0)) or "EQUIPMENT" in s(cell(r, 0)).upper() or s(cell(r, 0)) == "Code":
            continue
        labor.append({
            "id": new_id(ids), "code": s(cell(r, 0)), "trade": s(cell(r, 1)), "unit": s(cell(r, 2)),
            "low": n(cell(r, 3)), "high": n(cell(r, 4)), "avg": n(cell(r, 5)), "source": s(cell(r, 6)),
        })
    for r in le_rows[equip_header_at + 2:]:
        if not s(cell(r, 0)):
            continue
        equipment.append({
            "id": new_id(ids), "code": s(cell(r, 0)), "name": s(cell(r, 1)), "unit": s(cell(r, 2)),
            "low": n(cell(r, 3)), "high": n(cell(r, 4)), "avg": n(cell(r, 5)), "source": s(cell(r, 6)),
        })

    concrete_mixes = []
    for r in rows_of("Concrete Mix Calculator", min_row=5):
        if not s(cell(r, 0)):
            continue
        concrete_mixes.append({
            "id": new_id(ids), "grade": s(cell(r, 0)), "description": s(cell(r, 1)),
            "cementKgM3": n(cell(r, 2)), "sandM3M3": n(cell(r, 3)), "gravelM3M3": n(cell(r, 4)),
            "cementCost": n(cell(r, 5)), "sandCost": n(cell(r, 6)), "gravelCost": n(cell(r, 7)),
            "admixtureAllowance": n(cell(r, 8)), "batchingCost": n(cell(r, 9)), "totalCost": n(cell(r, 10)),
        })

    th_rows = rows_of("Thresholds & Assumptions")

    def find(label_prefix: str) -> int:
        return next(i for i, r in enumerate(th_rows) if s(cell(r, 0)).upper().startswith(label_prefix.upper()))

    contingency = []
    ci = find("1. RISK-BASED")
    for r in th_rows[ci + 2:ci + 6]:
        contingency.append({"id": new_id(ids), "riskLevel": s(cell(r, 0)), "pct": n(cell(r, 1)), "basis": s(cell(r, 3))})

    oi = find("2. OVERHEAD")
    site_oh = n(cell(th_rows[oi + 2], 1))
    ho_oh = n(cell(th_rows[oi + 3], 1))

    profit_margins = []
    pi = find("3. PROFIT")
    for r in th_rows[pi + 2:pi + 6]:
        sector_name = s(cell(r, 0)).lower()
        profit_margins.append({"id": new_id(ids), "sector": sector_name, "min": n(cell(r, 1)), "target": n(cell(r, 2)), "max": n(cell(r, 3))})

    ei = find("4. PRICE ESCALATION")
    escalation = {
        "annualRatePct": n(cell(th_rows[ei + 2], 1)),
        "durationMonths": n(cell(th_rows[ei + 3], 1)),
        "allowancePct": n(cell(th_rows[ei + 4], 1)),
        "note": s(cell(th_rows[ei + 4], 2)),
    }

    bi = find("5. BONDS")
    bonds = {
        "bidBondPct": n(cell(th_rows[bi + 2], 1)), "performanceBondPct": n(cell(th_rows[bi + 3], 1)),
        "advancePaymentPct": n(cell(th_rows[bi + 4], 1)), "apgPct": n(cell(th_rows[bi + 5], 1)),
        "retentionPct": n(cell(th_rows[bi + 6], 1)), "bankGuaranteeCommissionPct": n(cell(th_rows[bi + 7], 1)),
    }

    ii = find("6. INSURANCE")
    insurance = {
        "carPct": n(cell(th_rows[ii + 2], 1)), "tplPct": n(cell(th_rows[ii + 3], 1)), "workmenCompPct": n(cell(th_rows[ii + 4], 1)),
    }

    ti = find("7. TAXES")
    taxes = {
        "vatPct": n(cell(th_rows[ti + 2], 1)), "withholdingTaxPct": n(cell(th_rows[ti + 3], 1)), "stampDutyPct": n(cell(th_rows[ti + 4], 1)),
    }

    wi = find("8. MATERIAL WASTAGE")
    wastage_defaults = []
    for r in th_rows[wi + 2:]:
        if not s(cell(r, 0)) or s(cell(r, 0)).startswith("9."):
            break
        wastage_defaults.append({"id": new_id(ids), "material": s(cell(r, 0)), "pct": n(cell(r, 1))})

    fi = find("9. FINANCING")
    financing = {
        "costOfCapitalPct": n(cell(th_rows[fi + 2], 1)), "paymentCycleDays": n(cell(th_rows[fi + 3], 1)),
        "financingAllowancePct": n(cell(th_rows[fi + 4], 1)),
    }

    thresholds = {
        "contingency": contingency, "siteOverheadPct": site_oh, "headOfficeOverheadPct": ho_oh,
        "profitMargins": profit_margins, "escalation": escalation, "bonds": bonds, "insurance": insurance,
        "taxes": taxes, "wastageDefaults": wastage_defaults, "financing": financing,
    }

    boq = {}
    for sector, sheet_name in SECTOR_SHEET.items():
        rows = rows_of(sheet_name, min_row=5)
        out_rows = []
        for r in rows:
            first = cell(r, 0)
            desc = s(cell(r, 1))
            if first is None and not desc:
                continue
            if isinstance(first, str) and (first.upper().startswith("SUBTOTAL") or first.upper().startswith("TOTAL") or first.upper().startswith("INDICATIVE") or "BUILT-UP AREA" in first.upper()):
                continue
            if isinstance(first, str) and not desc:
                out_rows.append({"id": new_id(ids), "kind": "section", "label": first})
                continue
            wastage = cell(r, 6)
            out_rows.append({
                "id": new_id(ids), "kind": "item", "item": first if isinstance(first, (int, float)) else None,
                "description": desc, "unit": s(cell(r, 2)), "quantity": n(cell(r, 3)),
                "materialCode": s(cell(r, 4)), "wastagePctOverride": (n(wastage) if wastage is not None else None),
                "laborCostPerUnit": n(cell(r, 8)), "equipmentCostPerUnit": n(cell(r, 9)),
                "subcontractorRatePerUnit": n(cell(r, 10)), "notes": s(cell(r, 13)),
            })
        boq[sector] = out_rows

    bid_summary = {
        sector: {"included": True, "riskLevel": "Medium", "profitMarginPct": None, "bondsInsurancePct": 0.0095, "referenceQuantity": 0}
        for sector in SECTOR_SHEET
    }

    data = {
        "schema": "tender-pricing/1",
        "name": "Tender pricing",
        "source": SOURCE.name,
        "updatedAt": "2026-09-15T00:00:00.000Z",
        "materials": materials, "labor": labor, "equipment": equipment, "concreteMixes": concrete_mixes,
        "thresholds": thresholds, "boq": boq, "bidSummary": bid_summary,
        "audit": [{"at": "2026-09-15T00:00:00.000Z", "action": "import_workbook", "detail": SOURCE.name}],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({len(materials)} materials, {len(labor)} labor, {len(equipment)} equipment, "
          f"{len(concrete_mixes)} concrete mixes, {sum(len(v) for v in boq.values())} BOQ rows)")


if __name__ == "__main__":
    main()
