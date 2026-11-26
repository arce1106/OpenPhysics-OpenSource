"""Only reliable verdicts become learning evidence (grading audit A1-A5, A13, A16)."""
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile

from app.api.student import answer_grading
from app.api.student.schemas import ManualCorrectionRequest
from app.models.question import QualityStatus
from app.models.student import StudentAnswer
from app.services.adaptive_service import AdaptiveService
from app.services.ai_service import AIService
from app.services.grading_reliability import (
    is_deterministic_grading,
    model_flagged_uncertain,
    photo_answer_unrecognized,
    strict_verdict,
)
from app.services.knowledge_service import KnowledgeService
from app.services.knowledge_tracing import KnowledgeTracingEngine
from app.services.learning_evidence import STUDENT_VERDICT_WEIGHT
from app.services.physics_error_types import display_process_grading
from app.services.question_service import QuestionService
from app.services.review_center_service import build_review_center
from app.services.student_service import CorrectionNotAllowed


@pytest.mark.parametrize(("value", "expected"), [
    (True, True), (False, False), ("false", False), ("True", True), ("正确", True), ("错", False),
    (None, None), ("maybe", None), (1, None),
])
def test_strict_verdict_never_reads_text_false_as_true(value, expected):
    assert strict_verdict(value) is expected


def test_model_doubt_is_detected_from_its_own_signals():
    assert model_flagged_uncertain({"is_correct": True, "needs_human_review": True})
    assert model_flagged_uncertain({"is_correct": True, "confidence": 0.3})
    assert model_flagged_uncertain({"is_correct": "unsure"})
    assert not model_flagged_uncertain({"is_correct": False, "confidence": 0.9, "error_type": "unknown"})
    assert not model_flagged_uncertain({"confidence": 0.9}, require_verdict=False)


@pytest.mark.parametrize(("question_type", "answer", "expected"), [
    ("problem_solving", "", True),
    ("problem_solving", "v=2m/s", False),
    ("single_choice", "看不清", True),
    ("multiple_choice", "BD", False),
])
def test_photo_answer_unrecognized(question_type, answer, expected):
    assert photo_answer_unrecognized(question_type, answer) is expected


def test_deterministic_records_show_no_invented_ai_process():
    legacy_tapped = {"_mastery_update": {"kp": {}}, "_evidence_knowledge_point_id": "kp"}
    assert is_deterministic_grading(legacy_tapped)
    assert display_process_grading(legacy_tapped, fallback_answer="B") is None

    with_scratch = {**legacy_tapped, "answer_source": "choice", "needs_human_review": True,
                    "process_evidence_image_path": "/static/uploads/answers/s/a.png"}
    shown = display_process_grading(with_scratch, fallback_answer="B")
    assert shown["process_evidence_image_path"].endswith("a.png")
    assert shown["needs_human_review"] is False
    assert "自动判分" in shown["grading_basis"]

    ai = {"answer_source": "photo", "is_correct": False, "feedback": "计算错误", "error_type": "calculation"}
    assert not is_deterministic_grading(ai)
    assert display_process_grading(ai)["error_type"] == "calculation"


def test_vision_text_false_is_not_a_correct_verdict():
    item = AIService._normalize_vision_grading_item({"extracted_answer": "A", "is_correct": "false", "confidence": 0.9})
    assert item["is_correct"] is False
    assert item["needs_human_review"] is False
    unclear = AIService._normalize_vision_grading_item({"extracted_answer": "A", "is_correct": "部分", "confidence": 0.9})
    assert unclear["is_correct"] is False
    assert unclear["needs_human_review"] is True


def test_recognition_doubt_survives_a_positive_vision_verdict():
    item = AIService._normalize_vision_grading_item({
        "extracted_answer": "v=3", "is_correct": True,
        "confidence": 0.3, "needs_human_review": True,
    })
    assert item["needs_human_review"] is True
    assert item["confidence"] == 0.3


def test_notebook_summary_is_not_masked_by_unknown_ai_error():
    summary = build_review_center([{
        "kp_name": "x-t 图像",
        "mistakes": [{"answer_id": 1, "process_grading": {"error_type": "unknown"},
                      "misconception": {"id": "choice_misjudgment", "name": "选项判断错误"}}],
    }])
    assert summary["primary_focus"]["error_type"] == "choice_misjudgment"
    assert summary["primary_focus"]["error_name"] == "选项判断错误"


def test_correction_and_evidence_inputs_are_bounded():
    with pytest.raises(ValidationError):
        ManualCorrectionRequest(corrected_answer="A", is_correct=True, correction_reason="x" * 501)
    assert answer_grading.EVIDENCE_KIND_PATTERN.fullmatch("final_choice_scratch")
    assert not answer_grading.EVIDENCE_KIND_PATTERN.fullmatch("../../etc")


