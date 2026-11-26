"""Admin API guards added in the 2026-10-21 admin audit."""
import httpx
import pytest
from fastapi import FastAPI

from app.api.admin.router import router, verify_admin_token
from app.core.database import get_db
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


def admin_app(db_session) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def db_override():
        yield db_session

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[verify_admin_token] = lambda: None
    return app


async def create_question(db_session, qid: str):
    await QuestionService(db_session).create_question({
        "id": qid,
        "stem_text": "题干",
        "answer": "A",
        "explanation": "解析",
        "source": "human",
        "options": [{"label": "A", "text": "A", "is_correct": True}],
        "labels": [],
        "formulas": [],
        "images": [],
    })


@pytest.mark.asyncio
async def test_unknown_status_filter_is_a_400_not_a_500(db_session):
    app = admin_app(db_session)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        paged = await client.get("/api/admin/questions/paged", params={"status": "bogus"})
        listed = await client.get("/api/admin/questions", params={"status": "bogus"})
        valid = await client.get("/api/admin/questions/paged", params={"status": "approved"})

    assert paged.status_code == 400
    assert listed.status_code == 400
    assert "bogus" in paged.json()["detail"]
    assert valid.status_code == 200


@pytest.mark.asyncio
async def test_answered_question_cannot_be_deleted_but_unused_one_can(db_session):
    await create_question(db_session, "q_guard_answered")
    await create_question(db_session, "q_guard_unused")
    students = StudentService(db_session)
    student = await students.create_student("guard_student", "pass123", "guard_student")
    await students.record_answer(student.id, "q_guard_answered", "A", True, 1000)

    app = admin_app(db_session)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        blocked = await client.delete("/api/admin/questions/q_guard_answered")
        removed = await client.delete("/api/admin/questions/q_guard_unused")
        missing = await client.delete("/api/admin/questions/q_guard_missing")

    assert blocked.status_code == 409
    assert "已退役" in blocked.json()["detail"]
    assert await QuestionService(db_session).get_question("q_guard_answered") is not None
    assert removed.status_code == 200
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_admin_set_student_password_needs_six_characters(db_session):
    app = admin_app(db_session)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        short = await client.post("/api/admin/students", json={"username": "short_pw", "password": "123"})
        created = await client.post("/api/admin/students", json={"username": "ok_pw", "password": "123456"})
        reset_short = await client.post(f"/api/admin/students/{created.json()['id']}/reset-password", json={"password": "12"})

    assert short.status_code == 422
    assert created.status_code == 200
    assert reset_short.status_code == 422
