"""Invite, consent receipt, withdrawal and cross-account permission boundaries."""
import asyncio
import importlib.util
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.api.student.classes import router as student_classes
from app.models.teacher import TeacherAssignment, TeacherClassInvitation, TeacherClassMember, TeacherClassMembershipEvent
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.class_membership_service import ClassMembershipService, DISCLOSURE_VERSION
from app.services.login_attempt_limiter import get_login_limiter
from app.services.student_service import StudentService
from app.services.teacher_service import TeacherService, TeacherServiceError
from app.services.teacher_homework_service import student_homework, homework_attempt
from app.services.teacher_paper_service import owned_attempt, submit_attempt, validate_submission
from tests.test_teacher_accounts import build_app, client_for, ready_teacher, bearer


async def setup(db):
    app = build_app(db)
    app.include_router(student_classes, prefix="/api/student")
    async with client_for(app) as client:
        teacher_id, token = await ready_teacher(client, "invite_teacher", "邀请测试老师")
    cls = await TeacherService(db).create_class(teacher_id, "邀请测试班", grade="高一")
    student = await StudentService(db).create_student("invite_student", "pass123", "入班测试学生")
    invitation = await ClassMembershipService(db).generate(cls.id, teacher_id)
    return SimpleNamespace(app=app, teacher_id=teacher_id, token=token, cls=cls, student=student,
        auth=bearer(StudentService.create_access_token(student.id)), code=invitation["code"])


@pytest.mark.asyncio
async def test_preview_then_join_is_idempotent_and_records_disclosure(db_session):
    started_at = datetime.now(timezone.utc)
    env = await setup(db_session)
    async with client_for(env.app) as client:
        preview = await client.post("/api/student/class-invitations/preview", headers=env.auth, json={"code": " " + env.code.lower() + " "})
        assert preview.status_code == 200, preview.text
        assert preview.json()["teacher_name"] == "邀请测试老师"
        assert "第三方 AI" in preview.json()["disclosure"]
        assert not await db_session.get(TeacherClassMember, (env.cls.id, env.student.id))
        body = {"code": env.code, "disclosure_version": preview.json()["disclosure_version"], "student_name": " 张三 "}
        first = await client.post("/api/student/classes/join", headers=env.auth, json=body)
        second = await client.post("/api/student/classes/join", headers=env.auth, json=body)
        assert first.status_code == second.status_code == 200
        assert first.json()["added"] is True and second.json()["added"] is False
        assert first.json()["student_number"] == "1"
        assert first.json()["student_name"] == "张三"
        assert env.student.display_name == "张三" and env.student.username == "invite_student"
        assert (await client.get("/api/student/classes", headers=env.auth)).json()[0]["id"] == env.cls.id
        member = (await client.get(f"/api/teacher/classes/{env.cls.id}", headers=bearer(env.token))).json()["members"][0]
        assert member["id"] == env.student.id and member["display_name"] == "张三"
        assert first.headers["cache-control"] == "no-store"
    receipts = (await db_session.scalars(select(TeacherClassMembershipEvent))).all()
    assert len(receipts) == 1 and receipts[0].disclosure_version == DISCLOSURE_VERSION
    assert env.student.class_name is None
    invitation = await db_session.get(TeacherClassInvitation, env.cls.id)
    assert started_at + timedelta(days=3) <= invitation.expires_at <= datetime.now(timezone.utc) + timedelta(days=3)
    assert env.code not in invitation.encrypted_code and env.code not in invitation.code_hash
    from app.services.teacher_ai_service import TeacherAiService
    from app.services.privacy_consent_service import PrivacyConsentService
    assert not await TeacherAiService(db_session).authorized_students([env.student.id])
    permissions = await PrivacyConsentService(db_session).state(env.student.id)
    assert not permissions["ios_ai"] and not permissions["ios_terms"]


@pytest.mark.asyncio
@pytest.mark.parametrize("name", [None, "", "   ", "张\n三", "张" * 41])
async def test_join_requires_name_without_mutating_account_or_membership(db_session, name):
    env = await setup(db_session)
    original_name = env.student.display_name
    async with client_for(env.app) as client:
        body = {"code": env.code, "disclosure_version": DISCLOSURE_VERSION}
        if name is not None:
            body["student_name"] = name
        response = await client.post("/api/student/classes/join", headers=env.auth, json=body)
        assert response.status_code in {400, 422}
    assert env.student.display_name == original_name
    assert not await db_session.get(TeacherClassMember, (env.cls.id, env.student.id))


@pytest.mark.asyncio
async def test_same_names_remain_separate_accounts_and_failed_invite_never_renames(db_session):
    env = await setup(db_session)
    other = await StudentService(db_session).create_student("same_name_other", "pass123", "张三")
    svc = ClassMembershipService(db_session)
    with pytest.raises(TeacherServiceError):
        await svc.join("00000000", env.student.id, DISCLOSURE_VERSION, "张三")
    assert env.student.display_name == "入班测试学生"
    await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
    await svc.join(env.code, other.id, DISCLOSURE_VERSION, "张三")
    members = await TeacherService(db_session).list_members(env.cls.id)
    assert {member.id for member in members} == {env.student.id, other.id}
    assert all(member.display_name == "张三" for member in members)
    assert env.student.username == "invite_student" and other.username == "same_name_other"


