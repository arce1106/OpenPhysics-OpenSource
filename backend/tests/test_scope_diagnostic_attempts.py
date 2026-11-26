from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.student import schemas
from app.api.student.diagnose import diagnose_scope_submitted_feedback
from app.models.improvement import StudentScopeDiagnosticAttempt, StudentScopeDiagnosticKpResult
from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import Student, StudentAnswer, StudentMastery
from app.services.diagnostic_attempt_service import DiagnosticAttemptService
from app.services.improvement_plan_service import ImprovementPlanService
from app.services.knowledge_service import KnowledgeService
from app.services.student_service import StudentService


class AdaptiveStub:
    def __init__(self, db):
        self.db = db


async def seed_scope_data(db_session) -> tuple[StudentAnswer, StudentAnswer]:
    db_session.add_all([
        Student(id="student-a", username="student-a", password_hash="hash", display_name="学生 A", status="active"),
        Student(id="student-b", username="student-b", password_hash="hash", display_name="学生 B", status="active"),
        KnowledgePoint(
            id="kp-a",
            name="质点",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.1 质点 参考系",
        ),
        KnowledgePoint(
            id="kp-b",
            name="坐标系",
            volume="必修 第一册",
            chapter="第一章 运动的描述",
            section="1.2 时间 位移",
        ),
        Question(
            id="q-a",
            stem_text="第一单元题 1",
            answer="A",
            explanation="解析",
            question_type=QuestionType.single_choice,
            quality_status=QualityStatus.approved,
        ),
        Question(
            id="q-b",
            stem_text="第一单元题 2",
            answer="B",
            explanation="解析",
            question_type=QuestionType.single_choice,
            quality_status=QualityStatus.approved,
        ),
        QuestionLabel(question_id="q-a", label_type="knowledge_point", label_id="kp-a", role="主要"),
        QuestionLabel(question_id="q-b", label_type="knowledge_point", label_id="kp-b", role="主要"),
        StudentMastery(
            student_id="student-a",
            knowledge_point_id="kp-a",
            mastery=0.82,
            confidence=1.0,
            attempts=1,
            correct_rate=1.0,
        ),
        StudentMastery(
            student_id="student-a",
            knowledge_point_id="kp-b",
            mastery=0.18,
            confidence=1.0,
            attempts=1,
            correct_rate=0.0,
        ),
    ])
    answer_a = StudentAnswer(
        student_id="student-a",
        question_id="q-a",
        given_answer="A",
        is_correct=True,
        time_spent_ms=1000,
    )
    answer_b = StudentAnswer(
        student_id="student-a",
        question_id="q-b",
        given_answer="A",
        is_correct=False,
        time_spent_ms=1000,
    )
    db_session.add_all([answer_a, answer_b])
    await db_session.commit()
    await db_session.refresh(answer_a)
    await db_session.refresh(answer_b)
    return answer_a, answer_b


def make_scope_result(
    *,
    scope_id: str = "第一章 运动的描述",
    scope_name: str = "第一章 运动的描述",
    weak_kp_ids: list[str] | None = None,
) -> schemas.ScopeDiagnosticResult:
    return schemas.ScopeDiagnosticResult(
        scope_type="chapter",
        scope_id=scope_id,
        scope_name=scope_name,
        correct_count=1,
        total_count=2,
        weak_kp_ids=weak_kp_ids if weak_kp_ids is not None else ["kp-b"],
        recommendation="study",
        feedback=f"{scope_name} 检测反馈",
        kp_results=[
            schemas.ScopeKpResult(
                kp_id="kp-a",
                kp_name="质点",
                correct_count=1,
                total_count=1,
                mastery_before=0.6,
                mastery_after=0.82,
            ),
            schemas.ScopeKpResult(
                kp_id="kp-b",
                kp_name="坐标系",
                correct_count=0,
                total_count=1,
                mastery_before=0.1,
                mastery_after=0.18,
            ),
        ],
    )


@pytest.mark.asyncio
async def test_submitted_scope_diagnostic_creates_attempt(db_session):
    answer_a, answer_b = await seed_scope_data(db_session)

    result = await diagnose_scope_submitted_feedback(
        schemas.SubmittedScopeDiagnosticFeedbackRequest(
            scope_type="chapter",
            scope_id="第一章 运动的描述",
            answers=[
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=answer_a.id,
                    mastery_update={"kp-a": schemas.MasteryUpdateValue(before=0.6, after=0.82, name="质点")},
                ),
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=answer_b.id,
                    mastery_update={"kp-b": schemas.MasteryUpdateValue(before=0.1, after=0.18, name="坐标系")},
                ),
            ],
        ),
        student_id="student-a",
        adaptive_svc=AdaptiveStub(db_session),
        knowledge_svc=KnowledgeService(db_session),
        student_svc=StudentService(db_session),
        attempt_svc=DiagnosticAttemptService(db_session),
    )

    assert result.diagnostic_attempt_id
    attempt = await db_session.get(StudentScopeDiagnosticAttempt, result.diagnostic_attempt_id)
    assert attempt is not None
    assert attempt.student_id == "student-a"
    assert attempt.scope_id == "第一章 运动的描述"
    assert attempt.question_ids == ["q-a", "q-b"]
    assert attempt.answer_ids == [answer_a.id, answer_b.id]
    assert attempt.correct_count == 1
    assert attempt.total_count == 2
    assert attempt.weak_count == 1
    assert attempt.weak_kp_ids == ["kp-b"]

    kp_rows = (
        await db_session.execute(
            select(StudentScopeDiagnosticKpResult)
            .where(StudentScopeDiagnosticKpResult.attempt_id == attempt.id)
            .order_by(StudentScopeDiagnosticKpResult.kp_id)
        )
    ).scalars().all()
    assert [row.kp_id for row in kp_rows] == ["kp-a", "kp-b"]
    assert kp_rows[1].is_weak is True


