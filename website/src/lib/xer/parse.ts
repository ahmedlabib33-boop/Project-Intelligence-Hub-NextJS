/**
 * Primavera P6 XER tokenizer.
 *
 * An XER file is a tab-delimited record stream: `%T` opens a table, `%F` names
 * its fields, `%R` carries one row, `%E` ends the file. Nothing here interprets
 * schedule semantics — that happens in `model.ts`.
 */

export type XerRow = Record<string, string>;

export type XerTable = {
  name: string;
  fields: string[];
  rows: XerRow[];
  index: Record<string, number>;
};

export type XerHeader = {
  version: string;
  date: string;
  project: string;
  user: string;
  userFull: string;
  db: string;
  dbType: string;
  currency: string;
};

export type XerFile = {
  header: XerHeader | null;
  tables: Record<string, XerTable>;
  order: string[];
  warnings: string[];
};

/**
 * Decode raw bytes. P6 frequently exports ANSI (cp1252) rather than UTF-8, so
 * fall back when the UTF-8 decode produces replacement characters.
 */
export function decodeXerBuffer(buffer: ArrayBuffer): string {
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.indexOf("�") >= 0) {
    try {
      text = new TextDecoder("windows-1252").decode(buffer);
    } catch {
      /* keep the UTF-8 decode */
    }
  }
  return text;
}

export function parseXer(text: string): XerFile {
  const out: XerFile = { header: null, tables: {}, order: [], warnings: [] };
  const lines = text.split(/\r\n|\r|\n/);
  let current: XerTable | null = null;

  for (const line of lines) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const code = tab < 0 ? line : line.slice(0, tab);

    if (code === "%T") {
      const name = line.slice(tab + 1).split("\t")[0].trim().toUpperCase();
      current = { name, fields: [], rows: [], index: {} };
      out.tables[name] = current;
      out.order.push(name);
    } else if (code === "%F") {
      if (!current) continue;
      current.fields = line.slice(tab + 1).split("\t").map((field) => field.trim());
      current.fields.forEach((field, ix) => {
        current!.index[field] = ix;
      });
    } else if (code === "%R") {
      if (!current) continue;
      const cells = line.slice(tab + 1).split("\t");
      const row: XerRow = {};
      for (let k = 0; k < current.fields.length; k++) {
        row[current.fields[k]] = cells[k] !== undefined ? cells[k] : "";
      }
      current.rows.push(row);
    } else if (code === "ERMHDR") {
      const cells = line.split("\t");
      out.header = {
        version: cells[1] || "",
        date: cells[2] || "",
        project: cells[3] || "",
        user: cells[4] || "",
        userFull: cells[5] || "",
        db: cells[6] || "",
        dbType: cells[7] || "",
        currency: cells[8] || "",
      };
    }
  }

  if (!out.tables.TASK) out.warnings.push("No TASK table found — is this a valid XER export?");
  return out;
}

/** Rows of a table, or an empty list when the export omitted it. */
export function table(file: XerFile, name: string): XerRow[] {
  return file.tables[name] ? file.tables[name].rows : [];
}
