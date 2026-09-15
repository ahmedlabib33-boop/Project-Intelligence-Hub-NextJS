"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ReportFamily = {
  key: string;
  title: string;
  summary: string;
  native_schedule_required: boolean;
  requires: string[];
};

type ProjectInput = {
  project_id: string;
  project_key: string;
  project_display_name: string;
  sector: string;
  status: string;
  contract_value: number | null;
  planned_progress: number | null;
  actual_progress: number | null;
  progress_variance: number | null;
  spi: number | null;
  cpi: number | null;
  delay_days: number | null;
  risk_score: number | null;
  data_quality: number | null;
  last_updated: string | null;
};

type FormState = {
  projectName: string;
  projectId: string;
  reportingPeriod: string;
  preparedBy: string;
  reportStatus: string;
  notes: string;
};

const INPUT_COLUMNS = ["Metric", "Value", "Status", "Notes"];

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function safeFileName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "project-report";
}

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function displayMetric(value: number | null, suffix = "") {
  return value === null || value === undefined ? "Not supplied" : `${value.toLocaleString()}${suffix}`;
}

function displayPercent(value: number | null) {
  return value === null || value === undefined ? "Not supplied" : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function projectRows(project: ProjectInput) {
  return [
    ["Planned progress", displayPercent(project.planned_progress), "Program input", "Selected project payload"],
    ["Actual progress", displayPercent(project.actual_progress), "Program input", "Selected project payload"],
    ["Progress variance", displayPercent(project.progress_variance), "Program input", "Selected project payload"],
    ["Schedule performance index", displayMetric(project.spi), "Program input", "Selected project payload"],
    ["Cost performance index", displayMetric(project.cpi), "Program input", "Selected project payload"],
    ["Delay exposure", displayMetric(project.delay_days, " days"), "Program input", "Selected project payload"],
    ["Risk score", displayMetric(project.risk_score), "Program input", "Selected project payload"],
    ["Data quality", displayMetric(project.data_quality, "%"), "Program input", "Selected project payload"],
  ];
}

export default function UniversalReportBuilder({ project, family }: { project: ProjectInput; family: ReportFamily }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const initialRows = useMemo(() => projectRows(project), [project]);
  const [form, setForm] = useState<FormState>({
    projectName: project.project_display_name,
    projectId: project.project_id,
    reportingPeriod: project.last_updated || "",
    preparedBy: "",
    reportStatus: project.status || "Draft",
    notes: "",
  });
  const [csvText, setCsvText] = useState(() => toCsv([INPUT_COLUMNS, ...initialRows]));
  const [fileLabel, setFileLabel] = useState("Program inputs loaded");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm({
      projectName: project.project_display_name,
      projectId: project.project_id,
      reportingPeriod: project.last_updated || "",
      preparedBy: "",
      reportStatus: project.status || "Draft",
      notes: "",
    });
    setCsvText(toCsv([INPUT_COLUMNS, ...projectRows(project)]));
    setFileLabel("Program inputs loaded");
    setState("idle");
    setMessage("");
  }, [project]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadCsv(file?: File) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setState("error");
      setMessage("The CSV needs a header row and at least one data row.");
      return;
    }
    setCsvText(text);
    setFileLabel(`${file.name} loaded`);
    setState("idle");
    setMessage("");
  }

  function downloadTemplate() {
    downloadText(`${safeFileName(family.key)}-input-template.csv`, toCsv([INPUT_COLUMNS, ["", "", "", ""]]), "text/csv;charset=utf-8");
  }

  async function generatePowerPoint() {
    const parsed = parseCsv(csvText);
    const dataRows = parsed.slice(1).filter((row) => row.some(Boolean));
    if (!form.projectName.trim() || !form.projectId.trim() || !dataRows.length) {
      setState("error");
      setMessage("Project name, project ID, and at least one CSV data row are required.");
      return;
    }

    setState("working");
    setMessage("Building editable PowerPoint from the current form and CSV data...");
    try {
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = form.preparedBy.trim() || "Project Intelligence Hub user";
      pptx.company = "SAMCO";
      pptx.subject = family.title;
      pptx.title = `${form.projectName} - ${family.title}`;
      pptx.theme = {
        headFontFace: "Aptos Display",
        bodyFontFace: "Aptos",
      };

      const navy = "003366";
      const cyan = "39D7D2";
      const white = "FFFFFF";
      const ink = "122333";
      const muted = "667788";
      const pale = "F4F7FA";
      const amber = "DAA520";

      const cover = pptx.addSlide();
      cover.background = { color: navy };
      cover.addText("SAMCO · PROJECT CONTROLS", { x: 0.65, y: 0.55, w: 6.5, h: 0.35, fontSize: 13, bold: true, color: cyan, charSpacing: 1.4 });
      cover.addText(family.title, { x: 0.65, y: 2.05, w: 11.9, h: 1.2, fontSize: 31, bold: true, color: white, align: "center", breakLine: false, fit: "shrink" });
      cover.addText(form.projectName, { x: 0.65, y: 3.45, w: 11.9, h: 0.55, fontSize: 20, color: "D6E4EF", align: "center", fit: "shrink" });
      cover.addText(`Project ID: ${form.projectId}  |  Reporting period: ${form.reportingPeriod || "Not supplied"}`, { x: 0.65, y: 4.2, w: 11.9, h: 0.38, fontSize: 11, color: "AAC1D4", align: "center" });
      cover.addText(`Prepared by: ${form.preparedBy.trim() || "Not supplied"}`, { x: 0.65, y: 6.35, w: 11.9, h: 0.3, fontSize: 10, color: "AAC1D4", align: "center" });

      const report = pptx.addSlide();
      report.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.9, fill: { color: navy }, line: { color: navy } });
      report.addText(family.title, { x: 0.35, y: 0.16, w: 9.8, h: 0.45, fontSize: 22, bold: true, color: white, fit: "shrink" });
      report.addText(form.reportStatus || "Draft", { x: 11.2, y: 0.2, w: 1.7, h: 0.38, fontSize: 10, bold: true, color: white, align: "center", valign: "middle", fill: { color: amber }, margin: 0.04, fit: "shrink" });

      dataRows.slice(0, 3).forEach((row, index) => {
        const x = 0.35 + index * 2.75;
        report.addShape(pptx.ShapeType.roundRect, { x, y: 1.12, w: 2.45, h: 0.85, rectRadius: 0.08, fill: { color: pale }, line: { color: index === 0 ? "1E90FF" : index === 1 ? "228B22" : amber, width: 1.5 } });
        report.addText(row[0] || `Metric ${index + 1}`, { x: x + 0.1, y: 1.22, w: 2.25, h: 0.2, fontSize: 9, color: muted, align: "center", fit: "shrink" });
        report.addText(row[1] || "Not supplied", { x: x + 0.1, y: 1.49, w: 2.25, h: 0.28, fontSize: 16, bold: true, color: ink, align: "center", fit: "shrink" });
      });

      const tableRows = [
        INPUT_COLUMNS.map((cell) => ({ text: cell, options: { bold: true, color: white, fill: navy, align: "center" as const } })),
        ...dataRows.slice(0, 10).map((row) => INPUT_COLUMNS.map((_, index) => ({ text: row[index] || "" }))),
      ];
      report.addTable(tableRows, {
        x: 0.35, y: 2.2, w: 12.6, h: 3.55,
        border: { type: "solid", color: "CCD7E0", pt: 0.6 },
        color: ink, fontSize: 8.5, margin: 0.06,
        rowH: 0.29, colW: [2.6, 1.7, 1.7, 6.6],
        fill: { color: pale }, valign: "middle",
      });
      report.addText("REPORT NOTES", { x: 0.35, y: 6.05, w: 2, h: 0.25, fontSize: 9, bold: true, color: navy });
      report.addText(form.notes.trim() || "No additional notes supplied.", { x: 0.35, y: 6.32, w: 12.6, h: 0.55, fontSize: 9.5, color: muted, breakLine: false, fit: "shrink", margin: 0.02 });
      report.addText(`Source: selected program project + ${fileLabel}. Generated ${new Date().toLocaleString()}.`, { x: 0.35, y: 7.05, w: 12.6, h: 0.18, fontSize: 7.5, color: muted, align: "right", margin: 0 });

      const source = pptx.addSlide();
      source.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.9, fill: { color: navy }, line: { color: navy } });
      source.addText("Input & Governance Register", { x: 0.35, y: 0.16, w: 9.8, h: 0.45, fontSize: 22, bold: true, color: white });
      source.addText("Report generation inputs", { x: 0.45, y: 1.2, w: 4.2, h: 0.3, fontSize: 15, bold: true, color: navy });
      const register = [
        ["Project", form.projectName], ["Project ID", form.projectId], ["Project key", project.project_key],
        ["Sector", project.sector || "Not supplied"], ["Report family", family.title],
        ["Reporting period", form.reportingPeriod || "Not supplied"], ["Prepared by", form.preparedBy || "Not supplied"],
        ["Input rows", String(dataRows.length)], ["Input source", fileLabel],
      ].map((row) => row.map((text) => ({ text })));
      source.addTable(register, { x: 0.45, y: 1.65, w: 8.5, h: 4.65, colW: [2.2, 6.3], border: { type: "solid", color: "CCD7E0", pt: 0.7 }, fill: { color: pale }, color: ink, fontSize: 11, margin: 0.09, rowH: 0.48 });
      source.addText("This presentation contains only the selected project payload and the inputs supplied in this form. It does not read another project, execute a private local engine, or invent missing values.", { x: 9.35, y: 1.65, w: 3.3, h: 1.6, fontSize: 11, color: muted, margin: 0.06, valign: "middle", fill: { color: "EAF4F7" }, line: { color: cyan, width: 1 } });

      const fileName = `${safeFileName(form.projectName)}-${safeFileName(family.key)}-${new Date().toISOString().slice(0, 10)}.pptx`;
      await pptx.writeFile({ fileName });
      setState("done");
      setMessage(`Downloaded ${fileName}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "PowerPoint generation failed.");
    }
  }

  return (
    <section className="feature-card universal-report-builder">
      <div className="feature-card-head">
        <div>
          <p className="eyebrow">Vercel Browser Report Builder</p>
          <h3>Create {family.title}</h3>
          <small>Uses the active project and your current form/CSV inputs. Nothing is written back to the project.</small>
        </div>
        <span>Editable PPTX</span>
      </div>

      <div className="universal-builder-form">
        <label>Project name<input value={form.projectName} onChange={(event) => update("projectName", event.target.value)} /></label>
        <label>Project ID<input value={form.projectId} onChange={(event) => update("projectId", event.target.value)} /></label>
        <label>Reporting period<input value={form.reportingPeriod} onChange={(event) => update("reportingPeriod", event.target.value)} placeholder="e.g. August 2026" /></label>
        <label>Prepared by<input value={form.preparedBy} onChange={(event) => update("preparedBy", event.target.value)} placeholder="Enter author name" /></label>
        <label>Report status<input value={form.reportStatus} onChange={(event) => update("reportStatus", event.target.value)} placeholder="Draft / Final / Approved" /></label>
        <label className="universal-builder-notes">Report notes<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Enter only verified report observations or leave blank." /></label>
      </div>

      <div className="universal-builder-data">
        <div>
          <b>Report data</b>
          <small>{fileLabel}. Columns: {INPUT_COLUMNS.join(", ")}.</small>
        </div>
        <div className="universal-builder-actions">
          <button type="button" onClick={downloadTemplate}>Download CSV template</button>
          <button type="button" onClick={() => uploadRef.current?.click()}>Upload completed CSV</button>
          <input ref={uploadRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void loadCsv(event.target.files?.[0])} />
          <button type="button" className="primary" disabled={state === "working"} onClick={() => void generatePowerPoint()}>{state === "working" ? "Building..." : "Generate & Download PowerPoint"}</button>
        </div>
      </div>
      <textarea className="universal-builder-csv" value={csvText} onChange={(event) => { setCsvText(event.target.value); setFileLabel("Form CSV edited"); }} aria-label="Report CSV input" spellCheck={false} />
      {message ? <p className={`universal-builder-message ${state}`}>{message}</p> : null}
    </section>
  );
}
