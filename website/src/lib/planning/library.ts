/**
 * Planning library — activity list, CSI coding, crews, production rates,
 * equipment and resource codes, held as editable tables.
 *
 * Every table carries its own field list, so rows, values, fields and whole
 * tables can be added, edited or removed at run time. The scenario engine
 * reads the core fields; everything else is carried, exported and re-imported
 * unchanged. Salary and allowance data is never imported.
 */

import type { CellValue, SheetData } from "./xlsx";

/* -------------------------------------------------------------- types */

export type FieldType = "text" | "number";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  /** Read by the engine — can be relabelled but not removed. */
  core?: boolean;
  /** Composition columns: "Trades" on labour rates, "Machines" on equipment rates. */
  group?: string;
};

export type CellData = string | number | null;
export type LibRow = { _id: string; [field: string]: CellData };

export type LibTable = {
  key: string;
  label: string;
  description: string;
  fields: FieldDef[];
  rows: LibRow[];
  custom?: boolean;
};

export type AuditEntry = { at: string; table: string; action: string; detail: string };

export const LIBRARY_SCHEMA = "pih-planning-library/1";

export type PlanningLibrary = {
  schema: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  excluded: string[];
  tables: LibTable[];
  audit: AuditEntry[];
};

/* ------------------------------------------------------------ helpers */

