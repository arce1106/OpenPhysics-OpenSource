"""Verdicts must agree with their process score and rest on a standard answer (audit A9, A10)."""
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.datastructures import Headers, UploadFile

from app.api.student import answer_grading
from app.models.question import QualityStatus
from app.models.student import StudentAnswer
from app.services.adaptive_service import AdaptiveService
from app.services.grading_reliability import (
    NO_ANSWER_KEY_DETAIL,
    PROCESS_CONFLICT_KEY,
    UngradableQuestion,
    answer_key_for,
    verdict_process_conflict,
)
from app.services.knowledge_service import KnowledgeService
from app.services.question_importer import QuestionImporter
from app.services.question_service import QuestionNotGradable, QuestionService


async def _question(db_session, qid, kp, question_type, answer, *, options=None, approve=True):
    await KnowledgeService(db_session).create_point({"id": kp, "name": kp})
    await QuestionService(db_session).create_question({
        "id": qid, "stem_text": "题干", "answer": answer, "explanation": "解析",
        "question_type": question_type, "difficulty": 2.0, "source": "human",
        "options": options or [],
        "labels": [{"label_type": "knowledge_point", "label_id": kp, "role": "主要"}],
        "formulas": [], "images": [],
    })
    if approve:
        await QuestionService(db_session).review_question(qid, QualityStatus.approved)


@pytest.mark.parametrize(("is_correct", "credit", "conflict"), [
    (True, 0.4, True),
    (True, 0.5, False),
    (True, None, False),
    (False, 0.9, True),
    (False, 0.8, True),
    (False, 0.7, False),
    (False, None, False),
])
def test_verdict_and_process_score_conflict(is_correct, credit, conflict):
    assert verdict_process_conflict(is_correct, credit) is conflict


@pytest.mark.asyncio
@pytest.mark.parametrize(("verdict", "process_score", "word"), [(True, 40, "正确"), (False, 90, "错误")])
async def test_conflicting_verdict_waits_for_confirmation(db_session, verdict, process_score, word):
    qid, kp = f"q_conflict_{process_score}", f"kp_conflict_{process_score}"
    await _question(db_session, qid, kp, "problem_solving", "v=2m/s")
    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "s_conflict", qid, "v=2m/s", 0, judged_is_correct=verdict, judged_feedback="",
        judged_grading={"extracted_answer": "v=2m/s", "is_correct": verdict, "confidence": 0.9,
                        "process_score": process_score, "answer_source": "photo"},
    )
    assert result["is_correct"] is verdict
    assert result["mastery_update"] == {}
    assert result["process_grading"]["needs_human_review"] is True
    assert f"判定本题{word}" in result["process_grading"]["grading_basis"]
    assert f"过程分为 {process_score} 分" in result["process_grading"]["grading_basis"]
    assert await svc.student_svc.get_mastery("s_conflict", kp) is None
    answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.id == result["answer_id"]))
    assert answer.grading_result["_pending_confirmation"] is True
    assert answer.grading_result[PROCESS_CONFLICT_KEY] == {"is_correct": verdict, "process_score": process_score}


@pytest.mark.asyncio
async def test_consistent_verdict_and_process_score_count(db_session):
    await _question(db_session, "q_agree", "kp_agree", "problem_solving", "v=2m/s")
    svc = AdaptiveService(db_session)
    result = await svc.submit_answer(
        "s_agree", "q_agree", "v=2m/s", 0, judged_is_correct=True, judged_feedback="",
        judged_grading={"extracted_answer": "v=2m/s", "is_correct": True, "confidence": 0.9,
                        "process_score": 90, "answer_source": "photo"},
    )
    assert result["mastery_update"]
    answer = await db_session.scalar(select(StudentAnswer).where(StudentAnswer.id == result["answer_id"]))
    assert PROCESS_CONFLICT_KEY not in answer.grading_result


@pytest.mark.asyncio
async def test_question_without_answer_is_never_sent_to_the_model_or_recorded(db_session):
    await _question(db_session, "q_no_key", "kp_no_key", "problem_solving", "", approve=False)
    svc = AdaptiveService(db_session)
    svc.ai_svc = SimpleNamespace(judge_answer=AsyncMock())
    with pytest.raises(UngradableQuestion, match="暂缺标准答案"):
        await svc.submit_answer("s_no_key", "q_no_key", "v=3m/s", 0)
    svc.ai_svc.judge_answer.assert_not_called()
    assert await db_session.scalar(select(func.count()).select_from(StudentAnswer)) == 0
    assert await svc.student_svc.get_mastery("s_no_key", "kp_no_key") is None


@pytest.mark.asyncio
async def test_choice_question_falls_back_to_the_options_marked_correct(db_session):
    options = [{"label": "A", "text": "甲"}, {"label": "B", "text": "乙", "is_correct": True}]
    await _question(db_session, "q_option_key", "kp_option_key", "single_choice", None, options=options)
    question = await QuestionService(db_session).get_question("q_option_key")
    assert answer_key_for(question) == "B"
    svc = AdaptiveService(db_session)
    assert (await svc.submit_answer("s_option_key", "q_option_key", "B", 0, submission_id="1"))["is_correct"] is True
    assert (await svc.submit_answer("s_option_key", "q_option_key", "A", 0, submission_id="2"))["is_correct"] is False


