# ROYA-BIG PROJECT PHASE01 (B1-4) — Master Specification

## 1. Target outcome

Build one auditable Streamlit platform that can understand the governing Contract and FIDIC conditions, read all project evidence, perform controlled delay analysis, and issue a reasoned master assessment. The system must support Contractor-side preparation and Engineer-side neutral review without mixing the two roles.

## 2. Four-pipeline architecture

### Pipeline 1 — Contract and FIDIC Intelligence

Objective: determine the governing contractual position.

Required functions:

- Ingest the signed Contract Agreement, Letter of Acceptance, Tender, Appendix, Particular Conditions, Specifications, Drawings and authorized FIDIC General Conditions.
- OCR scanned documents page by page while retaining the original page image.
- Index words, phrases, sentences, clauses, sub-clauses, definitions, provisos, exceptions and cross-references.
- Detect amendments, deletions, replacements and additions to FIDIC wording.
- Build the actual project-specific order of precedence from the signed documents; never assume a standard order.
- Extract obligations, responsible party, trigger, deadline, required notice, required particulars, remedy and consequence.
- Answer questions with source name, clause, page, bounded quotation or paraphrase, verification status and confidence.
- State when evidence is insufficient and identify the exact missing source.
- Separate time entitlement, money entitlement and procedural compliance.

Output: `Contractual Position Pack`.

### Pipeline 2 — Evidence Reader and Provider

Objective: establish what occurred and what can be proven.

Supported evidence:

- Letters, notices and claim submissions
- RFIs, responses and technical queries
- IFC drawings, revisions and transmittals
- IRs, MIRs, NCRs and inspections
- VIs, VOs and change instructions
- Meeting minutes and progress reports
- Material requests, approvals, delivery tickets and stock records
- Payment, advance-payment and certification records
- Photographs, videos and daily reports
- Baseline, updates, XER files, narratives and schedule submissions
- Cost records, manpower, equipment and productivity records

Required controls:

- Record project ID, document type, reference, subject, issuer, recipient, issue date, received date, revision, status and hash.
- Extract assertions but never convert an assertion into a verified fact automatically.
- Classify evidence as `VERIFIED_SOURCE`, `SUPPORTING`, `REFERENCE_ONLY`, `CONFLICTING`, `MISSING`, `UNVERIFIED_ALLEGATION` or `EXTERNAL_REFERENCE`.
- Build chronology, cause-effect chains, correspondence threads, revision history and missing-evidence register.
- Map each record to applicable clauses without claiming that a clause proves the underlying fact.
- Detect inconsistent dates, references, revisions, attachments and proof-of-receipt gaps.
- Preserve both favorable and adverse evidence.

Output: `Chronology`, `Evidence Matrix`, `Document Register`, `Contradiction Register` and `Missing Evidence Register`.

### Pipeline 3 — Detailed Delay Analysis

Objective: measure schedule effect using reliable schedule models.

Required functions:

- Parse native Primavera P6 XER files and retain raw table provenance.
- Identify project, data date, calendars, WBS, activities, relationships, constraints, resources, codes and settings.
- Compare controlled before/after models at the same data date.
- Detect inserted, deleted or changed activities, relationships, durations, calendars, constraints and actuals.
- Identify fragnets and trace predecessor/successor boundaries.
- Report before/after milestone dates, total float, longest path and controlling path.
- Test open ends, excessive lags, relationship types, hard constraints, invalid dates, out-of-sequence progress and calendar changes.
- Establish cause, effect, criticality and completion movement.
- Test mitigation and alternative sequences without transferring contractual responsibility automatically.
- Test concurrency by independent critical effect, not calendar overlap alone.
- Separate gross impact, overlap, net technical effect, potential EOT and cost entitlement.
- Reject or qualify uncontrolled comparisons, including mismatched data dates.

TIA calculation:

\[
\text{Gross Impact} = \text{After Forecast Finish} - \text{Before Forecast Finish}
\]

No EOT conclusion may be generated until Pipelines 1 and 2 pass the contractual and evidential gates.

Output: `Technical Delay Assessment` and `Schedule Integrity Report`.

