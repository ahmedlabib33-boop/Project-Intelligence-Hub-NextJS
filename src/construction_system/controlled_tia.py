"""Project-isolated controlled Time Impact Analysis source adapter.

This module deliberately does not execute a submitted analysis package.  It
inspects the package as evidence, validates its integrity, reads the native
XER content, and produces a bounded project-local control record.  A final
EOT position remains unavailable until all project-specific evidence and P6
parity gates are approved.
"""

from __future__ import annotations

import ast
import base64
import hashlib
import io
import json
import re
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


ENGINE_VERSION = "2026.08.controlled-project-tia.v1"
SETUP_REQUIRED = "SETUP_REQUIRED"
CONDITIONAL_RESULT = "CONDITIONAL_RESULT"
RECONCILIATION_REQUIRED = "RECONCILIATION_REQUIRED"
READY_AND_CALCULATED = "READY_AND_CALCULATED"
WORKFLOW_TABS = (
    "Source Integrity",
    "Schedule and CPM",
    "Events and Fragnets",
    "Concurrency and Entitlement",
    "EOT Position",
    "AI Review and Run Control",
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _manifest(project: dict[str, Any]) -> tuple[dict[str, Any], Path]:
    # The shared catalog uses ``project_dir`` while the Vercel generator keeps
    # the same boundary under ``path``.  Accept both explicitly; never fall
    # back to the process working directory, which could mix projects.
    raw_dir = _text(project.get("project_dir") or project.get("path"))
    if not raw_dir:
        return {}, Path("__missing_project_context__")
    project_dir = Path(raw_dir)
    return _load_json(project_dir / "project_manifest.json"), project_dir


def _resolve_release(project: dict[str, Any]) -> tuple[dict[str, Any], Path | None]:
    manifest, project_dir = _manifest(project)
    configured = manifest.get("approved_tia_release")
    if not isinstance(configured, dict) or not configured.get("active"):
        return {}, None
    raw_path = _text(configured.get("source_path"))
    if not raw_path:
        return configured, None
    path = Path(raw_path)
    if not path.is_absolute():
        path = (project_dir / path).resolve()
    return configured, path


def _file_record(path: Path, required: bool = True) -> dict[str, Any]:
    exists = path.exists() and path.is_file()
    return {
        "file": path.name,
        "path": str(path),
        "required": required,
        "exists": exists,
        "sha256": _sha256(path) if exists else None,
        "size_bytes": path.stat().st_size if exists else 0,
    }


def _verify_release_signature(release_dir: Path, manifest_raw: bytes) -> dict[str, Any]:
    """Verify the detached manifest when cryptography is available.

    The check is intentionally advisory: a missing optional local package must
    not turn a valid source package into a fabricated schedule conclusion.
    """
    signature = release_dir / "BRAIN_LABIB_V34baba_manifest.sig"
    public_key = release_dir / "BRAIN_LABIB_V34baba_public_key.pem"
    if not signature.exists() or not public_key.exists():
        return {"status": "missing", "message": "Detached manifest signature or public key is missing."}
    try:
        from cryptography.hazmat.primitives import serialization  # type: ignore

        key = serialization.load_pem_public_key(public_key.read_bytes())
        key.verify(signature.read_bytes(), manifest_raw)
        return {"status": "verified", "message": "Detached signed release manifest verified."}
    except ImportError:
        return {"status": "not_checked", "message": "cryptography is unavailable; file hashes were still checked."}
    except Exception as exc:
        return {"status": "failed", "message": f"Detached manifest signature check failed: {exc}"}


def _extract_embedded_payload(core_path: Path) -> tuple[bytes | None, str | None]:
    """Read the embedded package without importing or executing its source."""
    try:
        module = ast.parse(core_path.read_text(encoding="utf-8"), filename=str(core_path))
        encoded: bytes | None = None
        for node in module.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == "PAYLOAD_B85" for target in node.targets):
                continue
            candidate = ast.literal_eval(node.value)
            encoded = candidate.encode("ascii") if isinstance(candidate, str) else bytes(candidate)
            break
        if not encoded:
            return None, "PAYLOAD_B85 was not found in the signed source release."
        # The signed release wraps its Base85 payload over source lines.  Base85
        # itself has no whitespace alphabet, so remove formatting whitespace
        # before decoding without altering any encoded byte.
        return base64.b85decode(b"".join(encoded.split())), None
    except (OSError, UnicodeDecodeError, SyntaxError, ValueError, TypeError) as exc:
        return None, f"The embedded source package could not be read safely: {exc}"


