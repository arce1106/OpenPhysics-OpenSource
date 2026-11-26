import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.api.student import privacy_consent
from app.api.student.dependencies import get_student_service
from app.models.question import Question, QuestionType
from app.models.student import StudentPrivacyConsent
from app.services.account_deletion_service import AccountDeletionService
from app.services.privacy_consent_service import AI_VERSION, PRIVACY_VERSION, PrivacyConsentService
from app.services.student_service import StudentService


async def setup(db):
    students = StudentService(db)
    person = await students.create_student("privacy-user", "synthetic-password", "Synthetic")
    token = students.create_access_token(person.id, person.auth_version)
    service = PrivacyConsentService(db)
    app = FastAPI()
    app.include_router(privacy_consent.router, prefix="/api/student")
    app.dependency_overrides[get_student_service] = lambda: students
    for path in ["learn/chat", "practice/submit", "practice/submit-photo", "practice/process-evidence",
                 "practice/submit-paper-batch", "practice/extract-photo", "tutor/question-chat"]:
        app.add_api_route("/api/student/" + path, lambda: {"dispatched": True}, methods=["POST"],
                         dependencies=[Depends(privacy_consent.enforce_ios_ai_consent)])
    return students, person, token, service, app


@pytest.mark.asyncio
async def test_receipts_are_explicit_versioned_idempotent_and_account_scoped(db_session):
    students, person, token, service, app = await setup(db_session)
    assert not (await service.state(person.id))["ios_ai"]
    await service.record(person.id, "ios_ai", AI_VERSION, True)
    await service.record(person.id, "ios_ai", AI_VERSION, True)
    assert await db_session.scalar(select(func.count()).select_from(StudentPrivacyConsent)) == 1
    other = await students.create_student("privacy-other", "synthetic-password", "Other")
    assert not (await service.state(other.id))["ios_ai"]
    await service.record(person.id, "ios_ai", AI_VERSION, False)
    assert not (await service.state(person.id))["ios_ai"]
    with pytest.raises(ValueError):
        await service.record(person.id, "ios_ai", "old", True)
    # Withdrawal remains possible with an older client version.
    await service.record(person.id, "ios_ai", "old", False)
    assert not (await service.state(person.id))["ios_ai"]


@pytest.mark.asyncio
async def test_combined_login_preserves_withdrawal_until_explicit_reenable(db_session):
    _, person, token, service, app = await setup(db_session)
    headers = {"Authorization": f"Bearer {token}"}
    path = "/api/student/auth/privacy-consent"
    assert (await service.state(person.id))["ios_ai_withdrawn"] is False
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        login_grant = {"scope": "ios_ai", "version": AI_VERSION, "granted": True, "preserve_withdrawal": True}
        result = await client.post(path, headers=headers, json=login_grant)
        assert result.json()["ios_ai"] is True
        assert result.json()["ios_ai_withdrawn"] is False
        # Withdrawal of any version remains authoritative after login or an upgrade.
        await service.record(person.id, "ios_ai", "old", False)
        await service.record(person.id, "ios_terms", PRIVACY_VERSION, True)
        count = await db_session.scalar(select(func.count()).select_from(StudentPrivacyConsent))
        for _ in range(2):
            result = await client.post(path, headers=headers, json=login_grant)
            assert result.json()["ios_ai"] is False
            assert result.json()["ios_ai_withdrawn"] is True
        assert await db_session.scalar(select(func.count()).select_from(StudentPrivacyConsent)) == count
        result = await client.post(path, headers=headers, json={"scope": "ios_ai", "version": AI_VERSION, "granted": True})
        assert result.json()["ios_ai"] is True
        assert result.json()["ios_ai_withdrawn"] is False


