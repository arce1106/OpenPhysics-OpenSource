from datetime import datetime, timedelta, timezone

import pytest

from app.api.student import schemas
from app.api.student.diagnose import (
    diagnose_kp_submitted_feedback,
    diagnose_scope,
    diagnose_scope_submitted_feedback,
)
from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import Student, StudentAnswer, StudentMastery
from app.services.knowledge_service import KnowledgeService
from app.services.adaptive_service import AdaptiveService
from app.services.diagnostic_attempt_service import DiagnosticAttemptService
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


class AdaptiveStub:
    def __init__(self, db):
        self.db = db


async def seed_submitted_answer(db_session, *, mastery: float = 0.82):
    db_session.add(Student(
        id="student-submitted",
        username="student-submitted",
        password_hash="hash",
        display_name="提交汇总学生",
        status="active",
    ))
    db_session.add(KnowledgePoint(
        id="kp-submitted",
        name="质点",
        volume="必修 第一册",
        chapter="第一章 运动的描述",
        section="1.1 质点 参考系",
    ))
    db_session.add(Question(
        id="q-submitted",
        stem_text="提交后汇总题目",
        answer="A",
        explanation="解析",
        question_type=QuestionType.single_choice,
        difficulty=1.0,
        quality_status=QualityStatus.approved,
    ))
    db_session.add(QuestionLabel(
        question_id="q-submitted",
        label_type="knowledge_point",
        label_id="kp-submitted",
        role="主要",
    ))
    answer = StudentAnswer(
        student_id="student-submitted",
        question_id="q-submitted",
        given_answer="B",
        is_correct=False,
        time_spent_ms=1000,
    )
    db_session.add(answer)
    db_session.add(StudentMastery(
        student_id="student-submitted",
        knowledge_point_id="kp-submitted",
        mastery=mastery,
        confidence=1.0,
        attempts=3,
        correct_rate=0.67,
    ))
    await db_session.commit()
    await db_session.refresh(answer)
    return answer


@pytest.mark.asyncio
async def test_kp_submitted_feedback_does_not_raise_mastery_when_all_answers_are_wrong(db_session):
    answer = await seed_submitted_answer(db_session, mastery=0.82)

    result = await diagnose_kp_submitted_feedback(
        "kp-submitted",
        schemas.SubmittedKpDiagnosticFeedbackRequest(answers=[
            schemas.SubmittedDiagnosticAnswer(
                answer_id=answer.id,
                mastery_update={
                    "kp-submitted": schemas.MasteryUpdateValue(before=0.2, after=0.82, name="质点"),
                },
            ),
        ]),
        student_id="student-submitted",
        adaptive_svc=AdaptiveStub(db_session),
        knowledge_svc=KnowledgeService(db_session),
        student_svc=StudentService(db_session),
    )

    assert result.correct_count == 0
    assert result.total_count == 1
    assert result.mastery_before == 0.2
    assert result.mastery_after == 0.2
    assert result.recommendation == "study"


@pytest.mark.asyncio
async def test_scope_submitted_feedback_does_not_raise_mastery_when_all_answers_are_wrong(db_session):
    answer = await seed_submitted_answer(db_session, mastery=0.65)

    result = await diagnose_scope_submitted_feedback(
        schemas.SubmittedScopeDiagnosticFeedbackRequest(
            scope_type="chapter",
            scope_id="第一章 运动的描述",
            answers=[
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=answer.id,
                    mastery_update={
                        "kp-submitted": schemas.MasteryUpdateValue(before=0.1, after=0.65, name="质点"),
                    },
                ),
            ],
        ),
        student_id="student-submitted",
        adaptive_svc=AdaptiveStub(db_session),
        knowledge_svc=KnowledgeService(db_session),
        student_svc=StudentService(db_session),
        attempt_svc=DiagnosticAttemptService(db_session),
    )

    assert result.correct_count == 0
    assert result.total_count == 1
    assert result.weak_kp_ids == ["kp-submitted"]
    assert result.kp_results[0].mastery_before == 0.1
    assert result.kp_results[0].mastery_after == 0.1
    assert result.recommendation == "study"


