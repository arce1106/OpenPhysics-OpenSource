from fastapi.testclient import TestClient

from app.main import create_app
from app.services import health_service


def test_liveness_does_not_depend_on_external_services():
    response = TestClient(create_app()).get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert len(response.headers["x-request-id"]) == 32


def test_request_id_is_preserved_for_log_correlation():
    response = TestClient(create_app()).get(
        "/health/live",
        headers={"X-Request-ID": "grading-request-123"},
    )

    assert response.headers["x-request-id"] == "grading-request-123"


def test_readiness_returns_service_unavailable_when_a_dependency_is_down(monkeypatch):
    async def not_ready():
        return {
            "status": "not_ready",
            "checks": {"database": True, "redis": False},
        }

    monkeypatch.setattr(health_service, "readiness_status", not_ready)

    response = TestClient(create_app()).get("/health/ready")

    assert response.status_code == 503
    assert response.json()["checks"] == {"database": True, "redis": False}


def test_readiness_returns_ok_only_when_all_dependencies_are_ready(monkeypatch):
    async def ready():
        return {
            "status": "ready",
            "checks": {"database": True, "redis": True},
        }

    monkeypatch.setattr(health_service, "readiness_status", ready)

    response = TestClient(create_app()).get("/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