@pytest.mark.asyncio
async def test_approval_and_import_require_an_answer_key(db_session, tmp_path):
    q_svc = QuestionService(db_session)
    await _question(db_session, "q_draft", "kp_draft", "problem_solving", "", approve=False)
    with pytest.raises(QuestionNotGradable):
        await q_svc.review_question("q_draft", QualityStatus.approved)
    with pytest.raises(QuestionNotGradable):
        await q_svc.update_question("q_draft", {"quality_status": QualityStatus.approved})
    await q_svc.update_question("q_draft", {"answer": "v=2m/s", "quality_status": QualityStatus.approved})
    assert (await q_svc.get_question("q_draft")).quality_status == QualityStatus.approved

    importer = QuestionImporter(q_svc, static_dir=tmp_path)
    results = await importer.import_questions([
        {"id": "q_import_missing", "stem_text": "题干", "answer": "", "question_type": "fill_in_blank",
         "quality_status": "approved"},
        {"id": "q_import_draft", "stem_text": "题干", "answer": "", "question_type": "fill_in_blank"},
    ])
    assert [(r.question_id, r.success) for r in results] == [("q_import_missing", False), ("q_import_draft", True)]
    assert "缺少标准答案" in results[0].error


@pytest.mark.asyncio
async def test_photo_of_a_question_without_answer_is_rejected_before_the_model(monkeypatch, tmp_path):
    question = SimpleNamespace(question_type=SimpleNamespace(value="problem_solving"), stem_text="题干",
                               answer="", options=[], difficulty=3)
    usage = SimpleNamespace(run=AsyncMock())
    monkeypatch.setattr(answer_grading, "__file__", str(tmp_path / "backend/app/api/student/answer_grading.py"))
    with pytest.raises(HTTPException) as error:
        await answer_grading._submit_image_answer(
            image=UploadFile(io.BytesIO(b"fake"), headers=Headers({"content-type": "image/png"})),
            question_id="q1", student_id="s1", time_spent_ms=0, submission_id="sub-1",
            target_knowledge_point_id=None,
            adaptive_svc=SimpleNamespace(db=None, get_existing_submission_response=AsyncMock(return_value=None)),
            ai_svc=SimpleNamespace(judge_photo_answer=AsyncMock()),
            question_svc=SimpleNamespace(get_question=AsyncMock(return_value=question)),
            source="photo", ai_usage_svc=usage,
        )
    assert error.value.status_code == 422
    assert error.value.detail == NO_ANSWER_KEY_DETAIL
    usage.run.assert_not_called()
    assert not (tmp_path / "backend/static/uploads/answers/s1").exists()


@pytest.mark.asyncio
async def test_paper_batch_skips_questions_without_answer(monkeypatch, tmp_path):
    keyed = SimpleNamespace(question_type=SimpleNamespace(value="experiment"), stem_text="实验题", answer="2",
                            options=[], explanation="解析")
    keyless = SimpleNamespace(question_type=SimpleNamespace(value="problem_solving"), stem_text="解答题",
                              answer=" ", options=[], explanation="完整解析")
    adaptive = SimpleNamespace(
        get_existing_submission_response=AsyncMock(return_value=None),
        submit_answer=AsyncMock(return_value={"answer_id": 1, "is_correct": True, "idempotent_replay": True}),
    )
    question_svc = SimpleNamespace(get_question=AsyncMock(side_effect=lambda qid: keyed if qid == "q1" else keyless))
    ai = SimpleNamespace(judge_paper_batch_answers=AsyncMock(return_value=[
        {"question_id": "q1", "extracted_answer": "2", "is_correct": True, "feedback": "正确"}]))

    async def run(student, *, operation, **kwargs):
        return await operation()

    usage = SimpleNamespace(run=AsyncMock(side_effect=run))
    monkeypatch.setattr(answer_grading, "__file__", str(tmp_path / "backend/app/api/student/answer_grading.py"))
    monkeypatch.setattr(answer_grading, "ensure_student_can_access_question", AsyncMock())
    monkeypatch.setattr(answer_grading, "crop_paper_batch_by_separators", Mock(return_value={}))
    monkeypatch.setattr(answer_grading, "maybe_enrich_rich_content", AsyncMock())
    monkeypatch.setattr(answer_grading.answer_media_service, "secure_payload", lambda student, payload: payload)
    result = await answer_grading.submit_paper_batch_answers(
        images=[UploadFile(io.BytesIO(b"fake"), headers=Headers({"content-type": "image/png"}))],
        question_ids=json.dumps(["q1", "q2"]), student_id="s1", time_spent_ms=0,
        submission_id="sheet", teacher_paper_attempt_id=None, topic_context=None,
        target_knowledge_point_ids=None, adaptive_svc=adaptive, ai_svc=ai, question_svc=question_svc,
        reward_svc=SimpleNamespace(), quest_svc=SimpleNamespace(), student_svc=SimpleNamespace(),
        ai_usage_svc=usage, rich_content_svc=SimpleNamespace(), include_rendered=False,
        x_openphysics_include_rendered=None,
    )
    sent = ai.judge_paper_batch_answers.call_args.args[1]
    assert [q["question_id"] for q in sent] == ["q1"]
    assert result["errors"] == {"q2": NO_ANSWER_KEY_DETAIL}
    assert result["solutions"] == {"q2": {"correct_answer": "", "explanation": "完整解析"}}
    assert adaptive.submit_answer.call_count == 1
