from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response


HERE = Path(__file__).resolve().parent
WHEEL = HERE.parent / "vendor" / "primavera_planning_recovery_intelligence_10x-6.0.0-py3-none-any.whl"
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
if WHEEL.is_file() and str(WHEEL) not in sys.path:
    # The wheel is loaded directly via zipimport, both by RUN_LOCAL and here on
    # Vercel — it is never pip/uv-installed. requirements.txt only lists its own
    # runtime dependencies (Vercel's uv failed to resolve a local wheel path
    # given through requirements.txt, so pip/uv never touches this file at all).
    sys.path.insert(0, str(WHEEL))

from app import schedule_summary  # type: ignore  # noqa: E402
from core.cpm import calculate_cpm  # type: ignore  # noqa: E402
from core.data_vault import build_schedule_data_vault  # type: ignore  # noqa: E402
from core.document_intelligence import evidence_summary, extract_document_pack  # type: ignore  # noqa: E402
from core.exporter import schedule_to_excel_bytes  # type: ignore  # noqa: E402
from core.integrity import schedule_fingerprint, validate_history_unchanged  # type: ignore  # noqa: E402
from core.models import ProjectSchedule  # type: ignore  # noqa: E402
from core.package_export import build_final_recovery_package  # type: ignore  # noqa: E402
from core.recovery import apply_scenario, generate_recovery_scenarios, validate_scenario  # type: ignore  # noqa: E402
from core.reporting import build_docx_bytes, build_pdf_bytes, build_report_data  # type: ignore  # noqa: E402
from core.report_studio import inspect_template, load_report_data, render_template  # type: ignore  # noqa: E402
from core.schedule_doctor import apply_repairs, build_repair_plan  # type: ignore  # noqa: E402
from core.schedule_import import parse_csv_schedule_bytes, parse_xlsx_schedule_bytes, parse_xml_schedule_bytes  # type: ignore  # noqa: E402
from core.tender_builder import build_tender_schedule  # type: ignore  # noqa: E402
from core.utils import safe_filename  # type: ignore  # noqa: E402
from core.version import ENGINE_NAME, VERSION  # type: ignore  # noqa: E402
from core.xer import parse_xer_bytes  # type: ignore  # noqa: E402
from core.xer_writer import build_recovered_xer_bytes  # type: ignore  # noqa: E402
from _schedule_evidence_analyzer import analyze_schedule_evidence  # noqa: E402
from _controlled_libraries import (  # noqa: E402
    build_productivity_library,
    is_local_runtime,
    load_activity_catalog,
    load_library,
    save_library,
    verify_editor_password,
)
from _schedule_development import (  # noqa: E402
    build_schedule_development,
    build_schedule_development_xer,
    build_schedule_development_xlsx,
    project_schedule_to_development_result,
)


IS_VERCEL = bool(os.getenv("VERCEL"))
# Raw multipart body, per file / combined \u2014 bounded by Vercel's hard,
# non-configurable 4.5 MB request-body cap on Python Functions.
MAX_REQUEST_BYTES = 4_000_000 if IS_VERCEL else 320 * 1024 * 1024
MAX_EVIDENCE_TOTAL_BYTES = 4_000_000 if IS_VERCEL else 320 * 1024 * 1024
MAX_EVIDENCE_FILES = 40 if IS_VERCEL else 500
# Files resolved from Vercel Blob URLs never pass through the request body,
# so they are not subject to the cap above \u2014 this is the real ceiling once a
# file is uploaded client-side via /api/blob-upload.
MAX_BLOB_TOTAL_BYTES = 200 * 1024 * 1024
BLOB_URL_RE = re.compile(r"^https://[a-z0-9]{1,64}\.(public|private)\.blob\.vercel-storage\.com/")
BLOB_READ_WRITE_TOKEN = os.getenv("BLOB_READ_WRITE_TOKEN", "")
ARABIC = re.compile(r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]")

app = FastAPI(title="Project Intelligence Hub Schedule Intelligence 10X", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5184",
        "http://localhost:5184",
        "https://samcoegyptdashboard.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Requested-With"],
)


