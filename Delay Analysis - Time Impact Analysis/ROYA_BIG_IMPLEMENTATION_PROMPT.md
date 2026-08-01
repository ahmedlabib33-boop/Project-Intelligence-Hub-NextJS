# Implementation Prompt — ROYA-BIG PROJECT PHASE01 (B1-4)

Copy the full prompt below into Codex or another capable coding agent.

---

You are the lead construction contract-intelligence architect, Contract Director, Planning Director, Claims Consultant, Commercial Director and Engineer-side reviewer.

Build a production-quality Streamlit application named **ROYA-BIG PROJECT PHASE01 (B1-4) — Contract, Evidence & Delay Intelligence**.

## Primary instruction

Implement the logic defined in all Markdown files in this package. Preserve four independently testable analytical pipelines and one unified Streamlit interface:

1. Contract and FIDIC Intelligence
2. Evidence Reader and Provider
3. Detailed Delay Analysis
4. Visual Master Assessment

Do not import or hard-code facts, dates, quantities, delay values, event conclusions, party responsibility, clause amendments, EOT figures or evidence from any earlier project. The project starts with empty analytical registers. Populate them only from files uploaded for `ROYA_BIG_PHASE01_B1_4`.

## Mandatory behavior

- Read every supplied source before making project conclusions.
- Build the actual order of precedence from the signed Contract.
- Analyze the Contract at word, phrase, sentence, clause, definition, exception and cross-reference level.
- Apply FIDIC only from an authorized supplied edition and subject to signed amendments.
- Never invent or silently reconstruct contractual wording.
- Provide bounded quotations only when verified; otherwise paraphrase and label OCR uncertainty.
- Ingest letters, notices, RFIs, IFCs, IRs, MIRs, VIs, VOs, drawings, registers, transmittals, minutes, reports, photos, payment records and schedules.
- Record SHA-256, page, reference, revision, date, issuer, recipient, proof of receipt, verification status and confidence.
- Separate allegation from verified fact.
- Parse XER files natively and compare before/after models at the same data date.
- Detect all schedule changes, not only inserted fragnet activities.
- Validate calendars, relationships, lags, constraints, open ends, progress, actuals and critical/near-critical paths.
- Distinguish float loss, milestone movement, project-finish movement, technical impact, potential EOT and determined entitlement.
- Test mitigation and concurrency rigorously.
- Give a neutral Engineer view and the next procedural action.
- Prevent cross-project data leakage by enforcing `project_id` on every object and query.

## Required interface

Create these pages:

- Executive Dashboard
- Contract & FIDIC
- Ask Contract
- Evidence Upload and Register
- Chronology and Cause-Effect
- Delay Events
- XER Before/After Comparison
- Mitigation and Concurrency
- Master Assessment
- Visual Report Builder
- Administration, Validation and Audit Log

## Required deliverables

- Modular Python source, not one monolithic file
- Typed schemas and validation
- Configuration-driven project creation
- Local database suitable for Streamlit with a migration path to PostgreSQL
- Unit and integration tests
- Sample empty project configuration
- Markdown operating manual
- Markdown methodology report
- Markdown AI handoff document
- Requirements file and Windows launcher
- Export to Markdown, DOCX, PDF, JSON and CSV
- One ZIP containing the complete validated application

## Required answer format inside the app

For each user question or event, return:

1. Conclusion
2. Governing contractual route
3. Source evidence
4. Schedule assessment
5. Notice and procedural compliance
6. Mitigation and concurrency
7. Confidence and limitations
8. Engineer assessment
9. Recommended next move

If any gate fails, state `NOT YET PROVEN`, identify the failed gate and list the exact missing records. Do not generate a confident entitlement conclusion from incomplete evidence.

## Required development sequence

1. Inventory and classify supplied sources.
2. Produce a source audit before coding conclusions.
3. Define schemas and project-isolation controls.
4. Implement and test each pipeline independently.
5. Implement the Master Assessment only after the three specialist outputs validate.
6. Build Streamlit UI and caching.
7. Generate visuals only from controlled result tables.
8. Run compilation, unit, integration, XER, citation, cross-project isolation and archive-integrity tests.
9. Perform at least two improvement cycles based on test findings.
10. Deliver a validation report identifying what is verified, conditional, unsupported and still required.

## Acceptance rule

Do not claim completion merely because the interface opens. Completion requires deterministic tests, traceable evidence answers, controlled XER comparison, project isolation, accurate visuals, export validation and a clean ZIP integrity test.

---

