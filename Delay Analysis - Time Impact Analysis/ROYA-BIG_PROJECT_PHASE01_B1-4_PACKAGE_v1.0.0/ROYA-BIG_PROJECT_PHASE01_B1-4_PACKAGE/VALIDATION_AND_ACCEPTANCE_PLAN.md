# Validation and Acceptance Plan

## Release gates

| Gate | Minimum pass condition |
|---|---|
| Source integrity | Every source has project ID and SHA-256 |
| Contract corpus | All pages indexed; key clauses visually verified |
| FIDIC | Authorized source indexed; amendments applied |
| Precedence | Conflicts resolved using signed project hierarchy |
| Evidence | Facts separated from allegations and references |
| XER | Native tables parsed and dates/calendars validated |
| TIA comparison | Same data date or explicit qualified rejection |
| Schedule changes | All non-fragnet changes reported |
| Concurrency | Independent critical effect tested |
| Visuals | Values reconcile to controlled tables |
| Isolation | No retrieval or defaults from another project |
| Exports | Markdown, DOCX, PDF, JSON and CSV open correctly |
| Application | All pages load and errors are contained by module |
| Archive | ZIP integrity passes |

## Mandatory tests

- Python compilation and linting
- Schema and JSON validation
- Contract citation retrieval tests
- Amendment and precedence tests
- OCR uncertainty tests
- Evidence-status and contradiction tests
- Notice-timeline tests
- XER parser regression tests
- Same-data-date enforcement tests
- Before/after schedule-change reconciliation
- Critical-path and float tests
- Mitigation and concurrency tests
- Cross-project contamination tests
- Visual reconciliation tests
- Report and archive integrity tests

## Failure conditions

The package must not be approved if it:

- Quotes a clause without a traceable source.
- treats a reference number as proof of document content.
- calculates EOT from float loss alone.
- compares uncontrolled schedule models without qualification.
- deducts calendar overlap as concurrency without critical-path proof.
- uses another project's facts or conclusions.
- presents a claimed figure as Engineer-determined.
- displays a visual that does not reconcile to its source data.

## Final validation report

The report shall classify every capability and conclusion as:

- Verified
- Verified with qualification
- Conditional on missing information
- Unsupported
- Not tested

