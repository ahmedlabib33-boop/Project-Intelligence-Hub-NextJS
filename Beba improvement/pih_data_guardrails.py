"""
PIH Data Guardrails & Free-Tier Governance Layer
=================================================
Project Intelligence Hub — free, no-subscription fixes bundle.

Covers, in one module:
  1. Data validation (bounds-checking CPI/SPI/progress/contract value,
     status-vs-progress contradictions) — catches the exact bugs found
     in the current portfolio (CPI ~60, ROYA-BIG contract value = 0,
     every project at 100% progress).
  2. Portfolio aggregation consistency check (simple vs weighted
     average mismatch between sector table and portfolio header).
  3. Letters Intelligence directionality + duplicate-reference audit
     (catches the "Drom samco ti ACEPM" / "From ACEPM to Slamco"
     folder-naming and duplicate-reference-across-folders problem).
  4. Timestamped local backup + manifest + changelog (free
     version-control discipline, no cloud storage needed).
  5. Local SQLite action/audit tracker (project_id scoped, no
     managed-database subscription needed).
  6. A single markdown "guardrail report" that becomes your
     missing-field / bad-data dashboard.

HOW YOUR AGENT WIRES THIS INTO THE EXISTING PIPELINE
-----------------------------------------------------
Current pipeline (per Project_Intelligence_Hub_Comprehensive_Guide):

    Project folders -> tools/generate_nextjs_website_data.py
                     -> website/public/data/portfolio.json
                     -> website/public/data/projects/*.json
                     -> Next.js UI

Drop this file at:  tools/pih_data_guardrails.py

Then add this block to tools/generate_nextjs_website_data.py, right
AFTER portfolio.json and projects/*.json are written, and BEFORE the
website is built/synced:

    import sys
    from pih_data_guardrails import run_guardrails

    ok = run_guardrails(
        portfolio_json_path="website/public/data/portfolio.json",
        projects_json_dir="website/public/data/projects",
        projects_root="projects",          # scans every {Sector}/{Project}
        backup_dir="12-logs/_guardrail_backups",
        action_db_path="12-logs/actions.db",
        report_path="12-logs/guardrail_report_latest.md",
    )
    if not ok:
        print("GUARDRAILS: blocking issues found — see 12-logs/guardrail_report_latest.md")
        print("Publish aborted. Fix BLOCK-level issues above, then rerun.")
        sys.exit(1)

That is the only required integration point. Everything else below is
self-contained standard-library Python (no new pip installs).

WARN-level issues are logged but do not stop the pipeline.
BLOCK-level issues stop it (run_guardrails returns False) — because a
number like "CPI: 60.11" or "contract value: 0 on an Active project"
should never reach a board dashboard silently.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Optional


# ---------------------------------------------------------------------------
# 1. VALIDATION BOUNDS — tune these per your contract/portfolio norms
# ---------------------------------------------------------------------------

BOUNDS = {
    # (min, max) — outside this range is almost always a calculation bug,
    # not a real project condition.
    "spi": (0.10, 2.00),
    "cpi": (0.20, 3.00),
    "progress": (0.0, 100.0),
}

# Statuses where contract_value == 0 or progress == 100 is almost
# certainly a data/mapping bug rather than reality.
NON_ZERO_VALUE_STATUSES = {"active", "delayed", "on track"}
SUSPICIOUS_FULL_PROGRESS_STATUSES = {"delayed"}


@dataclass
class Issue:
    severity: str            # "BLOCK" or "WARN"
    scope: str                # e.g. project_id, "portfolio", "letters"
    field: str
    message: str


@dataclass
class GuardrailResult:
    issues: list = field(default_factory=list)

    def add(self, severity: str, scope: str, field_name: str, message: str):
        self.issues.append(Issue(severity, scope, field_name, message))

    @property
    def blocking(self) -> bool:
        return any(i.severity == "BLOCK" for i in self.issues)


# ---------------------------------------------------------------------------
# 2. PER-PROJECT VALIDATION
# ---------------------------------------------------------------------------

def validate_project(project: dict, result: GuardrailResult) -> None:
    """
    Validate a single project's generated JSON record.
    Expects keys roughly matching the portfolio table:
    project_id/name, status, contract_value, progress, spi, cpi.
    Missing keys are treated as WARN (schema drift), not BLOCK.
    """
    name = project.get("project_name") or project.get("project_id") or "UNKNOWN_PROJECT"
    status = str(project.get("status", "")).strip().lower()

    # --- contract value ---
    contract_value = project.get("contract_value")
    if contract_value is None:
        result.add("WARN", name, "contract_value", "Field missing from project JSON.")
    elif status in NON_ZERO_VALUE_STATUSES and float(contract_value) == 0:
        result.add(
            "BLOCK", name, "contract_value",
            f"contract_value is 0 while status is '{status}'. This almost always means "
            "the source cost/contract CSV wasn't read for this project — check "
            "01-data/import_templates/projects.csv and contracts.csv for this project_id."
        )

    # --- progress vs status ---
    progress = project.get("progress")
    if progress is not None:
        lo, hi = BOUNDS["progress"]
        if not (lo <= float(progress) <= hi):
            result.add("BLOCK", name, "progress", f"progress={progress} is outside [{lo},{hi}].")
        if float(progress) == 100.0 and status in SUSPICIOUS_FULL_PROGRESS_STATUSES:
            result.add(
                "WARN", name, "progress",
                "progress is exactly 100.0% while status is 'Delayed'. Possible default/"
                "placeholder value rather than a real reading — verify against source progress.csv."
            )

    # --- SPI / CPI bounds ---
    for metric_key in ("spi", "cpi"):
        value = project.get(metric_key)
        if value is None:
            result.add("WARN", name, metric_key, f"{metric_key.upper()} missing from project JSON.")
            continue
        lo, hi = BOUNDS[metric_key]
        if not (lo <= float(value) <= hi):
            result.add(
                "BLOCK", name, metric_key,
                f"{metric_key.upper()}={value} is outside plausible range [{lo},{hi}]. "
                f"{metric_key.upper()} = EV/AC (or EV/PV for SPI) — a value this far out usually means "
                "AC or PV is near zero for this project. Check evm.csv for this project_id."
            )

    # --- EV/AC sanity: near-zero denominator explicitly ---
    ev, ac = project.get("ev"), project.get("ac")
    if ev is not None and ac is not None:
        try:
            ev_f, ac_f = float(ev), float(ac)
            if ev_f > 0 and ac_f < (0.01 * ev_f):
                result.add(
                    "BLOCK", name, "ac",
                    f"AC ({ac_f}) is near-zero relative to EV ({ev_f}) — this is the direct "
                    "cause of an inflated CPI. Confirm actual cost data was imported for this project."
                )
        except (TypeError, ValueError):
            pass


# ---------------------------------------------------------------------------
# 3. PORTFOLIO AGGREGATION CONSISTENCY CHECK
# ---------------------------------------------------------------------------

def check_aggregation_consistency(
    portfolio_header: dict,
    projects: list,
    result: GuardrailResult,
    tolerance: float = 0.05,
) -> None:
    """
    Recomputes simple averages of SPI/CPI/progress across `projects` and
    compares them against the claimed portfolio-level averages. Flags a
    WARN (not BLOCK, since weighting method may legitimately differ) if
    they disagree by more than `tolerance`, so the discrepancy at least
    gets documented instead of silently shipping.
    """
    for metric_key, header_key in (("spi", "average_spi"), ("cpi", "average_cpi"), ("progress", "average_progress")):
        values = [float(p[metric_key]) for p in projects if p.get(metric_key) is not None]
        if not values:
            continue
        simple_avg = sum(values) / len(values)
        claimed = portfolio_header.get(header_key)
        if claimed is None:
            continue
        claimed = float(claimed)
        if simple_avg == 0:
            continue
        pct_diff = abs(simple_avg - claimed) / max(abs(simple_avg), 1e-9)
        if pct_diff > tolerance:
            result.add(
                "WARN", "portfolio", header_key,
                f"Claimed {header_key}={claimed:.2f} does not match simple average of "
                f"per-project values ({simple_avg:.2f}, diff {pct_diff*100:.1f}%). Either "
                "document the weighting method used (value-weighted vs count-weighted) "
                "or fix the aggregator — right now this is unexplained on the dashboard."
            )


# ---------------------------------------------------------------------------
# 4. LETTERS INTELLIGENCE INTEGRITY CHECK
# ---------------------------------------------------------------------------

REF_PATTERN = re.compile(r"[A-Z]{2,}(?:-[A-Z0-9]+)+-LET-\d+", re.IGNORECASE)
DIRECTION_PATTERN = re.compile(r"from\s+(.+?)\s+to\s+(.+)", re.IGNORECASE)

# Known-good company tokens — extend this list per project/contract.
KNOWN_PARTIES = ["SAMCO", "ACEPM"]


def _closest_known_party(token: str) -> Optional[str]:
    """Cheap fuzzy match (edit distance <=2) to catch typos like 'Slamco' -> 'SAMCO'."""
    token_clean = re.sub(r"[^A-Za-z]", "", token).upper()

    def edit_distance(a: str, b: str) -> int:
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            prev = cur
        return prev[-1]

    best, best_dist = None, 3
    for party in KNOWN_PARTIES:
        d = edit_distance(token_clean, party)
        if d < best_dist:
            best, best_dist = party, d
    return best


def check_letters_intelligence(projects_root: str, result: GuardrailResult) -> None:
    """
    Walks every project's 07-letters_intelligence/inbox/* subfolders.
    Flags:
      - folder names that don't match "From X to Y" or contain a typo'd
        party name (fuzzy-corrected against KNOWN_PARTIES)
      - the same letter reference code appearing under more than one
        inbox subfolder (the exact bug found in ROYA-BIG's ingest report)
    """
    if not os.path.isdir(projects_root):
        result.add("WARN", "letters", "projects_root", f"'{projects_root}' not found — skipped letters audit.")
        return

    for sector in os.listdir(projects_root):
        sector_path = os.path.join(projects_root, sector)
        if not os.path.isdir(sector_path):
            continue
        for project_name in os.listdir(sector_path):
            inbox = os.path.join(sector_path, project_name, "07-letters_intelligence", "inbox")
            if not os.path.isdir(inbox):
                continue

            ref_to_folders: dict[str, set] = {}

            for folder_name in os.listdir(inbox):
                folder_path = os.path.join(inbox, folder_name)
                if not os.path.isdir(folder_path):
                    continue

                m = DIRECTION_PATTERN.search(folder_name)
                if not m:
                    result.add(
                        "WARN", project_name, "letters_folder_name",
                        f"Inbox folder '{folder_name}' does not match the 'From X to Y' naming "
                        "convention — automated direction detection will not work reliably for it."
                    )
                else:
                    for raw_party in m.groups():
                        corrected = _closest_known_party(raw_party)
                        if corrected and corrected.upper() != re.sub(r"[^A-Za-z]", "", raw_party).upper():
                            result.add(
                                "WARN", project_name, "letters_folder_name",
                                f"Folder '{folder_name}' contains '{raw_party.strip()}', which looks "
                                f"like a typo of '{corrected}'. Rename the folder — direction-of-"
                                "correspondence naming errors are a claims/evidence risk."
                            )

                # collect reference codes from filenames in this folder
                for fname in os.listdir(folder_path):
                    for ref in REF_PATTERN.findall(fname):
                        ref_to_folders.setdefault(ref.upper(), set()).add(folder_name)

            for ref, folders in ref_to_folders.items():
                if len(folders) > 1:
                    result.add(
                        "BLOCK", project_name, "letters_duplicate_reference",
                        f"Reference '{ref}' appears in multiple inbox folders: {sorted(folders)}. "
                        "This causes double-counting or wrong-direction attribution in the letters "
                        "workbook — resolve which folder is correct before the next ingest."
                    )


def check_cited_but_missing_references(
    known_refs: Iterable[str], cited_refs: Iterable[str], scope: str, result: GuardrailResult
) -> None:
    """
    Pass the set of reference codes that exist in the workbook (known_refs)
    and the set of reference codes mentioned inside letter subjects/bodies
    (cited_refs, e.g. extracted from "Re: BD-ACEPM-SAMCO-LET-031" subject
    lines). Anything cited but not present is an evidentiary gap.
    """
    known = {r.upper() for r in known_refs}
    for ref in cited_refs:
        if ref.upper() not in known:
            result.add(
                "WARN", scope, "letters_missing_source",
                f"'{ref}' is cited by an existing letter but no source letter with that "
                "reference exists in the workbook or inbox folders — open a missing-evidence item."
            )


# ---------------------------------------------------------------------------
# 5. TIMESTAMPED BACKUP + MANIFEST + CHANGELOG (free version control)
# ---------------------------------------------------------------------------

def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def backup_and_snapshot(paths: list, backup_dir: str, note: str = "") -> str:
    """
    Copies each file in `paths` into a timestamped subfolder of backup_dir,
    writes a manifest.json with checksums, and appends one line to
    backup_dir/CHANGELOG.md. Returns the snapshot folder path.
    """
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    snapshot_dir = os.path.join(backup_dir, ts)
    os.makedirs(snapshot_dir, exist_ok=True)

    manifest = {"timestamp": ts, "note": note, "files": []}
    for path in paths:
        if not os.path.isfile(path):
            continue
        dest = os.path.join(snapshot_dir, os.path.basename(path))
        shutil.copy2(path, dest)
        manifest["files"].append({"source": path, "sha256": _sha256(path)})

    with open(os.path.join(snapshot_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    changelog_path = os.path.join(backup_dir, "CHANGELOG.md")
    with open(changelog_path, "a", encoding="utf-8") as f:
        f.write(f"- {ts} — {note or 'pipeline run'} — {len(manifest['files'])} file(s) snapshotted\n")

    return snapshot_dir


# ---------------------------------------------------------------------------
# 6. LOCAL SQLITE ACTION / AUDIT TRACKER
# ---------------------------------------------------------------------------

def init_action_db(db_path: str) -> None:
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            action_text TEXT NOT NULL,
            owner TEXT,
            status TEXT DEFAULT 'Open',
            severity TEXT,
            due_date TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def log_action(
    db_path: str, project_id: str, action_text: str,
    owner: str = "", severity: str = "WARN", due_date: str = "",
) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO actions (project_id, action_text, owner, status, severity, due_date, created_at, updated_at) "
        "VALUES (?, ?, ?, 'Open', ?, ?, ?, ?)",
        (project_id, action_text, owner, severity, due_date, now, now),
    )
    conn.commit()
    conn.close()


def get_open_actions(db_path: str, project_id: Optional[str] = None) -> list:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    if project_id:
        rows = conn.execute("SELECT * FROM actions WHERE status='Open' AND project_id=?", (project_id,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM actions WHERE status='Open'").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 7. REPORT WRITER (your free "missing-field / bad-data dashboard")
# ---------------------------------------------------------------------------

def write_report(result: GuardrailResult, report_path: str) -> None:
    os.makedirs(os.path.dirname(report_path) or ".", exist_ok=True)
    blocks = [i for i in result.issues if i.severity == "BLOCK"]
    warns = [i for i in result.issues if i.severity == "WARN"]

    lines = [
        f"# Guardrail Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        f"BLOCK issues: {len(blocks)}  |  WARN issues: {len(warns)}",
        "",
        "## BLOCK (pipeline halted until fixed)" if blocks else "## BLOCK\n_None._",
    ]
    for i in blocks:
        lines.append(f"- **[{i.scope}] {i.field}** — {i.message}")

    lines.append("")
    lines.append("## WARN (logged, does not halt pipeline)" if warns else "## WARN\n_None._")
    for i in warns:
        lines.append(f"- [{i.scope}] {i.field} — {i.message}")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# 8. ORCHESTRATOR — the single function your pipeline calls
# ---------------------------------------------------------------------------

def run_guardrails(
    portfolio_json_path: str,
    projects_json_dir: str,
    projects_root: str = "projects",
    backup_dir: str = "12-logs/_guardrail_backups",
    action_db_path: str = "12-logs/actions.db",
    report_path: str = "12-logs/guardrail_report_latest.md",
) -> bool:
    """
    Runs every free-tier check and writes a single report.
    Returns True if it's safe to continue publishing (no BLOCK issues),
    False otherwise. Call this right after portfolio.json / projects/*.json
    are generated, and before build/sync/deploy.
    """
    result = GuardrailResult()

    # 1) per-project validation
    project_records = []
    if os.path.isdir(projects_json_dir):
        for fname in os.listdir(projects_json_dir):
            if not fname.endswith(".json"):
                continue
            with open(os.path.join(projects_json_dir, fname), encoding="utf-8") as f:
                proj = json.load(f)
            project_records.append(proj)
            validate_project(proj, result)
    else:
        result.add("WARN", "pipeline", "projects_json_dir", f"'{projects_json_dir}' not found.")

    # 2) aggregation consistency
    if os.path.isfile(portfolio_json_path):
        with open(portfolio_json_path, encoding="utf-8") as f:
            portfolio_header = json.load(f)
        check_aggregation_consistency(portfolio_header, project_records, result)
    else:
        result.add("WARN", "pipeline", "portfolio_json_path", f"'{portfolio_json_path}' not found.")

    # 3) letters intelligence integrity
    check_letters_intelligence(projects_root, result)

    # 4) backup + manifest + changelog
    to_backup = [p for p in [portfolio_json_path] if os.path.isfile(p)]
    to_backup += [
        os.path.join(projects_json_dir, f)
        for f in (os.listdir(projects_json_dir) if os.path.isdir(projects_json_dir) else [])
        if f.endswith(".json")
    ]
    if to_backup:
        backup_and_snapshot(to_backup, backup_dir, note="pre-publish guardrail snapshot")

    # 5) push BLOCK issues into the local audit tracker so they're not lost
    init_action_db(action_db_path)
    for issue in result.issues:
        if issue.severity == "BLOCK":
            log_action(
                action_db_path, project_id=issue.scope,
                action_text=f"[{issue.field}] {issue.message}",
                severity="BLOCK",
            )

    # 6) write the human-readable report
    write_report(result, report_path)

    return not result.blocking


# ---------------------------------------------------------------------------
# Standalone CLI — lets you dry-run this against an existing website/public/data
# folder without touching generate_nextjs_website_data.py yet.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run PIH data guardrails standalone.")
    parser.add_argument("--portfolio-json", default="website/public/data/portfolio.json")
    parser.add_argument("--projects-json-dir", default="website/public/data/projects")
    parser.add_argument("--projects-root", default="projects")
    parser.add_argument("--backup-dir", default="12-logs/_guardrail_backups")
    parser.add_argument("--action-db", default="12-logs/actions.db")
    parser.add_argument("--report", default="12-logs/guardrail_report_latest.md")
    args = parser.parse_args()

    ok = run_guardrails(
        portfolio_json_path=args.portfolio_json,
        projects_json_dir=args.projects_json_dir,
        projects_root=args.projects_root,
        backup_dir=args.backup_dir,
        action_db_path=args.action_db,
        report_path=args.report,
    )
    print(f"Guardrails {'PASSED' if ok else 'FAILED (BLOCK issues found)'}. Report: {args.report}")
