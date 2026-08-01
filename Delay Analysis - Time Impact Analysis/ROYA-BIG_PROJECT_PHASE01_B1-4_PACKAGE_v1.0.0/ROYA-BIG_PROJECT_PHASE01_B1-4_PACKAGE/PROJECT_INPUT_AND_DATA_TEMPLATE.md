# Project Input and Data Template

## Project identity

| Field | Required value |
|---|---|
| Project name | ROYA-BIG PROJECT PHASE01 (B1-4) |
| Project ID | ROYA_BIG_PHASE01_B1_4 |
| Employer | To be supplied |
| Engineer | To be supplied |
| Contractor | To be supplied |
| Contract date | To be supplied |
| Commencement date | To be supplied |
| Time for Completion | To be supplied |
| Governing law | To be supplied |
| FIDIC edition | To be verified from signed documents |
| Data-date basis | To be supplied per schedule submission |

## Required source folders

```text
sources/
├── 01_contract/
├── 02_fidic_authorized/
├── 03_correspondence/
├── 04_notices_claims/
├── 05_rfi_ifc_drawings/
├── 06_ir_mir_ncr/
├── 07_vi_vo_changes/
├── 08_programmes_xer/
├── 09_progress_records/
├── 10_materials_deliveries/
├── 11_payment_cost/
├── 12_photos_daily_records/
└── 13_meetings_transmittals/
```

## Minimum document-register fields

| Field | Rule |
|---|---|
| Project ID | Mandatory and immutable |
| Document ID | Unique |
| Type | Controlled vocabulary |
| Reference | Original reference |
| Subject | Original subject |
| Revision | Exact revision |
| Issuer / recipient | Named parties |
| Issue / receipt date | Separate fields |
| Proof of receipt | File or status |
| Source path | Original file |
| SHA-256 | Mandatory |
| Verification | Controlled status |
| Related event | Optional until verified |
| Related clauses | Analytical mapping, not proof |

## Delay-event intake

For every event, provide:

- Event ID and neutral title
- Alleged cause and responsible party
- Start, awareness, notice, instruction and completion dates
- Affected work fronts, activities and milestones
- Before and after native XER files
- Fragnet narrative and logic basis
- Relevant calendars and scheduling options
- Notice, particulars and updates
- Supporting correspondence and technical records
- Mitigation records
- Concurrent-event candidates
- Cost records, if money is claimed

## Data-quality status

Each input shall be classified:

- `ACCEPTED_FOR_ANALYSIS`
- `ACCEPTED_WITH_QUALIFICATION`
- `REFERENCE_ONLY`
- `CONFLICTING`
- `INVALID`
- `MISSING`

No invalid or missing value shall be silently substituted using data from another project.

