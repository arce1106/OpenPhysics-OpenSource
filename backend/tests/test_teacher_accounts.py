"""Teacher accounts, classes and the class-scoped teacher API (teacher app P0)."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.api.admin.router import verify_admin_token
from app.api.admin.teachers import router as admin_teachers_router
from app.api.teacher.router import auth_router as teacher_auth_router
from app.api.teacher.router import get_rubric_runner
from app.api.teacher.router import router as teacher_router
from app.core.config import DEV_TEACHER_AUTH_SECRET, settings
from app.core.database import get_db
from app.models.knowledge import KnowledgePoint
from app.models.student import StudentMastery
from app.models.teacher import TeacherClassMember
from app.services.admin_auth_service import AdminAuthService
from app.services.login_attempt_limiter import get_login_limiter
from app.services.student_service import StudentService
from app.services.teacher_auth_service import TeacherAuthService
from app.services.teacher_service import TeacherService, TeacherServiceError

INITIAL_PASSWORD = "init2026pass"
NEW_PASSWORD = "teach2026new"


def build_app(db_session, *, admin_authorized: bool = True) -> FastAPI:
    app = FastAPI()
    for router in (admin_teachers_router, teacher_auth_router, teacher_router):
        app.include_router(router)

    async def db_override():
        yield db_session

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_login_limiter] = lambda: SimpleNamespace(
        check=AsyncMock(return_value="test"), succeeded=AsyncMock(),
    )
    if admin_authorized:
        app.dependency_overrides[verify_admin_token] = lambda: None

    async def no_rubric_drafting(_question_points):
        return None

    # Publishing queues AI rubric drafts; tests that need them install a fake drafter.
    app.dependency_overrides[get_rubric_runner] = lambda: no_rubric_drafting
    return app


def client_for(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def ready_teacher(client: httpx.AsyncClient, username: str, display_name: str) -> tuple[str, str]:
    """Create a teacher through the admin API, sign in and replace the initial password."""
    created = await client.post("/api/admin/teachers", json={
        "username": username, "display_name": display_name, "password": INITIAL_PASSWORD,
    })
    assert created.status_code == 201, created.text
    login = await client.post("/api/teacher/auth/login", json={"username": username, "password": INITIAL_PASSWORD})
    changed = await client.post("/api/teacher/me/password", headers=bearer(login.json()["access_token"]), json={
        "current_password": INITIAL_PASSWORD, "new_password": NEW_PASSWORD,
    })
    assert changed.status_code == 200, changed.text
    return created.json()["id"], changed.json()["access_token"]


@pytest.mark.asyncio
async def test_admin_builds_teacher_class_and_roster_from_existing_students(db_session):
    students = StudentService(db_session)
    alice = await students.create_student("alice_s", "pass123", "Alice")
    await students.create_student("bob_s", "pass123", "Bob")
    async with client_for(build_app(db_session)) as client:
        teacher = await client.post("/api/admin/teachers", json={
            "username": "wang", "display_name": "王老师", "password": INITIAL_PASSWORD,
        })
        assert teacher.status_code == 201
        assert teacher.json()["must_change_password"] is True
        duplicate = await client.post("/api/admin/teachers", json={
            "username": "wang", "display_name": "重复", "password": INITIAL_PASSWORD,
        })
        assert duplicate.status_code == 409
        weak = await client.post("/api/admin/teachers", json={
            "username": "li", "display_name": "李老师", "password": "12345678",
        })
        assert weak.status_code == 400

        teacher_id = teacher.json()["id"]
        created = await client.post(f"/api/admin/teachers/{teacher_id}/classes", json={
            "name": "高一(3)班", "grade": "高一", "level": "advanced",
        })
        assert created.status_code == 201
        class_id = created.json()["id"]
        assert (await client.post(f"/api/admin/teachers/{teacher_id}/classes", json={
            "name": "高一(3)班",
        })).status_code == 409
        assert (await client.post(f"/api/admin/teachers/{teacher_id}/classes", json={
            "name": "高一(4)班", "level": "elite",
        })).status_code == 422

        first = await client.post(f"/api/admin/teacher-classes/{class_id}/members", json={"username": "alice_s", "grantor": "school"})
        again = await client.post(f"/api/admin/teacher-classes/{class_id}/members", json={"username": "alice_s", "grantor": "school"})
        missing = await client.post(f"/api/admin/teacher-classes/{class_id}/members", json={"username": "nobody", "grantor": "school"})
        assert first.json()["added"] is True and again.json()["added"] is False
        assert missing.status_code == 404
        rows = (await db_session.execute(select(TeacherClassMember))).scalars().all()
        assert [(row.class_id, row.student_id) for row in rows] == [(class_id, alice.id)]

        listed = await client.get("/api/admin/teachers")
        assert listed.json()[0]["classes"][0]["member_count"] == 1

        removed = await client.delete(f"/api/admin/teacher-classes/{class_id}/members/{alice.id}")
        assert removed.status_code == 204
        assert (await client.delete(f"/api/admin/teacher-classes/{class_id}/members/{alice.id}")).status_code == 404


@pytest.mark.asyncio
async def test_disabled_student_cannot_join_a_class(db_session):
    students = StudentService(db_session)
    await students.create_student("paused_s", "pass123", "Paused", status="disabled")
    service = TeacherService(db_session)
    teacher = await service.create_teacher("zhao", "赵老师", INITIAL_PASSWORD)
    teacher_class = await service.create_class(teacher.id, "高二(1)班")
    with pytest.raises(TeacherServiceError) as error:
        await service.add_member(teacher_class.id, "paused_s")
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_teacher_must_replace_initial_password_before_seeing_classes(db_session):
    async with client_for(build_app(db_session)) as client:
        await client.post("/api/admin/teachers", json={
            "username": "wang", "display_name": "王老师", "password": INITIAL_PASSWORD,
        })
        wrong = await client.post("/api/teacher/auth/login", json={"username": "wang", "password": "nope1234"})
        assert wrong.status_code == 401
        login = await client.post("/api/teacher/auth/login", json={"username": "wang", "password": INITIAL_PASSWORD})
        assert login.status_code == 200
        assert login.json()["teacher"]["must_change_password"] is True
        token = login.json()["access_token"]

        assert (await client.get("/api/teacher/me", headers=bearer(token))).status_code == 200
        assert (await client.get("/api/teacher/classes", headers=bearer(token))).status_code == 403

        same = await client.post("/api/teacher/me/password", headers=bearer(token), json={
            "current_password": INITIAL_PASSWORD, "new_password": INITIAL_PASSWORD,
        })
        assert same.status_code == 400
        changed = await client.post("/api/teacher/me/password", headers=bearer(token), json={
            "current_password": INITIAL_PASSWORD, "new_password": NEW_PASSWORD,
        })
        assert changed.status_code == 200
        assert changed.json()["teacher"]["must_change_password"] is False
        fresh = changed.json()["access_token"]

        # The pre-change token is revoked; the fresh one opens class data.
        assert (await client.get("/api/teacher/me", headers=bearer(token))).status_code == 401
        assert (await client.get("/api/teacher/classes", headers=bearer(fresh))).status_code == 200


@pytest.mark.asyncio
async def test_teacher_only_reaches_own_classes(db_session):
    students = StudentService(db_session)
    alice = await students.create_student("alice_s", "pass123", "Alice")
    bob = await students.create_student("bob_s", "pass123", "Bob")
    async with client_for(build_app(db_session)) as client:
        wang_id, wang_token = await ready_teacher(client, "wang", "王老师")
        li_id, li_token = await ready_teacher(client, "li", "李老师")
        wang_class = (await client.post(f"/api/admin/teachers/{wang_id}/classes", json={"name": "高一(3)班"})).json()
        li_class = (await client.post(f"/api/admin/teachers/{li_id}/classes", json={"name": "高一(5)班"})).json()
        await client.post(f"/api/admin/teacher-classes/{wang_class['id']}/members", json={"username": "alice_s", "grantor": "school"})
        await client.post(f"/api/admin/teacher-classes/{li_class['id']}/members", json={"username": "bob_s", "grantor": "school"})

        own = await client.get("/api/teacher/classes", headers=bearer(wang_token))
        assert [item["id"] for item in own.json()] == [wang_class["id"]]
        detail = await client.get(f"/api/teacher/classes/{wang_class['id']}", headers=bearer(wang_token))
        assert [member["id"] for member in detail.json()["members"]] == [alice.id]

        for path in (f"/api/teacher/classes/{li_class['id']}", f"/api/teacher/classes/{li_class['id']}/dashboard"):
            foreign = await client.get(path, headers=bearer(wang_token))
            unknown = await client.get(path.replace(li_class["id"], "c_missing"), headers=bearer(wang_token))
            assert foreign.status_code == unknown.status_code == 404
            assert foreign.json() == unknown.json()

        dashboard = await client.get(f"/api/teacher/classes/{li_class['id']}/dashboard", headers=bearer(li_token))
        assert [row["student_id"] for row in dashboard.json()["statistics"]["students"]] == [bob.id]

        archived = await client.put(f"/api/admin/teacher-classes/{wang_class['id']}", json={"archived": True})
        assert archived.json()["archived"] is True
        assert (await client.get("/api/teacher/classes", headers=bearer(wang_token))).json() == []


@pytest.mark.asyncio
async def test_class_dashboard_only_counts_class_members(db_session):
    db_session.add(KnowledgePoint(id="kp_force", name="受力分析", volume="必修一", chapter="相互作用"))
    students = StudentService(db_session)
    member = await students.create_student("in_class", "pass123", "In")
    outsider = await students.create_student("outside", "pass123", "Out")
    db_session.add_all([
        StudentMastery(student_id=member.id, knowledge_point_id="kp_force", mastery=0.2, attempts=1),
        StudentMastery(student_id=outsider.id, knowledge_point_id="kp_force", mastery=0.9),
    ])
    await db_session.commit()
    service = TeacherService(db_session)
    teacher = await service.create_teacher("wang", "王老师", INITIAL_PASSWORD)
    teacher_class = await service.create_class(teacher.id, "高一(3)班")
    await service.add_member(teacher_class.id, "in_class")

    signals = await service.class_signals(teacher_class.id)
    # Only the class statistics go to the teacher: no all-time signals, no account names.
    assert set(signals) == {"statistics"}
    rows = signals["statistics"]["students"]
    assert [row["student_id"] for row in rows] == [member.id] and rows[0]["mastery"] == 0.2


@pytest.mark.asyncio
async def test_disable_and_password_reset_revoke_teacher_tokens(db_session):
    async with client_for(build_app(db_session)) as client:
        teacher_id, token = await ready_teacher(client, "wang", "王老师")
        disabled = await client.put(f"/api/admin/teachers/{teacher_id}", json={"status": "disabled"})
        assert disabled.json()["status"] == "disabled"
        assert (await client.get("/api/teacher/me", headers=bearer(token))).status_code == 401
        assert (await client.post("/api/teacher/auth/login", json={
            "username": "wang", "password": NEW_PASSWORD,
        })).status_code == 401

        await client.put(f"/api/admin/teachers/{teacher_id}", json={"status": "active"})
        token = (await client.post("/api/teacher/auth/login", json={
            "username": "wang", "password": NEW_PASSWORD,
        })).json()["access_token"]
        reset = await client.post(f"/api/admin/teachers/{teacher_id}/reset-password", json={"password": "reset2026pw"})
        assert reset.json()["must_change_password"] is True
        assert (await client.get("/api/teacher/me", headers=bearer(token))).status_code == 401
        relogin = await client.post("/api/teacher/auth/login", json={"username": "wang", "password": "reset2026pw"})
        assert relogin.status_code == 200


@pytest.mark.asyncio
async def test_admin_and_teacher_tokens_are_not_interchangeable(db_session):
    async with client_for(build_app(db_session)) as client:
        _, teacher_token = await ready_teacher(client, "wang", "王老师")
    admin_token = AdminAuthService.create_access_token("admin", settings.admin_auth_secret, 60)
    async with client_for(build_app(db_session, admin_authorized=False)) as client:
        as_teacher = await client.get("/api/teacher/me", headers=bearer(admin_token))
        as_admin = await client.get("/api/admin/teachers", headers={"X-Admin-Token": teacher_token})
    assert as_teacher.status_code == 401
    assert as_admin.status_code in {401, 503}


def test_teacher_token_rejects_tampering_and_other_secrets():
    token = TeacherAuthService.create_access_token("t_1", 3, "secret-a", 60)
    assert TeacherAuthService.decode_access_token(token, "secret-a").auth_version == 3
    assert TeacherAuthService.decode_access_token(token, "secret-b") is None
    assert TeacherAuthService.decode_access_token(token + "x", "secret-a") is None
    expired = TeacherAuthService.create_access_token("t_1", 3, "secret-a", -1)
    assert TeacherAuthService.decode_access_token(expired, "secret-a") is None


def test_teacher_login_requires_real_secret_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "teacher_auth_secret", DEV_TEACHER_AUTH_SECRET)
    assert not settings.teacher_login_configured()
    monkeypatch.setattr(settings, "teacher_auth_secret", "x" * 40)
    assert settings.teacher_login_configured()
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "teacher_auth_secret", DEV_TEACHER_AUTH_SECRET)
    assert settings.teacher_login_configured()


@pytest.mark.asyncio
async def test_migration_creates_tables_guards_erased_students_and_downgrades(db_session):
    from tests.test_account_deletion import install_guards

    await install_guards(db_session)
    spec = importlib.util.spec_from_file_location(
        "teacher_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0035_teacher_accounts.py",
    )
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def recreate(connection):
        # Later teacher tables depend on these, so they go first.
        for table in ("teacher_class_membership_events", "teacher_class_invitations", "teacher_student_papers", "teacher_grading_runs", "teacher_ai_calls", "teacher_submission_items", "teacher_submissions",
                      "teacher_scan_pages", "teacher_scan_batches", "teacher_answer_sheets",
                      "teacher_assignments", "teacher_class_members", "teacher_classes", "teachers"):
            connection.execute(text(f"DROP TABLE IF EXISTS {table}"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

    await (await db_session.connection()).run_sync(recreate)
    await db_session.commit()

    student = await StudentService(db_session).create_student("erased_s", "pass123", "Erased")
    service = TeacherService(db_session)
    teacher = await service.create_teacher("wang", "王老师", INITIAL_PASSWORD)
    teacher_class = await service.create_class(teacher.id, "高一(3)班")
    await db_session.execute(text("UPDATE students SET status='deleted' WHERE id=:id"), {"id": student.id})
    await db_session.commit()
    # Raw SQL: this table is at its 0035 shape, without columns later migrations add.
    with pytest.raises(IntegrityError):
        await db_session.execute(text(
            "INSERT INTO teacher_class_members (class_id, student_id) VALUES (:c, :s)"
        ), {"c": teacher_class.id, "s": student.id})
    await db_session.rollback()

    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()

    await (await db_session.connection()).run_sync(downgrade)
    await db_session.commit()
    remaining = await db_session.execute(text(
        "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'teacher%' "
        "AND table_name <> 'teacher_paper_attempts'"
    ))
    assert remaining.scalar_one() == 0