### Pipeline 4 — Visual Master Assessment

Objective: combine the three specialist outputs into an Engineer-ready decision pack.

Mandatory gates:

1. Contractual route exists.
2. Evidence is sufficient and traceable.
3. Schedule model is reliable enough for the stated conclusion.
4. Cause-and-effect is demonstrated.
5. Notice and particulars compliance is assessed.
6. Mitigation is considered.
7. Concurrency and double counting are tested.
8. Time and money are assessed separately.

Required outputs:

- Executive position
- Event-by-event entitlement matrix
- Contractual findings
- Evidence strengths, weaknesses and gaps
- Schedule impact and reliability
- Concurrency and mitigation assessment
- Contractor position versus Engineer assessment
- Decision status: supported, partly supported, unsupported or pending information
- Recommended next action, responsible party and deadline
- Controlled visuals whose figures reconcile to source tables

## 3. Determination logic

For every event, the master layer must answer:

| Gate | Question |
|---|---|
| Event | What precisely happened and during what period? |
| Risk | Which party carries the relevant contractual risk? |
| Notice | Was valid and timely notice issued and received? |
| Evidence | Are occurrence, responsibility and effect proven? |
| Causation | Is a direct cause-effect chain demonstrated? |
| Criticality | Did the event affect the controlling completion path? |
| Mitigation | Were reasonable measures taken and evidenced? |
| Concurrency | Was another independently critical event effective? |
| Time | What net time relief is potentially supportable? |
| Money | Is cost entitlement independently established? |
| Procedure | What must the Engineer or Contractor do next? |

## 4. Streamlit structure

```text
roya_big_intelligence/
├── app.py
├── pages/
│   ├── 1_Contract_and_FIDIC.py
│   ├── 2_Evidence_Reader.py
│   ├── 3_Delay_Analysis.py
│   └── 4_Master_Assessment.py
├── engines/
│   ├── contract_engine.py
│   ├── evidence_engine.py
│   ├── delay_engine.py
│   └── master_engine.py
├── services/
│   ├── ingestion.py
│   ├── ocr.py
│   ├── xer_parser.py
│   ├── citation_manager.py
│   ├── visual_validator.py
│   └── report_generator.py
├── schemas/
├── templates/
├── tests/
└── projects/
    └── ROYA_BIG_PHASE01_B1_4/
        ├── config/
        ├── sources/
        ├── working/
        └── outputs/
```

## 5. Project-isolation controls

- Every project receives a unique immutable `project_id`.
- Every source and derived record carries that `project_id`.
- Cross-project retrieval is disabled by default.
- Project creation initializes empty evidence, event and conclusion registers.
- No previous values may be used as defaults for dates, delay days, quantities or entitlement.
- Reusable knowledge may contain methodology and generic clause-routing concepts only.
- Any imported precedent must be labeled `EXTERNAL_REFERENCE` and cannot be cited as project fact.

## 6. AI answer contract

Every substantive answer must contain:

1. Direct answer.
2. Contractual basis and precedence status.
3. Supporting evidence with references.
4. Schedule finding, if relevant.
5. Assumptions and unresolved conflicts.
6. Confidence percentage and reason.
7. Engineer view.
8. Recommended next move.

If the evidence is insufficient, the system must say `NOT YET PROVEN` and list the minimum evidence required. It must never fill evidential gaps with prior-project knowledge.

## 7. Visual governance

Before a chart or diagram is released:

- Recalculate every displayed value from the current controlled dataset.
- Compare labels, dates and totals to the source table.
- Confirm units and calendars.
- Reconcile waterfall totals and concurrency deductions.
- Show version, data date, source and status.
- Mark superseded visuals prominently and exclude them from approved reports.
- Do not display an entitlement figure where only schedule movement is established.

## 8. Security and audit

- Hash all uploaded sources.
- Keep immutable ingestion records and append-only analysis history.
- Log the user, time, project, source set, engine version and prompt version.
- Restrict final determination approval to authorized roles.
- Redact sensitive data in shared exports when required.
- Provide reproducible exports in Markdown, Word, PDF, JSON and CSV.

