from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.student import schemas
from app.models.improvement import StudentImprovementPlan, StudentImprovementRetestAttempt
from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import Student, StudentAnswer, StudentMastery
from app.services.improvement_plan_service import (
    ERR_NO_RETEST_QUESTIONS,
    ERR_NO_TASKS_READY_FOR_RETEST,
    ImprovementPlanService,
)


def make_scope_result() -> schemas.ScopeDiagnosticResult:
    return schemas.ScopeDiagnosticResult(
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        correct_count=1,
        total_count=4,
        weak_kp_ids=["kp-mid", "kp-low", "kp-zero"],
        recommendation="study",
        feedback="先补薄弱点。",
        kp_results=[
            schemas.ScopeKpResult(
                kp_id="kp-stable",
                kp_name="质点",
                correct_count=1,
                total_count=1,
                mastery_before=0.7,
                mastery_after=0.82,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-mid",
                kp_name="参考系",
                correct_count=0,
                total_count=1,
                mastery_before=0.25,
                mastery_after=0.45,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-low",
                kp_name="坐标系",
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.22,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-zero",
                kp_name="位置",
                correct_count=0,
                total_count=0,
                mastery_before=0.1,
                mastery_after=0.22,
            ),
        ],
    )


async def seed_students_and_kps(db_session) -> None:
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
        KnowledgePoint(
            id="kp-stable",
            name="质点",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.1 质点 参考系",
        ),
        KnowledgePoint(
            id="kp-mid",
            name="参考系",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.1 质点 参考系",
        ),
        KnowledgePoint(
            id="kp-low",
            name="坐标系",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        KnowledgePoint(
            id="kp-zero",
            name="位置",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        KnowledgePoint(
            id="kp-other-chapter",
            name="其他章节知识点",
            volume="必修 第一册",
            chapter="第二章 匀变速直线运动",
            section="2.1 实验：探究小车速度随时间变化的规律",
        ),
        KnowledgePoint(
            id="kp-scope-a",
            name="真实顺序靠前",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        KnowledgePoint(
            id="kp-scope-b",
            name="真实顺序靠后",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
    ])
    await db_session.commit()


async def seed_retest_questions(
    db_session,
    kp_ids: list[str],
    *,
    question_type: QuestionType = QuestionType.single_choice,
    answer: str = "A",
    explanation: str = "解析",
) -> None:
    for kp_id in kp_ids:
        db_session.add(
            Question(
                id=f"q-{kp_id}",
                stem_text=f"{kp_id} 复测题",
                answer=answer,
                explanation=explanation,
                question_type=question_type,
                quality_status=QualityStatus.approved,
            )
        )
        db_session.add(
            QuestionLabel(
                question_id=f"q-{kp_id}",
                label_type="knowledge_point",
                label_id=kp_id,
                role="主要",
                source="test",
            )
        )
    await db_session.commit()


def make_single_task_scope_result(
    *,
    kp_id: str = "kp-low",
    kp_name: str = "坐标系",
) -> schemas.ScopeDiagnosticResult:
    return schemas.ScopeDiagnosticResult(
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        correct_count=0,
        total_count=1,
        weak_kp_ids=[kp_id],
        recommendation="study",
        feedback="先补一个薄弱点。",
        kp_results=[
            schemas.ScopeKpResult(
                kp_id=kp_id,
                kp_name=kp_name,
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.2,
            )
        ],
    )


def make_two_task_scope_result() -> schemas.ScopeDiagnosticResult:
    return schemas.ScopeDiagnosticResult(
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        correct_count=0,
        total_count=2,
        weak_kp_ids=["kp-low", "kp-mid"],
        recommendation="study",
        feedback="两个薄弱点都需要复测。",
        kp_results=[
            schemas.ScopeKpResult(
                kp_id="kp-low",
                kp_name="坐标系",
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.2,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-mid",
                kp_name="参考系",
                correct_count=0,
                total_count=1,
                mastery_before=0.2,
                mastery_after=0.35,
            ),
        ],
    )


async def make_practiced_plan(db_session, result: schemas.ScopeDiagnosticResult):
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", result)
    for task in plan.tasks:
        plan = await svc.update_task_status("student-a", plan.id, task.id, "practiced")
    return svc, plan


async def make_completed_single_task_plan(
    db_session,
    *,
    student_id: str = "student-a",
    kp_id: str = "kp-low",
    kp_name: str = "坐标系",
    scope_type: str = "chapter",
    scope_id: str = "第一章 运动的描述",
    scope_name: str = "第一章 运动的描述",
    completed_at: datetime | None = None,
):
    svc = ImprovementPlanService(db_session)
    result = make_single_task_scope_result(kp_id=kp_id, kp_name=kp_name)
    result.scope_type = scope_type
    result.scope_id = scope_id
    result.scope_name = scope_name
    plan = await svc.create_from_scope_result(student_id, result)
    plan = await svc.update_task_status(student_id, plan.id, plan.tasks[0].id, "practiced")
    retest = await svc.start_retest(student_id, plan.id)
    answer = await record_retest_answer(
        db_session,
        student_id=student_id,
        question_id=f"q-{kp_id}",
        kp_id=kp_id,
        is_correct=True,
        mastery=0.82,
    )
    completed = await svc.submit_retest_feedback(
        student_id,
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={kp_id: schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )
    if completed_at:
        model = await db_session.get(StudentImprovementPlan, completed.plan.id)
        assert model is not None
        model.completed_at = completed_at
        model.updated_at = completed_at
        await db_session.commit()
    return svc, completed.plan


async def record_retest_answer(
    db_session,
    *,
    student_id: str = "student-a",
    question_id: str,
    kp_id: str,
    is_correct: bool,
    mastery: float,
) -> StudentAnswer:
    db_session.add(
        StudentMastery(
            student_id=student_id,
            knowledge_point_id=kp_id,
            mastery=mastery,
            attempts=1,
            correct_rate=1.0 if is_correct else 0.0,
        )
    )
    answer = StudentAnswer(
        student_id=student_id,
        question_id=question_id,
        given_answer="A" if is_correct else "B",
        is_correct=is_correct,
        time_spent_ms=1000,
    )
    db_session.add(answer)
    await db_session.commit()
    await db_session.refresh(answer)
    return answer


@pytest.mark.asyncio
async def test_create_from_scope_result_persists_sorted_plan_and_source_result(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)

    plan = await svc.create_from_scope_result("student-a", make_scope_result())

    assert plan.student_id == "student-a"
    assert plan.scope_type == "chapter"
    assert plan.scope_id == "第一章 运动的描述"
    assert plan.status == "diagnosed"
    assert plan.current_task_id == plan.tasks[0].id
    assert plan.source_result["scope_name"] == "第一章 运动的描述"
    assert [task.kp_id for task in plan.tasks] == ["kp-low", "kp-zero", "kp-mid", "kp-stable"]
    assert [task.priority for task in plan.tasks] == [1, 2, 3, 4]
    assert plan.tasks[0].group_name == "1.2 时间 位移"
    assert plan.tasks[0].recommended_action == "review_then_practice"
    assert plan.tasks[2].recommended_action == "practice"
    assert plan.tasks[3].recommended_action == "challenge"


@pytest.mark.asyncio
async def test_create_from_scope_result_rejects_kp_outside_scope(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    result = make_scope_result()
    result.kp_results.append(
        schemas.ScopeKpResult(
            kp_id="kp-other-chapter",
            kp_name="其他章节知识点",
            correct_count=0,
            total_count=1,
            mastery_before=0.1,
            mastery_after=0.2,
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.create_from_scope_result("student-a", result)

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_from_scope_result_uses_scope_kp_order_for_ties(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    result = schemas.ScopeDiagnosticResult(
        scope_type="chapter",
        scope_id="第一章 运动的描述",
        scope_name="第一章 运动的描述",
        correct_count=0,
        total_count=2,
        weak_kp_ids=["kp-scope-b", "kp-scope-a"],
        recommendation="study",
        feedback="按真实章节顺序安排。",
        kp_results=[
            schemas.ScopeKpResult(
                kp_id="kp-scope-b",
                kp_name="真实顺序靠后",
                correct_count=0,
                total_count=1,
                mastery_before=0.2,
                mastery_after=0.4,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-scope-a",
                kp_name="真实顺序靠前",
                correct_count=0,
                total_count=1,
                mastery_before=0.2,
                mastery_after=0.4,
            ),
        ],
    )

    plan = await svc.create_from_scope_result("student-a", result)

    assert [task.kp_id for task in plan.tasks[:2]] == ["kp-scope-a", "kp-scope-b"]


@pytest.mark.asyncio
async def test_get_latest_plan_returns_current_students_latest_plan_with_sorted_tasks(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    first = await svc.create_from_scope_result("student-a", make_scope_result())
    second_result = make_scope_result()
    second_result.scope_type = "section"
    second_result.scope_id = "第一章 运动的描述||1.1 质点 参考系"
    second_result.scope_name = "1.1 质点 参考系"
    second_result.kp_results = second_result.kp_results[:2]
    second_result.weak_kp_ids = ["kp-mid"]
    second = await svc.create_from_scope_result("student-a", second_result)
    await svc.create_from_scope_result("student-b", make_scope_result())

    latest = await svc.get_latest_plan("student-a")
    scoped = await svc.get_latest_plan("student-a", scope_type=first.scope_type, scope_id=first.scope_id)

    assert latest is not None
    assert latest.id == second.id
    assert [task.priority for task in latest.tasks] == [1, 2]
    assert scoped is not None
    assert scoped.id == first.id


@pytest.mark.asyncio
async def test_update_task_status_tracks_progress_and_marks_ready_for_retest(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_scope_result())
    first_task = plan.tasks[0]

    in_progress = await svc.update_task_status("student-a", plan.id, first_task.id, "in_progress")
    updated_first = next(task for task in in_progress.tasks if task.id == first_task.id)
    assert in_progress.status == "in_progress"
    assert in_progress.current_task_id == first_task.id
    assert updated_first.status == "in_progress"
    assert updated_first.started_at is not None

    practiced = await svc.update_task_status("student-a", plan.id, first_task.id, "practiced")
    practiced_first = next(task for task in practiced.tasks if task.id == first_task.id)
    assert practiced_first.status == "practiced"
    assert practiced_first.practiced_at is not None
    assert practiced.status == "in_progress"
    assert practiced.current_task_id == practiced.tasks[1].id

    for task in practiced.tasks[1:]:
        practiced = await svc.update_task_status("student-a", plan.id, task.id, "practiced")

    assert practiced.status == "ready_for_retest"
    assert practiced.current_task_id is None


@pytest.mark.asyncio
async def test_move_to_next_task_advances_or_finishes_plan(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_scope_result())

    await svc.update_task_status("student-a", plan.id, plan.tasks[0].id, "practiced")
    moved = await svc.move_to_next_task("student-a", plan.id)

    assert moved.current_task_id == moved.tasks[1].id
    assert moved.status == "in_progress"

    for task in moved.tasks[1:]:
        moved = await svc.update_task_status("student-a", plan.id, task.id, "practiced")
    finished = await svc.move_to_next_task("student-a", plan.id)

    assert finished.status == "ready_for_retest"
    assert finished.current_task_id is None


@pytest.mark.asyncio
async def test_move_to_next_task_can_mark_next_task_in_progress(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_scope_result())
    await svc.update_task_status("student-a", plan.id, plan.tasks[0].id, "practiced")

    moved = await svc.move_to_next_task("student-a", plan.id, mark_in_progress=True)

    next_task = next(task for task in moved.tasks if task.id == moved.current_task_id)
    assert moved.status == "in_progress"
    assert next_task.status == "in_progress"
    assert next_task.started_at is not None


@pytest.mark.asyncio
async def test_move_to_next_task_can_leave_next_task_pending(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_scope_result())
    await svc.update_task_status("student-a", plan.id, plan.tasks[0].id, "practiced")

    moved = await svc.move_to_next_task("student-a", plan.id, mark_in_progress=False)

    next_task = next(task for task in moved.tasks if task.id == moved.current_task_id)
    assert moved.status == "in_progress"
    assert next_task.status == "pending"
    assert next_task.started_at is None


@pytest.mark.asyncio
async def test_students_cannot_read_or_update_other_students_plans(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_scope_result())

    with pytest.raises(HTTPException) as read_error:
        await svc.get_plan("student-b", plan.id)
    assert read_error.value.status_code == 404

    with pytest.raises(HTTPException) as update_error:
        await svc.update_task_status("student-b", plan.id, plan.tasks[0].id, "in_progress")
    assert update_error.value.status_code == 404


@pytest.mark.asyncio
async def test_start_retest_creates_attempt_and_returns_improvement_retest_session(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())

    retest = await svc.start_retest("student-a", plan.id)

    assert retest.attempt_id
    assert retest.plan.id == plan.id
    assert retest.session.session_type == "improvement_retest"
    assert retest.session.strategy == "improvement_retest"
    assert retest.session.questions[0]["id"] == "q-kp-low"
    attempt = await db_session.get(StudentImprovementRetestAttempt, retest.attempt_id)
    assert attempt is not None
    assert attempt.status == "in_progress"
    assert attempt.question_ids == ["q-kp-low"]


@pytest.mark.asyncio
async def test_start_retest_includes_solution_for_self_review_questions(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(
        db_session,
        ["kp-low"],
        question_type=QuestionType.problem_solving,
        answer="(1) 6 s；(2) 60 m/s",
        explanation="先由位移公式求时间，再用速度公式求结果。",
    )
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())

    retest = await svc.start_retest("student-a", plan.id)

    question = retest.session.questions[0]
    assert question["id"] == "q-kp-low"
    assert question["answer"] == "(1) 6 s；(2) 60 m/s"
    assert question["correct_answer"] == "(1) 6 s；(2) 60 m/s"
    assert question["explanation"] == "先由位移公式求时间，再用速度公式求结果。"


@pytest.mark.asyncio
async def test_start_retest_without_available_questions_returns_stable_error(db_session):
    await seed_students_and_kps(db_session)
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())

    with pytest.raises(HTTPException) as exc_info:
        await svc.start_retest("student-a", plan.id)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == ERR_NO_RETEST_QUESTIONS


@pytest.mark.asyncio
async def test_start_retest_without_ready_tasks_returns_stable_error(db_session):
    await seed_students_and_kps(db_session)
    svc = ImprovementPlanService(db_session)
    plan = await svc.create_from_scope_result("student-a", make_single_task_scope_result())
    plan = await svc.update_task_status("student-a", plan.id, plan.tasks[0].id, "in_progress")

    with pytest.raises(HTTPException) as exc_info:
        await svc.start_retest("student-a", plan.id)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == ERR_NO_TASKS_READY_FOR_RETEST


@pytest.mark.asyncio
async def test_submit_retest_marks_passed_tasks_and_completes_plan(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )

    result = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )

    assert result.correct_count == 1
    assert result.total_count == 1
    assert result.passed_count == 1
    assert result.needs_retest_count == 0
    assert result.task_results[0].passed is True
    assert result.plan.status == "completed"
    assert result.plan.completed_at is not None
    assert result.plan.tasks[0].status == "passed"


@pytest.mark.asyncio
async def test_completed_plan_cannot_be_reopened(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    completed = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.update_task_status("student-a", completed.plan.id, completed.plan.tasks[0].id, "in_progress")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Completed improvement plan cannot be modified"


@pytest.mark.asyncio
async def test_passed_task_cannot_be_reopened_in_partial_plan(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    svc, plan = await make_practiced_plan(db_session, make_two_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    pass_answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    fail_answer = await record_retest_answer(
        db_session,
        question_id="q-kp-mid",
        kp_id="kp-mid",
        is_correct=False,
        mastery=0.4,
    )
    result = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=pass_answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            ),
            schemas.SubmittedDiagnosticAnswer(
                answer_id=fail_answer.id,
                mastery_update={"kp-mid": schemas.MasteryUpdateValue(before=0.35, after=0.4)},
            ),
        ],
    )
    passed_task = next(task for task in result.plan.tasks if task.status == "passed")

    with pytest.raises(HTTPException) as exc_info:
        await svc.update_task_status("student-a", result.plan.id, passed_task.id, "in_progress")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Passed improvement task cannot be reopened"


@pytest.mark.asyncio
async def test_practiced_task_waiting_for_retest_cannot_be_restarted(db_session):
    await seed_students_and_kps(db_session)
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())

    with pytest.raises(HTTPException) as exc_info:
        await svc.update_task_status("student-a", plan.id, plan.tasks[0].id, "in_progress")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Practiced task is waiting for retest"


@pytest.mark.asyncio
async def test_submit_retest_marks_failed_tasks_as_needs_retest(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=False,
        mastery=0.35,
    )

    result = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.35)},
            )
        ],
    )

    assert result.correct_count == 0
    assert result.passed_count == 0
    assert result.needs_retest_count == 1
    assert result.task_results[0].passed is False
    assert result.task_results[0].next_status == "needs_retest"
    assert result.plan.status == "in_progress"
    assert result.plan.current_task_id == result.plan.tasks[0].id
    assert result.plan.tasks[0].status == "needs_retest"


