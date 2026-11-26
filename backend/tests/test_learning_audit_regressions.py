"""Learning integrity regressions from the 2026-09-05 code audit."""

import asyncio
import io
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.student import schemas
from app.api.student import answer_grading
from app.api.student.diagnose import diagnose_scope_submitted_feedback
from app.models.question import QualityStatus
from app.models.student import ItemStats, StudentAnswer
from app.services.adaptive_service import AdaptiveService
from app.services.improvement_plan_service import ImprovementPlanService
from app.services.knowledge_service import KnowledgeService
from app.services.physics_error_types import answer_credit_from_grading, normalize_process_grading
from app.services.knowledge_tracing import KnowledgeTracingEngine
from app.services.learning_evidence import STUDENT_VERDICT_WEIGHT
from app.services.question_service import QuestionService
from app.services.student_practice_profile import StudentPracticeProfileService
from app.services.student_service import StudentService
from app.core.config import settings


async def seed_question(db, qid, question_type="single_choice", kp_ids=("audit_kp",)):
    service = QuestionService(db)
    await service.create_question({
        "id": qid, "stem_text": "审计合成题", "answer": "A", "explanation": "合成解析",
        "question_type": question_type, "difficulty": 2.0, "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True},
                    {"label": "B", "text": "错误", "is_correct": False}],
        "labels": [{"label_type": "knowledge_point", "label_id": kp,
                    "role": "主要" if index == 0 else "次要"}
                   for index, kp in enumerate(kp_ids)],
        "formulas": [], "images": [],
    })
    await service.review_question(qid, QualityStatus.approved)


async def seed_kp(db, kpid="audit_kp"):
    await KnowledgeService(db).create_point({
        "id": kpid, "name": kpid, "chapter": "审计章节", "section": "审计小节",
    })


@pytest.mark.asyncio
@pytest.mark.parametrize("forgetting_enabled", [False, True])
async def test_mixed_learning_evidence_replays_without_changing_mastery(db_session, monkeypatch, forgetting_enabled):
    monkeypatch.setattr(settings, "mastery_forgetting_enabled", forgetting_enabled)
    await seed_kp(db_session)
    for qid, kind in [("self", "problem_solving"), ("process", "problem_solving"),
                      ("choice", "single_choice"), ("blank", "single_choice")]:
        await seed_question(db_session, qid, kind)
    svc = AdaptiveService(db_session)
    await svc.submit_self_review("mixed", "self", [
        {"label": "1", "status": "correct"}, {"label": "2", "status": "partial"},
    ])
    await svc.submit_answer("mixed", "process", "有部分过程", judged_is_correct=False,
                            judged_grading={"process_score": 60, "is_correct": False})
    await svc.submit_answer("mixed", "choice", "A")
    await svc.submit_answer("mixed", "blank", "")
    before = await svc.student_svc.get_mastery("mixed", "audit_kp")
    expected = (before.mastery, before.correct_rate, before.confidence, before.attempts)
    assert before.correct_rate == pytest.approx((0.75 + 0.6 + 1.0 + 0.0) / 4)
    rebuilt = await svc.student_svc.rebuild_mastery_for_kp("mixed", "audit_kp")
    assert (rebuilt.mastery, rebuilt.correct_rate, rebuilt.confidence, rebuilt.attempts) == pytest.approx(expected)


@pytest.mark.asyncio
async def test_blank_evidence_stays_zero_after_mastery_rebuild(db_session):
    await seed_kp(db_session)
    await seed_question(db_session, "blank")
    svc = AdaptiveService(db_session)
    await svc.submit_answer("blank-student", "blank", "")
    rebuilt = await svc.student_svc.rebuild_mastery_for_kp("blank-student", "audit_kp")
    assert rebuilt.mastery == 0
    assert rebuilt.correct_rate == 0
    assert rebuilt.attempts == 1


