"use client";

/**
 * Project brief & requirements — the first step of schedule creation.
 *
 * Reads every uploaded document in the browser (PDF, Word, Excel, PowerPoint,
 * XER, JSON, text), has the Hub's language model extract the project's facts,
 * requirements, milestones and parties with exact quotes, and lets the planner
 * confirm, edit, reject and question every item. Items whose quote cannot be
 * found in the document are kept aside as unverified; data no document states
 * is listed as missing. Nothing is filled in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { readEvidenceFiles, type ReadProgress } from "../../../lib/evidence/extract";
import {
  buildMasterData, groupItems, normalizeText, REQUIRED_FIELDS,
  type EvidenceDoc, type ExtractedItem, type GroupedItem, type MasterRow, type ReviewMap,
} from "../../../lib/evidence/intelligence";
import {
  askEvidence, extractFromChunks, writeBrief,
  type AiHealth, type Answer, type Brief, type ExtractProgress,
} from "../../../lib/evidence/run";
import { normLabel } from "../../../lib/planning/library";
import { writeXlsx } from "../../../lib/planning/xlsx";
import { formatNum } from "../../../lib/xer/format";
import { Badge, Card, Kpi, Kpis, SectionTitle } from "../xer/ui";
import { downloadBlob } from "./LibraryWorkspace";

type View = "brief" | "master" | "requirements" | "dates" | "missing" | "ask" | "documents" | "unverified";

type Saved = { items: ExtractedItem[]; reviews: ReviewMap; brief: Brief | null; answers: Omit<Answer, "excerpts">[]; docs: Omit<EvidenceDoc, "chunks">[] };

const STATUS_TONE: Record<string, string> = { confirmed: "ok", edited: "info", extracted: "mut", conflict: "warn", missing: "bad", rejected: "bad", multiple: "info" };

/** What is kept between visits: document metadata and answers, not the document text itself. */
const docMeta = (d: EvidenceDoc): Omit<EvidenceDoc, "chunks"> => ({
  id: d.id, name: d.name, size: d.size, kind: d.kind, status: d.status, reason: d.reason, units: d.units, chars: d.chars, parserItems: d.parserItems,
});
const answerMeta = (a: Answer): Omit<Answer, "excerpts"> => ({ question: a.question, answer: a.answer, model: a.model, at: a.at });

function storageKey(projectName: string) {
  return `pih.scheduleIntelligence.evidence.v1.${normLabel(projectName).replace(/ /g, "-") || "project"}`;
}

