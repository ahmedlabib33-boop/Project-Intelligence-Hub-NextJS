/**
 * Browser-side document reading for evidence intelligence.
 *
 * Every file stays in the browser. Text is read from PDF (per page), Word,
 * Excel, PowerPoint, XER, JSON, CSV, plain text, XML and HTML, and split into
 * cited excerpts for the language model. XER files are also read exactly by
 * the schedule parser, so their dates and milestones are facts, not model
 * output. What cannot be read — scanned pages, images, legacy binary Office
 * files, archives — is reported with the reason, never guessed at.
 */

import { buildSchedule, projectView } from "../xer/model";
import { decodeXerBuffer } from "../xer/parse";
import { formatDate } from "../xer/format";
import { decodeXml, readXlsx, readZip } from "../planning/xlsx";
import type { DocKind, EvidenceChunk, EvidenceDoc, ExtractedItem } from "./intelligence";

const CHUNK_CHARS = 6000;
const MAX_TEXT_CHARS = 400_000;
const OCR_LANGUAGES = ["eng", "ara"];
const MAX_OCR_PAGES = 30;

export type ReadProgress = { done: number; total: number; current: string };
export type ReadOptions = { ocr?: boolean; onStatus?: (status: string) => void };

/* ----------------------------------------------------------------- OCR */

type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};
type CreateWorker = (langs: string[]) => Promise<OcrWorker>;
type TesseractModule = { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };

let ocrWorker: Promise<OcrWorker> | null = null;

/** One English + Arabic Tesseract worker per reading session; engine and language data download on first use. */
function getOcr(): Promise<OcrWorker> {
  if (!ocrWorker) {
    ocrWorker = import("tesseract.js").then((mod) => {
      const t = mod as unknown as TesseractModule;
      const create = t.createWorker || t.default?.createWorker;
      if (!create) throw new Error("the OCR engine did not load");
      return create(OCR_LANGUAGES);
    });
    ocrWorker.catch(() => {
      ocrWorker = null;
    });
  }
  return ocrWorker;
}

export async function releaseOcr(): Promise<void> {
  const pending = ocrWorker;
  ocrWorker = null;
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    /* worker never started or is already gone */
  }
}

async function ocrImage(image: unknown): Promise<{ text: string; confidence: number }> {
  const worker = await getOcr();
  const result = await worker.recognize(image);
  return { text: result.data.text || "", confidence: Math.round(result.data.confidence || 0) };
}