@pytest.mark.asyncio
async def test_owner_only_invites_and_remove_no_arbitrary_student_enrollment(db_session):
    env = await setup(db_session)
    async with client_for(env.app) as client:
        _, other = await ready_teacher(client, "other_inviter", "其他老师")
        path = f"/api/teacher/classes/{env.cls.id}/invitation"
        for method in (client.get, client.post, client.delete):
            assert (await method(path, headers=bearer(other))).status_code == 404
            assert (await method(path)).status_code == 401
        assert (await client.delete(f"/api/teacher/classes/{env.cls.id}/members/{env.student.id}", headers=bearer(other))).status_code == 404
        assert (await client.post(f"/api/teacher/classes/{env.cls.id}/members", headers=bearer(env.token), json={"username": env.student.username})).status_code == 404
        assert (await client.post("/api/student/classes/join", json={"code": env.code, "disclosure_version": DISCLOSURE_VERSION, "student_name": "张三"})).status_code == 401
        assert (await client.post("/api/student/classes/join", headers=env.auth, json={"code": env.code, "disclosure_version": DISCLOSURE_VERSION, "student_name": "张三", "student_id": "someone_else"})).status_code == 422
        assert (await client.post("/api/student/classes/join", headers=env.auth, json={"code": env.code, "disclosure_version": "old"})).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("condition", ["expired", "stopped", "rotated", "archived", "teacher_disabled", "password_reset", "invalid"])
async def test_invalid_invitation_cannot_preview_or_join(db_session, condition):
    env = await setup(db_session)
    svc = ClassMembershipService(db_session)
    invitation = await db_session.get(TeacherClassInvitation, env.cls.id)
    if condition == "expired":
        invitation.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif condition == "stopped":
        await svc.disable(env.cls.id, env.teacher_id)
    elif condition == "rotated":
        await svc.generate(env.cls.id, env.teacher_id)
    elif condition == "archived":
        await TeacherService(db_session).update_class(env.cls.id, archived=True)
    elif condition in {"teacher_disabled", "password_reset"}:
        teacher = await TeacherService(db_session).get_teacher(env.teacher_id)
        teacher.status = "disabled" if condition == "teacher_disabled" else "active"
        teacher.must_change_password = condition == "password_reset"
    else:
        env.code = "00000000"
    await db_session.commit()
    async with client_for(env.app) as client:
        for path, payload in [("/class-invitations/preview", {"code": env.code}), ("/classes/join", {"code": env.code, "disclosure_version": DISCLOSURE_VERSION, "student_name": "张三"})]:
            result = await client.post("/api/student" + path, headers=env.auth, json=payload)
            assert result.status_code == 400, result.text
    assert not await db_session.get(TeacherClassMember, (env.cls.id, env.student.id))


@pytest.mark.asyncio
async def test_leave_remove_rejoin_and_multiple_classes(db_session):
    env = await setup(db_session)
    svc = ClassMembershipService(db_session)
    await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
    second = await TeacherService(db_session).create_class(env.teacher_id, "第二个班")
    new_code = (await svc.generate(second.id, env.teacher_id))["code"]
    await svc.join(new_code, env.student.id, DISCLOSURE_VERSION, "张三")
    assert len(await svc.classes(env.student.id)) == 2
    async with client_for(env.app) as client:
        assert (await client.delete(f"/api/student/classes/{env.cls.id}", headers=env.auth)).status_code == 204
        assert len((await client.get("/api/student/classes", headers=env.auth)).json()) == 1
        # A voluntary departure can be undone with a still-valid invite.
        await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
        removed = await client.delete(f"/api/teacher/classes/{env.cls.id}/members/{env.student.id}", headers=bearer(env.token))
        assert removed.status_code == 200 and removed.json()["member_count"] == 0
        assert (await client.post("/api/student/classes/join", headers=env.auth, json={"code": env.code, "disclosure_version": DISCLOSURE_VERSION, "student_name": "张三"})).status_code == 403
        assert (await client.post("/api/student/class-invitations/preview", headers=env.auth, json={"code": env.code})).status_code == 403
    refreshed = (await svc.generate(env.cls.id, env.teacher_id))["code"]
    assert (await svc.join(refreshed, env.student.id, DISCLOSURE_VERSION, "张三"))["added"]
    assert (await db_session.scalar(select(func.count()).select_from(TeacherClassMembershipEvent))) == 6


@pytest.mark.asyncio
async def test_invitation_attempts_use_shared_rate_guard_and_disabled_student_rejected(db_session):
    env = await setup(db_session)
    async def reject(*_):
        raise HTTPException(429, "尝试次数较多", headers={"Retry-After": "300"})
    env.app.dependency_overrides[get_login_limiter] = lambda: SimpleNamespace(check=reject)
    async with client_for(env.app) as client:
        for path in ("class-invitations/preview", "classes/join"):
            result = await client.post(f"/api/student/{path}", headers=env.auth,
                json={"code": env.code, **({"disclosure_version": DISCLOSURE_VERSION, "student_name": "张三"} if path.endswith("join") else {})})
            assert result.status_code == 429 and result.headers["retry-after"] == "300"
        env.student.status = "disabled"
        await db_session.commit()
        assert (await client.get("/api/student/classes", headers=env.auth)).status_code == 401