async def _question(db_session, qid, kp, question_type, answer):
    await KnowledgeService(db_session).create_point({"id": kp, "name": kp})
    q_svc = QuestionService(db_session)
    options = [{"label": "A", "text": "甲"}, {"label": "B", "text": "乙"}] if "choice" in question_type else []
    await q_svc.create_question({
        "id": qid, "stem_text": "题干", "answer": answer, "explanation": "解析",
        "question_type": question_type, "difficulty": 2.0, "source": "human", "options": options,
        "labels": [{"label_type": "knowledge_point", "label_id": kp, "role": "主要"}],
        "formulas": [], "images": [],
    })
    await q_svc.review_question(qid, QualityStatus.approved)


@pytest.mark.asyncio
async def test_photo_choice_is_judged_by_letters_not_model_verdict(db_session):
    await _question(db_session, "q_photo_choice", "kp_photo_choice", "single_choice", "A")
    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "s_photo_choice", "q_photo_choice", "B", 0, judged_is_correct=True, judged_feedback="正确",
        judged_grading={"extracted_answer": "B", "is_correct": True, "confidence": 0.95,
                        "error_type": "none", "answer_source": "photo"},
    )
    assert result["is_correct"] is False
    assert result["process_grading"]["error_type"] == "unknown"


@pytest.mark.asyncio
async def test_uncertain_ai_verdict_is_recorded_but_not_counted(db_session):
    await _question(db_session, "q_unsure", "kp_unsure", "problem_solving", "v=2m/s")
    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "s_unsure", "q_unsure", "v=3m/s", 0, judged_is_correct=False, judged_feedback="看不清",
        judged_grading={"extracted_answer": "v=3m/s", "is_correct": False, "confidence": 0.3,
                        "needs_human_review": True, "process_score": 10, "answer_source": "photo"},
    )
    assert result["mastery_update"] == {}
    assert result["process_grading"]["needs_human_review"] is True
    assert "暂不计入掌握度" in result["process_grading"]["grading_basis"]
    assert await svc.student_svc.get_mastery("s_unsure", "kp_unsure") is None
    answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.id == result["answer_id"]))
    assert answer.grading_result["_pending_confirmation"] is True

    # Confirming it makes it count, at the student-verdict weight.
    await svc.student_svc.apply_manual_correction(
        student_id="s_unsure", answer_id=result["answer_id"], corrected_answer="v=2m/s",
        is_correct=True, correction_reason="AI 看错了",
    )
    mastery = await svc.student_svc.get_mastery("s_unsure", "kp_unsure")
    assert mastery is not None and mastery.attempts == 1
    answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.id == result["answer_id"]))
    assert "_pending_confirmation" not in answer.grading_result
    assert answer.grading_result["confidence_level"] == "medium"


@pytest.mark.asyncio
async def test_unclear_model_verdict_does_not_count(db_session):
    await _question(db_session, "q_text_false", "kp_text_false", "problem_solving", "2")
    svc = AdaptiveService(db_session)
    textual = await svc.submit_answer(
        "s_text_false", "q_text_false", "2", 0, judged_is_correct="false", judged_feedback="",
        judged_grading={"extracted_answer": "2", "is_correct": "false", "confidence": 0.9},
        submission_id="text-false",
    )
    assert textual["is_correct"] is False
    assert textual["mastery_update"]
    unclear = await svc.submit_answer(
        "s_text_false", "q_text_false", "2", 0, judged_is_correct="部分", judged_feedback="",
        judged_grading={"extracted_answer": "2", "is_correct": "部分", "confidence": 0.9},
        submission_id="unclear",
    )
    assert unclear["is_correct"] is False
    assert unclear["mastery_update"] == {}


@pytest.mark.asyncio
async def test_tapped_choice_cannot_be_corrected_and_shows_no_ai_process(db_session):
    await _question(db_session, "q_tap", "kp_tap", "single_choice", "A")
    svc = AdaptiveService(db_session)
    wrong = await svc.submit_answer("s_tap", "q_tap", "B", 0)
    answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.id == wrong["answer_id"]))
    assert answer.grading_result["answer_source"] == "choice"
    assert display_process_grading(answer.grading_result, fallback_answer="B") is None
    with pytest.raises(CorrectionNotAllowed):
        await svc.student_svc.apply_manual_correction(
            student_id="s_tap", answer_id=wrong["answer_id"], corrected_answer="A",
            is_correct=True, correction_reason="想改成对",
        )
    replay = await svc._response_from_existing_answer("s_tap", await svc.question_svc.get_question("q_tap"), answer)
    assert replay["process_grading"] is None


@pytest.mark.asyncio
async def test_student_correction_counts_at_self_review_weight(db_session):
    await _question(db_session, "q_photo_fix", "kp_photo_fix", "problem_solving", "v=2m/s")
    svc = AdaptiveService(db_session)
    wrong = await svc.submit_answer(
        "s_fix", "q_photo_fix", "v=3m/s", 0, judged_is_correct=False, judged_feedback="计算错误",
        judged_grading={"extracted_answer": "v=3m/s", "is_correct": False, "confidence": 0.9,
                        "error_type": "calculation", "answer_source": "photo"},
    )
    assert wrong["mastery_update"]
    await svc.student_svc.apply_manual_correction(
        student_id="s_fix", answer_id=wrong["answer_id"], corrected_answer="v=2m/s",
        is_correct=True, correction_reason="识别错误",
    )
    mastery = await svc.student_svc.get_mastery("s_fix", "kp_photo_fix")
    prior = KnowledgeTracingEngine.initial_p_l()
    assert mastery.mastery == pytest.approx(prior + (1.0 - prior) * STUDENT_VERDICT_WEIGHT)


