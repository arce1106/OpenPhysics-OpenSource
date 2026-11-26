import pytest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from sqlalchemy import func, select
from app.models.student import ItemStats, Student, StudentAnswer
from app.services.adaptive_service import AdaptiveService
from app.services.knowledge_service import KnowledgeService
from app.services.question_service import QuestionService
from app.models.question import QualityStatus
from tests.practicable import seed_practicable


async def _create_subscribed_student(db_session, student_id):
    """Selection tests need an explicit entitlement, not an unknown identity."""
    now = datetime.now(timezone.utc)
    db_session.add(Student(
        id=student_id, username=student_id, display_name='测试', password_hash='!test-only',
        status='active',


    ))
    await db_session.commit()


@pytest.mark.parametrize(
    ("question_type", "given_answer", "correct_answer", "expected"),
    [
        ("single_choice", "B", "答案：B", True),
        ("single_choice", "C", "（C）", True),
        ("single_choice", "C", "C项", True),
        ("single_choice", "D", "故选D。", True),
        ("single_choice", "A", "B", False),
        ("multiple_choice", "BD", "故选DB", True),
        ("multiple_choice", "A、C", "AC", True),
    ],
)
def test_choice_answer_normalization_extracts_option_labels(
    question_type,
    given_answer,
    correct_answer,
    expected,
):
    assert AdaptiveService._answers_equal(question_type, given_answer, correct_answer) is expected


@pytest.mark.parametrize("question_type", ["fill_in_blank", "knowledge_fill_in_blank"])
def test_serialize_question_includes_solution_for_fill_self_review(question_type):
    question = SimpleNamespace(
        id=f"q_{question_type}",
        stem_text="填写答案",
        answer="标准答案",
        explanation="标准解析",
        question_type=SimpleNamespace(value=question_type),
        difficulty=2.0,
        difficulty_tier=None,
        labels=[SimpleNamespace(label_type="knowledge_point", label_id="fill_kp")],
        options=[],
        images=[],
        session_phase=None,
    )

    serialized = AdaptiveService._serialize_question(question)

    assert serialized["answer"] == "标准答案"
    assert serialized["correct_answer"] == "标准答案"
    assert serialized["explanation"] == "标准解析"
    assert serialized["target_knowledge_point_id"] == "fill_kp"


