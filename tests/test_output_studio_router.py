from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENGINE_ROOT = (
    ROOT
    / "Universal engines"
    / "UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_MULTI_LLM_ML_PACKAGE"
)

pytest.importorskip("fastapi")
pytest.importorskip("sklearn")

if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from OUTPUT_STUDIO_PROJECT_CONTROLS_WEB import create_router  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    app = FastAPI()
    app.include_router(
        create_router(
            run_root=tmp_path / "WEB_RUNS",
            model_registry=tmp_path / "MODEL_REGISTRY",
        )
    )
    return TestClient(app)


def test_health_reports_honest_status(client: TestClient) -> None:
    response = client.get("/api/project-controls/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"READY", "NOT_READY"}
    assert body["model_registry"]["real_project_promoted_model_count"] == 0
    assert body["actual_trained_machine_learning"] == "NO — AWAITING VALIDATED REAL-PROJECT MODEL"
    assert "native p6" in body["truthful_readiness_note"].lower()


def test_ml_tasks_lists_fifteen_governed_tasks(client: TestClient) -> None:
    response = client.get("/api/project-controls/ml/tasks")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 15
    assert "delay_risk_prediction" in body["tasks"]


def test_train_rejects_fewer_than_twenty_rows(client: TestClient) -> None:
    csv_bytes = b"project_id,x,y\n" + b"\n".join(
        f"p1,{i},{i * 2}".encode() for i in range(10)
    )
    response = client.post(
        "/api/project-controls/ml/train",
        files={"data": ("tiny.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={
            "task": "forecast_finish_deviation_prediction",
            "target": "y",
            "data_origin": "synthetic_benchmark",
        },
    )
    assert response.status_code == 422
    assert "20 labeled records" in response.json()["detail"]


def test_train_accepts_twenty_rows_and_registers_as_draft(client: TestClient) -> None:
    rows = [f"p1,{i},{'a' if i % 2 == 0 else 'b'}" for i in range(24)]
    csv_bytes = ("project_id,x,label\n" + "\n".join(rows)).encode()
    response = client.post(
        "/api/project-controls/ml/train",
        files={"data": ("small.csv", io.BytesIO(csv_bytes), "text/csv")},
        data={
            "task": "delay_risk_prediction",
            "target": "label",
            "data_origin": "synthetic_benchmark",
            "promote": "true",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["model"]["promotion_status"] == "DRAFT"
    assert body["model"]["promotion_reason"] == "Promotion requires data_origin=real_project"

    models = client.get("/api/project-controls/ml/models").json()
    assert models["registered_model_count"] == 1
    assert models["real_project_promoted_model_count"] == 0