@pytest.mark.asyncio
async def test_withdrawal_blocks_old_homework_even_after_rejoin_preserves_attempt(db_session):
    env = await setup(db_session)
    student_id = env.student.id
    svc = ClassMembershipService(db_session)
    await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
    assignment = TeacherAssignment(id="old_assignment", class_id=env.cls.id, teacher_id=env.teacher_id, title="历史作业",
        status="published", published_at=datetime.now(timezone.utc), roster={env.student.id: "1"}, items=[])
    attempt = TeacherPaperAttempt(id="old_attempt", student_id=env.student.id, paper_id="homework:old_assignment",
        catalog_code="teacher_homework", node_id=assignment.id, title=assignment.title, question_ids=["q1"], questions=[], status="grading")
    db_session.add_all([assignment, attempt]); await db_session.commit()
    assert len(await student_homework(db_session, env.student.id)) == 1
    assert (await homework_attempt(db_session, env.student.id, attempt.id)).id == attempt.id
    await svc.remove(env.cls.id, env.student.id, student_leave=True)
    assert await student_homework(db_session, env.student.id) == []
    assert await homework_attempt(db_session, env.student.id, attempt.id) is None
    for action in (lambda: submit_attempt(db_session, student_id, "old_attempt"),
                   lambda: validate_submission(db_session, student_id, "old_attempt", "q1", lock=True)):
        with pytest.raises(HTTPException) as error:
            await action()
        assert error.value.status_code == 403
        await db_session.rollback()
    await svc.join(env.code, student_id, DISCLOSURE_VERSION, "张三")
    assert await student_homework(db_session, student_id) == []
    # The student can still access their historical result machinery; nothing is erased.
    assert (await owned_attempt(db_session, student_id, "old_attempt")).id == "old_attempt"
    assert (await db_session.get(TeacherAssignment, "old_assignment")).roster == {student_id: "1"}


@pytest.mark.asyncio
async def test_auto_number_respects_existing_numbers_and_admin_removal_revokes_invite(db_session):
    env = await setup(db_session)
    students = StudentService(db_session)
    other = await students.create_student("number_existing", "pass123", "原有学生")
    teacher = TeacherService(db_session)
    await teacher.add_member(env.cls.id, other.username)
    await teacher.set_member_number(env.cls.id, other.id, "1")
    svc = ClassMembershipService(db_session)
    assert (await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三"))["student_number"] == "2"
    await teacher.remove_member(env.cls.id, env.student.id)
    with pytest.raises(TeacherServiceError) as error:
        await svc.join(env.code, env.student.id, DISCLOSURE_VERSION, "张三")
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_concurrent_joins_keep_numbers_unique_and_same_student_idempotent(db_session):
    env = await setup(db_session)
    other = await StudentService(db_session).create_student("concurrent_student", "pass123", "并发测试学生")
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async def join(student_id):
        async with factory() as session:
            return await ClassMembershipService(session).join(env.code, student_id, DISCLOSURE_VERSION, "张三")
    results = await asyncio.gather(join(env.student.id), join(other.id), join(env.student.id))
    assert sum(row["added"] for row in results) == 2
    numbers = (await db_session.scalars(select(TeacherClassMember.student_number).where(TeacherClassMember.class_id == env.cls.id))).all()
    assert set(numbers) == {"1", "2"}


@pytest.mark.asyncio
async def test_migration_and_membership_receipt_erasure_guard(db_session, tmp_path):
    from tests.test_account_deletion import install_guards
    from sqlalchemy import text
    await install_guards(db_session)
    spec = importlib.util.spec_from_file_location("invitation_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0046_class_invitations.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    def recreate(connection):
        connection.execute(text("DROP TABLE teacher_class_membership_events"))
        connection.execute(text("DROP TABLE teacher_class_invitations"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
    await (await db_session.connection()).run_sync(recreate)
    await db_session.commit()
    env = await setup(db_session)
    student_id, class_id = env.student.id, env.cls.id
    await ClassMembershipService(db_session).join(env.code, student_id, DISCLOSURE_VERSION, "张三")
    from app.services.account_deletion_service import AccountDeletionService
    students = StudentService(db_session)
    students.answer_upload_root = tmp_path
    assert await AccountDeletionService(students).erase(student_id, StudentService.create_access_token(student_id), password="pass123", code=None)
    assert not await db_session.scalar(select(TeacherClassMembershipEvent.id).where(TeacherClassMembershipEvent.student_id == student_id))
    assert not await db_session.get(TeacherClassMember, (class_id, student_id))
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(TeacherClassMembershipEvent(id="late", class_id=class_id, student_id=student_id, action="joined", invitation_version=1))
            await db_session.flush()
    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
    await (await db_session.connection()).run_sync(downgrade)
    assert await db_session.scalar(text("SELECT to_regclass('teacher_class_membership_events')")) is None