@pytest.mark.asyncio
async def test_rebuild_uses_observed_evidence_order_instead_of_transaction_start_time(db_session):
    await seed_kp(db_session)
    await seed_question(db_session, "ordering")
    svc = AdaptiveService(db_session)
    first = await svc.submit_answer("ordered", "ordering", "A")
    second = await svc.submit_answer("ordered", "ordering", "B")
    mastery = await svc.student_svc.get_mastery("ordered", "audit_kp")
    expected = mastery.mastery
    first_answer = await svc.student_svc.get_answer("ordered", first["answer_id"])
    second_answer = await svc.student_svc.get_answer("ordered", second["answer_id"])
    # PostgreSQL now() denotes transaction start, which can precede the lock
    # acquisition order. Recorded observation time retains the applied order.
    first_answer.created_at = second_answer.created_at + timedelta(seconds=1)
    await db_session.commit()
    rebuilt = await svc.student_svc.rebuild_mastery_for_kp("ordered", "audit_kp")
    assert rebuilt.mastery == pytest.approx(expected)


@pytest.mark.asyncio
async def test_binary_answer_preserves_previous_fractional_credit(db_session):
    await seed_kp(db_session)
    svc = StudentService(db_session)
    await svc.update_mastery_with_score("fractional", "audit_kp", 0.5)
    result = await svc.update_mastery("fractional", "audit_kp", True)
    assert result.correct_rate == pytest.approx(0.75)


@pytest.mark.asyncio
async def test_manual_correction_overrides_ai_process_for_display_and_profile(db_session):
    await seed_kp(db_session)
    await seed_question(db_session, "corrected", "problem_solving")
    svc = AdaptiveService(db_session)
    result = await svc.submit_answer("manual", "corrected", "v=1", judged_is_correct=False,
        judged_grading={"process_score": 20, "final_answer": "v=1", "feedback": "原AI判断错误",
                        "first_error": "错误列式", "equation_correct": False,
                        "error_type": "equation_setup"})
    corrected = await svc.student_svc.apply_manual_correction(
        "manual", result["answer_id"], "v=2", True, correction_reason="原识别有误")
    grading = corrected["process_grading"]
    assert grading["final_answer"] == "v=2"
    assert grading["process_score"] == 100
    assert grading["first_error"] == ""
    assert grading.get("equation_correct") is not False
    assert answer_credit_from_grading(True, grading) == 1
    answer = await svc.student_svc.get_answer("manual", result["answer_id"])
    assert answer.grading_result["_original_grading"]["process_score"] == 20
    profile = await StudentPracticeProfileService(db_session).build_profile("manual")
    assert profile["weak_labels"]["knowledge_point"] == []
    assert profile["process_weaknesses"] == []
    replay = await svc._response_from_existing_answer("manual", await svc.question_svc.get_question("corrected"), answer)
    assert replay["process_grading"]["final_answer"] == "v=2"
    stats = await db_session.scalar(select(ItemStats).where(ItemStats.question_id == "corrected"))
    assert stats.correct_rate == 1
    assert stats.total_attempts == 1
    await db_session.refresh(answer)
    assert answer.grading_result["_mastery_update"] == corrected["mastery_update"]


def test_legacy_manual_correction_overrides_stale_process_credit_and_flags():
    grading = {"process_score": 20, "equation_correct": False, "error_type": "equation_setup",
               "manual_correction": {"is_correct": True, "corrected_answer": "正确答案"}}
    assert answer_credit_from_grading(True, grading) == 1
    assert StudentPracticeProfileService._process_weakness_flags(SimpleNamespace(grading_result=grading)) == []


def test_manual_wrong_verdict_is_not_reclassified_as_pending_ai_review():
    normalized = normalize_process_grading({
        "error_type": "unknown", "process_score": 80,
        "manual_correction": {"is_correct": False, "corrected_answer": "学生确认不会"},
    })
    assert normalized["process_score"] == 0
    assert normalized["needs_human_review"] is False


@pytest.mark.asyncio
async def test_process_attachment_preserves_learning_and_correction_metadata(tmp_path, monkeypatch):
    original = {"manual_correction": {"is_correct": True, "corrected_answer": "A"},
                "_original_grading": {"process_score": 20}, "_evidence_knowledge_point_id": "target",
                "_evidence_observed_at": "2026-09-05T00:00:00+00:00", "_mastery_update": {"target": {"after": 0.8}}}
    answer = SimpleNamespace(id=1, question_id="question", grading_result=original,
                             given_answer="A", is_correct=True)
    monkeypatch.setattr(answer_grading, "__file__", str(tmp_path / "backend/app/api/student/answer_grading.py"))
    monkeypatch.setattr(answer_grading, "ensure_student_can_access_question", AsyncMock())
    image = UploadFile(io.BytesIO(b"synthetic-image"), headers=Headers({"content-type": "image/png"}))
    await answer_grading.submit_process_evidence(
        image=image, question_id="question", answer_id=1, student_id="synthetic", time_spent_ms=0,
        evidence_kind="scratch_image", question_svc=SimpleNamespace(get_question=AsyncMock(
            return_value=SimpleNamespace(question_type=SimpleNamespace(value="single_choice")))),
        student_svc=SimpleNamespace(get_answer=AsyncMock(return_value=answer), db=AsyncMock()),
        rich_content_svc=SimpleNamespace(), include_rendered=False, x_openphysics_include_rendered=None,
    )
    for key, value in original.items():
        assert answer.grading_result[key] == value


