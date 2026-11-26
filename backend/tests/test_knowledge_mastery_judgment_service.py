from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.student.router import router as student_router
from app.models.improvement import (
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentScopeDiagnosticAttempt,
    StudentScopeDiagnosticKpResult,
)
from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import Student, StudentAnswer, StudentMastery
from app.services.knowledge_mastery_judgment_service import KnowledgeMasteryJudgmentService
from tests.practicable import seed_practicable


BASE_TIME = datetime(2026, 6, 28, 8, 0, tzinfo=timezone.utc)


def test_mastery_judgment_routes_are_registered_under_student_api():
    paths = {route.path for route in student_router.routes}

    assert "/api/student/mastery-judgments/kps/{kp_id}" in paths
    assert "/api/student/mastery-judgments/kps" in paths
    assert "/api/student/mastery-judgments/scope" in paths


def at_minute(minutes: int) -> datetime:
    return BASE_TIME + timedelta(minutes=minutes)


async def seed_base_entities(db_session) -> None:
    db_session.add_all([
        Student(
            id="student-a",
            username="student-a",
            password_hash="hash",
            display_name="学生 A",
            status="active",



        ),
        Student(
            id="student-b",
            username="student-b",
            password_hash="hash",
            display_name="学生 B",
            status="active",



        ),
        Student(
            id="student-trial",
            username="student-trial",
            password_hash="hash",
            display_name="体验学生",
            status="active",

        ),
        KnowledgePoint(
            id="kp-weak",
            name="薄弱点",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.1 质点 参考系",
        ),
        KnowledgePoint(
            id="kp-developing",
            name="发展中",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.1 质点 参考系",
        ),
        KnowledgePoint(
            id="kp-stable",
            name="稳定点",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        KnowledgePoint(
            id="kp-mastered",
            name="已掌握",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        KnowledgePoint(
            id="kp-private",
            name="未订阅知识点",
            volume="必修 第一册",
            chapter="第二章 匀变速直线运动",
            section="2.1 实验：探究小车速度随时间变化的规律",
        ),
    ])
    await db_session.commit()


async def seed_mastery(
    db_session,
    student_id: str,
    kp_id: str,
    mastery: float,
    *,
    attempts: int = 3,
    correct_rate: float | None = None,
) -> None:
    db_session.add(
        StudentMastery(
            student_id=student_id,
            knowledge_point_id=kp_id,
            mastery=mastery,
            confidence=1.0,
            attempts=attempts,
            correct_rate=correct_rate if correct_rate is not None else mastery,
            last_practiced=at_minute(1),
        )
    )
    await db_session.commit()


async def seed_recent_answers(
    db_session,
    *,
    student_id: str = "student-a",
    kp_id: str = "kp-stable",
    correctness: list[bool],
) -> None:
    rows = []
    for index, is_correct in enumerate(correctness, start=1):
        question_id = f"q-{kp_id}-{index}"
        rows.extend([
            Question(
                id=question_id,
                stem_text=f"{kp_id} 最近练习 {index}",
                answer="A",
                explanation="解析",
                question_type=QuestionType.single_choice,
                quality_status=QualityStatus.approved,
                created_at=at_minute(index),
            ),
            QuestionLabel(
                question_id=question_id,
                label_type="knowledge_point",
                label_id=kp_id,
                role="主要",
                source="test",
            ),
            StudentAnswer(
                student_id=student_id,
                question_id=question_id,
                given_answer="A",
                is_correct=is_correct,
                time_spent_ms=1000,
                created_at=at_minute(20 + index),
            ),
        ])
    db_session.add_all(rows)
    await db_session.commit()


async def seed_diagnostic_result(
    db_session,
    *,
    student_id: str = "student-a",
    kp_id: str = "kp-stable",
    is_weak: bool = True,
    submitted_at: datetime | None = None,
) -> None:
    submitted = submitted_at or at_minute(30)
    attempt = StudentScopeDiagnosticAttempt(
        id=f"attempt-{student_id}-{kp_id}",
        student_id=student_id,
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        diagnostic_type="scope",
        status="submitted",
        question_ids=[],
        answer_ids=[],
        result={},
        correct_count=0 if is_weak else 1,
        total_count=1,
        weak_count=1 if is_weak else 0,
        weak_kp_ids=[kp_id] if is_weak else [],
        recommendation="study" if is_weak else "practice",
        feedback="检测完成",
        created_at=submitted,
        submitted_at=submitted,
    )
    kp_result = StudentScopeDiagnosticKpResult(
        id=f"attempt-result-{student_id}-{kp_id}",
        attempt_id=attempt.id,
        student_id=student_id,
        kp_id=kp_id,
        kp_name="稳定点",
        correct_count=0 if is_weak else 1,
        total_count=1,
        mastery_before=0.6,
        mastery_after=0.78,
        is_weak=is_weak,
        created_at=submitted,
    )
    db_session.add_all([attempt, kp_result])
    await db_session.commit()


async def seed_plan_task(
    db_session,
    *,
    student_id: str = "student-a",
    kp_id: str = "kp-stable",
    plan_status: str = "in_progress",
    task_status: str = "in_progress",
) -> tuple[StudentImprovementPlan, StudentImprovementTask]:
    plan = StudentImprovementPlan(
        id=f"plan-{student_id}-{kp_id}-{task_status}",
        student_id=student_id,
        diagnostic_attempt_id=None,
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        status=plan_status,
        correct_count=0,
        total_count=1,
        weak_count=1,
        source_result={},
        created_at=at_minute(40),
        updated_at=at_minute(45),
    )
    task = StudentImprovementTask(
        id=f"task-{student_id}-{kp_id}-{task_status}",
        plan_id=plan.id,
        student_id=student_id,
        kp_id=kp_id,
        kp_name="稳定点",
        correct_count=0,
        total_count=1,
        mastery_before=0.2,
        mastery_after=0.55,
        is_weak=True,
        priority=1,
        status=task_status,
        recommended_action="practice",
        reason="专项补弱",
        started_at=at_minute(41) if task_status in {"in_progress", "practiced", "needs_retest", "passed"} else None,
        practiced_at=at_minute(42) if task_status in {"practiced", "needs_retest", "passed"} else None,
        passed_at=at_minute(43) if task_status == "passed" else None,
        created_at=at_minute(40),
        updated_at=at_minute(44),
    )
    plan.current_task_id = task.id if task_status in {"pending", "in_progress", "needs_retest"} else None
    db_session.add_all([plan, task])
    await db_session.commit()
    return plan, task


async def seed_retest_result(
    db_session,
    *,
    student_id: str = "student-a",
    kp_id: str = "kp-stable",
    passed: bool,
) -> None:
    _, task = await seed_plan_task(
        db_session,
        student_id=student_id,
        kp_id=kp_id,
        plan_status="completed" if passed else "in_progress",
        task_status="passed" if passed else "needs_retest",
    )
    db_session.add(
        StudentImprovementRetestAttempt(
            id=f"retest-{student_id}-{kp_id}-{passed}",
            plan_id=task.plan_id,
            student_id=student_id,
            status="submitted",
            question_ids=[f"rq-{kp_id}"],
            task_results=[{
                "task_id": task.id,
                "kp_id": kp_id,
                "kp_name": task.kp_name,
                "correct_count": 1 if passed else 0,
                "total_count": 1,
                "mastery_before": 0.4,
                "mastery_after": 0.82 if passed else 0.5,
                "passed": passed,
                "next_status": "passed" if passed else "needs_retest",
                "feedback": "复测结果",
            }],
            correct_count=1 if passed else 0,
            total_count=1,
            passed_count=1 if passed else 0,
            needs_retest_count=0 if passed else 1,
            created_at=at_minute(50),
            submitted_at=at_minute(51),
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_base_mastery_thresholds(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-weak", 0.2)
    await seed_mastery(db_session, "student-a", "kp-developing", 0.55)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.75)
    await seed_mastery(db_session, "student-a", "kp-mastered", 0.9)

    svc = KnowledgeMasteryJudgmentService(db_session)

    assert (await svc.get_kp_judgment("student-a", "kp-weak")).mastery_level == "weak"
    assert (await svc.get_kp_judgment("student-a", "kp-developing")).mastery_level == "developing"
    assert (await svc.get_kp_judgment("student-a", "kp-stable")).mastery_level == "stable"
    assert (await svc.get_kp_judgment("student-a", "kp-mastered")).mastery_level == "mastered"


@pytest.mark.asyncio
async def test_latest_diagnostic_weak_overrides_stable_mastery(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.78)
    await seed_diagnostic_result(db_session, kp_id="kp-stable", is_weak=True)

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.mastery_level == "developing"
    assert judgment.intervention_status == "needs_practice"
    assert judgment.next_action == "improve"
    assert "diagnostic" in judgment.evidence_sources
    assert judgment.latest_diagnostic_is_weak is True


@pytest.mark.asyncio
async def test_needs_retest_task_dominates_judgment(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.9)
    await seed_plan_task(db_session, kp_id="kp-stable", plan_status="in_progress", task_status="needs_retest")

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.mastery_level == "stable"
    assert judgment.intervention_status == "needs_retest"
    assert judgment.next_action == "improve"
    assert judgment.active_task_status == "needs_retest"


@pytest.mark.asyncio
async def test_in_progress_task_requests_continuing_improvement(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.62)
    await seed_plan_task(db_session, kp_id="kp-stable", plan_status="in_progress", task_status="in_progress")

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.intervention_status == "in_improvement"
    assert judgment.next_action == "continue_improvement"
    assert "improvement_task" in judgment.evidence_sources


@pytest.mark.asyncio
async def test_practiced_task_waits_for_retest_when_plan_ready(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.68)
    await seed_plan_task(db_session, kp_id="kp-stable", plan_status="ready_for_retest", task_status="practiced")

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.intervention_status == "awaiting_retest"
    assert judgment.next_action == "retest"


@pytest.mark.asyncio
async def test_passed_retest_marks_knowledge_point_passed_recently(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.72)
    await seed_retest_result(db_session, kp_id="kp-stable", passed=True)

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.mastery_level == "stable"
    assert judgment.intervention_status == "passed_recently"
    assert judgment.next_action == "maintain"
    assert judgment.latest_retest_passed is True
    assert "retest" in judgment.evidence_sources


@pytest.mark.asyncio
async def test_recent_answer_low_correct_rate_requests_practice(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.65)
    await seed_recent_answers(db_session, kp_id="kp-stable", correctness=[False, True, False, False])

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-a", "kp-stable")

    assert judgment.intervention_status == "needs_practice"
    assert judgment.next_action == "practice"
    assert judgment.recent_total_count == 4
    assert judgment.recent_correct_count == 1
    assert judgment.recent_correct_rate == 0.25
    assert "recent_answer" in judgment.evidence_sources


@pytest.mark.asyncio
async def test_batch_and_scope_judgments_return_requested_items(db_session):
    await seed_base_entities(db_session)
    await seed_practicable(db_session, "kp-weak", "kp-developing", "kp-stable", "kp-mastered")
    await seed_mastery(db_session, "student-a", "kp-weak", 0.2)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.75)

    svc = KnowledgeMasteryJudgmentService(db_session)
    batch = await svc.get_kp_judgments("student-a", ["kp-weak", "kp-stable"])
    scope = await svc.get_scope_judgments("student-a", "chapter", "第一章 运动的描述")

    assert [item.kp_id for item in batch.items] == ["kp-weak", "kp-stable"]
    assert scope.scope_type == "chapter"
    assert scope.scope_id == "第一章 运动的描述"
    assert scope.scope_name == "第一章 运动的描述"
    assert {item.kp_id for item in scope.items} == {"kp-weak", "kp-developing", "kp-stable", "kp-mastered"}


@pytest.mark.asyncio
async def test_student_isolation_uses_only_current_student_evidence(db_session):
    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.78)
    await seed_diagnostic_result(db_session, student_id="student-a", kp_id="kp-stable", is_weak=True)

    judgment = await KnowledgeMasteryJudgmentService(db_session).get_kp_judgment("student-b", "kp-stable")

    assert "diagnostic" not in judgment.evidence_sources
    assert judgment.latest_diagnostic_attempt_id is None
    assert judgment.confidence == "low"




@pytest.mark.asyncio
async def test_mastered_level_uses_the_learning_state_threshold(db_session):
    from app.services.learning_state_rules import MASTERED_THRESHOLD, classify_learning_state

    await seed_base_entities(db_session)
    await seed_mastery(db_session, "student-a", "kp-stable", 0.79)
    await seed_mastery(db_session, "student-a", "kp-mastered", 0.82)
    svc = KnowledgeMasteryJudgmentService(db_session)

    below = await svc.get_kp_judgment("student-a", "kp-stable")
    above = await svc.get_kp_judgment("student-a", "kp-mastered")

    assert MASTERED_THRESHOLD == 0.8
    # One "已掌握" line: the judgment never calls an 80%+ point merely "较稳定".
    assert above.mastery_level == "mastered"
    assert classify_learning_state("current", 0.82, attempts=3)["state"] == "mastered"
    assert below.mastery_level == "stable"
    assert classify_learning_state("current", 0.79, attempts=3)["state"] == "practice"