let idCounter = 0;
export function rowId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `r${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const normLabel = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const fieldKeyFrom = (prefix: string, label: string) => `${prefix}${normLabel(label).replace(/ /g, "_") || "field"}`;

export function cellText(value: CellValue | CellData | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
  return String(value).trim();
}

export function cellNumber(value: CellValue | CellData | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function getTable(lib: PlanningLibrary, key: string): LibTable | null {
  return lib.tables.find((t) => t.key === key) || null;
}

const SALARY_COLUMN = /salary|allowance|\bbasic\b|housing|transport|food|vacation|bonus|\beos\b|gosi|air ticket|medical|iqama|work permit|recruit|relocation|visa|wage|payroll|operator rate|opertator rate|manpower rate|manpower cost/i;

/* --------------------------------------------------------- core tables */

type CoreSpec = { key: string; label: string; description: string; fields: FieldDef[] };

const f = (key: string, label: string, type: FieldType = "text", core = true): FieldDef => ({ key, label, type, core });

export const CORE_TABLES: CoreSpec[] = [
  {
    key: "activities", label: "Activity list",
    description: "CSI-coded activity catalogue. The code is what schedule activities map to.",
    fields: [
      f("code", "Activity code"), f("oldCode", "Old activity code"), f("description", "Activity description"),
      f("division", "Division"), f("divisionName", "Division description"), f("subdivision", "Sub-division"),
      f("extension", "Extension"), f("subdivisionName", "Sub-division description"), f("uom", "UOM"),
    ],
  },
  {
    key: "divisions", label: "CSI divisions", description: "Division coding used by the activity list.",
    fields: [f("code", "Division code"), f("name", "Division description")],
  },
  {
    key: "subdivisions", label: "CSI sub-divisions", description: "Sub-division coding used by the activity list.",
    fields: [f("code", "Sub-division code"), f("name", "Sub-division description"), f("division", "Division code")],
  },
  {
    key: "labourRates", label: "Labour production rates",
    description: "Output of one crew per working day for each activity, with its trade composition.",
    fields: [
      f("activityCode", "Activity code"), f("description", "Work sub-group"), f("crew", "Crew type"), f("uom", "UOM"),
      f("dailyProduction", "Daily production", "number"), f("crewHoursPerDay", "Crew hours / day", "number"),
      f("crewHoursPerUnit", "Crew hours / unit", "number"),
    ],
  },
  {
    key: "crews", label: "Crew rates",
    description: "Blended cost of each crew type per crew-hour. Individual salaries are not held.",
    fields: [
      f("crew", "Crew type"), f("resourceCode", "Resource main code"), f("uom", "UOM"),
      f("ratePerHour", "Crew rate / hour", "number"), f("ratePerDay", "Crew rate / day", "number"),
      f("ratePerMonth", "Crew rate / month", "number"),
    ],
  },
  {
    key: "crewMembers", label: "Crew composition", description: "Positions and numbers in each crew type.",
    fields: [
      f("crew", "Crew type"), f("position", "Position"), f("positionCode", "Manpower code"),
      f("count", "No. required", "number"), f("hoursPerDay", "Hours / day", "number"),
    ],
  },
  {
    key: "equipmentRates", label: "Equipment production rates",
    description: "Machines per activity set and the set's daily output.",
    fields: [
      f("activityCode", "Activity code"), f("description", "Activity"), f("uom", "UOM"),
      f("dailyProduction", "Daily production", "number"), f("equipmentHoursPerDay", "Equipment hours / day", "number"),
      f("equipmentHoursPerUnit", "Equipment hours / unit", "number"),
    ],
  },
  {
    key: "equipment", label: "Equipment rates",
    description: "Owning and operating rate per machine model. Models flagged Y set the rate of their machine type.",
    fields: [
      f("machineType", "Machine type"), f("code", "CSI code"), f("ext", "Extension"), f("description", "Description"),
      f("uom", "UOM"), f("ratePerHour", "Rate / hour", "number"), f("ratePerDay", "Rate / day", "number"),
      f("ratePerMonth", "Rate / month", "number"), f("purchaseCost", "Purchase cost", "number", false),
      f("salvageCost", "Salvage cost", "number", false), f("lifeMonths", "Depreciation life (months)", "number", false),
      f("fuelType", "Fuel type", "text", false), f("useInTypeRate", "Use in type rate (Y/N)"),
    ],
  },
  {
    key: "resources", label: "Resource codes", description: "Unique resource coding with units and rates.",
    fields: [
      f("resourceCode", "Resource code"), f("category", "Resource category"), f("description", "Resource description"),
      f("uom", "UOM"), f("mainCode", "Resource main code"), f("ext", "Ext"), f("extDescription", "Ext description"),
      f("rate", "Rate", "number"),
    ],
  },
  {
    key: "materials", label: "Materials", description: "Unique material list.",
    fields: [f("material", "Material"), f("mainCode", "Resource main code"), f("uom", "UOM"), f("category", "Resource category")],
  },
  {
    key: "subcontractors", label: "Subcontractors", description: "Unique subcontractor list.",
    fields: [f("name", "Subcontractor"), f("mainCode", "Resource main code")],
  },
  {
    key: "activityResources", label: "Activity resource coding",
    description: "Which materials, crews, subcontractors and equipment each activity code uses.",
    fields: [
      f("activityCode", "Activity code"), f("resourceClass", "Resource class"), f("resourceDescription", "Resource description"),
      f("resourceOrder", "Resource order"), f("resourceMainCode", "Resource main code"), f("mainCodeMod", "Main code (mod.)"),
    ],
  },
  {
    key: "positions", label: "Manpower positions", description: "Position coding by CSI division. Salary columns are not held.",
    fields: [
      f("divisionCode", "Div. code"), f("divisionName", "Div description"), f("csiCode", "CSI code"),
      f("csiName", "CSI description"), f("position", "Organization position"), f("resourceOrder", "Resource order"),
      f("manpowerCode", "Manpower main code"),
    ],
  },
];

export function emptyLibrary(name = "Planning library"): PlanningLibrary {
  const now = new Date().toISOString();
  return {
    schema: LIBRARY_SCHEMA, name, source: "Created in the app", createdAt: now, updatedAt: now, excluded: [],
    tables: CORE_TABLES.map((spec) => ({ ...spec, fields: spec.fields.map((x) => ({ ...x })), rows: [] })),
    audit: [],
  };
}

/* ------------------------------------------------------ workbook import */

type Sheet = { name: string; rows: CellValue[][] };

function findSheet(sheets: Sheet[], name: string): Sheet | null {
  return sheets.find((s) => normLabel(s.name) === normLabel(name)) || null;
}

function headerRow(rows: CellValue[][], required: string[], scan = 15): number {
  const want = required.map(normLabel);
  for (let i = 0; i < Math.min(scan, rows.length); i++) {
    const labels = new Set((rows[i] || []).map(normLabel));
    if (want.every((w) => labels.has(w))) return i;
  }
  return -1;
}

function columnMap(header: CellValue[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  header.forEach((value, index) => {
    const key = normLabel(value);
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(index);
    else map.set(key, [index]);
  });
  return map;
}

function reader(sheet: Sheet | null, required: string[]) {
  if (!sheet) return null;
  const at = headerRow(sheet.rows, required);
  if (at < 0) return null;
  const header = sheet.rows[at] || [];
  const cols = columnMap(header);
  const col = (label: string, occurrence = 0) => {
    const list = cols.get(normLabel(label));
    return list && list.length > occurrence ? list[occurrence] : -1;
  };
  const data = sheet.rows.slice(at + 1).filter((row) => row && row.some((v) => v !== null && v !== ""));
  return { header, col, data };
}

const pick = (row: CellValue[], index: number) => (index >= 0 ? row[index] ?? null : null);

export type ImportReport = { sheetsRead: string[]; sheetsSkipped: string[]; rows: Record<string, number> };

/** Import the planning workbook (activity lists, production rates, crews, equipment). Salaries are dropped. */
export function importWorkbook(sheets: SheetData[], source: string): { library: PlanningLibrary; report: ImportReport } {
  const lib = emptyLibrary("Planning library");
  lib.source = source;
  const report: ImportReport = { sheetsRead: [], sheetsSkipped: [], rows: {} };
  const push = (tableKey: string, values: Record<string, CellData>) => {
    const table = getTable(lib, tableKey)!;
    const row: LibRow = { _id: rowId() };
    // Blank cells are stored as null so an exported and re-imported library compares equal.
    for (const [key, value] of Object.entries(values)) row[key] = value === "" ? null : value;
    table.rows.push(row);
  };
  const used = new Set<string>();
  const mark = (s: Sheet | null) => s && used.add(s.name);

  /* activity list */
  const actSheet = findSheet(sheets, "Activity List CSI");
  const act = reader(actSheet, ["Activity Code", "Activity description"]);
  if (act) {
    mark(actSheet);
    for (const row of act.data) {
      const code = cellText(pick(row, act.col("Activity Code")));
      if (!code) continue;
      push("activities", {
        code, oldCode: cellText(pick(row, act.col("Old Activity Code"))), description: cellText(pick(row, act.col("Activity description"))),
        division: cellText(pick(row, act.col("Div."))), divisionName: cellText(pick(row, act.col("Division Description"))),
        subdivision: cellText(pick(row, act.col("Sub Division"))), extension: cellText(pick(row, act.col("Extension"))),
        subdivisionName: cellText(pick(row, act.col("Sub Division Description"))), uom: "",
      });
    }
  }

  /* labour production rates, with trade composition as dynamic fields */
  const mpSheet = findSheet(sheets, "Manpower PR");
  const mp = reader(mpSheet, ["Activity Code", "Crew Type", "Daily Production"]);
  if (mp) {
    mark(mpSheet);
    const table = getTable(lib, "labourRates")!;
    const from = mp.col("UOM") + 1;
    const to = mp.col("Daily Production");
    const trades: { index: number; key: string }[] = [];
    for (let i = from; i < to; i++) {
      const label = cellText(mp.header[i]);
      if (!label) continue;
      const key = fieldKeyFrom("t_", label);
      trades.push({ index: i, key });
      table.fields.push({ key, label, type: "number", group: "Trades" });
    }
    for (const row of mp.data) {
      const code = cellText(pick(row, mp.col("Activity Code")));
      if (!code) continue;
      const values: Record<string, CellData> = {
        activityCode: code, description: cellText(pick(row, mp.col("Work Sub-group"))), crew: cellText(pick(row, mp.col("Crew Type"))),
        uom: cellText(pick(row, mp.col("UOM"))), dailyProduction: cellNumber(pick(row, mp.col("Daily Production"))),
        crewHoursPerDay: cellNumber(pick(row, mp.col("CrewHr/ day"))), crewHoursPerUnit: cellNumber(pick(row, mp.col("CrewHr/ Unit"))),
      };
      for (const t of trades) values[t.key] = cellNumber(row[t.index]);
      push("labourRates", values);
    }
  }

  /* crews: blended crew rates (right-hand table) and composition (left-hand table, no rates) */
  const cuSheet = findSheet(sheets, "ManPower Unique List");
  const cu = reader(cuSheet, ["Crew Type", "Manpower Description", "Crew rate/Hr"]);
  if (cu) {
    mark(cuSheet);
    for (const row of cu.data) {
      const crew = cellText(pick(row, cu.col("Crew Type", 1)));
      if (crew) {
        push("crews", {
          crew, resourceCode: cellText(pick(row, cu.col("Resource Main code", 1))), uom: cellText(pick(row, cu.col("UOM"))),
          ratePerHour: cellNumber(pick(row, cu.col("Crew rate/Hr"))), ratePerDay: cellNumber(pick(row, cu.col("Crew rate/day"))),
          ratePerMonth: cellNumber(pick(row, cu.col("Crew rate/Month"))),
        });
      }
      const position = cellText(pick(row, cu.col("Manpower Description")));
      if (position) {
        push("crewMembers", {
          crew: cellText(pick(row, cu.col("Crew Type", 0))), position, positionCode: cellText(pick(row, cu.col("Manpower Code"))),
          count: cellNumber(pick(row, cu.col("No. Required"))), hoursPerDay: cellNumber(pick(row, cu.col("Manpower Hours / Day"))),
        });
      }
    }
  }

  /* equipment production rates, with machine counts as dynamic fields */
  const eqpSheet = findSheet(sheets, "Machinary PR");
  const eqp = reader(eqpSheet, ["Activity Code", "Daily Production"]);
  if (eqp) {
    mark(eqpSheet);
    const table = getTable(lib, "equipmentRates")!;
    const from = eqp.col("UOM") + 1;
    const to = eqp.col("Daily Production");
    const machines: { index: number; key: string }[] = [];
    for (let i = from; i < to; i++) {
      const label = cellText(eqp.header[i]).replace(/\s+/g, " ");
      if (!label) continue;
      const key = fieldKeyFrom("m_", label);
      machines.push({ index: i, key });
      table.fields.push({ key, label, type: "number", group: "Machines" });
    }
    for (const row of eqp.data) {
      const code = cellText(pick(row, eqp.col("Activity Code")));
      if (!code) continue;
      const values: Record<string, CellData> = {
        activityCode: code, description: cellText(pick(row, eqp.col("Activity List"))), uom: cellText(pick(row, eqp.col("UOM"))),
        dailyProduction: cellNumber(pick(row, eqp.col("Daily Production"))),
        equipmentHoursPerDay: cellNumber(pick(row, eqp.col("CrewHr/ day"))), equipmentHoursPerUnit: cellNumber(pick(row, eqp.col("CrewHr/ Unit"))),
      };
      for (const m of machines) values[m.key] = cellNumber(row[m.index]);
      push("equipmentRates", values);
    }
  }

  /* equipment models and rates (operator salary columns dropped) */
  const umSheet = findSheet(sheets, "List of Unique Machinary");
  const um = reader(umSheet, ["Machinary Type", "Description", "Rate/ Hr"]);
  if (um) {
    mark(umSheet);
    for (const row of um.data) {
      const type = cellText(pick(row, um.col("Machinary Type"))).replace(/\s+/g, " ");
      if (!type) continue;
      push("equipment", {
        machineType: type, code: cellText(pick(row, um.col("CSI CODE"))), ext: cellText(pick(row, um.col("EXT."))),
        description: cellText(pick(row, um.col("Description"))), uom: "EH",
        ratePerHour: cellNumber(pick(row, um.col("Rate/ Hr"))), ratePerDay: cellNumber(pick(row, um.col("Rate/Day"))),
        ratePerMonth: cellNumber(pick(row, um.col("Rate/Month"))), purchaseCost: cellNumber(pick(row, um.col("Puchase Cost"))),
        salvageCost: cellNumber(pick(row, um.col("Salvage Cost"))), lifeMonths: cellNumber(pick(row, um.col("Depriciation Life Cycle"))),
        fuelType: cellText(pick(row, um.col("Type of Fuel"))), useInTypeRate: "Y",
      });
    }
  }

  /* resource, material and subcontractor lists */
  const rsSheet = findSheet(sheets, "Resource Unique List");
  const rs = reader(rsSheet, ["Resource Code", "Resource Description"]);
  if (rs) {
    mark(rsSheet);
    for (const row of rs.data) {
      const code = cellText(pick(row, rs.col("Resource Code")));
      if (!code) continue;
      push("resources", {
        resourceCode: code, category: cellText(pick(row, rs.col("Resource Category"))), description: cellText(pick(row, rs.col("Resource Description"))),
        uom: cellText(pick(row, rs.col("UOM"))), mainCode: cellText(pick(row, rs.col("Resource Main Code"))), ext: cellText(pick(row, rs.col("Ext"))),
        extDescription: cellText(pick(row, rs.col("Ext Description"))), rate: cellNumber(pick(row, rs.col("Rate"))),
      });
    }
  }
  const matSheet = findSheet(sheets, "Material Unique List");
  const mat = reader(matSheet, ["Material List", "Resource Main Code"]);
  if (mat) {
    mark(matSheet);
    for (const row of mat.data) {
      const name = cellText(pick(row, mat.col("Material List")));
      if (!name) continue;
      push("materials", {
        material: name, mainCode: cellText(pick(row, mat.col("Resource Main Code"))), uom: cellText(pick(row, mat.col("UOM"))),
        category: cellText(pick(row, mat.col("Resource Category"))),
      });
    }
  }
  const subSheet = findSheet(sheets, "Sub-Contractors Unique List");
  const sub = reader(subSheet, ["Sub-Contractor List", "Resource Main Code"]);
  if (sub) {
    mark(subSheet);
    for (const row of sub.data) {
      const name = cellText(pick(row, sub.col("Sub-Contractor List")));
      if (name) push("subcontractors", { name, mainCode: cellText(pick(row, sub.col("Resource Main Code"))) });
    }
  }

  /* activity ↔ resource coding */
  const seen = new Set<string>();
  for (const [sheetName, resourceClass] of [
    ["Mat. List CSI", "Material"], ["MP. List CSI", "Manpower crew"], ["SUBC. List CSI", "Subcontractor"], ["Equip. List CSI", "Equipment"],
  ] as const) {
    const sheet = findSheet(sheets, sheetName);
    const r = reader(sheet, ["Activity Code", "Resource Description"]);
    if (!r) continue;
    mark(sheet);
    for (const row of r.data) {
      const code = cellText(pick(row, r.col("Activity Code")));
      if (!code) continue;
      const values = {
        activityCode: code, resourceClass, resourceDescription: cellText(pick(row, r.col("Resource Description"))),
        resourceOrder: cellText(pick(row, r.col("Resource Order"))), resourceMainCode: cellText(pick(row, r.col("Resource Main Code"))),
        mainCodeMod: cellText(pick(row, r.col("Resource Main Code Mod."))),
      };
      const key = JSON.stringify(values);
      if (seen.has(key)) continue;
      seen.add(key);
      push("activityResources", values);
      const act = getTable(lib, "activities")!.rows.find((a) => a.code === code);
      if (act && !act.description) act.description = cellText(pick(row, r.col("Activity description")));
    }
  }

  /* positions without salary columns */
  const plSheet = findSheet(sheets, "Manpower List");
  const pl = reader(plSheet, ["Organization Position", "Manpower Main Code"]);
  if (pl) {
    mark(plSheet);
    for (const row of pl.data) {
      const position = cellText(pick(row, pl.col("Organization Position")));
      if (!position) continue;
      push("positions", {
        divisionCode: cellText(pick(row, pl.col("Div. Code"))), divisionName: cellText(pick(row, pl.col("Div Description"))),
        csiCode: cellText(pick(row, pl.col("CSI Code"))), csiName: cellText(pick(row, pl.col("CSI Description"))), position,
        resourceOrder: cellText(pick(row, pl.col("Resource Order"))), manpowerCode: cellText(pick(row, pl.col("Manpower Main Code"))),
      });
    }
  }

  /* derived coding and units */
  const divisions = new Map<string, string>();
  const subdivisions = new Map<string, { name: string; division: string }>();
  for (const a of getTable(lib, "activities")!.rows) {
    const division = cellText(a.division);
    const subdivision = cellText(a.subdivision);
    if (division && !divisions.has(division)) divisions.set(division, cellText(a.divisionName));
    if (subdivision && !subdivisions.has(subdivision)) subdivisions.set(subdivision, { name: cellText(a.subdivisionName), division });
    const rate = getTable(lib, "labourRates")!.rows.find((r) => r.activityCode === a.code && r.uom)
      || getTable(lib, "equipmentRates")!.rows.find((r) => r.activityCode === a.code && r.uom);
    if (rate) a.uom = cellText(rate.uom);
  }
  for (const [code, name] of divisions) push("divisions", { code, name });
  for (const [code, v] of subdivisions) push("subdivisions", { code, name: v.name, division: v.division });

  /* sheets this importer does not model */
  const salarySheets = new Set(["manual manpower database"]);
  const derivedSheets = new Set(["machinary pr2", "machine list"]);
  for (const sheet of sheets) {
    if (used.has(sheet.name)) {
      report.sheetsRead.push(sheet.name);
      continue;
    }
    const key = normLabel(sheet.name);
    if (salarySheets.has(key) || derivedSheets.has(key)) {
      report.sheetsSkipped.push(sheet.name);
      continue;
    }
    const custom = genericTable(sheet);
    if (custom) {
      lib.tables.push(custom);
      report.sheetsRead.push(sheet.name);
    } else {
      report.sheetsSkipped.push(sheet.name);
    }
  }

  lib.excluded = [
    "Manual Manpower Database — salaries, allowances and headcount by position (sheet not imported).",
    "Manpower List — basic salary, allowances, benefits and total monthly cost per position.",
    "ManPower Unique List — per-person monthly, daily and hourly rates and cost per day.",
    "List of Unique Machinary / Machine List — operator salary rates (machine total rates are kept).",
    "Any column of an unrecognised sheet whose heading names a salary, allowance or benefit.",
  ];
  for (const t of lib.tables) report.rows[t.label] = t.rows.length;
  lib.audit.push({ at: lib.createdAt, table: "*", action: "import", detail: `Imported ${source}` });
  return { library: lib, report };
}

/** An unrecognised sheet becomes a custom table; salary-like columns are dropped. */
function genericTable(sheet: Sheet): LibTable | null {
  let at = -1;
  for (let i = 0; i < Math.min(15, sheet.rows.length); i++) {
    const texts = (sheet.rows[i] || []).filter((v) => typeof v === "string" && v.trim()).length;
    if (texts >= 2) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const header = sheet.rows[at];
  const fields: FieldDef[] = [];
  const indexes: number[] = [];
  const keys = new Set<string>();
  header.forEach((value, index) => {
    const label = cellText(value);
    if (!label || SALARY_COLUMN.test(label)) return;
    let key = fieldKeyFrom("c_", label);
    while (keys.has(key)) key += "_";
    keys.add(key);
    fields.push({ key, label, type: "text" });
    indexes.push(index);
  });
  if (!fields.length) return null;
  const rows: LibRow[] = [];
  for (const row of sheet.rows.slice(at + 1)) {
    if (!row || !row.some((v) => v !== null && v !== "")) continue;
    const values: LibRow = { _id: rowId() };
    fields.forEach((field, i) => {
      const v = row[indexes[i]];
      values[field.key] = typeof v === "number" ? v : cellText(v) || null;
    });
    rows.push(values);
  }
  for (const field of fields) {
    const values = rows.map((r) => r[field.key]).filter((v) => v !== null && v !== "");
    if (values.length && values.every((v) => typeof v === "number")) field.type = "number";
  }
  return {
    key: `custom_${normLabel(sheet.name).replace(/ /g, "_")}_${Math.random().toString(36).slice(2, 6)}`,
    label: sheet.name.trim(), description: `Imported from sheet "${sheet.name.trim()}".`, fields, rows, custom: true,
  };
}

/* ----------------------------------------------------- round-trip export */

const META_SHEET = "_library";

export function libraryToSheets(lib: PlanningLibrary): SheetData[] {
  const meta: CellValue[][] = [
    ["schema", LIBRARY_SCHEMA], ["name", lib.name], ["source", lib.source], ["createdAt", lib.createdAt], ["updatedAt", lib.updatedAt],
    ["excluded", lib.excluded.join(" | ")], [],
    ["table", "tableLabel", "description", "custom", "fieldKey", "fieldLabel", "type", "group", "core"],
  ];
  for (const t of lib.tables) {
    for (const field of t.fields) {
      meta.push([t.key, t.label, t.description, t.custom ? "Y" : "N", field.key, field.label, field.type, field.group || "", field.core ? "Y" : "N"]);
    }
  }
  const sheets: SheetData[] = [{ name: META_SHEET, rows: meta }];
  for (const t of lib.tables) {
    sheets.push({
      name: t.label,
      rows: [t.fields.map((x) => x.label), ...t.rows.map((r) => t.fields.map((x) => (r[x.key] === undefined ? null : r[x.key])))],
    });
  }
  return sheets;
}

/** Re-import a workbook exported by `libraryToSheets`, or fall back to the planning workbook importer. */
export function libraryFromSheets(sheets: SheetData[], source: string): { library: PlanningLibrary; report: ImportReport } {
  const meta = sheets[0];
  if (!meta || meta.name !== META_SHEET || cellText(meta.rows[0]?.[1]) !== LIBRARY_SCHEMA) return importWorkbook(sheets, source);

  const value = (key: string) => cellText(meta.rows.find((r) => cellText(r?.[0]) === key)?.[1]);
  const headerAt = meta.rows.findIndex((r) => cellText(r?.[0]) === "table" && cellText(r?.[4]) === "fieldKey");
  const tables: LibTable[] = [];
  for (const r of meta.rows.slice(headerAt + 1)) {
    const key = cellText(r?.[0]);
    if (!key) continue;
    let table = tables.find((t) => t.key === key);
    if (!table) {
      table = { key, label: cellText(r[1]), description: cellText(r[2]), custom: cellText(r[3]) === "Y", fields: [], rows: [] };
      tables.push(table);
    }
    table.fields.push({
      key: cellText(r[4]), label: cellText(r[5]), type: cellText(r[6]) === "number" ? "number" : "text",
      group: cellText(r[7]) || undefined, core: cellText(r[8]) === "Y",
    });
  }
  const report: ImportReport = { sheetsRead: [META_SHEET], sheetsSkipped: [], rows: {} };
  tables.forEach((table, i) => {
    const sheet = sheets[i + 1];
    if (!sheet) return;
    report.sheetsRead.push(sheet.name);
    const header = (sheet.rows[0] || []).map(cellText);
    const indexOf = new Map(table.fields.map((field) => [field.key, header.indexOf(field.label)]));
    for (const row of sheet.rows.slice(1)) {
      if (!row || !row.some((v) => v !== null && v !== "")) continue;
      const out: LibRow = { _id: rowId() };
      for (const field of table.fields) {
        const v = row[indexOf.get(field.key) ?? -1];
        out[field.key] = field.type === "number" ? cellNumber(v) : cellText(v) || null;
      }
      table.rows.push(out);
    }
    report.rows[table.label] = table.rows.length;
  });
  // Make sure engine tables always exist, even if a file dropped one.
  for (const spec of CORE_TABLES) {
    if (!tables.some((t) => t.key === spec.key)) tables.push({ ...spec, fields: spec.fields.map((x) => ({ ...x })), rows: [] });
  }
  const now = new Date().toISOString();
  return {
    library: {
      schema: LIBRARY_SCHEMA, name: value("name") || "Planning library", source, createdAt: value("createdAt") || now, updatedAt: now,
      excluded: value("excluded") ? value("excluded").split(" | ") : [], tables, audit: [{ at: now, table: "*", action: "import", detail: `Imported ${source}` }],
    },
    report,
  };
}

export function parseLibraryJson(text: string): PlanningLibrary {
  const data = JSON.parse(text) as PlanningLibrary;
  if (!data || data.schema !== LIBRARY_SCHEMA || !Array.isArray(data.tables)) throw new Error("This JSON file is not a planning library export.");
  for (const spec of CORE_TABLES) {
    if (!data.tables.some((t) => t.key === spec.key)) data.tables.push({ ...spec, fields: spec.fields.map((x) => ({ ...x })), rows: [] });
  }
  for (const table of data.tables) for (const row of table.rows) if (!row._id) row._id = rowId();
  data.audit = Array.isArray(data.audit) ? data.audit : [];
  return data;
}

/* ------------------------------------------------------------- editing */

function touch(lib: PlanningLibrary, table: string, action: string, detail: string, tables: LibTable[]): PlanningLibrary {
  const at = new Date().toISOString();
  return { ...lib, tables, updatedAt: at, audit: [...lib.audit.slice(-499), { at, table, action, detail }] };
}

function mapTable(lib: PlanningLibrary, key: string, fn: (t: LibTable) => LibTable): LibTable[] {
  return lib.tables.map((t) => (t.key === key ? fn(t) : t));
}

export function updateCell(lib: PlanningLibrary, tableKey: string, id: string, fieldKey: string, raw: string): PlanningLibrary {
  const table = getTable(lib, tableKey);
  const field = table?.fields.find((x) => x.key === fieldKey);
  if (!table || !field) return lib;
  const value: CellData = field.type === "number" ? cellNumber(raw) : raw.trim() || null;
  const before = table.rows.find((r) => r._id === id)?.[fieldKey] ?? null;
  if (before === value) return lib;
  return touch(lib, table.label, "edit", `${field.label}: ${cellText(before) || "∅"} → ${cellText(value) || "∅"}`,
    mapTable(lib, tableKey, (t) => ({ ...t, rows: t.rows.map((r) => (r._id === id ? { ...r, [fieldKey]: value } : r)) })));
}

export function addRow(lib: PlanningLibrary, tableKey: string, values: Record<string, CellData> = {}): { library: PlanningLibrary; id: string } {
  const table = getTable(lib, tableKey);
  const id = rowId();
  if (!table) return { library: lib, id };
  const row: LibRow = { _id: id };
  for (const field of table.fields) row[field.key] = values[field.key] ?? null;
  return { library: touch(lib, table.label, "add row", "New row", mapTable(lib, tableKey, (t) => ({ ...t, rows: [row, ...t.rows] }))), id };
}

export function duplicateRow(lib: PlanningLibrary, tableKey: string, id: string): PlanningLibrary {
  const table = getTable(lib, tableKey);
  const source = table?.rows.find((r) => r._id === id);
  if (!table || !source) return lib;
  const copy: LibRow = { ...source, _id: rowId() };
  return touch(lib, table.label, "duplicate row", "Row duplicated", mapTable(lib, tableKey, (t) => {
    const at = t.rows.findIndex((r) => r._id === id);
    const rows = t.rows.slice();
    rows.splice(at + 1, 0, copy);
    return { ...t, rows };
  }));
}

export function deleteRows(lib: PlanningLibrary, tableKey: string, ids: string[]): PlanningLibrary {
  const table = getTable(lib, tableKey);
  if (!table || !ids.length) return lib;
  const drop = new Set(ids);
  return touch(lib, table.label, "delete rows", `${ids.length} row(s) deleted`, mapTable(lib, tableKey, (t) => ({ ...t, rows: t.rows.filter((r) => !drop.has(r._id)) })));
}

export function addField(lib: PlanningLibrary, tableKey: string, label: string, type: FieldType, group?: string): PlanningLibrary {
  const table = getTable(lib, tableKey);
  const clean = label.trim();
  if (!table || !clean) return lib;
  let key = fieldKeyFrom("x_", clean);
  while (table.fields.some((x) => x.key === key)) key += "_";
  return touch(lib, table.label, "add field", `${clean} (${type})`, mapTable(lib, tableKey, (t) => ({
    ...t, fields: [...t.fields, { key, label: clean, type, group: group || undefined }], rows: t.rows.map((r) => ({ ...r, [key]: null })),
  })));
}

export function updateField(lib: PlanningLibrary, tableKey: string, fieldKey: string, patch: { label?: string; type?: FieldType }): PlanningLibrary {
  const table = getTable(lib, tableKey);
  const field = table?.fields.find((x) => x.key === fieldKey);
  if (!table || !field) return lib;
  const next: FieldDef = { ...field, label: patch.label?.trim() || field.label, type: field.core ? field.type : patch.type || field.type };
  return touch(lib, table.label, "edit field", `${field.label} → ${next.label} (${next.type})`, mapTable(lib, tableKey, (t) => ({
    ...t,
    fields: t.fields.map((x) => (x.key === fieldKey ? next : x)),
    rows: next.type !== field.type
      ? t.rows.map((r) => ({ ...r, [fieldKey]: next.type === "number" ? cellNumber(r[fieldKey]) : cellText(r[fieldKey]) || null }))
      : t.rows,
  })));
}

export function deleteField(lib: PlanningLibrary, tableKey: string, fieldKey: string): PlanningLibrary {
  const table = getTable(lib, tableKey);
  const field = table?.fields.find((x) => x.key === fieldKey);
  if (!table || !field || field.core) return lib;
  return touch(lib, table.label, "delete field", field.label, mapTable(lib, tableKey, (t) => ({
    ...t,
    fields: t.fields.filter((x) => x.key !== fieldKey),
    rows: t.rows.map((r) => {
      const next = { ...r };
      delete next[fieldKey];
      return next;
    }),
  })));
}

export function addTable(lib: PlanningLibrary, label: string): { library: PlanningLibrary; key: string } {
  const clean = label.trim() || "Custom table";
  const key = `custom_${normLabel(clean).replace(/ /g, "_")}_${Math.random().toString(36).slice(2, 6)}`;
  const table: LibTable = { key, label: clean, description: "Custom table", custom: true, fields: [{ key: "x_name", label: "Name", type: "text" }], rows: [] };
  return { library: touch(lib, clean, "add table", clean, [...lib.tables, table]), key };
}

export function updateTable(lib: PlanningLibrary, tableKey: string, patch: { label?: string; description?: string }): PlanningLibrary {
  const table = getTable(lib, tableKey);
  if (!table) return lib;
  return touch(lib, table.label, "edit table", `${table.label} → ${patch.label || table.label}`, mapTable(lib, tableKey, (t) => ({
    ...t, label: patch.label?.trim() || t.label, description: patch.description ?? t.description,
  })));
}

export function deleteTable(lib: PlanningLibrary, tableKey: string): PlanningLibrary {
  const table = getTable(lib, tableKey);
  if (!table || !table.custom) return lib;
  return touch(lib, table.label, "delete table", table.label, lib.tables.filter((t) => t.key !== tableKey));
}

/* ---------------------------------------------------------- validation */

export type LibraryIssue = { severity: "error" | "warning"; table: string; rowId: string | null; message: string };

export function validateLibrary(lib: PlanningLibrary): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const activities = getTable(lib, "activities")?.rows || [];
  const codes = new Map<string, number>();
  for (const a of activities) {
    const code = cellText(a.code);
    if (!code) issues.push({ severity: "error", table: "activities", rowId: a._id, message: "Activity without a code" });
    else codes.set(code, (codes.get(code) || 0) + 1);
  }
  for (const [code, n] of codes) if (n > 1) issues.push({ severity: "error", table: "activities", rowId: null, message: `Activity code ${code} appears ${n} times` });

  const crews = new Map((getTable(lib, "crews")?.rows || []).map((c) => [normLabel(c.crew), c]));
  for (const r of getTable(lib, "labourRates")?.rows || []) {
    const code = cellText(r.activityCode);
    if (code && !codes.has(code)) issues.push({ severity: "warning", table: "labourRates", rowId: r._id, message: `Labour rate for unknown activity ${code}` });
    const production = cellNumber(r.dailyProduction);
    if (!(production && production > 0)) issues.push({ severity: "warning", table: "labourRates", rowId: r._id, message: `${code} · ${cellText(r.crew)} has no daily production` });
    const crew = crews.get(normLabel(r.crew));
    if (!crew) issues.push({ severity: "warning", table: "labourRates", rowId: r._id, message: `${code} · crew "${cellText(r.crew)}" has no crew rate` });
    else if (!(cellNumber(crew.ratePerHour) || 0)) issues.push({ severity: "warning", table: "crews", rowId: crew._id, message: `Crew "${cellText(crew.crew)}" has no hourly rate` });
  }
  const index = buildLibraryIndex(lib);
  for (const r of getTable(lib, "equipmentRates")?.rows || []) {
    for (const field of index.machineFields) {
      const count = cellNumber(r[field.key]);
      if (count && count > 0 && !index.machineRate.has(normLabel(field.label))) {
        issues.push({ severity: "warning", table: "equipmentRates", rowId: r._id, message: `${cellText(r.activityCode)} uses ${field.label}, which has no equipment rate` });
      }
    }
  }
  for (const t of lib.tables) {
    for (const field of t.fields) {
      if (field.type !== "number") continue;
      for (const r of t.rows) {
        const v = r[field.key];
        if (typeof v === "number" && v < 0) issues.push({ severity: "error", table: t.key, rowId: r._id, message: `${t.label} · ${field.label} is negative` });
      }
    }
  }
  return issues;
}

/* --------------------------------------------------------- productivity */

export type LibraryIndex = {
  lib: PlanningLibrary;
  activities: Map<string, LibRow>;
  labour: Map<string, LibRow[]>;
  equipment: Map<string, LibRow[]>;
  crews: Map<string, LibRow>;
  machineRate: Map<string, number>;
  machineFields: FieldDef[];
};

export function buildLibraryIndex(lib: PlanningLibrary): LibraryIndex {
  const activities = new Map<string, LibRow>();
  for (const a of getTable(lib, "activities")?.rows || []) if (a.code) activities.set(cellText(a.code), a);
  const group = (key: string) => {
    const map = new Map<string, LibRow[]>();
    for (const r of getTable(lib, key)?.rows || []) {
      const code = cellText(r.activityCode);
      if (!code) continue;
      const list = map.get(code);
      if (list) list.push(r);
      else map.set(code, [r]);
    }
    return map;
  };
  const crews = new Map<string, LibRow>();
  for (const c of getTable(lib, "crews")?.rows || []) if (c.crew) crews.set(normLabel(c.crew), c);

  const rates = new Map<string, number[]>();
  for (const e of getTable(lib, "equipment")?.rows || []) {
    if (cellText(e.useInTypeRate).toUpperCase() === "N") continue;
    const rate = cellNumber(e.ratePerHour);
    if (rate === null || rate <= 0) continue;
    const key = normLabel(e.machineType);
    const list = rates.get(key);
    if (list) list.push(rate);
    else rates.set(key, [rate]);
  }
  const machineRate = new Map<string, number>();
  for (const [k, list] of rates) machineRate.set(k, list.reduce((s, v) => s + v, 0) / list.length);

  return {
    lib, activities, labour: group("labourRates"), equipment: group("equipmentRates"), crews, machineRate,
    machineFields: (getTable(lib, "equipmentRates")?.fields || []).filter((x) => x.group === "Machines"),
  };
}

export type CrewLine = {
  crew: string;
  uom: string;
  dailyProduction: number | null;
  crewHoursPerDay: number | null;
  ratePerHour: number | null;
  costPerDay: number | null;
};

export type MachineLine = { machineType: string; count: number; ratePerHour: number | null; costPerDay: number | null };

export type ActivityBasis = {
  code: string;
  description: string;
  uom: string;
  crews: CrewLine[];
  machines: MachineLine[];
  equipmentProduction: number | null;
  /** Governing output of one set per working day — the slowest resource line. */
  dailyProduction: number | null;
  governing: string;
  /** Cost of one set per working day; lines without a rate contribute nothing. */
  costPerDay: number;
  issues: string[];
};

export function activityBasis(index: LibraryIndex, code: string, crewFilter: string[] = [], includeEquipment = true): ActivityBasis | null {
  const activity = index.activities.get(code);
  const labourRows = index.labour.get(code) || [];
  const equipmentRows = index.equipment.get(code) || [];
  if (!activity && !labourRows.length && !equipmentRows.length) return null;

  const filter = crewFilter.map(normLabel).filter(Boolean);
  const issues: string[] = [];
  const crews: CrewLine[] = labourRows
    .filter((r) => !filter.length || filter.includes(normLabel(r.crew)))
    .map((r) => {
      const crew = index.crews.get(normLabel(r.crew));
      const ratePerHour = crew ? cellNumber(crew.ratePerHour) : null;
      const hours = cellNumber(r.crewHoursPerDay);
      if (!crew) issues.push(`No crew rate for ${cellText(r.crew)}`);
      return {
        crew: cellText(r.crew), uom: cellText(r.uom), dailyProduction: cellNumber(r.dailyProduction), crewHoursPerDay: hours,
        ratePerHour, costPerDay: ratePerHour !== null && hours !== null ? ratePerHour * hours : null,
      };
    });
  if (filter.length && !crews.length) issues.push(`None of the selected crews (${crewFilter.join(", ")}) has a rate row for ${code}`);

  const machines: MachineLine[] = [];
  let equipmentProduction: number | null = null;
  if (includeEquipment) {
    for (const r of equipmentRows) {
      equipmentProduction = cellNumber(r.dailyProduction);
      const counts = index.machineFields.map((field) => ({ field, count: cellNumber(r[field.key]) || 0 })).filter((x) => x.count > 0);
      const totalCount = counts.reduce((s, x) => s + x.count, 0);
      const hoursPerMachine = totalCount ? (cellNumber(r.equipmentHoursPerDay) || totalCount * 8) / totalCount : 8;
      for (const { field, count } of counts) {
        const rate = index.machineRate.get(normLabel(field.label)) ?? null;
        if (rate === null) issues.push(`No equipment rate for ${field.label}`);
        machines.push({ machineType: field.label, count, ratePerHour: rate, costPerDay: rate !== null ? rate * count * hoursPerMachine : null });
      }
    }
  }

  let dailyProduction: number | null = null;
  let governing = "";
  for (const line of crews) {
    if (line.dailyProduction && line.dailyProduction > 0 && (dailyProduction === null || line.dailyProduction < dailyProduction)) {
      dailyProduction = line.dailyProduction;
      governing = line.crew;
    }
  }
  if (equipmentProduction && equipmentProduction > 0 && (dailyProduction === null || equipmentProduction < dailyProduction)) {
    dailyProduction = equipmentProduction;
    governing = "Equipment set";
  }
  if (dailyProduction === null) issues.push("No daily production rate");

  const uom = crews.find((c) => c.uom)?.uom || cellText(equipmentRows[0]?.uom) || cellText(activity?.uom);
  const costPerDay = [...crews.map((c) => c.costPerDay || 0), ...machines.map((m) => m.costPerDay || 0)].reduce((s, v) => s + v, 0);
  return {
    code, description: cellText(activity?.description) || cellText(labourRows[0]?.description) || cellText(equipmentRows[0]?.description),
    uom, crews, machines, equipmentProduction, dailyProduction, governing, costPerDay, issues,
  };
}