@pytest.mark.asyncio
async def test_concurrent_correction_and_new_answer_preserve_both_evidence_rows(db_session):
    await seed_kp(db_session)
    await seed_question(db_session, "to-correct", "problem_solving")
    await seed_question(db_session, "new-choice")
    initial = await AdaptiveService(db_session).submit_answer("same-student", "to-correct", "wrong",
        judged_is_correct=False, judged_grading={"process_score": 20})
    sessions = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    ready = asyncio.Event()
    entrants = 0

    async def run(correction):
        nonlocal entrants
        async with sessions() as session:
            entrants += 1
            if entrants == 2:
                ready.set()
            await ready.wait()
            if correction:
                return await StudentService(session).apply_manual_correction(
                    "same-student", initial["answer_id"], "A", True)
            return await AdaptiveService(session).submit_answer("same-student", "new-choice", "A")

    await asyncio.wait_for(asyncio.gather(run(True), run(False)), 20)
    async with sessions() as verify:
        result = await StudentService(verify).get_mastery("same-student", "audit_kp")
        # The student's correction is low-weight evidence; the new answer is ordinary BKT evidence.
        corrected = 0.5 + (1.0 - 0.5) * STUDENT_VERDICT_WEIGHT
        expected = KnowledgeTracingEngine.p_learn(corrected, True)
        assert result.attempts == 2
        assert result.correct_rate == 1
        assert result.mastery == pytest.approx(expected)


def test_legacy_target_fallback_stays_in_scope_but_never_reassigns_persisted_target():
    question = SimpleNamespace(labels=[
        SimpleNamespace(label_type="knowledge_point", label_id="outside", role="primary", confidence=1),
        SimpleNamespace(label_type="knowledge_point", label_id="inside", role="secondary", confidence=1),
    ])
    legacy = SimpleNamespace(grading_result={})
    persisted = SimpleNamespace(grading_result={"_evidence_knowledge_point_id": "outside"})
    assert StudentService.evidence_knowledge_point_id(legacy, question, {"inside"}) == "inside"
    assert StudentService.evidence_knowledge_point_id(persisted, question, {"inside"}) is None


@pytest.mark.asyncio
async def test_scope_diagnostic_uses_persisted_answer_target(db_session):
    for kp in ("primary", "target"):
        await seed_kp(db_session, kp)
    student = await StudentService(db_session).create_student("scope-audit", "test-password", "测试学生")
    await seed_question(db_session, "multi-target", kp_ids=("primary", "target"))
    svc = AdaptiveService(db_session)
    submitted = await svc.submit_answer(student.id, "multi-target", "A", target_knowledge_point_id="target")
    body = schemas.SubmittedScopeDiagnosticFeedbackRequest(scope_type="chapter", scope_id="审计章节",
        answers=[schemas.SubmittedDiagnosticAnswer(answer_id=submitted["answer_id"],
                                                  mastery_update=submitted["mastery_update"])])
    result = await diagnose_scope_submitted_feedback(body, student_id=student.id, adaptive_svc=svc,
        knowledge_svc=KnowledgeService(db_session), student_svc=StudentService(db_session),
        attempt_svc=SimpleNamespace(create_from_scope_result=AsyncMock(return_value=SimpleNamespace(id="audit"))))
    assert [item.kp_id for item in result.kp_results] == ["target"]
    assert result.kp_results[0].correct_count == 1


