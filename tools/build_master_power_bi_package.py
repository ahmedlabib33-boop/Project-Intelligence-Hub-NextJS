from __future__ import annotations

import json
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.construction_system.project_catalog import discover_projects


PROJECTS_ROOT = ROOT / "projects"
PACKAGE_ROOT = ROOT / "11-outputs" / "master_dashboard_power_bi_package"
ZIP_PATH = ROOT / "11-outputs" / "Master_Dashboard_Power_BI_Build_Kit.zip"


CORE_FILES = {
    "projects": "projects.csv",
    "wbs": "wbs.csv",
    "activities": "activities.csv",
    "milestones": "milestones.csv",
    "s_curve": "s_curve.csv",
    "evm": "evm.csv",
    "contracts": "contracts.csv",
    "payments": "payments.csv",
    "risks": "risks.csv",
    "delay_events": "delay_events.csv",
    "claims": "claims.csv",
}


def read_csv(path: Path, project_id: str, project_name: str, sector_name: str) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    frame = pd.read_csv(path)
    if "project_id" not in frame.columns:
        frame.insert(0, "project_id", project_id)
    else:
        frame["project_id"] = project_id
    if "project_name" not in frame.columns:
        frame.insert(1, "project_name", project_name)
    if "sector_name" not in frame.columns:
        frame.insert(2, "sector_name", sector_name)
    frame["source_file"] = str(path.relative_to(ROOT))
    return frame


def collect_core_tables(records: list[dict]) -> dict[str, pd.DataFrame]:
    collected: dict[str, list[pd.DataFrame]] = {name: [] for name in CORE_FILES}
    for record in records:
        project_dir = Path(record["project_dir"])
        import_dir = project_dir / "01-data" / "import_templates"
        for table_name, file_name in CORE_FILES.items():
            frame = read_csv(
                import_dir / file_name,
                str(record["project_id"]),
                str(record["project_name"]),
                str(record.get("sector_name", "")),
            )
            if not frame.empty:
                collected[table_name].append(frame)
    return {
        name: pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        for name, frames in collected.items()
    }


def collect_claims_tables(records: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    summaries: list[dict] = []
    clauses: list[pd.DataFrame] = []
    for record in records:
        project_dir = Path(record["project_dir"])
        db_path = project_dir / "05-contracts" / "contract_claims.db"
        if not db_path.exists():
            summaries.append(
                {
                    "project_id": record["project_id"],
                    "project_name": record["project_name"],
                    "sector_name": record.get("sector_name", ""),
                    "contract_documents": 0,
                    "contract_clauses": 0,
                    "evidence_documents": 0,
                    "claim_drafts": 0,
                }
            )
            continue
        conn = sqlite3.connect(db_path)
        try:
            counts = {}
            for table in ["contract_documents", "contract_clauses", "evidence_documents", "claim_drafts"]:
                try:
                    counts[table] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] or 0)
                except Exception:
                    counts[table] = 0
            summaries.append(
                {
                    "project_id": record["project_id"],
                    "project_name": record["project_name"],
                    "sector_name": record.get("sector_name", ""),
                    **counts,
                    "source_file": str(db_path.relative_to(ROOT)),
                }
            )
            try:
                clause_df = pd.read_sql_query(
                    """
                    SELECT c.id, c.clause_number, c.clause_title, c.section_name, c.claim_type,
                           c.risk_level, c.claim_strength, c.time_impact, c.cost_impact,
                           c.notice_required, d.file_name
                    FROM contract_clauses c
                    LEFT JOIN contract_documents d ON d.id = c.document_id
                    """,
                    conn,
                )
                if not clause_df.empty:
                    clause_df.insert(0, "project_id", record["project_id"])
                    clause_df.insert(1, "project_name", record["project_name"])
                    clause_df.insert(2, "sector_name", record.get("sector_name", ""))
                    clause_df["source_file"] = str(db_path.relative_to(ROOT))
                    clauses.append(clause_df)
            except Exception:
                pass
        finally:
            conn.close()
    summary_df = pd.DataFrame(summaries)
    clauses_df = pd.concat(clauses, ignore_index=True) if clauses else pd.DataFrame()
    return summary_df, clauses_df


def collect_source_register(records: list[dict]) -> pd.DataFrame:
    rows: list[dict] = []
    for record in records:
        project_dir = Path(record["project_dir"])
        for file in project_dir.rglob("*"):
            if not file.is_file() or file.name == ".gitkeep":
                continue
            rows.append(
                {
                    "project_id": record["project_id"],
                    "project_name": record["project_name"],
                    "sector_name": record.get("sector_name", ""),
                    "relative_path": file.relative_to(project_dir).as_posix(),
                    "file_name": file.name,
                    "suffix": file.suffix.lower(),
                    "size_bytes": file.stat().st_size,
                    "modified_utc": datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat(),
                }
            )
    return pd.DataFrame(rows)