let docCounter = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(docCounter++).toString(36)}`;

export function kindOf(name: string): DocKind {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "pdf";
  if (["docx", "docm", "dotx"].includes(ext)) return "word";
  if (["xlsx", "xlsm", "xltx"].includes(ext)) return "excel";
  if (["pptx", "pptm"].includes(ext)) return "powerpoint";
  if (ext === "xer") return "xer";
  if (ext === "json") return "json";
  if (["txt", "csv", "tsv", "md", "xml", "html", "htm", "log", "rtf"].includes(ext)) return "text";
  if (["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic"].includes(ext)) return "image";
  if (["doc", "xls", "ppt", "mpp"].includes(ext)) return "legacy-office";
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "archive";
  return "unknown";
}

/** Split one readable unit (page, sheet, slide, section) into excerpts at paragraph boundaries. */
function chunkUnit(docId: string, docName: string, location: string, text: string): EvidenceChunk[] {
  const clean = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: EvidenceChunk[] = [];
  let buffer = "";
  let part = 1;
  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({ id: nextId("c"), docId, docName, location: part > 1 || buffer.length < clean.length ? `${location} · part ${part}` : location, text: buffer.trim() });
    part++;
    buffer = "";
  };
  for (const paragraph of clean.split(/\n\n+/)) {
    if (buffer.length + paragraph.length + 2 > CHUNK_CHARS) flush();
    if (paragraph.length > CHUNK_CHARS) {
      for (let i = 0; i < paragraph.length; i += CHUNK_CHARS) {
        buffer = paragraph.slice(i, i + CHUNK_CHARS);
        flush();
      }
    } else {
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
  }
  flush();
  if (chunks.length === 1) chunks[0].location = location;
  return chunks;
}

function blank(file: File, kind: DocKind, status: EvidenceDoc["status"], reason: string): EvidenceDoc {
  return { id: nextId("d"), name: file.name, size: file.size, kind, status, reason, units: 0, chars: 0, chunks: [], parserItems: [] };
}

function finish(doc: EvidenceDoc, units: { location: string; text: string }[], unitLabel: string): EvidenceDoc {
  let used = 0;
  let truncated = false;
  for (const unit of units) {
    if (used >= MAX_TEXT_CHARS) {
      truncated = true;
      break;
    }
    const text = unit.text.slice(0, MAX_TEXT_CHARS - used);
    used += text.length;
    doc.chunks.push(...chunkUnit(doc.id, doc.name, unit.location, text));
  }
  doc.units = units.length;
  doc.chars = used;
  if (!used) {
    doc.status = "not-read";
  } else if (truncated) {
    doc.status = "partial";
    doc.reason = `${doc.reason} Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters are analysed.`;
  }
  if (!doc.reason) doc.reason = `${units.length} ${unitLabel} read`;
  return doc;
}

/* -------------------------------------------------------------- readers */

async function readPdf(file: File, options: ReadOptions): Promise<EvidenceDoc> {
  const doc = blank(file, "pdf", "read", "");
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  // Decoders and font data are served from /pdfjs (copied from pdfjs-dist before dev and build).
  // Without the wasm decoders, CCITT and JBIG2 scans — the usual scanner letter — render blank and OCR sees nothing.
  const assets = new URL("/pdfjs/", window.location.href).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    wasmUrl: `${assets}wasm/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    iccUrl: `${assets}iccs/`,
  });
  const pdf = await task.promise;
  const units: { location: string; text: string }[] = [];
  let emptyPages = 0;
  let ocrPages = 0;
  let ocrError = "";
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) text += "\n";
      text += item.str;
      if (item.hasEOL) text += "\n";
      lastY = y;
    }
    if (text.trim().length >= 20) {
      units.push({ location: `page ${n}`, text });
      continue;
    }
    // No text layer: a scanned page. Render it and read it with OCR when that is switched on.
    if (options.ocr === false || ocrPages >= MAX_OCR_PAGES || ocrError) {
      emptyPages++;
      continue;
    }
    try {
      options.onStatus?.(`OCR page ${n} of ${pdf.numPages}`);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("the page could not be rendered");
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const read = await ocrImage(canvas);
      if (read.text.trim().length >= 20) {
        units.push({ location: `page ${n} (OCR ${read.confidence}%)`, text: read.text });
        ocrPages++;
      } else {
        emptyPages++;
      }
    } catch (cause) {
      ocrError = cause instanceof Error ? cause.message : "OCR failed";
      emptyPages++;
    }
  }
  await task.destroy();
  const textPages = units.length - ocrPages;
  const ocrNote = options.ocr === false
    ? "OCR is switched off"
    : ocrError
      ? `OCR could not run (${ocrError})`
      : `no readable text, or more than ${MAX_OCR_PAGES} scanned pages`;
  if (!units.length) {
    doc.status = "not-read";
    doc.reason = `${pdf.numPages} page(s) carry no readable text — ${ocrNote}.`;
    doc.units = pdf.numPages;
    return doc;
  }
  const parts = [`${textPages} page(s) read from text`];
  if (ocrPages) parts.push(`${ocrPages} scanned page(s) read by OCR (English + Arabic)`);
  if (emptyPages) {
    doc.status = "partial";
    parts.push(`${emptyPages} page(s) not read — ${ocrNote}`);
  }
  doc.reason = parts.join("; ");
  return finish(doc, units, "pages");
}

function wordText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, " | ")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeXml(line).replace(/\s*\|\s*$/, ""))
    .join("\n");
}