def _json(value: Any) -> JSONResponse:
    return JSONResponse(json.loads(json.dumps(value, ensure_ascii=False, default=str)))


async def _read(file: UploadFile, *, limit: int = MAX_REQUEST_BYTES) -> bytes:
    data = await file.read(limit + 1)
    await file.close()
    if not data:
        raise HTTPException(400, f"{file.filename or 'Uploaded file'} is empty")
    if len(data) > limit:
        runtime = "Vercel" if IS_VERCEL else "local"
        raise HTTPException(413, f"The {runtime} upload limit is {limit / 1024 / 1024:.0f} MB per file")
    return data


async def _fetch_blob_bytes(url: str, *, limit: int) -> bytes:
    """Fetch a file previously uploaded to Vercel Blob by the browser.

    Only Vercel Blob storage URLs are accepted — this endpoint must never be
    used to make the server fetch an arbitrary attacker-supplied URL (SSRF).
    """
    if not BLOB_URL_RE.match(url):
        raise HTTPException(400, "Rejected file URL: only Vercel Blob storage URLs are accepted")
    if limit <= 0:
        raise HTTPException(413, f"The combined upload exceeds {MAX_BLOB_TOTAL_BYTES / 1024 / 1024:.0f} MB")
    headers = {"Authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}"} if BLOB_READ_WRITE_TOKEN else {}
    try:
        async with httpx.AsyncClient(timeout=50.0) as client:
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 200:
                    raise HTTPException(502, f"Storage returned HTTP {response.status_code} for this file")
                chunks: List[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, f"File exceeds {limit / 1024 / 1024:.0f} MB")
                    chunks.append(chunk)
                return b"".join(chunks)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not reach storage: {type(exc).__name__}") from None