@pytest.mark.asyncio
async def test_scope_submitted_feedback_keeps_blank_wrong_mastery_at_zero(db_session):
    db_session.add(Student(
        id="student-blank-scope",
        username="student-blank-scope",
        password_hash="hash",
        display_name="白卷学生",
        status="active",




    ))
    await db_session.commit()

    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "kp-blank-scope",
        "name": "静摩擦力",
        "volume": "必修 第一册",
        "chapter": "第三章 相互作用",
        "section": "3.2 摩擦力",
    })
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q-blank-scope",
        "stem_text": "静摩擦力白卷提交测试题",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 2.0,
        "source": "human",
        "options": [
            {"label": "A", "text": "正确", "is_correct": True},
            {"label": "B", "text": "错误", "is_correct": False},
        ],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "kp-blank-scope", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q-blank-scope", QualityStatus.approved)

    adaptive_svc = AdaptiveService(db_session)
    submitted = await adaptive_svc.submit_answer("student-blank-scope", "q-blank-scope", "", 1000)

    result = await diagnose_scope_submitted_feedback(
        schemas.SubmittedScopeDiagnosticFeedbackRequest(
            scope_type="chapter",
            scope_id="第三章 相互作用",
            answers=[
                schemas.SubmittedDiagnosticAnswer(
                    answer_id=submitted["answer_id"],
                    mastery_update={
                        "kp-blank-scope": schemas.MasteryUpdateValue(
                            before=0.0,
                            after=0.0,
                            name="静摩擦力",
                        ),
                    },
                ),
            ],
        ),
        student_id="student-blank-scope",
        adaptive_svc=adaptive_svc,
        knowledge_svc=kp_svc,
        student_svc=StudentService(db_session),
        attempt_svc=DiagnosticAttemptService(db_session),
    )

    assert result.correct_count == 0
    assert result.total_count == 1
    assert result.kp_results[0].mastery_before == 0.0
    assert result.kp_results[0].mastery_after == 0.0
    assert result.weak_kp_ids == ["kp-blank-scope"]
    assert result.recommendation == "study"


@pytest.mark.asyncio
async def test_scope_diagnostic_deduplicates_questions_shared_by_multiple_kps(db_session):
    db_session.add(Student(id="trial-student", username="trial-student", password_hash="unused", display_name="测试学生", status="active"))
    await db_session.commit()
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "scope-kp-a",
        "name": "位移",
        "volume": "必修 第一册",
        "chapter": "第一章 运动的描述",
        "section": "1.1 质点 参考系",
    })
    await kp_svc.create_point({
        "id": "scope-kp-b",
        "name": "速度",
        "volume": "必修 第一册",
        "chapter": "第一章 运动的描述",
        "section": "1.1 质点 参考系",
    })
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "scope-shared-question",
        "stem_text": "同一道综合题同时关联两个知识点",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "source": "human",
        "options": [
            {"label": "A", "text": "正确"},
            {"label": "B", "text": "错误"},
        ],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "scope-kp-a", "role": "主要"},
            {"label_type": "knowledge_point", "label_id": "scope-kp-b", "role": "次要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("scope-shared-question", QualityStatus.approved)

    result = await diagnose_scope(
        schemas.ScopeDiagnoseRequest(
            scope_type="chapter",
            scope_id="第一章 运动的描述",
            question_count=4,
        ),
        student_id="trial-student",
        adaptive_svc=AdaptiveService(db_session),
        knowledge_svc=kp_svc,
        question_svc=q_svc,
        student_svc=StudentService(db_session),
    )

    question_ids = [question["id"] for question in result["questions"]]
    assert question_ids == ["scope-shared-question"]


@pytest.mark.asyncio
async def test_scope_diagnostic_includes_solution_for_self_review_questions(db_session):
    db_session.add(Student(
        id="student-scope-self-review",
        username="student-scope-self-review",
        password_hash="hash",
        display_name="范围自评学生",
        status="active",




    ))
    await db_session.commit()

    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "scope-self-review-kp",
        "name": "力的合成",
        "volume": "必修 第一册",
        "chapter": "第三章 相互作用",
        "section": "3.4 力的合成和分解",
    })
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "scope-self-review-question",
        "stem_text": "如图所示，求两绳拉力的合力及 OB 绳拉力大小。",
        "answer": "合力 1000 N，OB 绳拉力 2000 N",
        "explanation": "先画力的平行四边形，再由三角函数求 OB 绳拉力。",
        "question_type": "problem_solving",
        "difficulty": 3.0,
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "scope-self-review-kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("scope-self-review-question", QualityStatus.approved)

    result = await diagnose_scope(
        schemas.ScopeDiagnoseRequest(
            scope_type="chapter",
            scope_id="第三章 相互作用",
            question_count=1,
        ),
        student_id="student-scope-self-review",
        adaptive_svc=AdaptiveService(db_session),
        knowledge_svc=kp_svc,
        question_svc=q_svc,
        student_svc=StudentService(db_session),
    )

    question = result["questions"][0]
    assert question["id"] == "scope-self-review-question"
    assert question["answer"] == "合力 1000 N，OB 绳拉力 2000 N"
    assert question["correct_answer"] == "合力 1000 N，OB 绳拉力 2000 N"
    assert question["explanation"] == "先画力的平行四边形，再由三角函数求 OB 绳拉力。"
