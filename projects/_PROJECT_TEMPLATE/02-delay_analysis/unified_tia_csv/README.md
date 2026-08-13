# Universal Controlled TIA CSV Pack

Schema version: `1.0.0`

This is an empty, project-neutral input contract for the controlled Time Impact Analysis workflow. It is designed to carry the same evidence gates and reconciliation logic as the governed The BIG TIA release, without carrying any The BIG data into another project.

## Safe use

1. Copy this entire folder into only the new project's `02-delay_analysis/unified_tia_csv` directory.
2. Populate all rows with that project's own P6/XER exports, evidence, contract notices, fragnets, and approvals.
3. Do not copy another project's activity IDs, XER pairs, EOT days, source hashes, evidence references, or report artifacts.
4. Validate before review:

```powershell
python tools/validate_unified_tia_csv.py --input-dir <project>\02-delay_analysis\unified_tia_csv --expected-project-id <project_id> --expected-project-key <project_key>
```

A passing result means the CSV input is structurally complete enough for native P6 review; it does **not** calculate, approve, or establish a contractual EOT. The project's native P6/XER analysis, entitlement evidence, reconciliation closure, and formal approval remain the authority.

See `UNIFIED_TIA_OUTPUT_COVERAGE.csv` for the input-to-output controls and `UNIFIED_TIA_CSV_MANIFEST.json` for the exact schema.