async function readWord(file: File): Promise<EvidenceDoc> {
  const doc = blank(file, "word", "read", "");
  const zip = await readZip(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  const parts = ["word/document.xml", ...Array.from(zip.keys()).filter((k) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(k)).sort()];
  const units = parts
    .filter((p) => zip.has(p))
    .map((p) => ({ location: p === "word/document.xml" ? "document" : p.replace(/^word\/|\.xml$/g, ""), text: wordText(decoder.decode(zip.get(p)!)) }));
  doc.reason = units.length ? "Document text, tables, headers and footers read" : "No document body found in the file";
  return finish(doc, units, "parts");
}

async function readPowerPoint(file: File): Promise<EvidenceDoc> {
  const doc = blank(file, "powerpoint", "read", "");
  const zip = await readZip(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  const slides = Array.from(zip.keys())
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const units = slides.map((s, i) => ({
    location: `slide ${i + 1}`,
    text: decoder.decode(zip.get(s)!).replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "").split("\n").map(decodeXml).join("\n"),
  }));
  doc.reason = `${slides.length} slide(s) read`;
  return finish(doc, units, "slides");
}

async function readExcel(file: File): Promise<EvidenceDoc> {
  const doc = blank(file, "excel", "read", "");
  const sheets = await readXlsx(await file.arrayBuffer());
  const units: { location: string; text: string }[] = [];
  for (const sheet of sheets) {
    const rows = sheet.rows.filter((r) => r && r.some((v) => v !== null && v !== ""));
    // Excerpts of about 120 rows keep a table's header close to its data.
    for (let start = 0; start < rows.length; start += 120) {
      const slice = rows.slice(start, start + 120);
      const text = slice.map((r) => r.map((v) => (v === null ? "" : String(v))).join(" | ").replace(/(\s\|\s)+$/, "")).join("\n");
      units.push({ location: `sheet "${sheet.name}" rows ${start + 1}–${start + slice.length}`, text });
    }
  }
  doc.reason = `${sheets.length} sheet(s) read`;
  return finish(doc, units, "sheet sections");
}

async function readXer(file: File): Promise<EvidenceDoc> {
  const doc = blank(file, "xer", "read", "");
  const text = decodeXerBuffer(await file.arrayBuffer());
  const schedule = buildSchedule(text, file.name, file.size);
  const view = projectView(schedule);
  if (!view) {
    doc.status = "not-read";
    doc.reason = "No project found in the XER";
    return doc;
  }
  const quote = (table: string, field: string, value: string) => `${table}.${field} = ${value}`;
  const item = (kind: ExtractedItem["kind"], category: string, field: string, value: string, q: string, date?: string): ExtractedItem => ({
    id: nextId("p"), kind, category, field, value, date, quote: q, confidence: 1, verified: true,
    docId: doc.id, docName: doc.name, location: "XER PROJECT / TASK tables", source: "parser", model: "XER parser",
  });
  const raw = view.proj.raw;
  const items: ExtractedItem[] = [];
  if (view.longName) items.push(item("fact", "identity", "project_name", view.longName, quote("PROJWBS", "wbs_name (project node)", view.longName)));
  if (view.name) items.push(item("fact", "identity", "project_code", view.name, quote("PROJECT", "proj_short_name", view.name)));
  if (raw.plan_start_date) items.push(item("fact", "dates", "planned_start", formatDate(view.proj.planStart || null), quote("PROJECT", "plan_start_date", raw.plan_start_date)));
  if (raw.plan_end_date) items.push(item("fact", "dates", "schedule_must_finish", formatDate(view.mustFinish || null), quote("PROJECT", "plan_end_date", raw.plan_end_date)));
  if (raw.last_recalc_date) items.push(item("fact", "schedule", "data_date", formatDate(view.dataDate), quote("PROJECT", "last_recalc_date", raw.last_recalc_date)));
  if (raw.scd_end_date) items.push(item("fact", "schedule", "scheduled_finish", formatDate(view.proj.schedEnd || null), quote("PROJECT", "scd_end_date", raw.scd_end_date)));
  items.push(item("fact", "schedule", "schedule_activity_count", String(view.tasks.length), quote("TASK", "rows", String(view.tasks.length))));
  const calendars = Array.from(new Set(view.tasks.map((t) => `${t.calName} (${t.cal.dayHours} h/day)`)));
  if (calendars.length) items.push(item("fact", "schedule", "working_calendar", calendars.slice(0, 6).join("; "), quote("CALENDAR", "clndr_name / day_hr_cnt", calendars.slice(0, 6).join("; "))));
  const milestones = view.tasks.filter((t) => t.isMile).sort((a, b) => +(a.finish || a.start || 0) - +(b.finish || b.start || 0));
  for (const m of milestones.slice(0, 80)) {
    const when = m.finish || m.start;
    items.push(item("milestone", "milestone", m.code, m.name, quote("TASK", `${m.code} ${m.typeName}`, formatDate(when)), formatDate(when)));
  }
  doc.parserItems = items;

  const summary = [
    `Primavera P6 schedule ${view.name} — ${view.longName}`,
    `Data date ${formatDate(view.dataDate)}; planned start ${formatDate(view.proj.planStart || null)}; must finish ${formatDate(view.mustFinish || null)}; scheduled finish ${formatDate(view.finish)}.`,
    `${view.tasks.length} activities, ${view.links.length} relationships, ${milestones.length} milestones.`,
    `Calendars: ${calendars.join("; ")}.`,
    `Top-level WBS: ${view.wbsRoots.flatMap((r) => r.children.length ? r.children : [r]).slice(0, 30).map((w) => w.name).join("; ")}.`,
    "Milestones:",
    ...milestones.slice(0, 200).map((m) => `${m.code} ${m.name} — ${formatDate(m.finish || m.start)}${m.done ? " (actual)" : ""}`),
  ].join("\n");
  doc.reason = `Schedule read exactly: ${view.tasks.length} activities, ${milestones.length} milestones`;
  return finish(doc, [{ location: "schedule summary", text: summary }], "summary");
}

async function readImage(file: File, options: ReadOptions): Promise<EvidenceDoc> {
  const doc = blank(file, "image", "read", "");
  if (options.ocr === false) {
    doc.status = "not-read";
    doc.reason = "Image — OCR is switched off.";
    return doc;
  }
  options.onStatus?.("OCR");
  const read = await ocrImage(file);
  if (read.text.trim().length < 20) {
    doc.status = "not-read";
    doc.reason = `OCR found no readable text in the image (confidence ${read.confidence}%).`;
    return doc;
  }
  doc.reason = `Image text read by OCR (English + Arabic, confidence ${read.confidence}%)`;
  return finish(doc, [{ location: `image (OCR ${read.confidence}%)`, text: read.text }], "image");
}

async function readTextLike(file: File, kind: DocKind): Promise<EvidenceDoc> {
  const doc = blank(file, kind, "read", "");
  let text = await file.text();
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (kind === "json") {
    try {
      text = JSON.stringify(JSON.parse(text), null, 1);
    } catch {
      doc.reason = "Not valid JSON — read as plain text. ";
    }
  } else if (["html", "htm", "xml"].includes(ext)) {
    text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ");
    text = decodeXml(text);
  } else if (ext === "rtf") {
    text = text.replace(/\\par[d]?/g, "\n").replace(/\{\*?\\[^{}]+}|[{}]|\\[a-z]+-?\d* ?/gi, "");
  }
  const units: { location: string; text: string }[] = [];
  const sections = text.split(/\n{3,}/);
  let section = "";
  let n = 1;
  for (const s of sections) {
    if (section.length + s.length > CHUNK_CHARS * 4) {
      units.push({ location: `section ${n++}`, text: section });
      section = "";
    }
    section += `${s}\n\n`;
  }
  if (section.trim()) units.push({ location: units.length ? `section ${n}` : "text", text: section });
  doc.reason = `${doc.reason}Text read`.trim();
  return finish(doc, units, "sections");
}

/* ----------------------------------------------------------------- entry */

export async function readEvidenceFile(file: File, options: ReadOptions = {}): Promise<EvidenceDoc> {
  const kind = kindOf(file.name);
  try {
    switch (kind) {
      case "pdf": return await readPdf(file, options);
      case "word": return await readWord(file);
      case "excel": return await readExcel(file);
      case "powerpoint": return await readPowerPoint(file);
      case "xer": return await readXer(file);
      case "json":
      case "text": return await readTextLike(file, kind);
      case "image": return await readImage(file, options);
      case "legacy-office": return blank(file, kind, "not-read", "Legacy binary Office file — save it as .docx, .xlsx or .pptx to read it.");
      case "archive": return blank(file, kind, "not-read", "Archive — extract it and upload the files inside.");
      default: {
        // Try it as text; keep it only if it really is readable text.
        const sample = await file.slice(0, 4096).text();
        const printable = sample.replace(/[\x20-\x7e\s؀-ۿ -ɏ]/g, "").length / Math.max(1, sample.length);
        if (sample.trim() && printable < 0.05) return await readTextLike(file, "text");
        return blank(file, "unknown", "not-read", "Unrecognised binary format — catalogued, not read.");
      }
    }
  } catch (cause) {
    return blank(file, kind, "not-read", `Could not be read: ${cause instanceof Error ? cause.message : "unknown error"}.`);
  }
}

export async function readEvidenceFiles(
  files: File[],
  onProgress?: (p: ReadProgress) => void,
  options: ReadOptions = {},
): Promise<EvidenceDoc[]> {
  const docs: EvidenceDoc[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const name = files[i].name;
      onProgress?.({ done: i, total: files.length, current: name });
      const onStatus = (status: string) => onProgress?.({ done: i, total: files.length, current: `${name} · ${status}` });
      docs.push(await readEvidenceFile(files[i], { ...options, onStatus }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await releaseOcr();
  }
  onProgress?.({ done: files.length, total: files.length, current: "" });
  return docs;
}
