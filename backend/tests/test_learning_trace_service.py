from datetime import datetime, timedelta, timezone

import pytest

from app.api.student.router import router as student_router
from app.models.improvement import (
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentScopeDiagnosticAttempt,
)
from app.models.student import Student
from app.services.learning_trace_service import LearningTraceService


BASE_TIME = datetime(2026, 6, 27, 2, 0, tzinfo=timezone.utc)


def test_learning_trace_route_is_registered_under_student_api():
    paths = {route.path for route in student_router.routes}

    assert "/api/student/learning-trace" in paths


def at_minute(minutes: int) -> datetime:
    return BASE_TIME + timedelta(minutes=minutes)


async def seed_student(db_session, student_id: str = "student-a") -> None:
    db_session.add(
        Student(
            id=student_id,
            username=student_id,
            password_hash="hash",
            display_name=f"学生 {student_id}",
            status="active",
        )
    )
    await db_session.commit()


async def seed_completed_trace(
    db_session,
    *,
    student_id: str = "student-a",
    suffix: str = "one",
    scope_type: str = "chapter",
    scope_id: str = "第一章 运动的描述",
    scope_name: str = "第一章 运动的描述",
    base_offset: int = 0,
) -> dict[str, str]:
    attempt = StudentScopeDiagnosticAttempt(
        id=f"attempt-{suffix}",
        student_id=student_id,
        scope_type=scope_type,
        scope_id=scope_id,
        scope_name=scope_name,
        diagnostic_type="scope",
        status="submitted",
        question_ids=[f"q-{suffix}-1", f"q-{suffix}-2"],
        answer_ids=[1, 2],
        result={
            "scope_type": scope_type,
            "scope_id": scope_id,
            "scope_name": scope_name,
            "correct_count": 1,
            "total_count": 2,
            "weak_kp_ids": [f"kp-{suffix}"],
            "feedback": "检测完成。",
        },
        correct_count=1,
        total_count=2,
        weak_count=1,
        weak_kp_ids=[f"kp-{suffix}"],
        recommendation="study",
        feedback="检测完成。",
        created_at=at_minute(base_offset),
        submitted_at=at_minute(base_offset),
    )
    plan = StudentImprovementPlan(
        id=f"plan-{suffix}",
        student_id=student_id,
        diagnostic_attempt_id=attempt.id,
        scope_type=scope_type,
        scope_id=scope_id,
        scope_name=scope_name,
        status="completed",
        current_task_id=None,
        correct_count=1,
        total_count=2,
        weak_count=1,
        source_result=attempt.result,
        created_at=at_minute(base_offset + 1),
        updated_at=at_minute(base_offset + 8),
        completed_at=at_minute(base_offset + 8),
    )
    task = StudentImprovementTask(
        id=f"task-{suffix}",
        plan_id=plan.id,
        student_id=student_id,
        kp_id=f"kp-{suffix}",
        kp_name=f"知识点 {suffix}",
        correct_count=0,
        total_count=1,
        mastery_before=0.1,
        mastery_after=0.2,
        is_weak=True,
        priority=1,
        status="passed",
        recommended_action="review_then_practice",
        reason="先回看关键概念，再做一组专项练。",
        started_at=at_minute(base_offset + 2),
        practiced_at=at_minute(base_offset + 3),
        passed_at=at_minute(base_offset + 4),
        created_at=at_minute(base_offset + 1),
        updated_at=at_minute(base_offset + 4),
    )
    retest = StudentImprovementRetestAttempt(
        id=f"retest-{suffix}",
        plan_id=plan.id,
        student_id=student_id,
        status="submitted",
        question_ids=[f"rq-{suffix}"],
        task_results=[{
            "task_id": task.id,
            "kp_id": task.kp_id,
            "kp_name": task.kp_name,
            "correct_count": 1,
            "total_count": 1,
            "passed": True,
            "next_status": "passed",
            "feedback": "本步已通过。",
        }],
        correct_count=1,
        total_count=1,
        passed_count=1,
        needs_retest_count=0,
        created_at=at_minute(base_offset + 5),
        submitted_at=at_minute(base_offset + 6),
    )
    db_session.add_all([attempt, plan, task, retest])
    await db_session.commit()
    return {
        "attempt_id": attempt.id,
        "plan_id": plan.id,
        "task_id": task.id,
        "retest_id": retest.id,
    }


@pytest.mark.asyncio
async def test_learning_trace_merges_diagnostic_plan_task_retest_and_report_events(db_session):
    await seed_student(db_session)
    ids = await seed_completed_trace(db_session)

    trace = await LearningTraceService(db_session).list_learning_trace("student-a")

    assert trace.total == 8
    assert [item.event_type for item in trace.items] == [
        "improvement_completed",
        "retest_submitted",
        "retest_started",
        "task_passed",
        "task_practiced",
        "task_started",
        "improvement_plan_created",
        "diagnostic_submitted",
    ]
    assert trace.items[0].plan_id == ids["plan_id"]
    assert trace.items[0].primary_action == "view_report"
    assert trace.items[0].report_available is True
    assert trace.items[-1].attempt_id == ids["attempt_id"]
    assert trace.items[-1].primary_action == "view_diagnostic"
    assert trace.items[-1].metadata["correct_count"] == 1
    assert trace.items[-1].metadata["weak_count"] == 1


@pytest.mark.asyncio
async def test_learning_trace_filters_by_scope_and_student(db_session):
    await seed_student(db_session, "student-a")
    await seed_student(db_session, "student-b")
    await seed_completed_trace(db_session, student_id="student-a", suffix="chapter")
    await seed_completed_trace(
        db_session,
        student_id="student-a",
        suffix="section",
        scope_type="section",
        scope_id="第一章 运动的描述||1.2 时间 位移",
        scope_name="1.2 时间 位移",
        base_offset=20,
    )
    await seed_completed_trace(db_session, student_id="student-b", suffix="other", base_offset=40)

    chapter_trace = await LearningTraceService(db_session).list_learning_trace(
        "student-a",
        scope_type="chapter",
        scope_id="第一章 运动的描述",
    )
    assert chapter_trace.total == 8
    assert {item.scope_type for item in chapter_trace.items} == {"chapter"}
    assert {item.scope_id for item in chapter_trace.items} == {"第一章 运动的描述"}

    student_b_trace = await LearningTraceService(db_session).list_learning_trace("student-b")
    assert student_b_trace.total == 8
    assert {item.student_id for item in student_b_trace.items} == {"student-b"}


@pytest.mark.asyncio
async def test_learning_trace_paginates_after_global_time_sort(db_session):
    await seed_student(db_session)
    await seed_completed_trace(db_session)

    trace = await LearningTraceService(db_session).list_learning_trace("student-a", limit=2, offset=1)

    assert trace.total == 8
    assert trace.limit == 2
    assert trace.offset == 1
    assert [item.event_type for item in trace.items] == [
        "retest_submitted",
        "retest_started",
    ]


@pytest.mark.asyncio
async def test_learning_trace_returns_empty_response_for_student_without_records(db_session):
    await seed_student(db_session)

    trace = await LearningTraceService(db_session).list_learning_trace("student-a")

    assert trace.items == []
    assert trace.total == 0
    assert trace.limit == 20
    assert trace.offset == 0
