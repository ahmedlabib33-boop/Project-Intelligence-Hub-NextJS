"""Event-driven orchestration core engine (Schema 1).

Maps the requested architecture onto what this app can actually run without
new infrastructure:

    Event Broker            -> the ``jobs`` table below (claimed atomically,
                                so it behaves like a single-consumer queue
                                even though it is "just" SQLite).
    Relational DB            -> ``construction_system.db`` (the same SQLite
                                file already used by the legacy Streamlit
                                data layer and by the OpenAI response cache
                                in ``openai_gateway.py``).
    Orchestration Core Engine -> ``enqueue_job`` / ``claim_next_job`` /
                                ``run_worker_once`` below, plus the handler
                                registry that dispatches a job to the code
                                that actually knows how to run it.
    External API              -> whatever a handler calls out to (Groq/
                                OpenAI, the GitHub publish API, etc.).
    LLM Worker (Async Task)   -> the ``llm_task`` handler registered in
                                ``orchestration_llm_worker.py``.

There is no RabbitMQ/Redis broker here on purpose: this machine has no
Docker, and a SQLite-backed queue is a real, durable, transactional stand-in
that every part of this app can already reach with zero new infrastructure.
It only works for a single machine/process family (no cross-region fan-out);
that limit is documented, not hidden.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = ROOT / "construction_system.db"

STATUS_QUEUED = "QUEUED"
STATUS_RUNNING = "RUNNING"
STATUS_DONE = "DONE"
STATUS_FAILED = "FAILED"
TERMINAL_STATUSES = {STATUS_DONE, STATUS_FAILED}


@dataclass(frozen=True)
class Job:
    id: str
    job_type: str
    payload: dict[str, Any]
    status: str
    attempts: int
    max_attempts: int
    result: dict[str, Any] | None
    error: str | None
    created_at: str
    updated_at: str
    started_at: str | None
    finished_at: str | None

    @property
    def ok(self) -> bool:
        return self.status == STATUS_DONE and self.result is not None


TaskHandler = Callable[[dict[str, Any]], dict[str, Any]]
_HANDLERS: dict[str, TaskHandler] = {}


def register_handler(job_type: str) -> Callable[[TaskHandler], TaskHandler]:
    """Decorator that registers a function as the executor for ``job_type``."""

    def decorator(func: TaskHandler) -> TaskHandler:
        _HANDLERS[job_type] = func
        return func

    return decorator


def get_handler(job_type: str) -> TaskHandler | None:
    return _HANDLERS.get(job_type)


def registered_job_types() -> list[str]:
    return sorted(_HANDLERS.keys())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_orchestration_tables(db_path: Path = DEFAULT_DB_PATH) -> None:
    conn = _connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                job_type     TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status       TEXT NOT NULL,
                attempts     INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                result_json  TEXT,
                error        TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                started_at   TEXT,
                finished_at  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_jobs_status_type
                ON jobs (status, job_type, created_at);

            CREATE TABLE IF NOT EXISTS job_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id      TEXT NOT NULL,
                ts          TEXT NOT NULL,
                event       TEXT NOT NULL,
                detail_json TEXT,
                FOREIGN KEY (job_id) REFERENCES jobs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_job_events_job_id
                ON job_events (job_id, ts);
            """
        )
        conn.commit()
    finally:
        conn.close()


def _log_event(conn: sqlite3.Connection, job_id: str, event: str, detail: dict[str, Any] | None = None) -> None:
    conn.execute(
        "INSERT INTO job_events (job_id, ts, event, detail_json) VALUES (?, ?, ?, ?)",
        (job_id, _now_iso(), event, json.dumps(detail, ensure_ascii=True, default=str) if detail is not None else None),
    )