@pytest.mark.asyncio
async def test_unrecognized_photo_is_not_recorded(monkeypatch, tmp_path):
    question = SimpleNamespace(question_type=SimpleNamespace(value="problem_solving"), stem_text="题干",
                               answer="2", difficulty=3)
    adaptive = SimpleNamespace(db=None, get_existing_submission_response=AsyncMock(return_value=None),
                               submit_answer=AsyncMock())
    ai = SimpleNamespace(judge_photo_answer=AsyncMock(return_value={"extracted_answer": "", "is_correct": False}))

    async def run(student, *, operation, **kwargs):
        return await operation()

    usage = SimpleNamespace(run=AsyncMock(side_effect=run))
    monkeypatch.setattr(answer_grading, "__file__", str(tmp_path / "backend/app/api/student/answer_grading.py"))
    with pytest.raises(HTTPException) as error:
        await answer_grading._submit_image_answer(
            image=UploadFile(io.BytesIO(b"fake"), headers=Headers({"content-type": "image/png"})),
            question_id="q1", student_id="s1", time_spent_ms=0, submission_id="sub-1",
            target_knowledge_point_id=None, adaptive_svc=adaptive, ai_svc=ai,
            question_svc=SimpleNamespace(get_question=AsyncMock(return_value=question)),
            source="photo", ai_usage_svc=usage,
        )
    assert error.value.status_code == 422
    adaptive.submit_answer.assert_not_called()
    assert not list((tmp_path / "backend/static/uploads/answers/s1").glob("*"))
    assert usage.run.call_args.kwargs["submission_key"].startswith("sub-1:q1:")


def test_next_milestone_matches_the_sync_page_recommendation_rule():
    from app.api.student.journey import _next_milestone
    kp = lambda chapter: SimpleNamespace(volume="必修 第一册", chapter=chapter)
    kp_map = {"a": kp("第一章"), "b": kp("第一章"), "c": kp("第一章"), "d": kp("第二章")}
    states = [
        {"kp_id": "a", "kp_name": "打点计时器", "learning_state": "to_learn"},
        {"kp_id": "b", "kp_name": "参考系", "learning_state": "practice"},
        {"kp_id": "c", "kp_name": "x-t图像（基础）", "learning_state": "practice"},
        {"kp_id": "d", "kp_name": "匀变速直线运动", "learning_state": "learning"},
    ]
    # Inside the active chapter, practice comes before to_learn, in path order.
    assert _next_milestone(states, kp_map, "必修 第一册", "第一章") == "巩固「参考系」达到掌握水平"
    # Only unstarted points left in the chapter.
    assert _next_milestone(states[:1] + states[3:], kp_map, "必修 第一册", "第一章") == "开始同步学习「打点计时器」"
    # No recent scope: the same state order over the whole path.
    assert _next_milestone(states, kp_map, None, None) == "完成「匀变速直线运动」达到掌握水平"
    assert _next_milestone([], kp_map, None, None) is None


def test_choice_questions_never_show_ai_process_dimensions():
    from app.models.question import QuestionType
    from app.services.grading_reliability import PENDING_FLAG, PENDING_GRADING_BASIS
    from app.services.physics_error_types import display_process_grading

    ai_photo_grading = {
        "answer_source": "photo",
        "final_answer": "ABD",
        "error_type": "unknown",
        "grading_basis": "AI 对该题识别或判断不够确定，建议人工确认后再作为学习结论。",
        "model_correct": None,
        "equation_correct": None,
    }
    # A legacy AI-graded choice answer without evidence images shows no process block.
    assert display_process_grading(ai_photo_grading, "ABD", question_type=QuestionType.multiple_choice) is None

    # With its photo: the photo stays, no dimensions, still correctable (not a tap).
    with_photo = {**ai_photo_grading, "answer_image_path": "answers/s1/a.jpg"}
    shown = display_process_grading(with_photo, "ABD", question_type="multiple_choice")
    assert shown["answer_image_path"] == "answers/s1/a.jpg"
    assert "model_correct" not in shown and "error_type" not in shown
    assert shown["answer_source"] == "photo"
    assert shown["step_scores"] == []

    # Not yet confirmed: the notice that it is not counted stays visible.
    pending = display_process_grading({**ai_photo_grading, PENDING_FLAG: True}, "ABD", question_type="single_choice")
    assert pending["grading_basis"] == PENDING_GRADING_BASIS
    assert pending["needs_human_review"] is True

    # A student's correction keeps the full record.
    corrected = display_process_grading(
        {**ai_photo_grading, "manual_correction": {"is_correct": True}}, "ABD", question_type="multiple_choice"
    )
    assert "model_correct" in corrected

    # Worked problems keep their process grading.
    worked = display_process_grading(ai_photo_grading, "ABD", question_type="problem_solving")
    assert "model_correct" in worked
