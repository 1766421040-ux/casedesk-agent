from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(database_path=str(tmp_path / "test.sqlite3")))


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


@pytest.fixture
def auth(client):
    cached = {}
    def headers(role="agent", tenant="aurora"):
        key = (role, tenant)
        if key not in cached:
            result = client.post("/api/auth/login", json={"email": f"{role}@{tenant}.demo", "password": "DemoPass!2026"})
            assert result.status_code == 200, result.text
            cached[key] = {"Authorization": "Bearer " + result.json()["token"]}
        return cached[key]
    return headers


@pytest.fixture
def refund_run(client, auth):
    response = client.post("/api/tickets/aurora-ticket-1/runs", headers=auth(), json={"idempotencyKey": "first-refund-run"})
    assert response.status_code == 200, response.text
    run = response.json()["run"]
    assert run["status"] == "completed", run
    assert run["approvalId"], run
    return run
