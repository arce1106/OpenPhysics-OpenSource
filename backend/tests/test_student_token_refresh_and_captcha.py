import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.services.auth_request_limiter import (
    CAPTCHA_IP_LIMIT, captcha_ip_budget,
)
from app.services.student_service import CAPTCHA_HASH_PREFIX, StudentService, _b64url_decode


def token_payload(token: str) -> dict:
    return json.loads(_b64url_decode(token.split(".")[1]))


def auth_app(students: StudentService, reserve: AsyncMock | None = None) -> FastAPI:
    from app.api.student import auth
    from app.api.student.dependencies import get_student_service
    from app.services.auth_request_limiter import get_sensitive_action_limiter

    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[get_student_service] = lambda: students
    app.dependency_overrides[get_sensitive_action_limiter] = lambda: SimpleNamespace(reserve=reserve or AsyncMock())
    return app


def test_student_tokens_last_thirty_days():
    assert settings.student_access_token_minutes == 60 * 24 * 30


@pytest.mark.asyncio
async def test_refresh_token_extends_a_valid_session(db_session, monkeypatch):
    students = StudentService(db_session)
    student = await students.create_student("refresh_user", "safe-password", "续期学生")
    monkeypatch.setattr("app.services.student_service.time", lambda: 1_000_000)
    old_token = students.create_access_token(student.id, student.auth_version)
    monkeypatch.setattr("app.services.student_service.time", lambda: 1_000_000 + 86_400)
    async with AsyncClient(transport=ASGITransport(app=auth_app(students)), base_url="http://test") as client:
        response = await client.post("/auth/refresh-token", headers={"Authorization": f"Bearer {old_token}"})
    assert response.status_code == 200
    body = response.json()
    assert body["student"]["id"] == student.id
    renewed = token_payload(body["access_token"])
    assert renewed["sub"] == student.id and renewed["ver"] == student.auth_version
    assert renewed["exp"] - token_payload(old_token)["exp"] == 86_400


@pytest.mark.asyncio
async def test_refresh_token_rejects_revoked_expired_or_missing_tokens(db_session, monkeypatch):
    students = StudentService(db_session)
    student = await students.create_student("revoked_user", "safe-password", "改密学生")
    revoked = students.create_access_token(student.id, student.auth_version)
    student.auth_version += 1
    await db_session.commit()
    monkeypatch.setattr("app.services.student_service.time", lambda: 1_000)
    expired = students.create_access_token(student.id, student.auth_version)
    monkeypatch.undo()
    async with AsyncClient(transport=ASGITransport(app=auth_app(students)), base_url="http://test") as client:
        for headers in ({"Authorization": f"Bearer {revoked}"}, {"Authorization": f"Bearer {expired}"}, {}):
            assert (await client.post("/auth/refresh-token", headers=headers)).status_code == 401


def test_captcha_answers_use_a_keyed_digest_bound_to_the_challenge():
    digest = StudentService.hash_captcha_answer("challenge-a", "ab3k")
    assert digest.startswith(CAPTCHA_HASH_PREFIX)
    assert StudentService.verify_captcha_answer("challenge-a", " AB3K ", digest)
    assert not StudentService.verify_captcha_answer("challenge-a", "AB3X", digest)
    # A digest copied to another challenge does not verify there.
    assert not StudentService.verify_captcha_answer("challenge-b", "AB3K", digest)


def test_captchas_issued_before_the_switch_still_verify():
    legacy = StudentService.hash_password("AB3K")
    assert StudentService.verify_captcha_answer("challenge-a", "ab3k", legacy)
    assert not StudentService.verify_captcha_answer("challenge-a", "AB3X", legacy)


@pytest.mark.asyncio
async def test_issued_captcha_verifies_once(db_session, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "test")
    students = StudentService(db_session)
    captcha = await students.request_captcha(return_debug_answer=True)
    assert captcha["image_base64"].startswith("data:image/png;base64,")
    assert await students.verify_captcha(captcha["challenge_id"], captcha["debug_answer"].lower())
    assert not await students.verify_captcha(captcha["challenge_id"], captcha["debug_answer"])


def test_shared_ip_budgets_fit_a_whole_class_behind_one_nat():
    assert captcha_ip_budget("192.0.2.1") == ("captcha-ip", "192.0.2.1", CAPTCHA_IP_LIMIT, 600)
    assert CAPTCHA_IP_LIMIT >= 300


@pytest.mark.asyncio
async def test_captcha_endpoint_reserves_the_shared_captcha_budget(db_session, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "test")
    reserve = AsyncMock()
    students = StudentService(db_session)
    async with AsyncClient(transport=ASGITransport(app=auth_app(students, reserve)), base_url="http://test") as client:
        response = await client.get("/auth/captcha")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    budget = reserve.await_args.args[0][0]
    assert budget[0] == "captcha-ip" and budget[2] == CAPTCHA_IP_LIMIT