function loadSaved(key: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export default function EvidenceIntelligenceStep({ evidence, projectName, health, onRecheckAi }: {
  evidence: File[];
  projectName: string;
  /** Language-model health, checked by the stage so its status can show it too. */
  health: AiHealth;
  onRecheckAi: () => void;
}) {
  const key = storageKey(projectName);
  const [saved] = useState<Saved | null>(() => (typeof window === "undefined" ? null : loadSaved(key)));
  const [docs, setDocs] = useState<EvidenceDoc[]>(() => (saved?.docs || []).map((d) => ({ ...d, chunks: [] })));
  const [items, setItems] = useState<ExtractedItem[]>(() => saved?.items || []);
  const [reviews, setReviews] = useState<ReviewMap>(() => saved?.reviews || {});
  const [brief, setBrief] = useState<Brief | null>(() => saved?.brief || null);
  const [answers, setAnswers] = useState<Answer[]>(() => (saved?.answers || []).map((a) => ({ ...a, excerpts: [] })));
  const [view, setView] = useState<View>("brief");
  const [reading, setReading] = useState<ReadProgress | null>(null);
  const [extracting, setExtracting] = useState<ExtractProgress | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [ocr, setOcr] = useState(true);
  const [question, setQuestion] = useState("");
  const abort = useRef<AbortController | null>(null);

  const wired = health.state === "wired";
  const chunks = useMemo(() => docs.flatMap((d) => d.chunks), [docs]);
  const textLoaded = chunks.length > 0;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const payload: Saved = {
          items, reviews, brief,
          answers: answers.map(answerMeta),
          docs: docs.map(docMeta),
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        /* storage full or blocked — results stay on screen for this session */
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [key, items, reviews, brief, answers, docs]);

  const master = useMemo(() => buildMasterData(items, reviews, includeUnverified), [items, reviews, includeUnverified]);
  const requirements = useMemo(() => groupItems(items, "requirement", reviews, includeUnverified), [items, reviews, includeUnverified]);
  const milestones = useMemo(() => groupItems(items, "milestone", reviews, includeUnverified), [items, reviews, includeUnverified]);
  const parties = useMemo(() => groupItems(items, "party", reviews, includeUnverified), [items, reviews, includeUnverified]);
  const unverified = items.filter((i) => !i.verified);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const requiredRows = master.filter((r) => r.required);
  const found = requiredRows.filter((r) => r.status !== "missing").length;
  const conflicts = master.filter((r) => r.status === "conflict");

  const review = (id: string, status: "confirmed" | "rejected" | "edited", value?: string) =>
    setReviews((prev) => ({ ...prev, [id]: { status, value, at: new Date().toISOString() } }));
  const clearReview = (id: string) =>
    setReviews((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const readDocuments = async (): Promise<EvidenceDoc[]> => {
    setError("");
    const read = await readEvidenceFiles(evidence, setReading, { ocr });
    setReading(null);
    setDocs(read);
    // Replace parser facts from earlier reads; keep model items for documents that are still present.
    const names = new Set(read.map((d) => d.name));
    setItems((prev) => [...prev.filter((i) => i.source === "ai" && names.has(i.docName)), ...read.flatMap((d) => d.parserItems)]);
    return read;
  };

  const analyse = async () => {
    const read = textLoaded && docs.length === evidence.length ? docs : await readDocuments();
    const todo = read.flatMap((d) => d.chunks);
    if (!todo.length) {
      setError("None of the documents contains readable text to analyse.");
      return;
    }
    const names = new Set(read.map((d) => d.name));
    setItems((prev) => prev.filter((i) => i.source === "parser" && names.has(i.docName)));
    setBrief(null);
    const controller = new AbortController();
    abort.current = controller;
    setError("");
    const progress = await extractFromChunks(
      todo,
      (found) => setItems((prev) => [...prev, ...found]),
      setExtracting,
      controller.signal,
    );
    abort.current = null;
    setExtracting(null);
    if (progress.failed) setError(`${progress.failed} excerpt(s) could not be analysed: ${progress.lastError}`);
    if (!controller.signal.aborted) setView("brief");
  };

  const makeBrief = async () => {
    setBusy("Writing the project brief");
    setError("");
    try {
      const reviewed: ExtractedItem[] = master
        .filter((r) => r.status === "confirmed" || r.status === "edited")
        .map((r) => ({
          id: `R-${r.field}`, kind: "fact", category: r.category, field: r.field, value: r.value, quote: r.value, confidence: 1,
          verified: true, docId: "review", docName: "Planner review", location: "", source: "parser", model: "planner",
        }));
      const reviewedFields = new Set(reviewed.map((r) => r.field));
      const basis = [
        ...reviewed,
        ...items.filter((i) => (includeUnverified || i.verified) && !(i.kind === "fact" && reviewedFields.has(i.field)) && reviews[i.id]?.status !== "rejected"),
      ];
      if (!basis.length) throw new Error("There are no extracted items to write a brief from yet.");
      setBrief(await writeBrief(basis));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The brief could not be written.");
    } finally {
      setBusy("");
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy("Answering from the documents");
    setError("");
    try {
      const answer = await askEvidence(q, chunks);
      setAnswers((prev) => [answer, ...prev]);
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The question could not be answered.");
    } finally {
      setBusy("");
    }
  };

  const exportExcel = () => {
    const sheets = [
      { name: "Project brief", rows: [["Brief"], [brief?.brief || "Not written"], [], ["Main requirement", "Type", "Source items"], ...(brief?.main_requirements || []).map((r) => [r.requirement, r.type, r.item_ids.join(", ")]), [], ["Gap"], ...(brief?.gaps || []).map((g) => [g])] },
      { name: "Master data", rows: [["Field", "Value", "Status", "Required", "Sources"], ...master.map((r) => [r.label, r.value, r.status, r.required ? "Y" : "", r.candidates.flatMap((c) => c.items.map((i) => `${i.docName} · ${i.location}: "${i.quote}"`)).join(" || ")])] },
      { name: "Requirements", rows: [["Type", "Requirement", "Status", "Sources"], ...requirements.map((g) => [g.category, g.text, g.status, g.items.map((i) => `${i.docName} · ${i.location}`).join(" || ")])] },
      { name: "Milestones", rows: [["Milestone", "Date", "Status", "Sources"], ...milestones.map((g) => [g.text, g.date || "", g.status, g.items.map((i) => `${i.docName} · ${i.location}`).join(" || ")])] },
      { name: "Parties", rows: [["Role", "Name", "Status", "Sources"], ...parties.map((g) => [g.category, g.text, g.status, g.items.map((i) => `${i.docName} · ${i.location}`).join(" || ")])] },
      { name: "Documents", rows: [["Document", "Type", "Status", "Units", "Characters", "Excerpts", "Reason"], ...docs.map((d) => [d.name, d.kind, d.status, d.units, d.chars, d.chunks.length, d.reason])] },
      { name: "All items", rows: [["Id", "Kind", "Category", "Field", "Value", "Date", "Verified", "Confidence", "Document", "Location", "Quote", "Source", "Model"], ...items.map((i) => [i.id, i.kind, i.category, i.field, i.value, i.date || "", i.verified ? "Y" : "N", i.confidence, i.docName, i.location, i.quote, i.source, i.model])] },
    ];
    downloadBlob(`${projectName || "project"}-evidence-intelligence.xlsx`, writeXlsx(sheets) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  const readSummary = docs.length
    ? `${docs.filter((d) => d.status === "read").length} read · ${docs.filter((d) => d.status === "partial").length} partial · ${docs.filter((d) => d.status === "not-read").length} not read`
    : "Not read yet";

  return (
    <div className="xer-view">
      {!wired ? (
        <div className="xer-callout xer-callout-warn pl-not-wired">
          <span>
            <b>{health.state === "checking" ? "Checking the language model…" : "Language model not wired on this deployment."}</b> {health.detail} Documents can
            still be read and listed, and XER facts are read exactly; model extraction, the brief and questions stay empty until a model is connected.
          </span>
          <button type="button" className="xer-btn xer-btn-sm" onClick={onRecheckAi}>Check again</button>
        </div>
      ) : null}

      <Card
        eyebrow="Any format · read in the browser · analysed by the Hub's language model"
        title="Project brief, main data and requirements"
        aside={<Badge tone={wired ? "ok" : health.state === "checking" ? "info" : "bad"}>{wired ? `Wired · ${health.provider}` : health.state === "checking" ? "Checking" : "Not wired"}</Badge>}
      >
        <Kpis>
          <Kpi label="Documents" value={formatNum(evidence.length || docs.length)} note={readSummary} tone={docs.some((d) => d.status === "not-read") ? "warn" : ""} onClick={() => setView("documents")} />
          <Kpi label="Excerpts" value={formatNum(chunks.length)} note={textLoaded ? "Ready for analysis and questions" : docs.length ? "Re-read the documents to analyse or ask" : "Read the documents first"} />
          <Kpi label="Verified items" value={formatNum(items.filter((i) => i.verified).length)} note={`${formatNum(unverified.length)} unverified kept aside`} tone={items.length ? "ok" : ""} onClick={() => setView("master")} />
          <Kpi label="Main project data" value={`${found} / ${requiredRows.length}`} note={`${requiredRows.length - found} not stated in the documents`} tone={found === requiredRows.length ? "ok" : "warn"} onClick={() => setView("missing")} />
          <Kpi label="Conflicts" value={formatNum(conflicts.length)} note="Different values across documents" tone={conflicts.length ? "warn" : ""} onClick={() => setView("missing")} />
          <Kpi label="Model" value={wired ? health.extractionModel || "—" : "—"} note={wired ? `Brief and answers: ${health.reasoningModel}` : "No data — not wired"} />
        </Kpis>
        <div className="xer-toolbar pl-run">
          <button type="button" className="xer-btn" disabled={!evidence.length || !!reading || !!extracting} onClick={() => void readDocuments()}>
            Read {evidence.length || ""} document{evidence.length === 1 ? "" : "s"}
          </button>
          <button type="button" className="schedule-intelligence-primary" disabled={!wired || !evidence.length || !!reading || !!extracting || !!busy} onClick={() => void analyse()}>
            Analyse with AI
          </button>
          {extracting ? <button type="button" className="xer-btn" onClick={() => abort.current?.abort()}>Stop</button> : null}
          <button type="button" className="xer-btn" disabled={!wired || !items.length || !!busy || !!extracting} onClick={() => void makeBrief()}>
            {brief ? "Rewrite brief from current data" : "Write brief"}
          </button>
          <label className="xer-field">
            <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
            <span>OCR scanned pages and images (English + Arabic)</span>
          </label>
          <label className="xer-field">
            <input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} />
            <span>Include unverified items</span>
          </label>
          <button type="button" className="xer-btn xer-btn-sm" disabled={!items.length && !docs.length} onClick={exportExcel}>Export Excel</button>
          <button type="button" className="xer-btn xer-btn-sm" disabled={!items.length}
            onClick={() => downloadBlob(`${projectName || "project"}-evidence-intelligence.json`, JSON.stringify({ projectName, brief, master, requirements, milestones, parties, docs: docs.map(docMeta), items, reviews }, null, 2), "application/json")}>
            Export JSON
          </button>
          <button type="button" className="xer-btn xer-btn-sm" disabled={!items.length && !docs.length}
            onClick={() => {
              if (!window.confirm("Clear all read documents, extracted items, reviews, brief and answers for this project?")) return;
              setDocs([]); setItems([]); setReviews({}); setBrief(null); setAnswers([]);
            }}>
            Clear
          </button>
        </div>
        {!evidence.length ? <p className="xer-muted xer-note">Add documents with <b>Add evidence documents</b> above — any format.</p> : null}
        {reading ? <p className="xer-busy">Reading {reading.current} ({reading.done + 1} of {reading.total})…</p> : null}
        {extracting ? (
          <section className="schedule-intelligence-progress" aria-label="Analysis progress">
            <div>
              <span>Analysing {extracting.current || "…"} · {formatNum(extracting.items)} items · {formatNum(extracting.unverified)} unverified{extracting.failed ? ` · ${extracting.failed} failed` : ""}</span>
              <b>{extracting.done} / {extracting.total}</b>
            </div>
            <i><em style={{ width: `${extracting.total ? (extracting.done / extracting.total) * 100 : 0}%` }} /></i>
          </section>
        ) : null}
        {busy ? <p className="xer-busy">{busy}…</p> : null}
        {error ? <p className="xer-error">{error}</p> : null}
      </Card>

      <div className="xer-subtabs">
        {([
          ["brief", "Brief"], ["master", `Main data (${master.filter((r) => r.status !== "missing").length})`],
          ["requirements", `Requirements (${requirements.length})`], ["dates", `Milestones & parties (${milestones.length + parties.length})`],
          ["missing", `Missing & conflicts (${requiredRows.length - found + conflicts.length})`], ["ask", `Ask the documents (${answers.length})`],
          ["documents", `Documents (${docs.length})`], ["unverified", `Unverified (${unverified.length})`],
        ] as [View, string][]).map(([k, label]) => (
          <button key={k} type="button" className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      {view === "brief" ? <BriefView brief={brief} itemById={itemById} wired={wired} hasItems={items.length > 0} /> : null}
      {view === "master" ? <MasterView rows={master.filter((r) => r.status !== "missing" || r.candidates.length)} reviews={reviews} review={review} clearReview={clearReview} empty={wired ? "No data yet — analyse the documents." : "No data — the language model is not wired."} /> : null}
      {view === "requirements" ? <GroupView groups={requirements} review={review} clearReview={clearReview} title="Main requirements" empty={wired ? "No requirements extracted yet." : "No data — the language model is not wired."} /> : null}
      {view === "dates" ? (
        <>
          <GroupView groups={milestones} review={review} clearReview={clearReview} title="Milestones and key dates" empty={wired ? "No milestones extracted yet." : "No data — the language model is not wired (XER milestones appear once an XER is read)."} withDate />
          <GroupView groups={parties} review={review} clearReview={clearReview} title="Parties" empty={wired ? "No parties extracted yet." : "No data — the language model is not wired."} />
        </>
      ) : null}
      {view === "missing" ? <MissingView master={master} review={review} /> : null}
      {view === "ask" ? (
        <Card eyebrow="Answers cite the excerpts they rest on" title="Ask the documents">
          <div className="xer-toolbar">
            <input
              className="xer-input pl-question"
              placeholder={textLoaded ? "e.g. What are the delay damages and their cap? / ما هي مدة التنفيذ؟" : "Read the documents first"}
              value={question}
              disabled={!wired || !textLoaded}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void ask()}
            />
            <button type="button" className="schedule-intelligence-primary" disabled={!wired || !textLoaded || !question.trim() || !!busy} onClick={() => void ask()}>Ask</button>
          </div>
          {!answers.length ? (
            <div className="schedule-intelligence-empty"><b>{!wired ? "No data — the language model is not wired." : textLoaded ? "No questions asked yet." : "Read the documents to ask questions about them."}</b></div>
          ) : (
            answers.map((a) => (
              <div key={a.at} className="pl-answer">
                <p className="pl-answer-q">{a.question}</p>
                <p className="pl-answer-a" dir="auto">{a.answer}</p>
                {a.excerpts.length ? (
                  <details>
                    <summary>{a.excerpts.length} excerpt(s) used · {a.model}</summary>
                    <ol className="pl-excerpts">
                      {a.excerpts.map((c, i) => <li key={c.id}><b>[E{i + 1}] {c.docName} · {c.location}</b><span dir="auto">{c.text.slice(0, 600)}{c.text.length > 600 ? "…" : ""}</span></li>)}
                    </ol>
                  </details>
                ) : <small className="pl-sub">{a.model}{a.excerpts.length ? "" : " · excerpts are not kept after a reload"}</small>}
              </div>
            ))
          )}
        </Card>
      ) : null}
      {view === "documents" ? (
        <Card eyebrow="Read in this browser — never uploaded as files" title="Document inventory">
          {docs.length ? (
            <div className="schedule-intelligence-scroll">
              <table className="schedule-intelligence-table xer-table" style={{ minWidth: 900 }}>
                <thead><tr><th>Document</th><th>Type</th><th>Status</th><th style={{ textAlign: "right" }}>Units</th><th style={{ textAlign: "right" }}>Characters</th><th style={{ textAlign: "right" }}>Excerpts</th><th>What was read</th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td><b>{d.name}</b><small className="pl-sub">{formatNum(d.size / 1024, 0)} KB</small></td>
                      <td>{d.kind}</td>
                      <td><Badge tone={d.status === "read" ? "ok" : d.status === "partial" ? "warn" : "bad"}>{d.status}</Badge></td>
                      <td className="pl-num">{formatNum(d.units)}</td>
                      <td className="pl-num">{formatNum(d.chars)}</td>
                      <td className="pl-num">{formatNum(d.chunks.length)}</td>
                      <td>{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="schedule-intelligence-empty"><b>No documents read yet.</b></div>
          )}
        </Card>
      ) : null}
      {view === "unverified" ? (
        <Card eyebrow="Quote not found in the document — excluded unless you include them" title="Unverified items">
          <ItemTable items={unverified} empty="Every extracted item was verified against its document." />
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ sub-views */

function Sources({ items }: { items: ExtractedItem[] }) {
  if (!items.length) return <span className="xer-dim">—</span>;
  return (
    <details className="pl-sources">
      <summary>{items.length} source{items.length === 1 ? "" : "s"} · {items[0].docName}</summary>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <b>{i.docName}</b> · {i.location} · {i.source === "parser" ? "exact (parser)" : `${i.model}, confidence ${formatNum(i.confidence, 2)}`}{i.verified ? "" : " · unverified"}
            <q dir="auto">{i.quote}</q>
          </li>
        ))}
      </ul>
    </details>
  );
}

function BriefView({ brief, itemById, wired, hasItems }: { brief: Brief | null; itemById: Map<string, ExtractedItem>; wired: boolean; hasItems: boolean }) {
  if (!brief) {
    return (
      <Card eyebrow="Draft — written only from extracted, cited items" title="Project brief">
        <div className="schedule-intelligence-empty">
          <b>{!wired ? "No data — the language model is not wired." : hasItems ? "Write the brief from the extracted items." : "No data yet — analyse the documents."}</b>
        </div>
      </Card>
    );
  }
  const refs = (ids: string[]) => ids.map((id) => itemById.get(id)).filter((x): x is ExtractedItem => !!x);
  return (
    <>
      <Card eyebrow={`Draft — ${brief.model} · ${new Date(brief.generatedAt).toLocaleString()}`} title="Project brief">
        <p className="pl-brief" dir="auto">{brief.brief}</p>
      </Card>
      <Card eyebrow="Each rests on cited items" title="Main requirements">
        {brief.main_requirements.length ? (
          <table className="xer-mini-table">
            <thead><tr><th>Type</th><th>Requirement</th><th>Sources</th></tr></thead>
            <tbody>{brief.main_requirements.map((r, i) => <tr key={i}><td>{r.type}</td><td dir="auto">{r.requirement}</td><td><Sources items={refs(r.item_ids)} /></td></tr>)}</tbody>
          </table>
        ) : <div className="schedule-intelligence-empty"><b>No main requirements in the brief.</b></div>}
      </Card>
      <Card eyebrow="From cited items" title="Key dates">
        {brief.key_dates.length ? (
          <table className="xer-mini-table">
            <thead><tr><th>Date</th><th>What</th><th>Sources</th></tr></thead>
            <tbody>{brief.key_dates.map((d, i) => <tr key={i}><td>{d.date}</td><td dir="auto">{d.name}</td><td><Sources items={refs(d.item_ids)} /></td></tr>)}</tbody>
          </table>
        ) : <div className="schedule-intelligence-empty"><b>No dates in the brief.</b></div>}
      </Card>
      <Card eyebrow="Not stated in the documents — not guessed" title="Gaps">
        {brief.gaps.length ? <ul className="xer-findings">{brief.gaps.map((g) => <li key={g} dir="auto">{g}</li>)}</ul> : <p className="xer-muted">The brief reports no gaps.</p>}
      </Card>
    </>
  );
}

function MasterView({ rows, reviews, review, clearReview, empty }: {
  rows: MasterRow[];
  reviews: ReviewMap;
  review: (id: string, status: "confirmed" | "rejected" | "edited", value?: string) => void;
  clearReview: (id: string) => void;
  empty: string;
}) {
  const [editing, setEditing] = useState<{ field: string; value: string } | null>(null);
  if (!rows.length) return <Card eyebrow="Confirm, edit or reject each value" title="Main project data"><div className="schedule-intelligence-empty"><b>{empty}</b></div></Card>;
  return (
    <Card eyebrow="Confirm, edit or reject each value — click a value to edit it" title="Main project data">
      <div className="schedule-intelligence-scroll">
        <table className="schedule-intelligence-table xer-table pl-grid" style={{ minWidth: 980 }}>
          <thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Sources</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const id = `field:${r.field}`;
              const active = editing?.field === r.field;
              return (
                <tr key={r.field} className={r.status === "conflict" ? "pl-row-issue" : undefined}>
                  <td><b>{r.label}</b><small className="pl-sub">{r.category}{r.required ? " · main data" : ""}</small></td>
                  <td className="pl-cell" onClick={() => !active && setEditing({ field: r.field, value: r.value })} dir="auto">
                    {active ? (
                      <input
                        autoFocus
                        className="pl-cell-input"
                        value={editing.value}
                        onChange={(e) => setEditing({ field: r.field, value: e.target.value })}
                        onBlur={() => {
                          if (editing.value.trim() && editing.value !== r.value) review(id, "edited", editing.value.trim());
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : r.status === "multiple" ? (
                      <span>{r.candidates.length} values<small className="pl-sub">{r.candidates.slice(0, 3).map((c) => c.value).join(" · ")}{r.candidates.length > 3 ? " …" : ""}</small></span>
                    ) : r.value || <span className="xer-dim">—</span>}
                    {r.status === "conflict" ? (
                      <select className="xer-select pl-candidate" value="" onClick={(e) => e.stopPropagation()} onChange={(e) => e.target.value && review(id, "confirmed", e.target.value)}>
                        <option value="">Choose between {r.candidates.length} values…</option>
                        {r.candidates.map((c) => <option key={c.value} value={c.value}>{c.value} ({c.items.map((i) => i.docName).join(", ")})</option>)}
                      </select>
                    ) : null}
                  </td>
                  <td><Badge tone={STATUS_TONE[r.status] || "mut"}>{r.status}</Badge></td>
                  <td><Sources items={r.candidates.flatMap((c) => c.items)} /></td>
                  <td className="pl-col-actions">
                    <button type="button" className="pl-icon" title="Confirm" disabled={!r.value} onClick={() => review(id, "confirmed", r.value)}>✓</button>
                    <button type="button" className="pl-icon" title="Reject" onClick={() => review(id, "rejected")}>✕</button>
                    {reviews[id] ? <button type="button" className="pl-icon" title="Undo review" onClick={() => clearReview(id)}>↺</button> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GroupView({ groups, review, clearReview, title, empty, withDate }: {
  groups: GroupedItem[];
  review: (id: string, status: "confirmed" | "rejected" | "edited", value?: string) => void;
  clearReview: (id: string) => void;
  title: string;
  empty: string;
  withDate?: boolean;
}) {
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [filter, setFilter] = useState("");
  const categories = Array.from(new Set(groups.map((g) => g.category))).sort();
  const shown = groups.filter((g) => !filter || g.category === filter);
  return (
    <Card eyebrow="Merged across documents — confirm, edit or reject" title={title} aside={`${groups.length}`}>
      {categories.length > 1 ? (
        <div className="xer-subtabs">
          <button type="button" className={!filter ? "active" : ""} onClick={() => setFilter("")}>All</button>
          {categories.map((c) => <button key={c} type="button" className={filter === c ? "active" : ""} onClick={() => setFilter(c)}>{c}<i>{groups.filter((g) => g.category === c).length}</i></button>)}
        </div>
      ) : null}
      {shown.length ? (
        <div className="schedule-intelligence-scroll">
          <table className="schedule-intelligence-table xer-table pl-grid" style={{ minWidth: 900 }}>
            <thead><tr><th>{withDate ? "Date" : "Type"}</th><th>{title}</th><th>Status</th><th>Sources</th><th /></tr></thead>
            <tbody>
              {shown.map((g) => {
                const active = editing?.key === g.key;
                return (
                  <tr key={g.key} className={g.status === "rejected" ? "pl-row-rejected" : undefined}>
                    <td>{withDate ? g.date || "—" : g.category}</td>
                    <td className="pl-cell" dir="auto" onClick={() => !active && setEditing({ key: g.key, value: g.text })}>
                      {active ? (
                        <input
                          autoFocus
                          className="pl-cell-input"
                          value={editing.value}
                          onChange={(e) => setEditing({ key: g.key, value: e.target.value })}
                          onBlur={() => {
                            if (editing.value.trim() && editing.value !== g.text) review(g.key, "edited", editing.value.trim());
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : g.text}
                    </td>
                    <td><Badge tone={STATUS_TONE[g.status] || "mut"}>{g.status}</Badge></td>
                    <td><Sources items={g.items} /></td>
                    <td className="pl-col-actions">
                      <button type="button" className="pl-icon" title="Confirm" onClick={() => review(g.key, "confirmed", g.text)}>✓</button>
                      <button type="button" className="pl-icon" title="Reject" onClick={() => review(g.key, "rejected")}>✕</button>
                      {g.status !== "extracted" ? <button type="button" className="pl-icon" title="Undo review" onClick={() => clearReview(g.key)}>↺</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="schedule-intelligence-empty"><b>{empty}</b></div>
      )}
    </Card>
  );
}

function MissingView({ master, review }: { master: MasterRow[]; review: (id: string, status: "confirmed" | "rejected" | "edited", value?: string) => void }) {
  const required = master.filter((r) => r.required);
  const conflicts = master.filter((r) => r.status === "conflict");
  return (
    <>
      <Card eyebrow="Main project data a planner expects the documents to state" title="Main data checklist" aside={`${required.filter((r) => r.status !== "missing").length} of ${REQUIRED_FIELDS.length} found`}>
        <table className="xer-mini-table">
          <thead><tr><th>Field</th><th>Status</th><th>Value</th><th>Enter it yourself</th></tr></thead>
          <tbody>
            {required.map((r) => (
              <tr key={r.field}>
                <td><b>{r.label}</b></td>
                <td><Badge tone={STATUS_TONE[r.status] || "mut"}>{r.status === "missing" ? "not stated" : r.status}</Badge></td>
                <td dir="auto">{r.value || <span className="xer-dim">Not stated in any uploaded document</span>}</td>
                <td>
                  <input
                    key={`${r.field}:${r.value}`}
                    className="pl-cell-input"
                    placeholder={r.status === "missing" ? "Planner value (marked as edited)" : ""}
                    defaultValue=""
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) review(`field:${r.field}`, "edited", v);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card eyebrow="The same field has different values in different documents" title="Conflicts to decide" aside={`${conflicts.length}`}>
        {conflicts.length ? (
          conflicts.map((r) => (
            <div key={r.field} className="pl-conflict">
              <SectionTitle>{r.label}</SectionTitle>
              {r.candidates.map((c) => (
                <div key={normalizeText(c.value)} className="pl-conflict-option">
                  <button type="button" className="xer-btn xer-btn-sm" onClick={() => review(`field:${r.field}`, "confirmed", c.value)}>Use this</button>
                  <b dir="auto">{c.value}</b>
                  <Sources items={c.items} />
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="schedule-intelligence-empty"><b>No conflicting values across the documents.</b></div>
        )}
      </Card>
    </>
  );
}

function ItemTable({ items, empty }: { items: ExtractedItem[]; empty: string }) {
  if (!items.length) return <div className="schedule-intelligence-empty"><b>{empty}</b></div>;
  return (
    <div className="schedule-intelligence-scroll">
      <table className="schedule-intelligence-table xer-table" style={{ minWidth: 900 }}>
        <thead><tr><th>Kind</th><th>Field / type</th><th>Value</th><th>Document</th><th>Quote the model gave</th></tr></thead>
        <tbody>
          {items.slice(0, 300).map((i) => (
            <tr key={i.id}>
              <td>{i.kind}</td>
              <td>{i.kind === "fact" ? i.field : i.category}</td>
              <td dir="auto">{i.value}</td>
              <td>{i.docName}<small className="pl-sub">{i.location}</small></td>
              <td dir="auto"><q>{i.quote}</q></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
