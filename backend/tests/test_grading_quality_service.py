"""The three online grading rates the admin quality page shows (audit A11)."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.question import Question
from app.models.student import GradingOutcome, StudentAnswer
from app.services.admin_quality_service import AdminQualityService
from app.services.grading_quality_service import GradingQualityService, is_ai_graded


def test_only_model_verdicts_count_as_ai_graded():
    assert is_ai_graded({"answer_source": "photo", "is_correct": True, "feedback": "对"})
    assert is_ai_graded({"answer_source": "text", "feedback": "对", "manual_correction": {"is_correct": True}})
    assert not is_ai_graded({"answer_source": "choice", "_grading_method": "deterministic"})
    assert not is_ai_graded({"_mastery_update": {}})  # legacy tapped option
    assert not is_ai_graded({"answer_source": "self_review", "feedback": "自评"})
    assert not is_ai_graded(None)


@pytest.mark.asyncio
async def test_online_rates_from_answers_and_photo_outcomes(db_session):
    now = datetime.now(timezone.utc)
    db_session.add(Question(id="q-rate", stem_text="题", answer="1", question_type="problem_solving"))
    await db_session.flush()
    gradings = [
        {"answer_source": "photo", "feedback": "对", "is_correct": True},
        {"answer_source": "photo", "feedback": "看不清", "_pending_confirmation": True},
        {"answer_source": "text", "feedback": "冲突", "_pending_confirmation": True,
         "_verdict_process_conflict": {"is_correct": True, "process_score": 40}},
        # Corrected after waiting: still counts as needing review at grading time.
        {"answer_source": "photo", "feedback": "改", "manual_correction": {"is_correct": True},
         "_original_grading": {"_pending_confirmation": True}},
        {"answer_source": "choice", "_grading_method": "deterministic"},
        {"answer_source": "self_review", "feedback": "自评"},
    ]
    for index, grading in enumerate(gradings):
        db_session.add(StudentAnswer(student_id="s", question_id="q-rate", submission_id=str(index),
                                     given_answer="1", is_correct=True, grading_result=grading))
    db_session.add(StudentAnswer(student_id="s", question_id="q-rate", submission_id="old", given_answer="1",
                                 grading_result={"answer_source": "photo", "manual_correction": {}},
                                 created_at=now - timedelta(days=40)))
    db_session.add_all([
        GradingOutcome(source="photo", outcome="graded"),
        GradingOutcome(source="paper_batch", outcome="graded"),
        GradingOutcome(source="paper_batch", outcome="graded"),
        GradingOutcome(source="photo", outcome="unrecognized"),
        GradingOutcome(source="photo", outcome="no_answer_key"),
        GradingOutcome(source="photo", outcome="unrecognized", created_at=now - timedelta(days=40)),
    ])
    await db_session.commit()

    rates = await GradingQualityService(db_session).online_rates(now=now)

    assert rates["ai_graded_count"] == 4
    assert (rates["correction_count"], rates["correction_rate"]) == (1, 0.25)
    assert (rates["needs_review_count"], rates["needs_review_rate"]) == (3, 0.75)
    assert rates["process_conflict_count"] == 1
    assert (rates["photo_item_count"], rates["unrecognized_count"], rates["unrecognized_rate"]) == (4, 1, 0.25)
    assert rates["no_answer_key_count"] == 1

    report = await AdminQualityService(db_session).build_report()
    assert report["grading_metrics"]["ai_graded_count"] == 4


@pytest.mark.asyncio
async def test_online_rates_are_empty_not_zero_without_data(db_session):
    rates = await GradingQualityService(db_session).online_rates()
    assert rates["correction_rate"] is None
    assert rates["needs_review_rate"] is None
    assert rates["unrecognized_rate"] is None


@pytest.mark.asyncio
async def test_grader_comparison_failure_and_teacher_change_rates(db_session):
    """After switching the primary grader, the report compares graders on the same three signals."""
    import uuid
    from sqlalchemy import select
    from app.models.student import Student, StudentAiExecution
    from app.models.teacher import Teacher, TeacherAssignment, TeacherClass, TeacherStudentPaper
    from app.models.teacher_paper import TeacherPaperAttempt
    from app.models.teacher_scan import TeacherSubmissionItem
    from app.models.question import QuestionType
    from app.services.teacher_homework_service import sync_app_submissions

    now = datetime.now(timezone.utc)
    db_session.add(Teacher(id="cmp-t", username="cmp-t", display_name="QA", password_hash="unused"))
    db_session.add(Student(id="cmp-s", username="cmp-s", display_name="QA", password_hash="unused"))
    await db_session.flush()
    db_session.add(TeacherClass(id="cmp-c", teacher_id="cmp-t", name="QA"))
    for qid in ("cmp-q1", "cmp-q2"):
        db_session.add(Question(id=qid, stem_text="题", answer="答案", question_type=QuestionType.problem_solving))
    await db_session.flush()
    assignment = TeacherAssignment(id="cmp-a", teacher_id="cmp-t", class_id="cmp-c", title="QA",
                                   status="published", settings={"delivery": "app"})
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(TeacherStudentPaper(id="cmp-paper", assignment_id="cmp-a", student_id="cmp-s", delivery="app",
        items=[{"question_id": "cmp-q1", "points": 10}, {"question_id": "cmp-q2", "points": 10}],
        question_snapshot=[{"id": q, "question_type": "problem_solving"} for q in ("cmp-q1", "cmp-q2")]))
    db_session.add(TeacherPaperAttempt(id="cmp-attempt", student_id="cmp-s", paper_id="homework:cmp-a",
        catalog_code="teacher_homework", node_id="cmp-a", title="QA", question_ids=["cmp-q1", "cmp-q2"],
        questions=[], status="completed"))
    await db_session.flush()
    for qid, model in (("cmp-q1", "deepseek-flash"), ("cmp-q2", "doubao-seed")):
        db_session.add(StudentAnswer(student_id="cmp-s", question_id=qid, teacher_paper_attempt_id="cmp-attempt",
            given_answer="答案", is_correct=False, grading_result={
                "answer_source": "photo", "feedback": "部分正确", "process_score": 50, "_grading_model": model}))
    for status in ("succeeded", "succeeded", "succeeded", "failed"):
        db_session.add(StudentAiExecution(id=str(uuid.uuid4()), student_id="cmp-s", operation_key=str(uuid.uuid4()),
            fingerprint="f", feature="practice.photo_vision_grading", status=status, owner="o",
            started_at=now, lease_expires_at=now))
    db_session.add(StudentAiExecution(id=str(uuid.uuid4()), student_id="cmp-s", operation_key="tutor",
        fingerprint="f", feature="learn.chat", status="failed", owner="o", started_at=now, lease_expires_at=now))
    await db_session.commit()
    assert await sync_app_submissions(db_session, assignment) == 1

    items = {item.question_id: item for item in (await db_session.scalars(select(TeacherSubmissionItem))).all()}
    assert items["cmp-q1"].ai_result["_ai_score"] == 5
    # The teacher keeps DeepSeek's 5 and changes Doubao's 5 to 8.
    items["cmp-q1"].grade_status, items["cmp-q1"].reviewed_at = "confirmed", now
    items["cmp-q2"].grade_status, items["cmp-q2"].score, items["cmp-q2"].reviewed_at = "confirmed", 8, now
    await db_session.commit()

    rates = await GradingQualityService(db_session).online_rates(now=now + timedelta(seconds=1))

    assert (rates["ai_task_count"], rates["ai_failure_count"], rates["ai_failure_rate"]) == (4, 1, 0.25)
    assert (rates["teacher_review_count"], rates["teacher_change_count"], rates["teacher_change_rate"]) == (2, 1, 0.5)
    by_model = {row["model"]: row for row in rates["by_model"]}
    assert by_model["deepseek-flash"]["teacher_change_rate"] == 0
    assert by_model["doubao-seed"]["teacher_change_rate"] == 1
    assert by_model["deepseek-flash"]["ai_graded_count"] == 1
