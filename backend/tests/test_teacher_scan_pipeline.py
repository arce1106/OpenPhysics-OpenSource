"""Direct scanner uploads use the existing recognition, authorization and review gates."""
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from sqlalchemy import select

from app.api.teacher.router import get_scan_runner
from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherGradingRun, TeacherSubmission, TeacherSubmissionItem
from app.services.teacher_ai_service import TeacherAiService
from app.services.teacher_scan_pipeline import pregrade_scan
from app.services.teacher_scan_service import TeacherScanService
from app.services.teacher_service import TeacherServiceError
from tests.scan_fixtures import to_pdf
from tests.test_teacher_accounts import bearer, client_for
from tests.test_teacher_grading import FakeGrader, full_marks, grading_app
from tests.test_teacher_scans import FakeRecognizer, authorize, copy_pages, published_homework


@pytest.mark.asyncio
async def test_auto_pregrade_waits_for_recognition_and_never_releases_scores(db_session, tmp_path):
    recognizer = FakeRecognizer([], [{1: "A", 2: "B"}])
    grader = FakeGrader([full_marks()])
    app = grading_app(db_session, tmp_path, recognizer, grader)
    runs = []

    async def run(batch_id, auto_grade=False):
        runs.append(auto_grade)
        await TeacherScanService(db_session, TeacherAiService(db_session, recognizer), root=tmp_path).process(batch_id)
        if auto_grade:
            await pregrade_scan(db_session, batch_id, grader, root=tmp_path)

    app.dependency_overrides[get_scan_runner] = lambda: run
    async with client_for(app) as client:
        token, class_id, assignment_id, students, numbers = await published_homework(client, db_session, members=("alice_s", "bob_s"))
        await authorize(client, class_id, [students["alice_s"]])
        recognizer.numbers = [numbers["alice_s"], numbers["bob_s"]]
        pdf = to_pdf(copy_pages(numbers["alice_s"], 1) + copy_pages(numbers["bob_s"], 10))
        url = f"/api/teacher/assignments/{assignment_id}/scans?auto_grade=true"
        response = await client.post(url, headers=bearer(token), files={"file": ("本机扫描.pdf", pdf, "application/pdf")})
        assert response.status_code == 202, response.text
        assert runs == [True]
        assert len(grader.calls) == 1
        assert (await db_session.scalars(select(TeacherGradingRun))).one().status == "done"
        assignment = await db_session.get(TeacherAssignment, assignment_id)
        assert assignment.results_released_at is None
        submissions = {row.student_id: row for row in await db_session.scalars(select(TeacherSubmission))}
        bob_items = (await db_session.scalars(select(TeacherSubmissionItem).where(
            TeacherSubmissionItem.submission_id == submissions[students["bob_s"].id].id,
            TeacherSubmissionItem.kind == "area",
        ))).all()
        assert all(item.grade_status == "manual" and item.score is None for item in bob_items)
        # Network retry cannot recognize or pre-grade the same uploaded stack twice.
        again = await client.post(url, headers=bearer(token), files={"file": ("重试.pdf", pdf, "application/pdf")})
        assert not again.json()["created"]
        assert runs == [True] and len(grader.calls) == 1


@pytest.mark.asyncio
async def test_regular_import_keeps_manual_pregrade_and_failed_scans_do_not_grade(db_session, tmp_path):
    recognizer, grader = FakeRecognizer([]), FakeGrader([])
    app = grading_app(db_session, tmp_path, recognizer, grader)
    modes = []

    async def run(batch_id, auto_grade=False):
        modes.append(auto_grade)
        await TeacherScanService(db_session, TeacherAiService(db_session, recognizer), root=tmp_path).process(batch_id)
        if auto_grade:
            await pregrade_scan(db_session, batch_id, grader, root=tmp_path)

    app.dependency_overrides[get_scan_runner] = lambda: run
    async with client_for(app) as client:
        token, _, assignment_id, _, _ = await published_homework(client, db_session)
        base = f"/api/teacher/assignments/{assignment_id}/scans"
        first = await client.post(base, headers=bearer(token), files={"file": ("错误.pdf", b"%PDF-invalid", "application/pdf")})
        second = await client.post(base + "?auto_grade=true", headers=bearer(token), files={"file": ("错误2.pdf", b"%PDF-another-invalid", "application/pdf")})
        assert first.status_code == second.status_code == 202
        assert modes == [False, True]
        assert not grader.calls
        assert not (await db_session.scalars(select(TeacherGradingRun))).all()


@pytest.mark.asyncio
async def test_next_stack_waits_for_an_existing_grading_run(monkeypatch):
    from app.services import teacher_scan_pipeline as pipeline

    db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(status="done", teacher_id="t_1", assignment_id="a_1")),
                         rollback=AsyncMock())
    run = SimpleNamespace(id="g_next")
    service = SimpleNamespace(start_run=AsyncMock(side_effect=[TeacherServiceError(409, "预批正在进行中"), run]),
                              process_run=AsyncMock())
    monkeypatch.setattr(pipeline, "TeacherGradingService", lambda *args, **kwargs: service)
    pause = AsyncMock()
    monkeypatch.setattr(pipeline.asyncio, "sleep", pause)
    await pregrade_scan(db, "b_next", FakeGrader([]))
    db.rollback.assert_awaited_once()
    pause.assert_awaited_once_with(2)
    service.process_run.assert_awaited_once_with("g_next")