def _parse_blob_refs(payload: str) -> List[Tuple[str, str]]:
    text = (payload or "").strip()
    if not text or text == "[]":
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(400, "evidence_blob_files must be valid JSON") from None
    if not isinstance(parsed, list):
        raise HTTPException(400, "evidence_blob_files must be a JSON array")
    refs: List[Tuple[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise HTTPException(400, "Each evidence_blob_files entry must be an object with name and url")
        url = str(item.get("url") or "").strip()
        name = safe_filename(str(item.get("name") or "evidence"))
        if not url:
            raise HTTPException(400, f"'{name}' is missing its storage URL")
        refs.append((name, url))
    return refs


def _parse_single_blob_ref(payload: str, label: str) -> Optional[Tuple[str, str]]:
    text = (payload or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(400, f"{label} blob reference must be valid JSON") from None
    if not isinstance(parsed, dict):
        raise HTTPException(400, f"{label} blob reference must be a JSON object")
    url = str(parsed.get("url") or "").strip()
    name = safe_filename(str(parsed.get("name") or label))
    if not url:
        raise HTTPException(400, f"{label} blob reference is missing its storage URL")
    return name, url


async def _read_or_blob(file: Optional[UploadFile], blob_ref_json: str, *, label: str) -> Optional[Tuple[str, bytes]]:
    if file is not None:
        payload = await _read(file, limit=MAX_REQUEST_BYTES)
        return safe_filename(file.filename or label), payload
    ref = _parse_single_blob_ref(blob_ref_json, label)
    if ref is None:
        return None
    name, url = ref
    try:
        payload = await _fetch_blob_bytes(url, limit=MAX_BLOB_TOTAL_BYTES)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        raise HTTPException(exc.status_code, f"Could not read '{name}' from storage: {detail}") from None
    if not payload:
        raise HTTPException(400, f"'{name}' uploaded to storage but is empty")
    return name, payload


async def _read_evidence_pack(uploads: List[UploadFile], blob_files_json: str = "[]") -> List[Tuple[str, bytes]]:
    blob_refs = _parse_blob_refs(blob_files_json)
    if not uploads and not blob_refs:
        raise HTTPException(400, "Add at least one evidence document")
    if len(uploads) + len(blob_refs) > MAX_EVIDENCE_FILES:
        raise HTTPException(400, f"A maximum of {MAX_EVIDENCE_FILES} files is allowed per request")
    total_limit = MAX_BLOB_TOTAL_BYTES if blob_refs else MAX_EVIDENCE_TOTAL_BYTES
    packed: List[Tuple[str, bytes]] = []
    total = 0
    for upload in uploads:
        payload = await _read(upload, limit=MAX_REQUEST_BYTES)
        total += len(payload)
        if total > total_limit:
            raise HTTPException(413, f"The combined upload exceeds {total_limit / 1024 / 1024:.0f} MB")
        packed.append((safe_filename(upload.filename or "evidence"), payload))
    for name, url in blob_refs:
        try:
            payload = await _fetch_blob_bytes(url, limit=total_limit - total)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
            raise HTTPException(exc.status_code, f"Could not read '{name}' from storage: {detail}") from None
        if not payload:
            raise HTTPException(400, f"'{name}' uploaded to storage but is empty")
        total += len(payload)
        packed.append((name, payload))
    return packed


def _load_schedule(filename: str, payload: bytes, hours_per_day: float, project_id: str) -> ProjectSchedule:
    suffix = Path(filename).suffix.lower()
    try:
        if suffix == ".xer":
            schedule = parse_xer_bytes(payload, default_hours_per_day=hours_per_day, project_id=project_id or None)
        elif suffix == ".json":
            schedule = ProjectSchedule.from_dict(json.loads(payload.decode("utf-8-sig")))
            schedule.metadata["import_format"] = "JSON"
        elif suffix in {".xlsx", ".xlsm"}:
            schedule = parse_xlsx_schedule_bytes(payload, filename=filename)
        elif suffix in {".csv", ".tsv"}:
            schedule = parse_csv_schedule_bytes(payload, filename=filename)
        elif suffix == ".xml":
            schedule = parse_xml_schedule_bytes(payload, filename=filename)
        else:
            raise HTTPException(400, "Supported schedules: XER, JSON, XLSX, XLSM, CSV, TSV and XML")
        try:
            calculate_cpm(schedule)
        except Exception as exc:
            schedule.metadata["cpm_import_error"] = f"{type(exc).__name__}: {exc}"
        return schedule
    except HTTPException:
        raise
    except UnicodeDecodeError:
        raise HTTPException(400, "JSON and delimited text must use UTF-8 encoding") from None
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON at line {exc.lineno}, column {exc.colno}") from None
    except Exception as exc:
        raise HTTPException(422, f"Schedule import failed: {type(exc).__name__}: {str(exc)[:500]}") from None


def _document_result(document: Any) -> Dict[str, Any]:
    text = document.text or ""
    arabic_characters = len(ARABIC.findall(text))
    scan_warning = any("scanned/image-only" in item or "OCR is not performed" in item for item in document.warnings)
    if arabic_characters:
        read_status = "arabic_text_extracted"
    elif scan_warning:
        read_status = "ocr_required"
    elif text.strip():
        read_status = "text_extracted_no_arabic_detected"
    else:
        read_status = "catalogued_no_readable_text"
    return {
        **document.to_dict(include_text=False, include_tables=True),
        "arabic_characters": arabic_characters,
        "arabic_detected": arabic_characters > 0,
        "arabic_read_status": read_status,
        "text_preview": text[:12_000],
    }


async def _schedule_upload(schedule_file: Optional[UploadFile], hours_per_day: float, project_id: str) -> Tuple[ProjectSchedule, str, bytes]:
    if schedule_file is None:
        raise HTTPException(400, "A schedule file is required")
    filename = safe_filename(schedule_file.filename or "schedule")
    payload = await _read(schedule_file)
    return _load_schedule(filename, payload, hours_per_day, project_id.strip()), filename, payload


def _select_scenario(result: Dict[str, Any], scenario_id: str) -> Dict[str, Any]:
    scenarios = list(result.get("scenarios") or [])
    if not scenarios:
        raise HTTPException(422, "No valid recovery scenario was generated")
    if scenario_id:
        scenario = next((item for item in scenarios if item.get("id") == scenario_id), None)
        if scenario is None:
            raise HTTPException(404, "Recovery scenario was not found")
        return scenario
    return max(
        scenarios,
        key=lambda item: (
            bool(item.get("target_met")),
            float(item.get("score", 0.0)),
            float(item.get("recovery_days", 0.0)),
            -int(item.get("change_count", 0)),
        ),
    )


def _download(content: bytes, media_type: str, filename: str) -> Response:
    if IS_VERCEL and len(content) > 4_300_000:
        raise HTTPException(413, "Generated artifact exceeds Vercel's response limit; use the local 10X service for this file")
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename(filename, "download")}"'},
    )


@app.get("/api/schedule_intelligence")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "engine": ENGINE_NAME,
        "version": VERSION,
        "mode": "stateless-vercel-bridge" if IS_VERCEL else "persistent-local-runtime",
        "upload_limits": {
            "single_file_mb": round(MAX_BLOB_TOTAL_BYTES / 1024 / 1024) if IS_VERCEL else round(MAX_REQUEST_BYTES / 1024 / 1024),
            "combined_mb": round(MAX_BLOB_TOTAL_BYTES / 1024 / 1024) if IS_VERCEL else round(MAX_EVIDENCE_TOTAL_BYTES / 1024 / 1024),
            "file_count": MAX_EVIDENCE_FILES,
            "direct_request_mb": round(MAX_REQUEST_BYTES / 1024 / 1024),
        },
        "schedule_authority": "deterministic",
        "native_p6_verification_required": True,
        "arabic": {
            "unicode_text": True,
            "text_pdf_docx_xlsx_pptx_csv_xml": True,
            "scanned_image_ocr": False,
            "english_and_arabic_analyzer": True,
        },
    }


