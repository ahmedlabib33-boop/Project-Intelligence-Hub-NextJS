"use client";

/**
 * Schedule Intelligence workspace — one pipeline over one loaded schedule.
 *
 * Load one XER for a forensic analysis of a single programme — calendar-aware
 * CPM recalculation, longest path, float paths, out-of-sequence progress and a
 * DCMA-style health assessment. The same schedule then flows through the
 * editable planning library, activity mapping and the Mitigation / Recovery /
 * Revised scenario engine. Load a second to compare the two field by field.
 *
 * Everything runs in the browser: the file is read locally and never uploaded.
 * Every number here is a shadow calculation for review — native Primavera P6
 * remains the scheduling authority.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, type Analysis, type Check } from "../../lib/xer/analysis";
import {
  activeCompareFields, COMPARE_FIELDS, compareSchedules, defaultFieldsOff,
  type ActivityDiff, type Comparison,
} from "../../lib/xer/compare";
import { exportEvidencePack } from "../../lib/xer/export";
import { decodeXerBuffer } from "../../lib/xer/parse";
import { formatDate, formatNum } from "../../lib/xer/format";
import { buildSchedule, projectView, type LoadedSchedule, type ProjectView, type Task } from "../../lib/xer/model";
import { DEFAULT_OPTIONS, type AnalyzerOptions, type MatchBy } from "../../lib/xer/options";
import { buildLibraryIndex, emptyLibrary, type PlanningLibrary } from "../../lib/planning/library";
import { productivityInputs } from "../../lib/planning/mapping";
import {
  clearStoredLibrary, loadLibrary, loadShippedLibrary, projectKey, readProjectState, writeProjectState, writeStoredLibrary,
  type ProjectPipelineState,
} from "../../lib/planning/store";
import { ActivityDrawer } from "./xer/ActivityDrawer";
import {
  CompareActivities, CompareCritical, CompareGantt, CompareImpact, CompareLogic, CompareStructure,
  CompareSummary, CompareVariance, COMPARE_TABS, DiffDetail, type CompareCtx, type CompareTab,
} from "./xer/CompareViews";
import { EMPTY_FILTER, type ActivityFilter, type AdHocFilter } from "./xer/helpers";
import {
  ActivitiesView, CalendarsView, CriticalView, DashboardView, FloatPathsView, GanttView, HealthView,
  LogicView, RawTablesView, ResourcesView, WbsView, type TabKey, type ViewCtx,
} from "./xer/SingleViews";
import { Badge, Card, DataTable, Drawer, KeyValues, SectionTitle } from "./xer/ui";
import LibraryWorkspace from "./planning/LibraryWorkspace";
import MappingView from "./planning/MappingView";
import ScenarioView, { type ScenarioRun } from "./planning/ScenarioView";

type Slot = "A" | "B";

const TABS: { k: TabKey; label: string; eyebrow: string; needsBoth?: boolean }[] = [
  { k: "dash", label: "Dashboard", eyebrow: "Overview" },
  { k: "act", label: "Activities", eyebrow: "Register" },
  { k: "logic", label: "Logic", eyebrow: "Network" },
  { k: "crit", label: "Critical path", eyebrow: "Driving chain" },
  { k: "float", label: "Float paths", eyebrow: "Ranked" },
  { k: "health", label: "Health & DCMA", eyebrow: "Assessment" },
  { k: "gantt", label: "Gantt", eyebrow: "Timeline" },
  { k: "wbs", label: "WBS", eyebrow: "Structure" },
  { k: "res", label: "Resources", eyebrow: "Cost" },
  { k: "cal", label: "Calendars", eyebrow: "Working time" },
  { k: "raw", label: "Raw tables", eyebrow: "Source data" },
  { k: "lib", label: "Planning library", eyebrow: "Activity list · rates" },
  { k: "map", label: "Activity mapping", eyebrow: "Schedule ↔ library" },
  { k: "scen", label: "Mitigation · Recovery · Revised", eyebrow: "One engine" },
  { k: "cmp", label: "Comparison", eyebrow: "A ⇄ B", needsBoth: true },
];

type Pipeline = ProjectPipelineState & { key: string };

export default function XerAnalyzerWorkspace() {
  const [A, setA] = useState<LoadedSchedule | null>(null);
  const [B, setB] = useState<LoadedSchedule | null>(null);
  const [scope, setScope] = useState<Slot>("A");
  const [tab, setTab] = useState<TabKey>("dash");
  const [cmpTab, setCmpTab] = useState<CompareTab>("sum");
  // Derived early/late dates and secondary cost fields start switched off:
  // every activity moves them, which buries the edits actually made.
  const [opts, setOpts] = useState<AnalyzerOptions>({ ...DEFAULT_OPTIONS, fieldsOff: defaultFieldsOff() });
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  const [adhoc, setAdhoc] = useState<AdHocFilter>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [projA, setProjA] = useState<string | null>(null);
  const [projB, setProjB] = useState<string | null>(null);

  const [drawerTask, setDrawerTask] = useState<{ task: Task; view: ProjectView } | null>(null);
  const [drawerCheck, setDrawerCheck] = useState<Check | null>(null);
  const [drawerDiff, setDrawerDiff] = useState<ActivityDiff | null>(null);

  const [library, setLibrary] = useState<PlanningLibrary | null>(null);
  const [libraryNote, setLibraryNote] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [scenario, setScenario] = useState<{ view: ProjectView; run: ScenarioRun } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<Slot>("A");

  /* ------------------------------------------------------ planning library */

  useEffect(() => {
    let cancelled = false;
    loadLibrary()
      .then((lib) => {
        if (!cancelled) setLibrary(lib);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLibraryNote(cause instanceof Error ? cause.message : "The planning library could not be loaded.");
        setLibrary(emptyLibrary());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!library) return;
    const handle = window.setTimeout(() => {
      if (!writeStoredLibrary(library)) {
        setLibraryNote("This browser could not save the library (storage full or blocked) — export it to keep your edits.");
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [library]);

  const resetLibrary = () => {
    clearStoredLibrary();
    loadShippedLibrary()
      .then(setLibrary)
      .catch((cause) => setLibraryNote(cause instanceof Error ? cause.message : "The shipped library could not be loaded."));
  };

  const index = useMemo(() => (library ? buildLibraryIndex(library) : null), [library]);

  /* ------------------------------------------------------------ loading */

  const loadFile = useCallback(async (file: File, slot: Slot) => {
    setBusy(`Reading ${file.name}…`);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const text = decodeXerBuffer(buffer);
      // Yield once so the busy state paints before the parse blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const schedule = buildSchedule(text, file.name, file.size);
      if (!schedule.taskRows.length) {
        setError(`${file.name} contains no TASK table — it does not look like a P6 XER export.`);
        setBusy(null);
        return;
      }
      if (slot === "A") {
        setA(schedule);
        setProjA(schedule.activeProj);
      } else {
        setB(schedule);
        setProjB(schedule.activeProj);
      }
      setFilter(EMPTY_FILTER);
      setAdhoc(null);
    } catch (err) {
      setError(err instanceof Error ? `${file.name}: ${err.message}` : `${file.name} could not be read.`);
    } finally {
      setBusy(null);
    }
  }, []);

  const pickFile = (slot: Slot) => {
    pendingSlot.current = slot;
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    const slot = pendingSlot.current;
    void loadFile(files[0], slot);
    if (files[1] && slot === "A") void loadFile(files[1], "B");
  };

  const clearSlot = (slot: Slot) => {
    if (slot === "A") {
      setA(null);
      setProjA(null);
      setScope("B");
    } else {
      setB(null);
      setProjB(null);
      setScope("A");
    }
    setDrawerTask(null);
    setDrawerDiff(null);
    if (tab === "cmp") setTab("dash");
  };

  /* ----------------------------------------------------------- analysis */

  const viewA = useMemo(() => (A ? projectView(A, projA) : null), [A, projA]);
  const viewB = useMemo(() => (B ? projectView(B, projB) : null), [B, projB]);

  const active = scope === "B" && viewB ? viewB : viewA;
  const activeSchedule = scope === "B" && B ? B : A;

  const analysis: Analysis | null = useMemo(() => (active ? analyze(active, opts) : null), [active, opts]);

  const cmp: Comparison | null = useMemo(() => {
    if (!viewA || !viewB) return null;
    try {
      return compareSchedules(viewA, viewB, opts);
    } catch {
      return null;
    }
  }, [viewA, viewB, opts]);

  /* ------------------------------------------------ per-project pipeline */

  const pipelineKey = active ? projectKey(active.name) : null;
  if (pipelineKey && (!pipeline || pipeline.key !== pipelineKey)) {
    // A different project is now active: pick up its saved mapping, controls and edits.
    setPipeline({ key: pipelineKey, ...readProjectState(pipelineKey) });
  }

  useEffect(() => {
    if (!pipeline) return;
    const handle = window.setTimeout(() => {
      writeProjectState(pipeline.key, { mapping: pipeline.mapping, controls: pipeline.controls, manual: pipeline.manual });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [pipeline]);

  const updatePipeline = (patch: Partial<ProjectPipelineState>) => setPipeline((current) => (current ? { ...current, ...patch } : current));

  const mapping = pipeline ? pipeline.mapping : null;
  const productivity = useMemo(
    () => (active && index && mapping ? productivityInputs(active, index, mapping) : []),
    [active, index, mapping],
  );

  /* --------------------------------------------------------- interaction */

  const openTask = useCallback(
    (task: Task, view?: ProjectView) => {
      const target = view || active;
      if (!target) return;
      setDrawerDiff(null);
      setDrawerCheck(null);
      setDrawerTask({ task, view: target });
    },
    [active],
  );

  const drill = useCallback((label: string, test: (t: Task) => boolean) => {
    setAdhoc({ label, test });
    setTab("act");
  }, []);

  const ctx: ViewCtx | null =
    active && analysis
      ? {
          P: active,
          an: analysis,
          opts,
          filter,
          setFilter,
          adhoc,
          setAdhoc,
          goTab: setTab,
          drill,
          openTask,
          openCheck: (check) => {
            setDrawerTask(null);
            setDrawerDiff(null);
            setDrawerCheck(check);
          },
          cmp,
          scope,
        }
      : null;

  const compareCtx: CompareCtx | null = cmp
    ? {
        cmp,
        opts,
        openTask,
        openDiff: (d) => {
          setDrawerTask(null);
          setDrawerCheck(null);
          setDrawerDiff(d);
        },
      }
    : null;

  /* -------------------------------------------------------------- render */

  const slotCard = (slot: Slot, schedule: LoadedSchedule | null, view: ProjectView | null) => (
    <div className={`xer-slot${schedule ? " filled" : ""}${slot === "B" ? " xer-slot-b" : ""}`}>
      <span className="xer-slot-tag">{slot}</span>
      {schedule && view ? (
        <>
          <div className="xer-slot-meta">
            <b title={schedule.fileName}>{schedule.fileName}</b>
            <span>
              {formatNum(view.tasks.length)} activities · {formatNum(view.links.length)} links · data date{" "}
              {formatDate(view.dataDate) || "—"}
            </span>
          </div>
          <button type="button" className="xer-slot-x" onClick={() => clearSlot(slot)} aria-label={`Remove schedule ${slot}`}>
            ✕
          </button>
        </>
      ) : (
        <button type="button" className="xer-slot-load" onClick={() => pickFile(slot)}>
          <b>Load schedule {slot}</b>
          <span>{slot === "A" ? "Current / updated programme" : "Baseline / previous revision — enables comparison"}</span>
        </button>
      )}
    </div>
  );

  const availableTabs = TABS.filter((t) => !t.needsBoth || (viewA && viewB));
  const libraryLoading = (
    <section className="schedule-intelligence-card">
      <div className="schedule-intelligence-empty"><b>Loading the planning library…</b></div>
    </section>
  );

  return (
    <div
      className="xer-analyzer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".xer"));
        if (!files.length) return;
        void loadFile(files[0], A ? "B" : "A");
        if (files[1]) void loadFile(files[1], "B");
      }}
    >
      <input ref={inputRef} type="file" accept=".xer" multiple className="xer-hidden-input" onChange={(e) => onFiles(e.target.files)} />

      <section className="schedule-intelligence-card xer-loader">
        <div className="schedule-intelligence-card-head">
          <div>
            <p>Browser-local · nothing is uploaded</p>
            <h3>Schedule input</h3>
          </div>
          <span>{A && B ? "Two schedules loaded" : A || B ? "One schedule loaded" : "Awaiting XER"}</span>
        </div>
        <div className="xer-slots">
          {slotCard("A", A, viewA)}
          {slotCard("B", B, viewB)}
          <div className="xer-slot-actions">
            {A && B ? (
              <div className="xer-scope">
                <span>Analysing</span>
                <button type="button" className={scope === "A" ? "active" : ""} onClick={() => setScope("A")}>
                  A
                </button>
                <button type="button" className={scope === "B" ? "active" : ""} onClick={() => setScope("B")}>
                  B
                </button>
              </div>
            ) : null}
            {active && analysis ? (
              <button
                type="button"
                className="xer-btn xer-btn-sm"
                onClick={() => {
                  const count = exportEvidencePack(active, analysis, opts, cmp);
                  setNotice(`Exporting ${count} CSV files — allow multiple downloads if the browser asks.`);
                  window.setTimeout(() => setNotice(null), 6000);
                }}
              >
                Export evidence pack
              </button>
            ) : null}
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </div>
        {busy ? <p className="xer-busy">{busy}</p> : null}
        {notice ? <p className="xer-busy">{notice}</p> : null}
        {error ? <p className="xer-error">{error}</p> : null}
        {libraryNote ? <p className="xer-error">{libraryNote}</p> : null}
        {activeSchedule && activeSchedule.warnings.length ? (
          <p className="xer-error">{activeSchedule.warnings.join(" · ")}</p>
        ) : null}
      </section>

      {!active || !ctx ? (
        <>
          <section className="schedule-intelligence-card">
            <div className="schedule-intelligence-empty schedule-intelligence-empty-large">
              <b>Load a .xer file to begin</b>
              <span>
                One file runs the whole pipeline — CPM recalculation, longest path, float paths, out-of-sequence progress and a
                DCMA-style health assessment, then activity mapping to the planning library and Mitigation, Recovery and Revised
                scenarios on the same network. A second file enables a field-level comparison. You can also drop files anywhere on
                this panel.
              </span>
            </div>
          </section>
          {library ? (
            <details className="pl-standalone">
              <summary>Planning library — activity list, CSI coding, crews, production and equipment rates (editable without a schedule)</summary>
              <LibraryWorkspace library={library} onChange={setLibrary} onReset={resetLibrary} />
            </details>
          ) : null}
        </>
      ) : (
        <>
          <div className="xer-project-bar">
            <b>{active.longName || active.name}</b>
            {activeSchedule && activeSchedule.projects.length > 1 ? (
              <label className="xer-field">
                <span>Project</span>
                <select
                  className="xer-select"
                  value={active.projId}
                  onChange={(e) => (scope === "B" ? setProjB(e.target.value) : setProjA(e.target.value))}
                >
                  {activeSchedule.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatNum(p.taskCount)} activities)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="xer-dim">
              Data date <b>{formatDate(active.dataDate) || "—"}</b> · Finish <b>{formatDate(active.finish) || "—"}</b>
              {active.mustFinish ? ` · Must finish ${formatDate(active.mustFinish)}` : ""}
            </span>
            <span className="xer-dim xer-ml-auto">Recalculated in {analysis!.ms} ms</span>
          </div>

          <nav className="schedule-intelligence-tabs xer-tabs" aria-label="Schedule Intelligence views">
            {availableTabs.map((t) => (
              <button
                key={t.k}
                type="button"
                className={tab === t.k ? "active" : ""}
                onClick={() => setTab(t.k)}
              >
                <span>{t.eyebrow}</span>
                {t.label}
                {t.k === "cmp" && cmp ? (
                  <i className="xer-tab-pill">
                    {formatNum(cmp.summaryCounts.added + cmp.summaryCounts.removed + cmp.summaryCounts.modified)}
                  </i>
                ) : null}
                {t.k === "map" && productivity.length ? <i className="xer-tab-pill">{formatNum(productivity.length)}</i> : null}
                {t.k === "scen" && scenario && scenario.view === active ? (
                  <i className="xer-tab-pill">{formatNum(scenario.run.value.gainDays, 0)} d</i>
                ) : null}
              </button>
            ))}
          </nav>

          {tab === "dash" ? <DashboardView ctx={ctx} /> : null}
          {tab === "act" ? <ActivitiesView ctx={ctx} /> : null}
          {tab === "logic" ? <LogicView ctx={ctx} /> : null}
          {tab === "crit" ? <CriticalView ctx={ctx} /> : null}
          {tab === "float" ? <FloatPathsView ctx={ctx} /> : null}
          {tab === "health" ? <HealthView ctx={ctx} /> : null}
          {tab === "gantt" ? <GanttView ctx={ctx} /> : null}
          {tab === "wbs" ? <WbsView ctx={ctx} /> : null}
          {tab === "res" ? <ResourcesView ctx={ctx} /> : null}
          {tab === "cal" ? <CalendarsView ctx={ctx} /> : null}
          {tab === "raw" ? <RawTablesView ctx={ctx} /> : null}

          {tab === "lib" ? (library ? <LibraryWorkspace library={library} onChange={setLibrary} onReset={resetLibrary} /> : libraryLoading) : null}

          {tab === "map" ? (
            library && index && pipeline ? (
              <MappingView
                P={active}
                an={analysis!}
                opts={opts}
                index={index}
                store={pipeline.mapping}
                onChange={(next) => updatePipeline({ mapping: next })}
                onOpenTask={(t) => openTask(t)}
              />
            ) : libraryLoading
          ) : null}

          {tab === "scen" && pipeline && activeSchedule ? (
            <ScenarioView
              S={activeSchedule}
              P={active}
              an={analysis!}
              opts={opts}
              productivity={productivity}
              controls={pipeline.controls}
              onControls={(next) => updatePipeline({ controls: next })}
              manual={pipeline.manual}
              onManual={(next) => updatePipeline({ manual: next })}
              run={scenario && scenario.view === active ? scenario.run : null}
              onRun={(next) => setScenario(next ? { view: active, run: next } : null)}
              onOpenTask={(t) => openTask(t)}
              goMapping={() => setTab("map")}
              goLibrary={() => setTab("lib")}
            />
          ) : null}

          {tab === "cmp" && compareCtx ? (
            <div className="xer-view">
              <div className="xer-subtabs">
                {COMPARE_TABS.map(([key, label]) => (
                  <button type="button" key={key} className={cmpTab === key ? "active" : ""} onClick={() => setCmpTab(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="xer-toolbar">
                <label className="xer-field">
                  <span>Match activities by</span>
                  <select
                    className="xer-select"
                    value={opts.matchBy}
                    onChange={(e) => setOpts({ ...opts, matchBy: e.target.value as MatchBy })}
                  >
                    <option value="code">Activity ID</option>
                    <option value="name">Activity name</option>
                    <option value="code+wbs">Activity ID + WBS</option>
                  </select>
                </label>
                <label className="xer-field">
                  <span>Date tolerance (d)</span>
                  <input
                    className="xer-input xer-input-num"
                    type="number"
                    min={0}
                    value={opts.dateTol}
                    onChange={(e) => setOpts({ ...opts, dateTol: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="xer-field">
                  <span>Duration tolerance (d)</span>
                  <input
                    className="xer-input xer-input-num"
                    type="number"
                    min={0}
                    value={opts.durTol}
                    onChange={(e) => setOpts({ ...opts, durTol: Number(e.target.value) || 0 })}
                  />
                </label>
                <button type="button" className="xer-btn xer-btn-sm" onClick={() => setShowFields(true)}>
                  Fields <i>{activeCompareFields(opts).length}/{COMPARE_FIELDS.length}</i>
                </button>
                <span className="xer-dim">Compared in {cmp!.ms} ms</span>
              </div>

              {cmp!.summaryCounts.modified === cmp!.diffs.length && cmp!.diffs.length > 20 ? (
                <div className="xer-callout xer-callout-warn">
                  <b>Every matched activity is reporting as modified.</b> That usually means one compared field differs
                  across the whole file — most often <b>WBS path</b>, when the two revisions carry different project
                  or root WBS codes. Switch that field off under <b>Fields</b> to see the edits that were actually made.
                </div>
              ) : null}

              {cmpTab === "sum" ? <CompareSummary ctx={compareCtx} goTab={setCmpTab} /> : null}
              {cmpTab === "act" ? <CompareActivities ctx={compareCtx} /> : null}
              {cmpTab === "logic" ? <CompareLogic ctx={compareCtx} /> : null}
              {cmpTab === "var" ? <CompareVariance ctx={compareCtx} /> : null}
              {cmpTab === "crit" ? <CompareCritical ctx={compareCtx} /> : null}
              {cmpTab === "struct" ? <CompareStructure ctx={compareCtx} /> : null}
              {cmpTab === "impact" ? <CompareImpact ctx={compareCtx} /> : null}
              {cmpTab === "gantt" ? <CompareGantt ctx={compareCtx} /> : null}
            </div>
          ) : null}
        </>
      )}

      <p className="xer-footnote">
        Every date, float value, path, gain and cost on this screen is recalculated by this engine from the XER&apos;s own data
        and the planning library. It is a review and decision aid — <b>native Primavera P6 remains the scheduling authority</b>,
        and no figure here should be issued or relied on contractually until it has been reproduced in a controlled P6 copy.
      </p>

      {/* ---------------------------------------------------------- drawers */}

      {drawerTask ? (
        <ActivityDrawer
          P={drawerTask.view}
          task={drawerTask.task}
          diff={cmp ? cmp.diffByIdA.get(drawerTask.task.id) || cmp.diffByIdB.get(drawerTask.task.id) || null : null}
          onPick={(t) => setDrawerTask({ task: t, view: drawerTask.view })}
          onClose={() => setDrawerTask(null)}
        />
      ) : null}

      {drawerDiff && cmp ? (
        <Drawer title={drawerDiff.b.code} subtitle={drawerDiff.b.name} onClose={() => setDrawerDiff(null)}>
          <KeyValues
            rows={[
              ["Match", drawerDiff.renamed ? `Renamed (score ${drawerDiff.score}%)` : `By ${opts.matchBy}`],
              ["Schedule A", `${drawerDiff.a.code} — ${drawerDiff.a.name}`],
              ["Schedule B", `${drawerDiff.b.code} — ${drawerDiff.b.name}`],
            ]}
          />
          <DiffDetail
            diff={drawerDiff}
            cmp={cmp}
            onOpenSide={(t, view) => {
              setDrawerDiff(null);
              openTask(t, view);
            }}
          />
        </Drawer>
      ) : null}

      {drawerCheck && ctx ? (
        <CheckDrawer check={drawerCheck} ctx={ctx} onClose={() => setDrawerCheck(null)} />
      ) : null}

      {showFields ? (
        <Drawer
          title="Compared fields"
          subtitle="Only ticked fields count towards a difference"
          onClose={() => setShowFields(false)}
        >
          <p className="xer-muted">
            Switching a field off removes it from the activity diff, the change counts and the impact ranking. Use it to
            silence a field that moved across the whole file — a different WBS root code, or recalculated early/late
            dates — so the real edits stand out.
          </p>
          <div className="xer-drawer-actions">
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => setOpts({ ...opts, fieldsOff: {} })}>
              Select all
            </button>
            <button type="button" className="xer-btn xer-btn-sm" onClick={() => setOpts({ ...opts, fieldsOff: defaultFieldsOff() })}>
              Reset to default
            </button>
          </div>
          {Array.from(new Set(COMPARE_FIELDS.map((f) => f.cat))).map((cat) => (
            <div key={cat}>
              <SectionTitle>{cat}</SectionTitle>
              {COMPARE_FIELDS.filter((f) => f.cat === cat).map((f) => (
                <label key={f.k} className="xer-check-field">
                  <input
                    type="checkbox"
                    checked={!opts.fieldsOff[f.k]}
                    onChange={(e) => {
                      const next = { ...opts.fieldsOff };
                      if (e.target.checked) delete next[f.k];
                      else next[f.k] = true;
                      setOpts({ ...opts, fieldsOff: next });
                    }}
                  />
                  <span>
                    <b>{f.l}</b>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </Drawer>
      ) : null}

      {showSettings ? (
        <Drawer title="Analyzer settings" subtitle="Thresholds used by the checks and float bands" onClose={() => setShowSettings(false)}>
          <SectionTitle>Float thresholds</SectionTitle>
          <div className="xer-settings">
            <NumberField label="Critical when total float ≤ (d)" value={opts.tfCritical} onChange={(v) => setOpts({ ...opts, tfCritical: v })} />
            <NumberField label="Near critical when ≤ (d)" value={opts.tfNear} onChange={(v) => setOpts({ ...opts, tfNear: v })} />
            <NumberField label="High float above (d)" value={opts.highFloat} onChange={(v) => setOpts({ ...opts, highFloat: v })} />
          </div>
          <SectionTitle>Duration and lag</SectionTitle>
          <div className="xer-settings">
            <NumberField label="High duration above (d)" value={opts.highDuration} onChange={(v) => setOpts({ ...opts, highDuration: v })} />
            <NumberField label="Long lag above (d)" value={opts.longLag} onChange={(v) => setOpts({ ...opts, longLag: v })} />
          </div>
          <SectionTitle>Calculation</SectionTitle>
          <label className="xer-check-field">
            <input type="checkbox" checked={opts.retainedLogic} onChange={(e) => setOpts({ ...opts, retainedLogic: e.target.checked })} />
            <span>
              <b>Retained logic</b>
              <small>Out-of-sequence remaining work stays behind its predecessors. Uncheck to approximate progress override.</small>
            </span>
          </label>
          <label className="xer-check-field">
            <input type="checkbox" checked={opts.ignoreLOE} onChange={(e) => setOpts({ ...opts, ignoreLOE: e.target.checked })} />
            <span>
              <b>Exclude LOE / WBS summary from logic checks</b>
              <small>Hammocks legitimately have unusual logic and would otherwise dominate the findings.</small>
            </span>
          </label>
          <label className="xer-check-field">
            <input type="checkbox" checked={opts.fuzzyRename} onChange={(e) => setOpts({ ...opts, fuzzyRename: e.target.checked })} />
            <span>
              <b>Detect renamed activities</b>
              <small>Pairs an added and a removed activity when their descriptions match closely.</small>
            </span>
          </label>
          <p className="xer-muted xer-note">
            These thresholds change how findings are classified, never the underlying schedule data.
          </p>
        </Drawer>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ sub-parts */

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="xer-field xer-field-block">
      <span>{label}</span>
      <input
        className="xer-input xer-input-num"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}

/** Lists the activities or relationships behind one health check. */
function CheckDrawer({ check, ctx, onClose }: { check: Check; ctx: ViewCtx; onClose: () => void }) {
  const items = check.items;
  const isLink = items.length > 0 && typeof items[0] === "object" && items[0] !== null && "link" in (items[0] as object);
  const isDrift = items.length > 0 && typeof items[0] === "object" && items[0] !== null && "days" in (items[0] as object);

  return (
    <Drawer title={check.name} subtitle={check.cat} onClose={onClose}>
      <p className="xer-muted">{check.desc}</p>
      <div className="xer-tag-row">
        <Badge tone={check.status === "fail" ? "bad" : check.status === "warn" ? "warn" : check.status === "pass" ? "ok" : "info"}>
          {check.status.toUpperCase()}
        </Badge>
        <Badge tone="mut">
          {formatNum(check.count)} {check.unit}
        </Badge>
        {check.unit !== "ratio" ? <Badge tone="mut">{formatNum(check.pctv, 1)}% of {formatNum(check.total)}</Badge> : null}
        {check.info ? <Badge tone="mut">{check.info}</Badge> : null}
      </div>

      {!items.length ? (
        <p className="xer-muted xer-note">Nothing to list — this check passed.</p>
      ) : isLink ? (
        <DataTable
          rows={items as { link: import("../../lib/xer/model").Link; reason?: string }[]}
          rowKey={(r, i) => `${r.link.id}-${i}`}
          pageSize={100}
          minWidth={640}
          onRowClick={(r) => r.link.succ && ctx.openTask(r.link.succ)}
          columns={[
            { k: "p", label: "Predecessor", cell: (r) => <span className="xer-mono">{r.link.pred?.code || "(ext)"}</span> },
            { k: "s", label: "Successor", cell: (r) => <span className="xer-mono">{r.link.succ?.code || "(ext)"}</span> },
            { k: "n", label: "Successor name", cell: (r) => r.link.succ?.name || "" },
            { k: "t", label: "Type", cell: (r) => r.link.type },
            { k: "l", label: "Lag", align: "right", cell: (r) => formatNum(r.link.lag, 1) },
            ...(items.some((i) => (i as { reason?: string }).reason)
              ? [{ k: "r", label: "Finding", cell: (r: { reason?: string }) => r.reason || "" }]
              : []),
          ]}
        />
      ) : isDrift ? (
        <DataTable
          rows={items as { task: Task; days: number | null }[]}
          rowKey={(r, i) => `${r.task.id}-${i}`}
          pageSize={100}
          minWidth={560}
          onRowClick={(r) => ctx.openTask(r.task)}
          columns={[
            { k: "c", label: "ID", cell: (r) => <span className="xer-mono">{r.task.code}</span> },
            { k: "n", label: "Name", cell: (r) => r.task.name },
            { k: "d", label: "Drift (d)", align: "right", cell: (r) => formatNum(r.days || 0, 1) },
          ]}
        />
      ) : (
        <DataTable
          rows={items as Task[]}
          rowKey={(t, i) => `${t.id}-${i}`}
          pageSize={100}
          minWidth={560}
          searchText={(t) => `${t.code} ${t.name}`}
          onRowClick={(t) => ctx.openTask(t)}
          columns={[
            { k: "c", label: "ID", cell: (t) => <span className="xer-mono">{t.code}</span>, sort: (t) => t.code },
            { k: "n", label: "Name", cell: (t) => t.name, sort: (t) => t.name },
            { k: "s", label: "Status", cell: (t) => t.statusName, sort: (t) => t.status },
            { k: "f", label: "Finish", cell: (t) => formatDate(t.finish), sort: (t) => +(t.finish || 0) },
          ]}
        />
      )}

      <div className="xer-drawer-actions">
        <button
          type="button"
          className="xer-btn xer-btn-sm"
          onClick={() => {
            const ids = new Set(
              items
                .map((i) => {
                  if (typeof i === "object" && i !== null && "link" in i) return (i as { link: { succId: string } }).link.succId;
                  if (typeof i === "object" && i !== null && "task" in i) return (i as { task: Task }).task.id;
                  return (i as Task).id;
                })
                .filter(Boolean),
            );
            ctx.drill(check.name, (t) => ids.has(t.id));
            onClose();
          }}
        >
          Show in activity list
        </button>
      </div>
    </Drawer>
  );
}

/** Named export kept so the panel can show the card without the default import. */
export { Card as XerCard };