@pytest.mark.asyncio
async def test_retest_summary_and_serialization_keep_explicit_target(db_session):
    for kp in ("primary", "target"):
        await seed_kp(db_session, kp)
    await seed_question(db_session, "retest-multi", kp_ids=("primary", "target"))
    adaptive = AdaptiveService(db_session)
    answer = await adaptive.submit_answer("retest-student", "retest-multi", "A", target_knowledge_point_id="target")
    question = await adaptive.question_svc.get_question("retest-multi")
    tasks = [SimpleNamespace(id=f"task-{kp}", kp_id=kp, kp_name=kp, priority=index,
                             status="practiced", mastery_after=0.1, passed_at=None)
             for index, kp in enumerate(("primary", "target"))]
    plan = SimpleNamespace(id="plan", tasks=tasks, status="ready_for_retest", current_task_id=None,
                           completed_at=None)
    attempt = SimpleNamespace(id="attempt", status="in_progress", question_ids=["retest-multi"])
    svc = ImprovementPlanService(db_session)
    svc._get_plan_model = AsyncMock(return_value=plan)
    svc._get_retest_attempt_model = AsyncMock(return_value=attempt)
    svc._serialize_retest_result = AsyncMock(return_value={})
    serialized = svc._serialize_question(question, "target")
    assert serialized["target_knowledge_point_id"] == "target"
    await svc.submit_retest_feedback("retest-student", "plan", "attempt", [
        schemas.SubmittedDiagnosticAnswer(answer_id=answer["answer_id"], mastery_update=answer["mastery_update"]),
    ])
    assert [result["kp_id"] for result in attempt.task_results] == ["target"]
    assert tasks[0].status == "practiced"
    assert tasks[1].status == "passed"


@pytest.mark.asyncio
async def test_client_cannot_mark_improvement_task_passed():
    task = SimpleNamespace(id="task", student_id="student", status="pending", priority=1,
                           started_at=None, passed_at=None)
    plan = SimpleNamespace(id="plan", status="diagnosed", tasks=[task], current_task_id=task.id,
                           completed_at=None)
    db = AsyncMock()
    svc = ImprovementPlanService(db)
    svc._get_plan_model = AsyncMock(return_value=plan)
    svc.get_plan = AsyncMock(return_value=plan)
    with pytest.raises(HTTPException) as error:
        await svc.update_task_status("student", "plan", "task", "passed")
    assert error.value.status_code == 400
    assert task.status == "pending"
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("preexisting", [False, True])
async def test_cross_student_same_question_submissions_are_atomic(db_session, preexisting):
    await seed_kp(db_session)
    await seed_question(db_session, "concurrent")
    initial_count = 3 if preexisting else 0
    if preexisting:
        db_session.add(ItemStats(question_id="concurrent", total_attempts=3,
                                 correct_rate=2 / 3, avg_time_ms=2500))
        await db_session.commit()

    sessions = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    ready = asyncio.Event()
    entrants = 0

    class ReadyStudentService(StudentService):
        async def update_item_stats(self, *args, **kwargs):
            nonlocal entrants
            entrants += 1
            if entrants == 8:
                ready.set()
            # Synchronize before any ItemStats lock or mutation, never inside it.
            await asyncio.wait_for(ready.wait(), 10)
            return await super().update_item_stats(*args, **kwargs)

    async def submit(index):
        async with sessions() as session:
            svc = AdaptiveService(session)
            svc.student_svc = ReadyStudentService(session)
            return await svc.submit_answer(f"parallel-{index}", "concurrent",
                                            "A" if index % 2 else "B", index * 1000,
                                            submission_id=f"submission-{index}")

    results = await asyncio.wait_for(asyncio.gather(*(submit(i) for i in range(1, 9)),
                                                   return_exceptions=True), 20)
    assert all(isinstance(result, dict) for result in results), [type(result).__name__ for result in results]
    answer_count = await db_session.scalar(select(func.count(StudentAnswer.id)))
    stats = (await db_session.execute(select(ItemStats).where(ItemStats.question_id == "concurrent")
                                       .execution_options(populate_existing=True))).scalar_one()
    assert answer_count == 8
    assert stats.total_attempts == initial_count + 8
    assert stats.correct_rate == pytest.approx(((2 if preexisting else 0) + 4) / (initial_count + 8))
    assert stats.avg_time_ms == pytest.approx(((2500 * 3 if preexisting else 0) + 36000) / (initial_count + 8))