def write_text_assets(package_root: Path) -> None:
    (package_root / "theme").mkdir(parents=True, exist_ok=True)
    (package_root / "dax").mkdir(parents=True, exist_ok=True)
    (package_root / "power_query").mkdir(parents=True, exist_ok=True)
    (package_root / "docs").mkdir(parents=True, exist_ok=True)
    (package_root / "layout").mkdir(parents=True, exist_ok=True)

    theme = {
        "name": "Master Dashboard Dark Glass",
        "dataColors": ["#f59e0b", "#10b981", "#3b82f6", "#f43f5e", "#06b6d4", "#8b5cf6"],
        "background": "#0a0e27",
        "foreground": "#f8fafc",
        "tableAccent": "#f59e0b",
    }
    (package_root / "theme" / "master_dashboard_theme.json").write_text(json.dumps(theme, indent=2), encoding="utf-8")

    (package_root / "dax" / "master_dashboard_measures.dax").write_text(
        """Total Projects = DISTINCTCOUNT(Projects[project_id])
Total Contract Value = SUM(Projects[contract_value])
Total Activities = COUNTROWS(Activities)
Critical Activities = CALCULATE(COUNTROWS(Activities), Activities[is_critical] = "Yes")
Total Risks = COUNTROWS(Risks)
Open Risks = CALCULATE(COUNTROWS(Risks), Risks[status] = "Open")
Total Delay Events = COUNTROWS('Delay Events')
Total Delay Days = SUM('Delay Events'[estimated_delay_days])
BAC = SUM(EVM[BAC])
PV = SUM(EVM[PV])
EV = SUM(EVM[EV])
AC = SUM(EVM[AC])
SPI = DIVIDE([EV], [PV])
CPI = DIVIDE([EV], [AC])
Contract Clauses = SUM('Claims Summary'[contract_clauses])
High Risk Clauses = CALCULATE(COUNTROWS('Contract Clauses'), 'Contract Clauses'[risk_level] IN {"High", "Critical"})
""",
        encoding="utf-8",
    )

    (package_root / "power_query" / "load_master_dashboard_folder.pq").write_text(
        """// Change FolderPath to the extracted ZIP data folder.
let
    FolderPath = "C:\\\\Users\\\\pc\\\\OneDrive\\\\Documents\\\\Project Intelligence Hub\\\\11-outputs\\\\master_dashboard_power_bi_package\\\\data\\\\",
    LoadCsv = (FileName as text) => Table.PromoteHeaders(Csv.Document(File.Contents(FolderPath & FileName), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]), [PromoteAllScalars=true])
in
    [
        Projects = LoadCsv("projects.csv"),
        WBS = LoadCsv("wbs.csv"),
        Activities = LoadCsv("activities.csv"),
        Milestones = LoadCsv("milestones.csv"),
        S_Curve = LoadCsv("s_curve.csv"),
        EVM = LoadCsv("evm.csv"),
        Contracts = LoadCsv("contracts.csv"),
        Payments = LoadCsv("payments.csv"),
        Risks = LoadCsv("risks.csv"),
        Delay_Events = LoadCsv("delay_events.csv"),
        Claims_Summary = LoadCsv("claims_summary.csv"),
        Contract_Clauses = LoadCsv("contract_clauses.csv"),
        Source_Register = LoadCsv("source_file_register.csv")
    ]
""",
        encoding="utf-8",
    )

    guide = """# Master Dashboard Power BI Build Kit

This kit recreates the Project Intelligence Hub Master Dashboard in Power BI using project-isolated exports.

## Pages
1. Project Overview: executive KPI cards, progress, dates, project health.
2. WBS: WBS hierarchy and progress.
3. Activities: activity progress, critical path, delayed activities.
4. Main Milestones: milestone register and timeline.
5. S-Curve Analysis: planned, actual, invoiced cumulative curves.
6. EVM Analysis: BAC, PV, EV, AC, SPI, CPI, SV, CV.
7. Contracts: contract values, payments, commercial status.
8. Letters Intelligence: correspondence and issue-thread data when available.
9. Risk Analysis: risk status, steel/RFI/IFC context.
10. Delay and Time Impact: delay events, responsibility, EOT exposure.

## Build Steps
1. Open Power BI Desktop.
2. Import `theme/master_dashboard_theme.json`.
3. Load all CSV files from the `data` folder.
4. Create relationships using `project_id` from Projects to every fact table.
5. Add measures from `dax/master_dashboard_measures.dax`.
6. Build pages following `layout/page_specification.md`.

## Refresh
Run `python tools/build_master_power_bi_package.py` to refresh the CSVs and ZIP from the current project folders.
"""
    (package_root / "README.md").write_text(guide, encoding="utf-8")
    (package_root / "docs" / "Power_BI_Build_Guide.md").write_text(guide, encoding="utf-8")
    (package_root / "layout" / "page_specification.md").write_text(guide, encoding="utf-8")


def build_package() -> Path:
    records = discover_projects(PROJECTS_ROOT)
    if PACKAGE_ROOT.exists():
        for file in sorted(PACKAGE_ROOT.rglob("*"), reverse=True):
            if file.is_file():
                file.unlink()
            elif file.is_dir():
                file.rmdir()
    data_dir = PACKAGE_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    project_frame = pd.DataFrame(records)
    project_frame.to_csv(data_dir / "project_registry.csv", index=False)
    tables = collect_core_tables(records)
    for name, frame in tables.items():
        frame.to_csv(data_dir / f"{name}.csv", index=False)
    claims_summary, contract_clauses = collect_claims_tables(records)
    claims_summary.to_csv(data_dir / "claims_summary.csv", index=False)
    contract_clauses.to_csv(data_dir / "contract_clauses.csv", index=False)
    collect_source_register(records).to_csv(data_dir / "source_file_register.csv", index=False)

    write_text_assets(PACKAGE_ROOT)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in PACKAGE_ROOT.rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(PACKAGE_ROOT.parent))
    return ZIP_PATH


if __name__ == "__main__":
    print(build_package())
