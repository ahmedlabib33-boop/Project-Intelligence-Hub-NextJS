# Project Intelligence Hub - Run, Test and Prompt Reference

Generated: 01 August 2026, 05:03

## Workspace roles

- Canonical Streamlit calculation and ingestion workspace: `D:\one drive data\OneDrive\Documents\Project Intelligence Hub`
- Vercel delivery workspace: `D:\Project Intelligence Hub NextJS`
- Website folder: `D:\Project Intelligence Hub NextJS\website`
- Public site: `https://samcoegyptdashboard.vercel.app`

## Daily local checks

```powershell
Set-Location "D:\one drive data\OneDrive\Documents\Project Intelligence Hub"
& .\.venv\Scripts\python.exe -m pytest -q tests -p no:cacheprovider
python tools\validate_project_isolation.py
```

## Generate Vercel data and test the delivery workspace

```powershell
Set-Location "D:\Project Intelligence Hub NextJS"
& .\.venv-analytics\Scripts\python.exe tools\generate_nextjs_website_data.py
& .\.venv-analytics\Scripts\python.exe tools\validate_streamlit_vercel_pipeline.py
& .\.venv-analytics\Scripts\python.exe -m pytest -q tests -p no:cacheprovider
Set-Location .\website
npm run build
```

## Vercel pipeline

```powershell
Set-Location "D:\Project Intelligence Hub NextJS"
# Check configuration only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\vercel_project_pipeline.ps1 -Mode DryRun -IntervalSeconds 30
# One validated release
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\vercel_project_pipeline.ps1 -Mode Once -IntervalSeconds 30
# Continuous watcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\vercel_project_pipeline.ps1 -Mode Watch -IntervalSeconds 30
```

## VS Code

```powershell
code "D:\one drive data\OneDrive\Documents\Project Intelligence Hub"
code "D:\Project Intelligence Hub NextJS"
code "D:\Project Intelligence Hub NextJS\website"
```

## Safe coding prompts

1. **Project isolation:** `Trace this selected project from manifest through project_context, loaders, TIA, claims, letters, report outputs and generated Vercel JSON. Report every fallback path and fix only cross-project leakage.`
2. **New project:** `Create a project folder under the correct sector. Create only missing standard folders and a project_manifest.json. Preserve existing files, assign a stable project_id, and do not copy data from another project.`
3. **TIA:** `Use only the selected project's 02-delay_analysis data. Do not fabricate dates or EOT. Use P6 relationship logic, float and concurrency evidence, then label unverified output indicative.`
4. **Claims:** `Use only the selected project's 05-contracts, 06-evidence and claims database. Cite source files and rows, and show missing evidence.`
5. **Deployment:** `Run generator, validator, tests and build. Publish only after all pass. Verify public project JSON and an HTML, PDF and PPTX report using the selected project identity.`

## Never do this

- Do not hardcode a project name as a fallback data source.
- Do not copy a contract library, letters register or output folder from one project to another.
- Do not place secrets in source, prompts, reports or synchronization configuration.
- Do not present a non-P6-recalculated TIA result as final EOT or compensation.