@pytest.mark.asyncio
async def test_submit_answer_triggers_mastery_update(db_session):
    # Setup knowledge point
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "v1c3s1k01", "name": "力"})

    # Setup question
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_adapt_1",
        "stem_text": "测试题目",
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
            {"label_type": "knowledge_point", "label_id": "v1c3s1k01", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_adapt_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_answer("student_1", "q_adapt_1", "A", 30000)
    assert result["is_correct"] is True
    assert isinstance(result["answer_id"], int)
    assert "v1c3s1k01" in result["mastery_update"]

    # Verify mastery was recorded
    mastery = await svc.student_svc.get_mastery("student_1", "v1c3s1k01")
    assert mastery is not None
    assert mastery.mastery > 0  # Should have increased from 0
    assert mastery.attempts == 1


@pytest.mark.parametrize(
    ("given", "credit"),
    [("ACD", 1.0), ("AC", 0.5), ("故选D", 0.5), ("AB", 0.0), ("ABCD", 0.0), ("", 0.0)],
)
def test_multiple_choice_follows_the_gaokao_rule(given, credit):
    from app.services.choice_scoring import multiple_choice_credit, normalize_choice_answer
    key = normalize_choice_answer("A、C、D", "multiple_choice")
    assert multiple_choice_credit(key, normalize_choice_answer(given, "multiple_choice")) == credit


@pytest.mark.asyncio
async def test_incomplete_multiple_choice_earns_half_credit(db_session):
    await KnowledgeService(db_session).create_point({"id": "v1c3s1k01", "name": "力"})
    q_svc = QuestionService(db_session)
    for qid in ("q_multi_partial", "q_multi_wrong"):
        await q_svc.create_question({
            "id": qid, "stem_text": "多选题", "answer": "AC", "explanation": "解析",
            "question_type": "multiple_choice", "difficulty": 2.0, "source": "human",
            "options": [{"label": label, "text": label, "is_correct": label in "AC"} for label in "ABCD"],
            "labels": [{"label_type": "knowledge_point", "label_id": "v1c3s1k01", "role": "主要"}],
            "formulas": [], "images": [],
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    svc = AdaptiveService(db_session)
    partial = await svc.submit_answer("student_partial", "q_multi_partial", "A", 30000)
    wrong = await svc.submit_answer("student_wrong", "q_multi_wrong", "AB", 30000)

    # Still not fully correct (it stays among the mistakes), but explained and half credited.
    assert partial["is_correct"] is False and "少选" in partial["ai_feedback"]
    assert "少选" not in (wrong["ai_feedback"] or "")
    partial_mastery = await svc.student_svc.get_mastery("student_partial", "v1c3s1k01")
    wrong_mastery = await svc.student_svc.get_mastery("student_wrong", "v1c3s1k01")
    assert partial_mastery.correct_rate == 0.5 and wrong_mastery.correct_rate == 0.0
    assert partial_mastery.mastery > wrong_mastery.mastery


@pytest.mark.asyncio
async def test_multi_label_answer_uses_explicit_target_and_primary_fallback(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "kp_secondary", "name": "板块模型"})
    await kp_svc.create_point({"id": "kp_primary", "name": "临界条件分析"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_multi_label_target",
        "stem_text": "多标签题应更新本次练习目标",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 2.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [
            {
                "label_type": "knowledge_point",
                "label_id": "kp_secondary",
                "role": "次要",
                "confidence": 1.0,
            },
            {
                "label_type": "knowledge_point",
                "label_id": "kp_primary",
                "role": "主要",
                "confidence": 1.0,
            },
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_multi_label_target", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    fallback = await svc.submit_answer(
        "student_primary_fallback",
        "q_multi_label_target",
        "A",
        1000,
    )
    explicit = await svc.submit_answer(
        "student_explicit_target",
        "q_multi_label_target",
        "A",
        1000,
        target_knowledge_point_id="kp_secondary",
    )

    assert list(fallback["mastery_update"]) == ["kp_primary"]
    assert list(explicit["mastery_update"]) == ["kp_secondary"]
    fallback_answer = await svc.student_svc.get_answer(
        "student_primary_fallback",
        fallback["answer_id"],
    )
    explicit_answer = await svc.student_svc.get_answer(
        "student_explicit_target",
        explicit["answer_id"],
    )
    assert fallback_answer.grading_result["_evidence_knowledge_point_id"] == "kp_primary"
    assert explicit_answer.grading_result["_evidence_knowledge_point_id"] == "kp_secondary"


@pytest.mark.asyncio
async def test_multi_label_answer_rejects_unlinked_target(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "kp_linked", "name": "已关联知识点"})
    await kp_svc.create_point({"id": "kp_unlinked", "name": "未关联知识点"})
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_reject_unlinked_target",
        "stem_text": "拒绝未关联目标",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 2.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "kp_linked", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_reject_unlinked_target", QualityStatus.approved)

    with pytest.raises(ValueError, match="is not linked"):
        await AdaptiveService(db_session).submit_answer(
            "student_unlinked",
            "q_reject_unlinked_target",
            "A",
            1000,
            target_knowledge_point_id="kp_unlinked",
        )


@pytest.mark.asyncio
async def test_blank_wrong_answer_does_not_create_positive_mastery(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "blank_answer_kp", "name": "空白答案知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_blank_answer_1",
        "stem_text": "空白提交测试题",
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
            {"label_type": "knowledge_point", "label_id": "blank_answer_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_blank_answer_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_answer("student_blank_answer", "q_blank_answer_1", "", 30000)
    mastery = await svc.student_svc.get_mastery("student_blank_answer", "blank_answer_kp")

    assert result["is_correct"] is False
    assert mastery is not None
    assert mastery.attempts == 1
    assert mastery.correct_rate == 0.0
    assert mastery.mastery == 0.0
    assert result["mastery_update"]["blank_answer_kp"]["before"] == 0.0
    assert result["mastery_update"]["blank_answer_kp"]["after"] == 0.0


@pytest.mark.asyncio
async def test_submit_answer_includes_grading_trust_fields(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "trust_kp", "name": "可信批改知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_trust_1",
        "stem_text": "写出速度公式",
        "answer": "v=v0+at",
        "explanation": "解析",
        "question_type": "problem_solving",
        "difficulty": 2.0,
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "trust_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_trust_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "student_trust",
        "q_trust_1",
        "v=v0+at",
        30000,
        judged_is_correct=True,
        judged_feedback="公式正确。",
        judged_grading={
            "is_correct": True,
            "extracted_answer": "v=v0+at",
            "confidence": 0.91,
            "grading_basis": "公式、符号和适用关系都正确。",
            "step_scores": [
                {"name": "公式选择", "score": 2, "max_score": 2, "comment": "公式正确"},
            ],
            "error_type": "none",
        },
    )

    grading = result["process_grading"]
    assert grading["grading_confidence"] == 0.91
    assert grading["confidence_level"] == "high"
    assert grading["needs_human_review"] is False
    assert grading["grading_basis"] == "公式、符号和适用关系都正确。"
    assert grading["step_scores"][0]["name"] == "公式选择"


@pytest.mark.asyncio
async def test_submit_answer_uses_process_score_for_non_choice_mastery(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "partial_score_kp", "name": "部分得分知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_partial_score_1",
        "stem_text": "解答题，写出完整过程",
        "answer": "完整答案",
        "explanation": "解析",
        "question_type": "problem_solving",
        "difficulty": 2.0,
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "partial_score_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_partial_score_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "student_partial_score",
        "q_partial_score_1",
        "列式正确但计算不完整",
        30000,
        judged_is_correct=False,
        judged_feedback="部分正确，计算过程不完整。",
        judged_grading={
            "is_correct": False,
            "process_score": 60,
            "feedback": "部分正确，计算过程不完整。",
            "step_scores": [
                {"name": "建模", "score": 2, "max_score": 2, "comment": "模型正确"},
                {"name": "计算", "score": 1, "max_score": 3, "comment": "计算不完整"},
            ],
        },
    )
    mastery = await svc.student_svc.get_mastery("student_partial_score", "partial_score_kp")

    assert result["is_correct"] is False
    assert result["process_grading"]["process_score"] == 60
    assert mastery is not None
    assert mastery.attempts == 1
    assert mastery.correct_rate == 0.6
    assert result["mastery_update"]["partial_score_kp"]["after"] > 0


@pytest.mark.asyncio
async def test_submit_answer_returns_explanation_fallback_when_question_has_no_explanation(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "fallback_explanation_kp", "name": "解析兜底知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_fallback_explanation_1",
        "stem_text": "没有解析的选择题",
        "answer": "A",
        "explanation": None,
        "question_type": "single_choice",
        "difficulty": 1.0,
        "source": "human",
        "options": [
            {"label": "A", "text": "正确"},
            {"label": "B", "text": "错误"},
        ],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "fallback_explanation_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_fallback_explanation_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_answer("student_fallback_explanation", "q_fallback_explanation_1", "B", 30000)

    assert result["explanation"]
    assert "暂无详细解析" in result["explanation"]


@pytest.mark.asyncio
async def test_manual_correction_updates_original_answer_and_recomputes_mastery(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "correct_kp", "name": "人工纠错知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_correct_1",
        "stem_text": "选择正确答案",
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
            {"label_type": "knowledge_point", "label_id": "correct_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_correct_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    # Only AI-read answers can be disputed; tapped options are graded by comparison.
    wrong = await svc.submit_answer(
        "student_correct", "q_correct_1", "B", 30000,
        judged_is_correct=False, judged_feedback="识别为 B",
        judged_grading={"extracted_answer": "B", "is_correct": False, "confidence": 0.9, "answer_source": "photo"},
    )
    before = await svc.student_svc.get_mastery("student_correct", "correct_kp")
    before_value = before.mastery if before else 0.0

    corrected = await svc.student_svc.apply_manual_correction(
        student_id="student_correct",
        answer_id=wrong["answer_id"],
        corrected_answer="A",
        is_correct=True,
        correction_reason="AI 识别错了，纸面答案实际为 A",
    )
    after = await svc.student_svc.get_mastery("student_correct", "correct_kp")
    answer = await svc.student_svc.get_answer("student_correct", wrong["answer_id"])

    assert corrected["answer_id"] == wrong["answer_id"]
    assert corrected["is_correct"] is True
    assert answer is not None
    assert answer.given_answer == "A"
    assert answer.is_correct is True
    assert answer.misconception_ids == []
    assert answer.grading_result["manual_correction"]["reason"] == "AI 识别错了，纸面答案实际为 A"
    assert after is not None and before is not None
    assert after.attempts == 1
    assert after.mastery > before_value


@pytest.mark.asyncio
async def test_submit_self_review_records_fractional_process_result(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "self_review_kp", "name": "自评知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_self_review_1",
        "stem_text": "计算：(1)时间；(2)速度",
        "answer": "(1)6 s　(2)60 m/s",
        "explanation": "先由 h=1/2gt^2 求时间，再由 v=gt 求速度。",
        "question_type": "problem_solving",
        "difficulty": 2.0,
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "self_review_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_self_review_1", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    before = await svc.student_svc.get_mastery("student_self_review", "self_review_kp")
    result = await svc.submit_self_review(
        student_id="student_self_review",
        question_id="q_self_review_1",
        items=[
            {"label": "(1)", "status": "correct"},
            {"label": "(2)", "status": "partial"},
        ],
        time_spent_ms=120000,
    )
    after = await svc.student_svc.get_mastery("student_self_review", "self_review_kp")
    answer = await svc.student_svc.get_answer("student_self_review", result["answer_id"])

    assert result["is_correct"] is False
    assert result["correct_answer"] == "(1)6 s　(2)60 m/s"
    assert result["explanation"] == "先由 h=1/2gt^2 求时间，再由 v=gt 求速度。"
    assert result["process_grading"]["answer_source"] == "self_review"
    assert result["process_grading"]["process_score"] == 75
    assert result["process_grading"]["needs_human_review"] is True
    assert result["process_grading"]["step_scores"][0]["score"] == 2
    assert result["process_grading"]["step_scores"][1]["score"] == 1
    assert answer is not None
    assert answer.given_answer == "自评：(1)完全正确；(2)部分正确"
    assert after is not None
    assert after.mastery != (before.mastery if before else 0.0)


@pytest.mark.asyncio
async def test_submit_self_review_rejects_choice_questions(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "self_review_choice_kp", "name": "自评选择题知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_self_review_choice",
        "stem_text": "下列说法正确的是",
        "answer": "A",
        "explanation": "选择题应按选项直接批改。",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "source": "human",
        "options": [
            {"label": "A", "text": "正确"},
            {"label": "B", "text": "错误"},
        ],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "self_review_choice_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_self_review_choice", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    with pytest.raises(ValueError, match="Self review is not supported"):
        await svc.submit_self_review(
            student_id="student_self_review_choice",
            question_id="q_self_review_choice",
            items=[{"label": "整题", "status": "correct"}],
            time_spent_ms=1000,
        )


@pytest.mark.asyncio
async def test_submit_self_review_allows_regular_fill_blank(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "self_review_fill_kp", "name": "普通填空知识点"})

    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_self_review_fill",
        "stem_text": "填写：(1)结果；(2)单位",
        "answer": "(1)20　(2)N",
        "explanation": "先计算结果，再填写单位。",
        "question_type": "fill_in_blank",
        "difficulty": 2.0,
        "source": "human",
        "options": [],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "self_review_fill_kp", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_self_review_fill", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    result = await svc.submit_self_review(
        student_id="student_self_review_fill",
        question_id="q_self_review_fill",
        items=[
            {"label": "(1)", "status": "partial"},
            {"label": "(2)", "status": "wrong"},
        ],
        time_spent_ms=1000,
    )

    assert result["process_grading"]["answer_source"] == "self_review"


@pytest.mark.asyncio
async def test_get_practice_session_filters_by_mastery(db_session):
    await _create_subscribed_student(db_session, 'student_new')
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "test_c1s1k01", "name": "A"})
    await kp_svc.create_point({"id": "test_c1s1k02", "name": "B"})

    # Setup question for kp_a
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_a", "stem_text": "Test A", "answer": "A", "explanation": "",
        "question_type": "problem_solving", "difficulty": 1.0, "source": "human",
        "options": [], "labels": [{"label_type": "knowledge_point", "label_id": "test_c1s1k01"}],
        "formulas": [], "images": [],
    })
    await q_svc.review_question("q_a", QualityStatus.approved)

    svc = AdaptiveService(db_session)
    session = await svc.get_practice_session("student_new", None, count=5)
    assert session["student_id"] == "student_new"
    assert len(session["questions"]) > 0


@pytest.mark.asyncio
async def test_get_practice_session_orders_questions_for_student_flow(db_session):
    await _create_subscribed_student(db_session, 'student_order')
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "order_c1s1k01", "name": "排序知识点"})
    q_svc = QuestionService(db_session)

    async def create_question(qid: str, question_type: str, difficulty: float, has_options: bool = False):
        options = [
            {"label": "A", "text": "选项A", "is_correct": True},
            {"label": "B", "text": "选项B", "is_correct": False},
        ] if has_options else []
        await q_svc.create_question({
            "id": qid,
            "stem_text": qid,
            "answer": "A",
            "explanation": "",
            "question_type": question_type,
            "difficulty": difficulty,
            "source": "human",
            "options": options,
            "labels": [{"label_type": "knowledge_point", "label_id": "order_c1s1k01"}],
            "formulas": [],
            "images": [],
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    await create_question("q_order_solve", "problem_solving", 1.0)
    await create_question("q_order_choice", "single_choice", 5.0, has_options=True)
    await create_question("q_order_fill", "fill_in_blank", 2.0)
    await create_question("q_order_experiment", "experiment", 1.5)

    svc = AdaptiveService(db_session)
    session = await svc.get_practice_session("student_order", "order_c1s1k01", count=4)

    assert [q["id"] for q in session["questions"]] == [
        "q_order_choice",
        "q_order_experiment",
        "q_order_fill",
        "q_order_solve",
    ]


@pytest.mark.asyncio
async def test_get_practice_session_excludes_recently_answered_assessment_questions(db_session):
    await _create_subscribed_student(db_session, 'student_repeat_guard')
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "repeat_guard_kp", "name": "防重复知识点"})
    q_svc = QuestionService(db_session)

    async def create_question(qid: str):
        await q_svc.create_question({
            "id": qid,
            "stem_text": qid,
            "answer": "A",
            "explanation": "",
            "question_type": "single_choice",
            "difficulty": 1.0,
            "source": "human",
            "options": [
                {"label": "A", "text": "正确", "is_correct": True},
                {"label": "B", "text": "错误", "is_correct": False},
            ],
            "labels": [{"label_type": "knowledge_point", "label_id": "repeat_guard_kp"}],
            "formulas": [],
            "images": [],
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    await create_question("q_repeat_1")
    await create_question("q_repeat_2")
    await create_question("q_repeat_3")

    svc = AdaptiveService(db_session)
    await svc.student_svc.record_answer("student_repeat_guard", "q_repeat_1", "A", True, 30000)

    session = await svc.get_practice_session("student_repeat_guard", "repeat_guard_kp", count=2)

    assert [q["id"] for q in session["questions"]] == ["q_repeat_2", "q_repeat_3"]


@pytest.mark.asyncio
async def test_get_practice_session_allows_wrong_questions_after_cooldown(db_session):
    await _create_subscribed_student(db_session, 'student_wrong_cooldown')
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "repeat_wrong_kp", "name": "错题间隔复习知识点"})
    q_svc = QuestionService(db_session)

    async def create_question(qid: str):
        await q_svc.create_question({
            "id": qid,
            "stem_text": qid,
            "answer": "A",
            "explanation": "",
            "question_type": "single_choice",
            "difficulty": 1.0,
            "source": "human",
            "options": [
                {"label": "A", "text": "正确", "is_correct": True},
                {"label": "B", "text": "错误", "is_correct": False},
            ],
            "labels": [{"label_type": "knowledge_point", "label_id": "repeat_wrong_kp"}],
            "formulas": [],
            "images": [],
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    await create_question("q_correct_old")
    await create_question("q_fresh_1")
    await create_question("q_fresh_2")
    await create_question("q_wrong_old")

    svc = AdaptiveService(db_session)
    correct_answer = await svc.student_svc.record_answer("student_wrong_cooldown", "q_correct_old", "A", True, 30000)
    wrong_answer = await svc.student_svc.record_answer("student_wrong_cooldown", "q_wrong_old", "B", False, 30000)
    two_days_ago = datetime.now(timezone.utc) - timedelta(days=2)
    correct_answer.created_at = two_days_ago
    wrong_answer.created_at = two_days_ago
    await db_session.commit()

    session = await svc.get_practice_session("student_wrong_cooldown", "repeat_wrong_kp", count=3)

    assert [q["id"] for q in session["questions"]] == ["q_fresh_1", "q_fresh_2", "q_wrong_old"]


@pytest.mark.asyncio
async def test_get_practice_session_applies_final_student_order_after_router(db_session):
    class StubRouter:
        async def select_session(self, **kwargs):
            return [
                make_question("q_final_solve", "problem_solving", 1.0, "challenge"),
                make_question("q_final_fill", "fill_in_blank", 2.0, "targeted_repair"),
                make_question("q_final_choice", "single_choice", 5.0, "warmup"),
            ]

    def make_question(qid: str, question_type: str, difficulty: float, phase: str):
        return SimpleNamespace(
            id=qid,
            stem_text=qid,
            answer="A",
            explanation="",
            question_type=SimpleNamespace(value=question_type),
            difficulty=difficulty,
            difficulty_tier=None,
            labels=[
                SimpleNamespace(label_type="knowledge_point", label_id="order_final_kp"),
            ],
            options=[],
            images=[],
            session_phase=phase,
        )

    svc = AdaptiveService(db_session)
    svc.router = StubRouter()

    session = await svc.get_practice_session("student_final_order", "order_final_kp", count=3)

    assert [q["id"] for q in session["questions"]] == [
        "q_final_choice",
        "q_final_fill",
        "q_final_solve",
    ]


@pytest.mark.asyncio
async def test_get_practice_session_deduplicates_questions_across_target_kps(db_session):
    class StubRouter:
        async def select_session(self, **kwargs):
            kp_id = kwargs["kp_id"]
            return [
                make_question("q_shared_across_kps", "single_choice", 1.0, kp_id),
                make_question(f"q_unique_{kp_id}", "single_choice", 2.0, kp_id),
            ]

    def make_question(qid: str, question_type: str, difficulty: float, kp_id: str):
        return SimpleNamespace(
            id=qid,
            stem_text=qid,
            answer="A",
            explanation="",
            question_type=SimpleNamespace(value=question_type),
            difficulty=difficulty,
            difficulty_tier=None,
            labels=[
                SimpleNamespace(label_type="knowledge_point", label_id=kp_id),
            ],
            options=[
                SimpleNamespace(label="A", text="正确"),
                SimpleNamespace(label="B", text="错误"),
            ],
            images=[],
            session_phase="mixed_practice",
        )

    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "dedup_kp_1", "name": "去重知识点一"})
    await kp_svc.create_point({"id": "dedup_kp_2", "name": "去重知识点二"})
    await seed_practicable(db_session, "dedup_kp_1", "dedup_kp_2")

    svc = AdaptiveService(db_session)
    svc.router = StubRouter()

    session = await svc.get_practice_session("student_dedup_session", None, count=4)
    ids = [question["id"] for question in session["questions"]]

    assert ids.count("q_shared_across_kps") == 1
    assert len(ids) == len(set(ids))


@pytest.mark.asyncio
async def test_get_variation_questions_prefers_surface_match_over_same_kp_long_response(db_session):
    q_svc = QuestionService(db_session)

    async def create_question(
        qid: str,
        question_type: str,
        kp_id: str,
        structure: str,
        stem: str,
        ability: str = "apply",
        strategy: str = "formula_application",
    ) -> None:
        await q_svc.create_question({
            "id": qid,
            "stem_text": stem,
            "answer": "A",
            "explanation": "解析",
            "question_type": question_type,
            "difficulty": 1.5,
            "difficulty_tier": "easy",
            "source": "human",
            "options": [],
            "labels": [
                {"label_type": "knowledge_point", "label_id": kp_id, "role": "主要"},
                {"label_type": "question_type", "label_id": question_type, "role": "主要"},
                {"label_type": "physics_model", "label_id": "velocity_acceleration", "role": "主要"},
                {"label_type": "question_structure", "label_id": structure, "role": "主要"},
                {"label_type": "ability_dimension", "label_id": ability, "role": "主要"},
                {"label_type": "solution_strategy", "label_id": strategy, "role": "主要"},
            ],
            "formulas": [],
            "images": (
                [{"id": f"{qid}_img", "image_path": "/static/questions/example.png", "image_type": "stem"}]
                if question_type == "experiment"
                else []
            ),
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    await create_question(
        "q_variation_original_experiment",
        "experiment",
        "free_fall_kp",
        "experiment",
        "用打点计时器研究自由落体运动。",
    )
    await create_question(
        "q_variation_bad_long",
        "problem_solving",
        "free_fall_kp",
        "multi_step",
        "小球从高处自由落下，求落地时间和速度。",
    )
    await create_question(
        "q_variation_bad_choice",
        "single_choice",
        "free_fall_kp",
        "single_concept",
        "关于自由落体运动，下列说法正确的是。",
        ability="understand",
        strategy="concept_analysis",
    )
    await create_question(
        "q_variation_experiment_match",
        "experiment",
        "timer_experiment_kp",
        "experiment",
        "用纸带和打点计时器测量匀变速直线运动。",
    )

    svc = AdaptiveService(db_session)
    answer = await svc.student_svc.record_answer(
        "student_variation_surface",
        "q_variation_original_experiment",
        "",
        False,
        30000,
    )

    variations = await svc.get_variation_questions(
        "student_variation_surface",
        answer.id,
        limit=1,
    )

    assert variations
    assert variations[0]["question"]["id"] == "q_variation_experiment_match"


@pytest.mark.asyncio
async def test_get_practice_session_uses_multidimensional_profile(db_session):
    await _create_subscribed_student(db_session, 'student_profile_route')
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "profile_route_kp", "name": "多维画像知识点"})
    q_svc = QuestionService(db_session)

    async def create_profile_question(qid: str, model: str, ability: str, structure: str, strategy: str):
        await q_svc.create_question({
            "id": qid,
            "stem_text": qid,
            "answer": "A",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty_tier": "medium",
            "source": "human",
            "options": [
                {"label": "A", "text": "正确", "is_correct": True},
                {"label": "B", "text": "错误", "is_correct": False},
            ],
            "labels": [
                {"label_type": "knowledge_point", "label_id": "profile_route_kp", "role": "主要"},
                {"label_type": "physics_model", "label_id": model, "role": "主要"},
                {"label_type": "ability_dimension", "label_id": ability, "role": "主要"},
                {"label_type": "question_structure", "label_id": structure, "role": "主要"},
                {"label_type": "solution_strategy", "label_id": strategy, "role": "主要"},
            ],
            "formulas": [],
            "images": [],
        })
        await q_svc.review_question(qid, QualityStatus.approved)

    await create_profile_question("q_profile_prior_wrong", "uniform_acceleration", "analyze", "multi_step", "formula_application")
    await create_profile_question("q_profile_matching", "uniform_acceleration", "analyze", "multi_step", "formula_application")
    await create_profile_question("q_profile_unrelated", "particle", "understand", "single_concept", "concept_analysis")

    svc = AdaptiveService(db_session)
    await svc.student_svc.record_answer("student_profile_route", "q_profile_prior_wrong", "B", False, 30000)

    session = await svc.get_practice_session("student_profile_route", "profile_route_kp", count=1)

    assert session["questions"][0]["id"] == "q_profile_matching"
    assert session["questions"][0]["session_phase"] == "targeted_repair"
    assert session["session_structure"]["phases"] == [
        {"phase": "targeted_repair", "question_indices": [0]},
    ]
    assert session["learner_profile"]["focus_labels"][0]["label_type"] == "knowledge_point"
    assert any(
        label["label_type"] == "physics_model" and label["label_id"] == "uniform_acceleration"
        for label in session["learner_profile"]["focus_labels"]
    )


@pytest.mark.asyncio
async def test_submit_answer_is_idempotent_for_same_submission_id(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "idempotent_kp", "name": "幂等知识点"})
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_idempotent",
        "stem_text": "幂等提交测试",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 2.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [{"label_type": "knowledge_point", "label_id": "idempotent_kp", "role": "主要"}],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_idempotent", QualityStatus.approved)
    svc = AdaptiveService(db_session)

    first = await svc.submit_answer(
        "student_idempotent", "q_idempotent", "A", 1000, submission_id="submission-1"
    )
    second = await svc.submit_answer(
        "student_idempotent", "q_idempotent", "A", 1000, submission_id="submission-1"
    )

    mastery = await svc.student_svc.get_mastery("student_idempotent", "idempotent_kp")
    answer_count = await db_session.scalar(
        select(func.count()).select_from(StudentAnswer).where(
            StudentAnswer.student_id == "student_idempotent"
        )
    )
    stats = await db_session.get(ItemStats, "q_idempotent")
    assert second["answer_id"] == first["answer_id"]
    assert second["mastery_update"] == first["mastery_update"]
    assert second["idempotent_replay"] is True
    assert mastery.attempts == 1
    assert answer_count == 1
    assert stats.total_attempts == 1


@pytest.mark.asyncio
async def test_submit_answer_rolls_back_mastery_and_answer_when_stats_fail(db_session, monkeypatch):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({"id": "atomic_kp", "name": "事务知识点"})
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_atomic",
        "stem_text": "事务提交测试",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 2.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [{"label_type": "knowledge_point", "label_id": "atomic_kp", "role": "主要"}],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_atomic", QualityStatus.approved)
    svc = AdaptiveService(db_session)

    async def fail_item_stats(*args, **kwargs):
        raise RuntimeError("stats write failed")

    monkeypatch.setattr(svc.student_svc, "update_item_stats", fail_item_stats)

    with pytest.raises(RuntimeError, match="stats write failed"):
        await svc.submit_answer(
            "student_atomic", "q_atomic", "A", 1000, submission_id="submission-atomic"
        )

    mastery = await svc.student_svc.get_mastery("student_atomic", "atomic_kp")
    answer_count = await db_session.scalar(
        select(func.count()).select_from(StudentAnswer).where(
            StudentAnswer.student_id == "student_atomic"
        )
    )
    assert mastery is None
    assert answer_count == 0