@pytest.mark.asyncio
async def test_api_rejects_other_identity_implicit_consent_and_old_version(db_session):
    _, person, token, service, app = await setup(db_session)
    headers = {"Authorization": f"Bearer {token}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        path = "/api/student/auth/privacy-consent"
        assert (await client.get(path)).status_code == 401
        for body in [
            {"scope": "ios_ai", "version": AI_VERSION},
            {"scope": "ios_ai", "version": AI_VERSION, "granted": "true"},
            {"scope": "ios_ai", "version": AI_VERSION, "granted": True, "student_id": "other"},
        ]:
            assert (await client.post(path, json=body, headers=headers)).status_code == 422
        assert (await client.post(path, json={"scope": "ios_terms", "version": "old", "granted": True}, headers=headers)).status_code == 409
        response = await client.post(path, json={"scope": "ios_terms", "version": PRIVACY_VERSION, "granted": True}, headers=headers)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["ios_terms"] is True
        assert response.json()["ios_ai"] is False


@pytest.mark.asyncio
async def test_previous_agreement_does_not_silently_grant_the_new_ai_scope(db_session):
    _, person, token, service, app = await setup(db_session)
    db_session.add_all([
        StudentPrivacyConsent(student_id=person.id, scope="ios_terms", version="2026-10-11.1", granted=True),
        StudentPrivacyConsent(student_id=person.id, scope="ios_ai", version="ios-ai-2026-10-11.1", granted=True),
    ])
    await db_session.commit()
    headers = {"Authorization": f"Bearer {token}", "X-OpenPhysics-Privacy-Client": "ios"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        assert (await client.post("/api/student/learn/chat", headers=headers)).status_code == 403
        consent_path = "/api/student/auth/privacy-consent"
        for scope, version in [("ios_terms", PRIVACY_VERSION), ("ios_ai", AI_VERSION)]:
            result = await client.post(consent_path, headers=headers,
                json={"scope": scope, "version": version, "granted": True})
            assert result.status_code == 200
            assert result.json()["ios_ai"] is (scope == "ios_ai")
            status = (await client.post("/api/student/learn/chat", headers=headers)).status_code
            assert status == (200 if scope == "ios_ai" else 403)
        for _ in range(3):
            assert (await client.post("/api/student/learn/chat", headers=headers)).status_code == 200
        assert await db_session.scalar(select(func.count()).select_from(StudentPrivacyConsent)) == 4


@pytest.mark.asyncio
async def test_ai_dispatch_requires_current_receipt_and_stops_after_withdrawal(db_session):
    _, person, token, service, app = await setup(db_session)
    headers = {"Authorization": f"Bearer {token}", "X-OpenPhysics-Privacy-Client": "ios"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        for path in ["learn/chat", "practice/submit-photo", "practice/process-evidence",
                     "practice/submit-paper-batch", "practice/extract-photo", "tutor/question-chat"]:
            denied = await client.post("/api/student/" + path, json={}, headers=headers)
            assert denied.status_code == 403
            assert denied.headers["X-OpenPhysics-AI-Consent-Required"] == "true"
        await service.record(person.id, "ios_ai", AI_VERSION, True)
        assert (await client.post("/api/student/learn/chat", headers=headers)).status_code == 403
        await service.record(person.id, "ios_terms", PRIVACY_VERSION, True)
        assert (await client.post("/api/student/learn/chat", headers=headers)).json() == {"dispatched": True}
        await service.record(person.id, "ios_ai", AI_VERSION, False)
        assert (await client.post("/api/student/learn/chat", headers=headers)).status_code == 403
        # Additive rollout does not impose an unimplemented consent UI on older clients.
        assert (await client.post("/api/student/learn/chat", headers={"Authorization": f"Bearer {token}"})).status_code == 200


@pytest.mark.asyncio
async def test_objective_grading_remains_available_without_ai_permission(db_session):
    _, person, token, service, app = await setup(db_session)
    db_session.add_all([
        Question(id="privacy-choice", stem_text="Synthetic", question_type=QuestionType.single_choice),
        Question(id="privacy-text", stem_text="Synthetic", question_type=QuestionType.problem_solving),
    ])
    await db_session.commit()
    headers = {"Authorization": f"Bearer {token}", "X-OpenPhysics-Privacy-Client": "ios"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        for qid, expected in [("privacy-choice", 200), ("privacy-text", 403)]:
            result = await client.post("/api/student/practice/submit", json={"question_id": qid}, headers=headers)
            assert result.status_code == expected


@pytest.mark.asyncio
async def test_account_erasure_removes_receipts_and_never_regrants(db_session, tmp_path):
    students, person, token, service, _ = await setup(db_session)
    students.answer_upload_root = tmp_path / "answers"
    await service.record(person.id, "ios_terms", PRIVACY_VERSION, True)
    await service.record(person.id, "ios_ai", AI_VERSION, True)
    identity = person.id
    assert await AccountDeletionService(students).erase(identity, token, password="synthetic-password", code=None)
    assert await db_session.scalar(select(func.count()).select_from(StudentPrivacyConsent)) == 0
    with pytest.raises(PermissionError):
        await service.record(identity, "ios_ai", AI_VERSION, True)


@pytest.mark.asyncio
async def test_consent_migration_attaches_erasure_guard_and_downgrades(db_session):
    from tests.test_account_deletion import install_guards
    students, person, token, service, _ = await setup(db_session)
    await install_guards(db_session)
    spec = importlib.util.spec_from_file_location("privacy_migration", Path(__file__).resolve().parents[1] / "alembic/versions/0033_privacy_consent.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    def recreate(connection):
        connection.execute(text("DROP TABLE student_privacy_consents"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        # Columns added later by 0038_teacher_scans.
        for column in ("source", "grantor", "recorded_by"):
            connection.execute(text(f"ALTER TABLE student_privacy_consents ADD COLUMN {column} text"))
    await (await db_session.connection()).run_sync(recreate)
    await db_session.commit()
    await service.record(person.id, "ios_ai", AI_VERSION, True)
    identity = person.id
    await db_session.execute(text("UPDATE students SET status='deleted' WHERE id=:id"), {"id": identity})
    await db_session.commit()
    db_session.add(StudentPrivacyConsent(student_id=identity, scope="ios_ai", version=AI_VERSION, granted=True))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    def downgrade(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
    await (await db_session.connection()).run_sync(downgrade)
    await db_session.commit()
