import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.student import account_deletion
from app.api.student.dependencies import get_current_student_id, get_student_service
from app.models import Base
from app.models.student import Student, StudentAiUsageLog
from app.models.reward import LearningEvent
from app.services.account_deletion_service import AccountDeletionService
from app.services.auth_request_limiter import get_sensitive_action_limiter
from app.services.student_service import StudentService

PASSWORD = "synthetic-deletion-password"


async def account(db, tmp_path):
    students = StudentService(db)
    students.answer_upload_root = tmp_path / "answers"
    person = await students.create_student("delete-me", PASSWORD, "Synthetic Private Name")
    person.phone = "19999990111"
    person.class_name = "Synthetic Class"
    person.registration_consent = {"synthetic": True}
    await db.commit()
    token = students.create_access_token(person.id, person.auth_version)
    return students, person, token


async def install_guards(db):
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("erasure_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0032_account_erasure_guards.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    def upgrade(connection):
        connection.execute(text("DROP FUNCTION IF EXISTS reject_erased_student_write() CASCADE"))
        connection.execute(text("DROP FUNCTION IF EXISTS prevent_student_reactivation() CASCADE"))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
    await (await db.connection()).run_sync(upgrade)
    await db.commit()
    return module


@pytest.mark.asyncio
async def test_erasure_removes_personal_data_and_media_but_preserves_other_accounts(db_session, tmp_path):
    students, person, token = await account(db_session, tmp_path)
    other = await students.create_student("keep-me", PASSWORD, "Other")
    for owner in (person, other):
        db_session.add(LearningEvent(student_id=owner.id, event_type="synthetic", id=uuid.uuid4().hex))
        db_session.add(StudentAiUsageLog(student_id=owner.id, feature="synthetic"))
        image = students.answer_upload_root / owner.id / "image.jpg"
        image.parent.mkdir(parents=True)
        image.write_bytes(b"synthetic")
    await db_session.commit()
    assert not await AccountDeletionService(students).erase(person.id, token, password="wrong", code=None)
    await db_session.refresh(person)
    assert await AccountDeletionService(students).erase(person.id, token, password=PASSWORD, code=None)
    await db_session.refresh(person)
    assert person.status == "deleted" and person.phone is None and person.password_hash == "!deleted"
    assert person.display_name == "已注销账号" and person.registration_consent is None and person.class_name is None
    assert not students.token_matches_auth_version(token, person)
    assert await students.authenticate_student("delete-me", PASSWORD) is None
    assert await students.update_student(person.id, status="active") is None
    assert await students.reset_student_password(person.id, PASSWORD) is None
    await db_session.refresh(person)
    await db_session.refresh(other)
    assert not (students.answer_upload_root / person.id).exists()
    assert (students.answer_upload_root / other.id / "image.jpg").read_bytes() == b"synthetic"
    for table in Base.metadata.sorted_tables:
        if "student_id" in table.c:
            assert await db_session.scalar(select(func.count()).select_from(table).where(table.c.student_id == person.id)) == 0
    assert await db_session.scalar(select(func.count(LearningEvent.id)).where(LearningEvent.student_id == other.id)) == 1


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_claim_success(db_session, tmp_path, monkeypatch):
    students, person, token = await account(db_session, tmp_path)
    identity = person.id
    image = students.answer_upload_root / identity / "image.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"synthetic")
    def fail(*args):
        raise OSError("synthetic cleanup failure")
    monkeypatch.setattr("app.services.account_deletion_service.shutil.rmtree", fail)
    with pytest.raises(OSError):
        await AccountDeletionService(students).erase(identity, token, password=PASSWORD, code=None)
    await db_session.refresh(person)
    assert person.status == "active" and person.phone == "19999990111"
    assert image.exists()


@pytest.mark.asyncio
async def test_api_requires_own_session_explicit_consent_and_fresh_proof(db_session, tmp_path):
    students, person, token = await account(db_session, tmp_path)
    app = FastAPI()
    app.include_router(account_deletion.router)
    app.dependency_overrides[get_student_service] = lambda: students
    app.dependency_overrides[get_sensitive_action_limiter] = lambda: SimpleNamespace(reserve=AsyncMock())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/auth/account-deletion", json={"confirmed": True, "current_password": PASSWORD})).status_code == 401
        headers = {"Authorization": f"Bearer {token}"}
        for body, status in [({"confirmed": False, "current_password": PASSWORD}, 400),
                             ({"confirmed": True, "current_password": PASSWORD, "student_id": "other"}, 422),
                             ({"confirmed": True, "current_password": "wrong"}, 400)]:
            assert (await client.post("/auth/account-deletion", json=body, headers=headers)).status_code == status
        response = await client.post("/auth/account-deletion", json={"confirmed": True, "current_password": PASSWORD}, headers=headers)
        assert response.json() == {"deleted": True}
        assert response.headers["cache-control"] == "no-store"
        assert (await client.post("/auth/account-deletion", json={"confirmed": True, "current_password": PASSWORD}, headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_migration_blocks_late_writes_and_reactivation(db_session, tmp_path):
    students, person, token = await account(db_session, tmp_path)
    module = await install_guards(db_session)
    personal = {t.name for t in Base.metadata.sorted_tables if "student_id" in t.c}
    # Later migrations own the consent receipt and class membership tables and their guards.
    assert personal == set(module.PERSONAL_TABLES) | {"student_privacy_consents", "teacher_class_members", "teacher_scan_pages", "teacher_submissions", "teacher_student_papers", "teacher_class_membership_events"}
    identity = person.id
    assert await AccountDeletionService(students).erase(identity, token, password=PASSWORD, code=None)
    db_session.add(LearningEvent(student_id=identity, event_type="late", id=uuid.uuid4().hex))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    with pytest.raises(IntegrityError):
        await db_session.execute(update(Student).where(Student.id == identity).values(status="active"))
    await db_session.rollback()
    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
    await (await db_session.connection()).run_sync(downgrade)
    await db_session.commit()


@pytest.mark.asyncio
async def test_concurrent_account_change_cannot_override_erasure(db_session, tmp_path):
    students, person, token = await account(db_session, tmp_path)
    identity = person.id
    module = await install_guards(db_session)
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with factory() as writer, factory() as eraser:
        await writer.execute(select(Student).where(Student.id == identity).with_for_update())
        deletion = AccountDeletionService(StudentService(eraser))
        deletion.students.answer_upload_root = tmp_path / "answers"
        pending = asyncio.create_task(deletion.erase(identity, token, password=PASSWORD, code=None))
        await asyncio.sleep(0.02)
        writer.add(LearningEvent(id=uuid.uuid4().hex, student_id=identity, event_type="in-flight"))
        await writer.commit()
        assert await asyncio.wait_for(pending, timeout=5)
    assert await db_session.scalar(select(func.count(LearningEvent.id)).where(LearningEvent.student_id == identity)) == 0
    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
    await (await db_session.connection()).run_sync(downgrade)
    await db_session.commit()


@pytest.mark.asyncio
async def test_late_photo_write_cannot_recreate_erased_uploads(db_session, tmp_path):
    from app.api.student.answer_grading import private_answer_write
    from fastapi import HTTPException
    students, person, token = await account(db_session, tmp_path)
    folder = students.answer_upload_root / person.id
    with private_answer_write(folder, person.id):
        (folder / "before.png").write_bytes(b"synthetic")
    await db_session.refresh(person)
    assert await AccountDeletionService(students).erase(person.id, token, password=PASSWORD, code=None)
    with pytest.raises(HTTPException) as rejected:
        with private_answer_write(folder, person.id):
            (folder / "late.png").write_bytes(b"synthetic")
    assert rejected.value.status_code == 401 and not folder.exists()