@pytest.mark.asyncio
async def test_needs_retest_task_can_be_started_again(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=False,
        mastery=0.35,
    )
    failed = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.35)},
            )
        ],
    )

    restarted = await svc.update_task_status("student-a", failed.plan.id, failed.plan.tasks[0].id, "in_progress")

    assert restarted.status == "in_progress"
    assert restarted.tasks[0].status == "in_progress"


@pytest.mark.asyncio
async def test_submit_retest_rejects_partial_answers(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    svc, plan = await make_practiced_plan(db_session, make_two_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.submit_retest_feedback(
            "student-a",
            plan.id,
            retest.attempt_id,
            [
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=answer.id,
                    mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
                )
            ],
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Retest submission must include all attempt questions"


@pytest.mark.asyncio
async def test_submit_retest_rejects_duplicate_answers(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    payload_item = schemas.SubmittedDiagnosticAnswer(
        answer_id=answer.id,
        mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.submit_retest_feedback("student-a", plan.id, retest.attempt_id, [payload_item, payload_item])

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Duplicate retest answers are not allowed"


@pytest.mark.asyncio
async def test_submit_retest_rejects_extra_answer_outside_attempt(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-mid",
        kp_id="kp-mid",
        is_correct=True,
        mastery=0.82,
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.submit_retest_feedback(
            "student-a",
            plan.id,
            retest.attempt_id,
            [
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=answer.id,
                    mastery_update={"kp-mid": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
                )
            ],
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Submitted answer does not belong to retest attempt"


@pytest.mark.asyncio
async def test_submit_retest_is_idempotent_for_submitted_attempt(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    payload = [
        schemas.SubmittedDiagnosticAnswer(
            answer_id=answer.id,
            mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
        )
    ]

    first = await svc.submit_retest_feedback("student-a", plan.id, retest.attempt_id, payload)
    second = await svc.submit_retest_feedback("student-a", plan.id, retest.attempt_id, [])

    assert second.attempt_id == first.attempt_id
    assert second.correct_count == first.correct_count
    assert second.task_results == first.task_results
    assert second.plan.status == "completed"


@pytest.mark.asyncio
async def test_retest_attempts_are_isolated_by_student(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)

    with pytest.raises(HTTPException) as start_error:
        await svc.start_retest("student-b", plan.id)
    assert start_error.value.status_code == 404

    with pytest.raises(HTTPException) as submit_error:
        await svc.submit_retest_feedback("student-b", plan.id, retest.attempt_id, [])
    assert submit_error.value.status_code == 404


@pytest.mark.asyncio
async def test_get_improvement_report_returns_completed_report_summary(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    completed = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )

    report = await svc.get_improvement_report("student-a", completed.plan.id)

    assert report.summary.completed is True
    assert report.summary.plan_status == "completed"
    assert report.summary.passed_task_count == 1
    assert report.summary.latest_retest_accuracy == 1.0
    assert report.tasks[0].final_label == "已通过"
    assert report.tasks[0].latest_retest_correct_count == 1
    assert report.tasks[0].latest_retest_passed is True
    assert report.diagnostic_result["feedback"] == "先补一个薄弱点。"
    assert any("提升闭环已完成" in item for item in report.strengths)
    assert report.remaining_weaknesses == []
    assert any("新的章节" in item for item in report.next_actions)


@pytest.mark.asyncio
async def test_get_improvement_report_returns_in_progress_report_with_remaining_weaknesses(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=False,
        mastery=0.35,
    )
    failed = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.35)},
            )
        ],
    )

    report = await svc.get_improvement_report("student-a", failed.plan.id)

    assert report.summary.completed is False
    assert report.summary.plan_status == "in_progress"
    assert report.summary.needs_retest_task_count == 1
    assert report.tasks[0].final_label == "仍需补弱"
    assert report.remaining_weaknesses == ["「坐标系」复测后仍需继续补弱。"]
    assert any("坐标系" in item for item in report.next_actions)


@pytest.mark.asyncio
async def test_get_latest_completed_report_returns_latest_completed_plan_only(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, completed_plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", completed_plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    completed = await svc.submit_retest_feedback(
        "student-a",
        completed_plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )
    active = await svc.create_from_scope_result("student-a", make_scope_result())

    report = await svc.get_latest_completed_report("student-a")

    assert report is not None
    assert report.summary.plan_id == completed.plan.id
    assert report.summary.plan_id != active.id
    assert report.summary.completed is True


@pytest.mark.asyncio
async def test_get_latest_completed_report_respects_scope_filter(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    svc, chapter_plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    chapter_retest = await svc.start_retest("student-a", chapter_plan.id)
    chapter_answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    chapter_completed = await svc.submit_retest_feedback(
        "student-a",
        chapter_plan.id,
        chapter_retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=chapter_answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )

    section_result = make_single_task_scope_result(kp_id="kp-mid", kp_name="参考系")
    section_result.scope_type = "section"
    section_result.scope_id = "第一章 运动的描述||1.1 质点 参考系"
    section_result.scope_name = "1.1 质点 参考系"
    svc, section_plan = await make_practiced_plan(db_session, section_result)
    section_retest = await svc.start_retest("student-a", section_plan.id)
    section_answer = await record_retest_answer(
        db_session,
        question_id="q-kp-mid",
        kp_id="kp-mid",
        is_correct=True,
        mastery=0.82,
    )
    await svc.submit_retest_feedback(
        "student-a",
        section_plan.id,
        section_retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=section_answer.id,
                mastery_update={"kp-mid": schemas.MasteryUpdateValue(before=0.35, after=0.82)},
            )
        ],
    )

    report = await svc.get_latest_completed_report(
        "student-a",
        scope_type="chapter",
        scope_id="第一章 运动的描述",
    )

    assert report is not None
    assert report.summary.plan_id == chapter_completed.plan.id
    assert report.summary.scope_type == "chapter"


@pytest.mark.asyncio
async def test_improvement_report_access_isolated_by_student(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    svc, plan = await make_practiced_plan(db_session, make_single_task_scope_result())
    retest = await svc.start_retest("student-a", plan.id)
    answer = await record_retest_answer(
        db_session,
        question_id="q-kp-low",
        kp_id="kp-low",
        is_correct=True,
        mastery=0.82,
    )
    completed = await svc.submit_retest_feedback(
        "student-a",
        plan.id,
        retest.attempt_id,
        [
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={"kp-low": schemas.MasteryUpdateValue(before=0.2, after=0.82)},
            )
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        await svc.get_improvement_report("student-b", completed.plan.id)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_list_completed_reports_returns_completed_reports_ordered_by_recent_completion(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid", "kp-stable"])
    base = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    _, oldest = await make_completed_single_task_plan(
        db_session,
        kp_id="kp-low",
        kp_name="坐标系",
        completed_at=base,
    )
    _, newest = await make_completed_single_task_plan(
        db_session,
        kp_id="kp-mid",
        kp_name="参考系",
        completed_at=base + timedelta(days=2),
    )
    _, middle = await make_completed_single_task_plan(
        db_session,
        kp_id="kp-stable",
        kp_name="质点",
        completed_at=base + timedelta(days=1),
    )

    reports = await ImprovementPlanService(db_session).list_completed_reports("student-a")

    assert reports.total == 3
    assert [item.plan_id for item in reports.items] == [newest.id, middle.id, oldest.id]
    assert reports.items[0].summary_label == "已完成"
    assert reports.items[0].highlight == "已通过 1/1 个提升任务"
    assert reports.items[0].latest_retest_accuracy == 1.0


@pytest.mark.asyncio
async def test_list_completed_reports_excludes_active_and_ready_for_retest_plans(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    _, completed = await make_completed_single_task_plan(db_session)
    svc = ImprovementPlanService(db_session)
    active = await svc.create_from_scope_result("student-a", make_scope_result())
    ready = await svc.create_from_scope_result(
        "student-a",
        make_single_task_scope_result(kp_id="kp-mid", kp_name="参考系"),
    )
    ready = await svc.update_task_status("student-a", ready.id, ready.tasks[0].id, "practiced")

    reports = await svc.list_completed_reports("student-a")

    assert [item.plan_id for item in reports.items] == [completed.id]
    assert active.id not in [item.plan_id for item in reports.items]
    assert ready.id not in [item.plan_id for item in reports.items]


@pytest.mark.asyncio
async def test_list_completed_reports_supports_pagination_and_total(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid", "kp-stable"])
    base = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    await make_completed_single_task_plan(db_session, kp_id="kp-low", kp_name="坐标系", completed_at=base)
    _, second = await make_completed_single_task_plan(
        db_session,
        kp_id="kp-mid",
        kp_name="参考系",
        completed_at=base + timedelta(days=1),
    )
    await make_completed_single_task_plan(
        db_session,
        kp_id="kp-stable",
        kp_name="质点",
        completed_at=base + timedelta(days=2),
    )

    reports = await ImprovementPlanService(db_session).list_completed_reports(
        "student-a",
        limit=1,
        offset=1,
    )

    assert reports.total == 3
    assert reports.limit == 1
    assert reports.offset == 1
    assert [item.plan_id for item in reports.items] == [second.id]


@pytest.mark.asyncio
async def test_list_completed_reports_clamps_limit_and_offset(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low"])
    _, completed = await make_completed_single_task_plan(db_session)

    reports = await ImprovementPlanService(db_session).list_completed_reports(
        "student-a",
        limit=99,
        offset=-20,
    )

    assert reports.total == 1
    assert reports.limit == 50
    assert reports.offset == 0
    assert [item.plan_id for item in reports.items] == [completed.id]


@pytest.mark.asyncio
async def test_list_completed_reports_respects_scope_filter(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    _, chapter = await make_completed_single_task_plan(db_session, kp_id="kp-low", kp_name="坐标系")
    await make_completed_single_task_plan(
        db_session,
        kp_id="kp-mid",
        kp_name="参考系",
        scope_type="section",
        scope_id="第一章 运动的描述||1.1 质点 参考系",
        scope_name="1.1 质点 参考系",
    )

    reports = await ImprovementPlanService(db_session).list_completed_reports(
        "student-a",
        scope_type="chapter",
        scope_id="第一章 运动的描述",
    )

    assert reports.total == 1
    assert reports.items[0].plan_id == chapter.id
    assert reports.items[0].scope_type == "chapter"


@pytest.mark.asyncio
async def test_list_completed_reports_is_student_isolated(db_session):
    await seed_students_and_kps(db_session)
    await seed_retest_questions(db_session, ["kp-low", "kp-mid"])
    _, student_a_plan = await make_completed_single_task_plan(
        db_session,
        student_id="student-a",
        kp_id="kp-low",
        kp_name="坐标系",
    )
    _, student_b_plan = await make_completed_single_task_plan(
        db_session,
        student_id="student-b",
        kp_id="kp-mid",
        kp_name="参考系",
    )

    reports = await ImprovementPlanService(db_session).list_completed_reports("student-b")

    assert reports.total == 1
    assert reports.items[0].plan_id == student_b_plan.id
    assert reports.items[0].plan_id != student_a_plan.id