def _parse_xer_table(text: str, table_name: str) -> list[dict[str, str]]:
    fields: list[str] = []
    active = False
    rows: list[dict[str, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r\n")
        if line.startswith("%T"):
            active = line.split("\t", 1)[-1].strip().casefold() == table_name.casefold()
            fields = []
            continue
        if not active:
            continue
        if line.startswith("%F"):
            fields = [item.strip() for item in line.split("\t")[1:]]
            continue
        if line.startswith("%R") and fields:
            values = line.split("\t")[1:]
            rows.append({field: values[index] if index < len(values) else "" for index, field in enumerate(fields)})
    return rows


def _parse_xer_date(value: Any) -> date | None:
    text = _text(value)
    if not text:
        return None
    for pattern in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%d-%b-%y", "%d-%b-%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _date_text(value: Any) -> str | None:
    parsed = _parse_xer_date(value)
    return parsed.isoformat() if parsed else _text(value) or None


def _int_value(value: Any) -> int | None:
    try:
        return int(float(_text(value)))
    except ValueError:
        return None


def _xer_summary(name: str, content: bytes) -> dict[str, Any]:
    text = content.decode("utf-8", errors="replace")
    projects = _parse_xer_table(text, "PROJECT")
    tasks = _parse_xer_table(text, "TASK")
    relationships = _parse_xer_table(text, "TASKPRED")
    project = projects[0] if projects else {}
    critical = 0
    longest = 0
    for task in tasks:
        float_hours = _int_value(task.get("total_float_hr_cnt"))
        if float_hours is not None and float_hours <= 0:
            critical += 1
        if _text(task.get("driving_path_flag")).upper() in {"Y", "YES", "1"}:
            longest += 1
    return {
        "file": name,
        "project_id": _text(project.get("proj_short_name") or project.get("proj_id")),
        "project_name": _text(project.get("proj_name")),
        "data_date": _date_text(project.get("last_recalc_date") or project.get("data_date")),
        "planned_finish": _date_text(project.get("plan_end_date")),
        "scheduled_finish": _date_text(project.get("scd_end_date") or project.get("forecast_end_date")),
        "task_count": len(tasks),
        "relationship_count": len(relationships),
        "critical_task_count": critical,
        "longest_path_task_count": longest,
    }


def _event_id(value: Any) -> str:
    return _text(value).upper().replace(" ", "")


def _normalise_events(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        events: list[dict[str, Any]] = []
        for key, item in value.items():
            if isinstance(item, dict):
                events.append({"event_id": key, **item})
        return events
    return []


def _event_records(brain: dict[str, Any], pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pairs_by_event: dict[str, list[dict[str, Any]]] = {}
    for pair in pairs:
        pairs_by_event.setdefault(_event_id(pair.get("event_id")), []).append(pair)
    records: list[dict[str, Any]] = []
    for index, raw in enumerate(_normalise_events(brain.get("events")), start=1):
        event_id = _event_id(raw.get("event_id") or raw.get("id") or raw.get("event") or f"EV{index:02d}")
        label = _text(raw.get("title") or raw.get("name") or raw.get("event_name") or raw.get("description")) or event_id
        linked_pairs = pairs_by_event.get(event_id, [])
        records.append({
            "event_id": event_id,
            "event_name": label,
            "event_type": _text(raw.get("event_type") or raw.get("type") or raw.get("category")) or None,
            "responsible_party": _text(raw.get("responsible_party") or raw.get("party")) or None,
            "source_reference": _text(raw.get("source") or raw.get("evidence_reference")) or None,
            "native_xer_pairs": len(linked_pairs),
            "assessment": "Native XER pair available; controlled reconciliation remains required." if linked_pairs else "No matched native before/after XER pair was found.",
            "fragnet_status": "P6 design required" if linked_pairs else "Evidence gap",
            "project_id": _text(brain.get("project_id")),
        })
    return records


def _reconciliation_records(brain: dict[str, Any], pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    raw = brain.get("discrepancies_and_corrections") or brain.get("reconciliation") or brain.get("known_issues")
    if isinstance(raw, dict):
        raw = [{"issue": key, **value} if isinstance(value, dict) else {"issue": key, "detail": value} for key, value in raw.items()]
    if isinstance(raw, list):
        for index, item in enumerate(raw, start=1):
            if isinstance(item, dict):
                items.append({
                    "id": _text(item.get("id") or item.get("event_id") or f"RC-{index:02d}"),
                    "issue": _text(item.get("issue") or item.get("finding") or item.get("description")) or "Source reconciliation item",
                    "resolution": _text(item.get("resolution") or item.get("correction") or item.get("required_action")) or "Resolve against native schedule and evidence.",
                })
            else:
                items.append({"id": f"RC-{index:02d}", "issue": _text(item), "resolution": "Resolve against native schedule and evidence."})
    for pair in pairs:
        if not pair.get("before_exists") or not pair.get("after_exists"):
            items.append({"id": f"{pair['event_id']}-PAIR", "issue": "Native before/after XER pair is incomplete.", "resolution": "Provide the matching approved baseline and impacted update."})
    return items


def _native_pairs(zip_file: zipfile.ZipFile) -> list[dict[str, Any]]:
    names = [name for name in zip_file.namelist() if name.casefold().endswith(".xer")]
    groups: dict[str, dict[str, str]] = {}
    for name in names:
        stem = Path(name).stem
        match = re.search(r"(EV\d{2}(?:[_-]BATCH[_-]\d+)?)", stem, flags=re.IGNORECASE)
        event_id = _event_id(match.group(1).replace("_", "-")) if match else "UNMAPPED"
        kind = "before" if re.search(r"before", stem, flags=re.IGNORECASE) else "after" if re.search(r"after", stem, flags=re.IGNORECASE) else "other"
        if kind in {"before", "after"}:
            groups.setdefault(event_id, {})[kind] = name
    pairs: list[dict[str, Any]] = []
    for event_id, pair in sorted(groups.items()):
        before_name, after_name = pair.get("before"), pair.get("after")
        before = _xer_summary(before_name, zip_file.read(before_name)) if before_name else {}
        after = _xer_summary(after_name, zip_file.read(after_name)) if after_name else {}
        before_finish = _parse_xer_date(before.get("scheduled_finish"))
        after_finish = _parse_xer_date(after.get("scheduled_finish"))
        movement = (after_finish - before_finish).days if before_finish and after_finish else None
        pairs.append({
            "event_id": event_id,
            "before_file": before_name,
            "after_file": after_name,
            "before_exists": bool(before_name),
            "after_exists": bool(after_name),
            "before_data_date": before.get("data_date"),
            "after_data_date": after.get("data_date"),
            "before_finish": before.get("scheduled_finish"),
            "after_finish": after.get("scheduled_finish"),
            "native_finish_movement_days": movement,
            "before_task_count": before.get("task_count"),
            "after_task_count": after.get("task_count"),
            "before_relationship_count": before.get("relationship_count"),
            "after_relationship_count": after.get("relationship_count"),
            "critical_task_count": after.get("critical_task_count"),
            "longest_path_task_count": after.get("longest_path_task_count"),
            "status": "pair_available" if before_name and after_name else "pair_incomplete",
            "conclusion": "Native finish movement is a reconciliation input only; it is not an EOT conclusion.",
        })
    return pairs


def _source_fingerprint(release_dir: Path, files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(str(release_dir.resolve()).encode("utf-8"))
    for record in sorted(files, key=lambda item: str(item.get("file"))):
        digest.update(str(record.get("file")).encode("utf-8"))
        digest.update(str(record.get("sha256") or "MISSING").encode("ascii"))
    return digest.hexdigest()


def _setup_snapshot(project: dict[str, Any], detail: str) -> dict[str, Any]:
    return {
        "engine": ENGINE_VERSION,
        "project_id": _text(project.get("project_id")),
        "project_key": _text(project.get("project_key")),
        "status": SETUP_REQUIRED,
        "approval_status": "not_submitted",
        "message": detail,
        "workflow_tabs": list(WORKFLOW_TABS),
        "source_integrity": {"release_configured": False, "files": [], "signature": {"status": "not_checked"}},
        "schedule_cpm": {"xer_pairs": [], "status": "Awaiting project-local approved XER baseline and impacted update."},
        "events_and_fragnets": {"events": [], "status": "Awaiting project-local event register and affected activity mapping."},
        "concurrency_and_entitlement": {"status": "Awaiting project-local concurrency, contract, and evidence controls."},
        "eot_position": {"status": "No EOT position", "label": "Not available", "message": "No final EOT conclusion can be produced until the project supplies its own approved evidence."},
        "ai_scope": {"status": "guidance_only", "message": "AI may explain the missing evidence but cannot calculate or infer an EOT."},
        "missing_evidence": [
            "Approved baseline and impacted XER pair with data dates.",
            "Relationship, calendar, constraint, and open-end validation.",
            "Project event register with affected activity mapping.",
            "Contract entitlement, notices, and event evidence.",
            "Concurrency assessment and Primavera P6 parity review.",
        ],
        "reconciliation_items": [],
        "source_fingerprint": None,
        "automatic_draft": False,
        "last_run_at": None,
    }


def build_controlled_tia_snapshot(project: dict[str, Any]) -> dict[str, Any]:
    """Build the active project's controlled TIA read model without mutation."""
    config, release_dir = _resolve_release(project)
    expected_project_id = _text(project.get("project_id"))
    if release_dir is None:
        return _setup_snapshot(project, "No project-local approved TIA release is configured in project_manifest.json.")
    if not release_dir.exists():
        return _setup_snapshot(project, f"Configured approved TIA release is not available: {release_dir}")
    if _text(config.get("project_id")) and _text(config.get("project_id")) != expected_project_id:
        return _setup_snapshot(project, "The configured TIA release project_id does not match the active project.")

    manifest_path = release_dir / "BRAIN_LABIB_V34baba_manifest.json"
    manifest_raw = manifest_path.read_bytes() if manifest_path.exists() else b""
    release_manifest = _load_json(manifest_path)
    expected_layers = release_manifest.get("layers") if isinstance(release_manifest.get("layers"), list) else []
    files = [_file_record(manifest_path), _file_record(release_dir / "Project_Control_Machine_V34baba_Preserved_Master.py")]
    for layer in expected_layers:
        if isinstance(layer, dict) and _text(layer.get("filename")):
            files.append(_file_record(release_dir / _text(layer.get("filename"))))
    signature = _verify_release_signature(release_dir, manifest_raw) if manifest_raw else {"status": "missing", "message": "Signed release manifest is missing."}
    master = release_manifest.get("master") if isinstance(release_manifest.get("master"), dict) else {}
    master_path = release_dir / _text(master.get("filename") or "Project_Control_Machine_V34baba_Preserved_Master.py")
    master_actual = _sha256(master_path) if master_path.exists() else None
    master_expected = _text(master.get("sha256")) or None
    master_status = "verified" if master_actual and master_actual == master_expected else "failed"
    core_path = release_dir / "labib_core_V34baba.py"
    payload, payload_error = _extract_embedded_payload(core_path) if core_path.exists() else (None, "Core payload source is missing.")
    expected_payload_hash = _text(master.get("embedded_payload_sha256")) or None
    payload_hash = hashlib.sha256(payload).hexdigest() if payload else None
    payload_status = "verified" if payload_hash and payload_hash == expected_payload_hash else "failed"
    missing_files = [record["file"] for record in files if not record["exists"]]
    integrity_ok = not missing_files and master_status == "verified" and payload_status == "verified" and signature.get("status") != "failed"

    brain: dict[str, Any] = {}
    pairs: list[dict[str, Any]] = []
    embedded_error: str | None = payload_error
    if payload:
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as package:
                brain_name = next((name for name in package.namelist() if name.endswith("the_big_project_brain.json")), None)
                if not brain_name:
                    embedded_error = "The signed package does not contain the expected project brain record."
                else:
                    loaded = json.loads(package.read(brain_name).decode("utf-8"))
                    brain = loaded if isinstance(loaded, dict) else {}
                    pairs = _native_pairs(package)
        except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as exc:
            embedded_error = f"The signed embedded source package could not be read: {exc}"

    source_project = _text(brain.get("project_id") or brain.get("project_key"))
    project_match = bool(source_project and source_project == expected_project_id)
    if source_project and not project_match:
        return _setup_snapshot(project, "The signed TIA source package belongs to a different project and has been excluded.")
    event_records = _event_records(brain, pairs)
    reconciliation = _reconciliation_records(brain, pairs)
    complete_pairs = [pair for pair in pairs if pair["status"] == "pair_available"]
    if not integrity_ok or embedded_error:
        status = CONDITIONAL_RESULT
        message = "The source package is present but integrity or embedded-data checks require correction before schedule conclusions."
    elif reconciliation:
        status = RECONCILIATION_REQUIRED
        message = "Native evidence is available, but reconciliation findings block a final EOT position."
    elif not complete_pairs:
        status = CONDITIONAL_RESULT
        message = "No complete native baseline/impacted XER pair is available for a controlled calculation."
    else:
        status = CONDITIONAL_RESULT
        message = "Native XER evidence is available. Manual Primavera P6 parity, contract, concurrency, and approval controls remain required."

    missing_evidence = []
    if not complete_pairs:
        missing_evidence.append("Matching approved baseline and impacted XER pair for each relied-upon event.")
    if reconciliation:
        missing_evidence.append("Resolution of source reconciliation items before publishing EOT or entitlement.")
    missing_evidence.extend([
        "Project calendar, constraints, open ends, out-of-sequence, and relationship parity evidence.",
        "Event-specific contract entitlement, notices, and contemporaneous evidence.",
        "Concurrency analysis and independent Primavera P6 reviewer approval.",
    ])
    files.append({"file": "embedded_payload", "path": "inside signed release", "required": True, "exists": payload is not None, "sha256": payload_hash, "size_bytes": len(payload or b"")})
    return {
        "engine": ENGINE_VERSION,
        "project_id": expected_project_id,
        "project_key": _text(project.get("project_key")),
        "status": status,
        "approval_status": "unreviewed_draft",
        "message": message,
        "workflow_tabs": list(WORKFLOW_TABS),
        "source_integrity": {
            "release_configured": True,
            "release_type": _text(config.get("source_type")) or "approved_project_release",
            "release_path": str(release_dir),
            "files": files,
            "missing_files": missing_files,
            "signature": signature,
            "master": {"status": master_status, "expected_sha256": master_expected, "actual_sha256": master_actual},
            "embedded_payload": {"status": payload_status, "expected_sha256": expected_payload_hash, "actual_sha256": payload_hash, "error": embedded_error},
            "project_match": project_match,
        },
        "schedule_cpm": {
            "status": "Native XER pairs parsed; P6 parity is pending." if complete_pairs else "No complete verified XER pair.",
            "xer_pairs": pairs,
            "cpm_controls": [
                "Relationships and lags are read from native TASKPRED records.",
                "Critical and longest-path indicators are schedule evidence, not an EOT grant.",
                "Calendars, constraints, open ends, and out-of-sequence settings require reviewer parity confirmation.",
            ],
        },
        "events_and_fragnets": {
            "events": event_records,
            "status": "Event-to-XER links are controlled by native pair availability.",
            "fragnet_controls": [
                "Each fragnet must be linked to a project event and affected activity.",
                "A fragnet remains draft until predecessor, successor, relationship, lag, calendar, and evidence are verified in P6.",
            ],
        },
        "concurrency_and_entitlement": {
            "status": "Not concluded until project-specific concurrency and contract evidence are approved.",
            "controls": [
                "EOT and compensation are assessed separately.",
                "Concurrent contractor delay prevents automatic compensation.",
                "No critical-path conclusion is accepted without verified schedule evidence.",
            ],
        },
        "eot_position": {
            "status": "Indicative - P6 verification required",
            "label": "Final EOT not publishable",
            "message": "The controlled adapter reports native schedule movement only as reconciliation evidence. It does not sum, grant, or publish EOT days.",
        },
        "ai_scope": {
            "status": "evidence_explanation_only",
            "message": "Groq receives only this active project's controlled run. It may explain evidence and gaps but cannot create EOT, fragnet, criticality, entitlement, or compensation conclusions.",
        },
        "missing_evidence": missing_evidence,
        "reconciliation_items": reconciliation,
        "source_fingerprint": _source_fingerprint(release_dir, files),
        "automatic_draft": True,
        "last_run_at": datetime.now(timezone.utc).isoformat(),
    }


def refresh_controlled_tia_run(project: dict[str, Any], approve: bool = False) -> dict[str, Any]:
    """Persist one project-local draft run only when its source changes.

    ``approve`` is intentionally conservative: an approval can only be stored
    when the source has no reconciliation item and all gates are ready.  The
    first BRAIN-backed project currently remains a draft until reconciliation.
    """
    snapshot = build_controlled_tia_snapshot(project)
    raw_dir = _text(project.get("project_dir") or project.get("path"))
    if snapshot.get("status") == SETUP_REQUIRED or not raw_dir:
        return snapshot
    project_dir = Path(raw_dir)
    run_dir = project_dir / "02-delay_analysis" / "controlled_runs"
    run_dir.mkdir(parents=True, exist_ok=True)
    run_path = run_dir / "latest.json"
    previous = _load_json(run_path)
    unchanged = previous.get("source_fingerprint") == snapshot.get("source_fingerprint") and previous.get("engine") == ENGINE_VERSION
    if unchanged:
        return previous
    if approve and snapshot.get("status") == READY_AND_CALCULATED:
        snapshot["approval_status"] = "approved"
    elif snapshot.get("status") != SETUP_REQUIRED:
        snapshot["approval_status"] = "unreviewed_draft"
    snapshot["run_id"] = hashlib.sha256(f"{snapshot.get('project_id')}|{snapshot.get('source_fingerprint')}".encode("utf-8")).hexdigest()[:16]
    snapshot["run_path"] = str(run_path)
    run_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    return snapshot