@app.post("/api/schedule_intelligence")
async def schedule_intelligence(
    action: str = Form(...),
    schedule_file: Optional[UploadFile] = File(None),
    evidence_files: Optional[List[UploadFile]] = File(None),
    template_file: Optional[UploadFile] = File(None),
    data_file: Optional[UploadFile] = File(None),
    evidence_blob_files: str = Form("[]"),
    template_blob_file: str = Form(""),
    data_blob_file: str = Form(""),
    hours_per_day: float = Form(8.0),
    project_id: str = Form(""),
    target_recovery_days: float = Form(0.0),
    near_critical_threshold: float = Form(5.0),
    selected_fix_ids: str = Form("[]"),
    scenario_id: str = Form(""),
    approved: bool = Form(False),
    approved_by: str = Form(""),
    approval_reference: str = Form(""),
    artifact: str = Form("xlsx"),
    project_name: str = Form("Tender / Detailed Schedule"),
    data_date: str = Form(""),
    build_mode: str = Form("TENDER"),
    default_duration_days: float = Form(5.0),
    password: str = Form(""),
    library_kind: str = Form(""),
    library_payload: str = Form(""),
    changed_by: str = Form("Eng. Ahmed Labib"),
    change_reason: str = Form("Controlled library update"),
    analyzer_payload: str = Form("{}"),
    productivity_payload: str = Form("{}"),
    activity_payload: str = Form("{}"),
    development_answers: str = Form("{}"),
    crew_overrides: str = Form("{}"),
):
    action = action.strip().lower()

    if action == "library_unlock":
        if not is_local_runtime():
            raise HTTPException(409, "Password-gated editing is available only in the local application")
        if not verify_editor_password(password):
            raise HTTPException(401, "Incorrect editor password")
        return _json({"unlocked": True, "editing_scope": "local controlled libraries"})

    if action == "library_load":
        try:
            return _json(load_library(library_kind.strip().lower(), project_name.strip()))
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(400, str(exc)) from None

    if action == "library_save":
        if not verify_editor_password(password):
            raise HTTPException(401, "Incorrect editor password")
        try:
            payload = json.loads(library_payload)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, f"Invalid library JSON at line {exc.lineno}") from None
        if not isinstance(payload, dict):
            raise HTTPException(400, "Controlled library payload must be a JSON object")
        try:
            return _json(save_library(
                library_kind.strip().lower(),
                project_name.strip(),
                payload,
                changed_by=changed_by,
                reason=change_reason,
            ))
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(400, str(exc)) from None

    if action == "activity_catalog":
        return _json(load_activity_catalog())

    if action == "productivity_import":
        packed = await _read_evidence_pack(evidence_files or [], evidence_blob_files)
        documents = extract_document_pack(packed)
        result = build_productivity_library(documents, packed, project_name.strip())
        result["documents"] = [_document_result(item) for item in documents]
        return _json(result)

    if action in {"schedule_develop", "schedule_development_export"}:
        try:
            developed = build_schedule_development(
                analyzer_payload,
                productivity_payload,
                activity_payload,
                development_answers,
                crew_overrides,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        if action == "schedule_develop":
            return _json(developed)
        if developed.get("status") != "PRE_P6_SCHEDULE_BUILT":
            raise HTTPException(409, {"message": "Schedule Development is blocked", "blockers": developed.get("blockers", [])})
        try:
            if artifact == "xlsx":
                return _download(
                    build_schedule_development_xlsx(developed),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    f"{developed['summary']['project_id']}_Schedule_Development.xlsx",
                )
            if artifact == "xer":
                return _download(
                    build_schedule_development_xer(developed),
                    "application/octet-stream",
                    f"{developed['summary']['project_id']}_P6_R16_2_STAGING.xer",
                )
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        raise HTTPException(400, "Supported Schedule Development exports: XLSX and XER")

    if action in {"evidence_read", "evidence_analyze"}:
        uploads = evidence_files or []
        packed = await _read_evidence_pack(uploads, evidence_blob_files)
        documents = extract_document_pack(packed)
        if action == "evidence_analyze":
            analysis = analyze_schedule_evidence(documents, project_name=project_name.strip())
            return _json({
                **analysis,
                "summary": evidence_summary(documents),
                "documents": [_document_result(item) for item in documents],
            })
        return _json({"summary": evidence_summary(documents), "documents": [_document_result(item) for item in documents]})

    if action == "tender_build":
        uploads = evidence_files or []
        packed = await _read_evidence_pack(uploads, evidence_blob_files)
        documents = extract_document_pack(packed)
        built, build = build_tender_schedule(
            documents,
            project_name=project_name.strip() or "Tender / Detailed Schedule",
            data_date=data_date.strip() or None,
            mode=build_mode.strip().upper() or "TENDER",
            default_duration_days=default_duration_days,
        )
        try:
            calculate_cpm(built)
        except Exception as exc:
            built.metadata["cpm_import_error"] = f"{type(exc).__name__}: {exc}"
        return _json({
            "summary": schedule_summary(built),
            "evidence": evidence_summary(documents),
            "documents": [_document_result(item) for item in documents],
            "build": build,
            "normalized_schedule": built.to_dict(include_raw_tables=False),
        })

    if action == "report_inspect":
        resolved_template = await _read_or_blob(template_file, template_blob_file, label="template")
        if resolved_template is None:
            raise HTTPException(400, "A report template is required")
        template_name, template_payload = resolved_template
        return _json(inspect_template(template_name, template_payload))

    if action == "report_render":
        resolved_template = await _read_or_blob(template_file, template_blob_file, label="template")
        if resolved_template is None:
            raise HTTPException(400, "A report template is required")
        template_name, template = resolved_template
        values: Dict[str, Any] = {}
        resolved_data = await _read_or_blob(data_file, data_blob_file, label="data")
        if resolved_data is not None:
            data_name, data_payload = resolved_data
            values = load_report_data(data_name, data_payload)
        if schedule_file is not None:
            schedule, _, _ = await _schedule_upload(schedule_file, hours_per_day, project_id)
            schedule_data = schedule.to_dict(include_raw_tables=False)
            values = {**schedule_data, **values, "schedule": schedule_data, "summary": schedule_summary(schedule)}
        content, media_type, extension = render_template(template_name, template, values)
        return _download(content, media_type, f"{Path(template_name).stem}_POPULATED{extension}")

    schedule, filename, source_payload = await _schedule_upload(schedule_file, hours_per_day, project_id)

    if action == "analyze":
        return _json({
            "source_file": filename,
            "summary": schedule_summary(schedule, near_critical_threshold),
            "doctor": build_repair_plan(schedule),
            "schedule_fingerprint": schedule_fingerprint(schedule),
        })

    if action == "doctor":
        return _json({"source_file": filename, **build_repair_plan(schedule)})

    if action == "doctor_apply":
        try:
            fixes = json.loads(selected_fix_ids or "[]")
        except json.JSONDecodeError:
            raise HTTPException(400, "selected_fix_ids must be a JSON array") from None
        if not isinstance(fixes, list):
            raise HTTPException(400, "selected_fix_ids must be a JSON array")
        clone, repair = apply_repairs(schedule, [str(item) for item in fixes], True, approved_by.strip())
        return _json({"source_file": filename, "summary": schedule_summary(clone), "repair": repair})

    if action == "recover":
        result = generate_recovery_scenarios(
            schedule,
            target_recovery_days=max(0.0, target_recovery_days),
            near_critical_threshold=max(0.0, near_critical_threshold),
        )
        return _json({"source_file": filename, "summary": schedule_summary(schedule), **result})

    if action == "export":
        if artifact == "xlsx":
            content = schedule_to_excel_bytes(schedule, {}, [])
            return _download(content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{schedule.project_id}_Schedule_Analysis.xlsx")
        if artifact == "data_vault":
            sources: List[Tuple[str, bytes]] = [(filename, source_payload)]
            content = build_schedule_data_vault(schedule, summary=schedule_summary(schedule), audit_log=[], source_files=sources)
            return _download(content, "application/zip", f"{schedule.project_id}_Data_Vault.zip")
        raise HTTPException(400, "Supported direct exports: xlsx and data_vault")

    if action == "recovery_export":
        if not approved or not approved_by.strip() or not approval_reference.strip():
            raise HTTPException(409, "Approved by and approval reference are mandatory before revised deliverables")
        result = generate_recovery_scenarios(
            schedule,
            target_recovery_days=max(0.0, target_recovery_days),
            near_critical_threshold=max(0.0, near_critical_threshold),
        )
        scenario = _select_scenario(result, scenario_id.strip())
        validation = validate_scenario(schedule, scenario)
        if not validation.get("valid"):
            raise HTTPException(409, {"message": "Scenario validation failed", "errors": validation.get("errors", [])})
        revised = apply_scenario(schedule, scenario, approved_by=approved_by.strip())
        history_violations = validate_history_unchanged(schedule, revised)
        if history_violations:
            raise HTTPException(409, {"message": "Recovery changed locked history", "violations": history_violations[:20]})
        context = {
            "source_schedule_id": schedule_fingerprint(schedule),
            "base_schedule": schedule.clone(),
            "scenario": scenario,
            "approved_by": approved_by.strip(),
            "approval_reference": approval_reference.strip(),
            "accepted_fingerprint": schedule_fingerprint(revised),
        }
        if artifact == "xer":
            if schedule.metadata.get("import_format") == "XER":
                content = build_recovered_xer_bytes(revised)
            elif schedule.metadata.get("native_p6_verification_required"):
                content = build_schedule_development_xer(project_schedule_to_development_result(revised))
            else:
                raise HTTPException(409, "Recovered XER export requires an XER source or a governed Schedule Development model")
            return _download(content, "application/octet-stream", f"{schedule.project_id}_RECOVERED_R16_2_STAGING.xer")
        report_data = build_report_data(revised, context, [], accepted=True)
        if artifact == "docx":
            return _download(build_docx_bytes(report_data), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", f"{schedule.project_id}_Recovery_Report.docx")
        if artifact == "pdf":
            return _download(build_pdf_bytes(report_data), "application/pdf", f"{schedule.project_id}_Recovery_Report.pdf")
        if artifact == "xlsx":
            return _download(schedule_to_excel_bytes(revised, context, []), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{schedule.project_id}_Revised_Schedule.xlsx")
        if artifact == "package":
            return _download(build_final_recovery_package(revised, context, [], accepted=True), "application/zip", f"{schedule.project_id}_Recovery_10X_Package.zip")
        raise HTTPException(400, "Supported recovery exports: XER, XLSX, DOCX, PDF and package")

    raise HTTPException(400, f"Unknown Schedule Intelligence action: {action}")