@pytest.mark.asyncio
async def test_scope_diagnostic_attempt_reuses_same_answer_set(db_session):
    answer_a, answer_b = await seed_scope_data(db_session)
    service = DiagnosticAttemptService(db_session)
    scope_result = make_scope_result()

    first = await service.create_from_scope_result(
        "student-a",
        scope_result,
        question_ids=["q-a", "q-b"],
        answer_ids=[answer_a.id, answer_b.id],
    )
    replay = await service.create_from_scope_result(
        "student-a",
        scope_result,
        question_ids=["q-b", "q-a"],
        answer_ids=[answer_b.id, answer_a.id],
    )

    attempts = (
        await db_session.execute(
            select(StudentScopeDiagnosticAttempt).where(
                StudentScopeDiagnosticAttempt.student_id == "student-a"
            )
        )
    ).scalars().all()
    assert replay.id == first.id
    assert len(attempts) == 1


@pytest.mark.asyncio
async def test_create_improvement_plan_links_existing_attempt(db_session):
    await seed_scope_data(db_session)
    attempt_svc = DiagnosticAttemptService(db_session)
    result = make_scope_result()
    attempt = await attempt_svc.create_from_scope_result("student-a", result, question_ids=["q-a"], answer_ids=[1])
    result.diagnostic_attempt_id = attempt.id

    plan = await ImprovementPlanService(db_session).create_from_scope_result("student-a", result)

    assert plan.diagnostic_attempt_id == attempt.id
    plan_model = await db_session.get(StudentScopeDiagnosticAttempt, attempt.id)
    assert plan_model is not None
    attempts = await attempt_svc.list_attempts("student-a")
    assert attempts.items[0].linked_plan_id == plan.id
    assert attempts.items[0].linked_plan_status == "diagnosed"
    assert attempts.items[0].linked_report_available is False


@pytest.mark.asyncio
async def test_list_attempts_returns_multiple_units_in_reverse_time_order_and_supports_filter(db_session):
    await seed_scope_data(db_session)
    svc = DiagnosticAttemptService(db_session)
    first = await svc.create_from_scope_result("student-a", make_scope_result(scope_name="第一单元"), question_ids=["q-a"], answer_ids=[1])
    first.created_at = datetime.now(timezone.utc) - timedelta(days=1)
    first.submitted_at = datetime.now(timezone.utc) - timedelta(days=1)
    second = await svc.create_from_scope_result(
        "student-a",
        make_scope_result(scope_id="第二章 匀变速直线运动", scope_name="第二单元", weak_kp_ids=["kp-a", "kp-b"]),
        question_ids=["q-b"],
        answer_ids=[2],
    )
    await db_session.commit()

    listed = await svc.list_attempts("student-a")
    assert [item.attempt_id for item in listed.items] == [second.id, first.id]
    assert listed.items[0].scope_name == "第二单元"
    assert listed.items[1].scope_name == "第一单元"

    filtered = await svc.list_attempts("student-a", scope_id="第一章 运动的描述")
    assert [item.attempt_id for item in filtered.items] == [first.id]
    assert filtered.total == 1


@pytest.mark.asyncio
async def test_attempt_detail_returns_full_result_and_kp_results(db_session):
    await seed_scope_data(db_session)
    svc = DiagnosticAttemptService(db_session)
    attempt = await svc.create_from_scope_result("student-a", make_scope_result(), question_ids=["q-a", "q-b"], answer_ids=[1, 2])

    detail = await svc.get_attempt("student-a", attempt.id)

    assert detail.attempt_id == attempt.id
    assert detail.question_ids == ["q-a", "q-b"]
    assert detail.answer_ids == [1, 2]
    assert detail.result["correct_count"] == 1
    assert detail.weak_kp_ids == ["kp-b"]
    assert [row.kp_id for row in detail.kp_results] == ["kp-a", "kp-b"]
    assert detail.kp_results[1].is_weak is True


@pytest.mark.asyncio
async def test_attempt_detail_and_list_are_student_isolated(db_session):
    await seed_scope_data(db_session)
    svc = DiagnosticAttemptService(db_session)
    attempt = await svc.create_from_scope_result("student-a", make_scope_result(), question_ids=["q-a"], answer_ids=[1])

    listed = await svc.list_attempts("student-b")
    assert listed.items == []
    with pytest.raises(HTTPException) as exc:
        await svc.get_attempt("student-b", attempt.id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_improvement_plan_without_attempt_id_creates_attempt_for_old_frontend(db_session):
    await seed_scope_data(db_session)
    result = make_scope_result()

    plan = await ImprovementPlanService(db_session).create_from_scope_result("student-a", result)

    assert plan.diagnostic_attempt_id
    attempt = await db_session.get(StudentScopeDiagnosticAttempt, plan.diagnostic_attempt_id)
    assert attempt is not None
    assert attempt.scope_id == result.scope_id
    assert attempt.result["weak_kp_ids"] == ["kp-b"]