def _row_to_job(row: sqlite3.Row) -> Job:
    return Job(
        id=row["id"],
        job_type=row["job_type"],
        payload=json.loads(row["payload_json"]) if row["payload_json"] else {},
        status=row["status"],
        attempts=row["attempts"],
        max_attempts=row["max_attempts"],
        result=json.loads(row["result_json"]) if row["result_json"] else None,
        error=row["error"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def enqueue_job(
    job_type: str,
    payload: dict[str, Any],
    *,
    max_attempts: int = 3,
    db_path: Path = DEFAULT_DB_PATH,
) -> str:
    """Write one job row and its ENQUEUED audit event. Returns the job id."""
    init_orchestration_tables(db_path)
    job_id = uuid.uuid4().hex
    now = _now_iso()
    conn = _connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO jobs (
                id, job_type, payload_json, status, attempts, max_attempts,
                result_json, error, created_at, updated_at, started_at, finished_at
            ) VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, NULL, NULL)
            """,
            (job_id, job_type, json.dumps(payload, ensure_ascii=True, default=str), STATUS_QUEUED, max_attempts, now, now),
        )
        _log_event(conn, job_id, "ENQUEUED", {"job_type": job_type})
        conn.commit()
    finally:
        conn.close()
    return job_id


def claim_next_job(job_types: Iterable[str] | None = None, *, db_path: Path = DEFAULT_DB_PATH) -> Job | None:
    """Atomically claim the oldest QUEUED job, or None if the queue is empty.

    Uses ``BEGIN IMMEDIATE`` so two workers racing on the same SQLite file can
    never claim the same row — this is what makes the "broker" behave like a
    real single-consumer-per-message queue instead of a shared mutable table.
    """
    init_orchestration_tables(db_path)
    conn = _connect(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        query = "SELECT * FROM jobs WHERE status = ?"
        params: list[Any] = [STATUS_QUEUED]
        job_type_list = list(job_types) if job_types is not None else []
        if job_type_list:
            placeholders = ",".join("?" for _ in job_type_list)
            query += f" AND job_type IN ({placeholders})"
            params.extend(job_type_list)
        query += " ORDER BY created_at ASC LIMIT 1"
        row = conn.execute(query, params).fetchone()
        if row is None:
            conn.execute("COMMIT")
            return None
        now = _now_iso()
        conn.execute(
            "UPDATE jobs SET status = ?, attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?",
            (STATUS_RUNNING, now, now, row["id"]),
        )
        _log_event(conn, row["id"], "CLAIMED", {"attempt": row["attempts"] + 1})
        conn.execute("COMMIT")
        job = _row_to_job(row)
        return replace(job, status=STATUS_RUNNING, attempts=job.attempts + 1, started_at=now, updated_at=now)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def complete_job(job_id: str, result: dict[str, Any], *, db_path: Path = DEFAULT_DB_PATH) -> None:
    conn = _connect(db_path)
    try:
        now = _now_iso()
        conn.execute(
            "UPDATE jobs SET status = ?, result_json = ?, error = NULL, updated_at = ?, finished_at = ? WHERE id = ?",
            (STATUS_DONE, json.dumps(result, ensure_ascii=True, default=str), now, now, job_id),
        )
        _log_event(conn, job_id, "COMPLETED")
        conn.commit()
    finally:
        conn.close()


def fail_job(job_id: str, error: str, *, retry: bool = True, db_path: Path = DEFAULT_DB_PATH) -> None:
    conn = _connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT attempts, max_attempts FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return
        now = _now_iso()
        can_retry = retry and row["attempts"] < row["max_attempts"]
        new_status = STATUS_QUEUED if can_retry else STATUS_FAILED
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?",
            (new_status, str(error)[:2000], now, None if can_retry else now, job_id),
        )
        _log_event(conn, job_id, "RETRY_SCHEDULED" if can_retry else "FAILED", {"error": str(error)[:500]})
        conn.commit()
    finally:
        conn.close()


def get_job(job_id: str, *, db_path: Path = DEFAULT_DB_PATH) -> Job | None:
    init_orchestration_tables(db_path)
    conn = _connect(db_path)
    try:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return _row_to_job(row) if row is not None else None
    finally:
        conn.close()


def list_jobs(
    *,
    status: str | None = None,
    job_type: str | None = None,
    limit: int = 50,
    db_path: Path = DEFAULT_DB_PATH,
) -> list[Job]:
    init_orchestration_tables(db_path)
    conn = _connect(db_path)
    try:
        query = "SELECT * FROM jobs WHERE 1=1"
        params: list[Any] = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if job_type:
            query += " AND job_type = ?"
            params.append(job_type)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        return [_row_to_job(row) for row in rows]
    finally:
        conn.close()


def job_events(job_id: str, *, db_path: Path = DEFAULT_DB_PATH) -> list[dict[str, Any]]:
    init_orchestration_tables(db_path)
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT ts, event, detail_json FROM job_events WHERE job_id = ? ORDER BY id ASC",
            (job_id,),
        ).fetchall()
        return [
            {"ts": row["ts"], "event": row["event"], "detail": json.loads(row["detail_json"]) if row["detail_json"] else None}
            for row in rows
        ]
    finally:
        conn.close()


def run_worker_once(job_types: Iterable[str] | None = None, *, db_path: Path = DEFAULT_DB_PATH) -> Job | None:
    """Claim and execute a single job. Returns the finished/failed job, or
    None if the queue had nothing to do."""
    job = claim_next_job(job_types, db_path=db_path)
    if job is None:
        return None
    handler = get_handler(job.job_type)
    if handler is None:
        fail_job(job.id, f"No orchestration handler registered for job_type '{job.job_type}'.", retry=False, db_path=db_path)
        return get_job(job.id, db_path=db_path)
    try:
        result = handler(job.payload)
        complete_job(job.id, result, db_path=db_path)
    except Exception as exc:  # noqa: BLE001 - a handler failure must never crash the worker loop
        fail_job(job.id, f"{exc.__class__.__name__}: {exc}", retry=True, db_path=db_path)
    return get_job(job.id, db_path=db_path)


def drain_queue(job_types: Iterable[str] | None = None, *, limit: int = 100, db_path: Path = DEFAULT_DB_PATH) -> list[Job]:
    """Process queued jobs synchronously until the queue is empty or ``limit``
    jobs have been processed. This is the serverless/CLI-batch-friendly path:
    there is no persistent worker process, so a caller enqueues then drains
    in the same request/run."""
    processed: list[Job] = []
    for _ in range(limit):
        job = run_worker_once(job_types, db_path=db_path)
        if job is None:
            break
        processed.append(job)
    return processed


def run_worker_loop(
    job_types: Iterable[str] | None = None,
    *,
    poll_interval: float = 2.0,
    db_path: Path = DEFAULT_DB_PATH,
    stop_event: Any = None,
) -> None:
    """Continuous background worker for a standalone process. This is the
    literal "LLM Worker (Async Task)" / async-task-runner box: run it from a
    small script and it will keep polling the shared SQLite job table."""
    init_orchestration_tables(db_path)
    while stop_event is None or not stop_event.is_set():
        job = run_worker_once(job_types, db_path=db_path)
        if job is None:
            time.sleep(poll_interval)
