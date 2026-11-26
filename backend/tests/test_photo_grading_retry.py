"""Malformed model output is retryable; unreadable photos remain a separate outcome."""
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from app.api.student import answer_grading
from app.services import ai_service


@pytest.fixture(autouse=True)
def configured_deepseek(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa-key")


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["not JSON", "[]", '"answer"', "{}"])
async def test_invalid_extraction_response_raises_instead_of_returning_an_unreadable_photo(monkeypatch, content):
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: False)
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: object())
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
    monkeypatch.setattr(ai_service, "create_chat_completion", AsyncMock(return_value=reply))
    with pytest.raises(ValueError, match="Invalid photo extraction response"):
        await object.__new__(ai_service.AIService).extract_answer_from_image("qa-image", "题目")


@pytest.mark.asyncio
async def test_explicitly_empty_extracted_answer_remains_an_unreadable_image(monkeypatch):
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: False)
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: object())
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
        content=json.dumps({"extracted_answer": ""}),
    ))])
    monkeypatch.setattr(ai_service, "create_chat_completion", AsyncMock(return_value=reply))
    result = await object.__new__(ai_service.AIService).judge_photo_answer("qa-image", "题目", "答案")
    assert result["extracted_answer"] == ""
    assert result["feedback"] == "AI 未能识别出可批改的作答"


@pytest.mark.asyncio
async def test_retryable_provider_failure_does_not_leave_an_answer_or_uploaded_image(monkeypatch, tmp_path):
    question = SimpleNamespace(id="q1", question_type=SimpleNamespace(value="problem_solving"),
                               stem_text="题目", answer="2", difficulty=3)
    adaptive = SimpleNamespace(db=None, get_existing_submission_response=AsyncMock(return_value=None),
                               submit_answer=AsyncMock())
    usage = SimpleNamespace(run=AsyncMock(side_effect=HTTPException(503, "AI 暂时未能完成，请稍后重试。")))
    monkeypatch.setattr(answer_grading, "__file__", str(tmp_path / "backend/app/api/student/answer_grading.py"))
    with pytest.raises(HTTPException) as failed:
        await answer_grading._submit_image_answer(
            image=UploadFile(io.BytesIO(b"qa-image"), headers=Headers({"content-type": "image/png"})),
            question_id="q1", student_id="qa", time_spent_ms=0, submission_id="same-submission",
            target_knowledge_point_id=None, adaptive_svc=adaptive,
            ai_svc=SimpleNamespace(judge_photo_answer=AsyncMock()),
            question_svc=SimpleNamespace(get_question=AsyncMock(return_value=question)),
            source="photo", ai_usage_svc=usage,
        )
    assert failed.value.status_code == 503
    adaptive.submit_answer.assert_not_called()
    assert not list((tmp_path / "backend/static/uploads/answers/qa").glob("*"))


@pytest.mark.asyncio
async def test_long_handwriting_extraction_gets_room_and_preserves_a_complete_answer_field(monkeypatch):
    """A multi-part derivation cut off inside "notes" still grades the student's answer."""
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: False)
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: object())
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa-key")
    answer = "(1)$V_1=\\frac{6}{5}hS$；(2)$Q=\\frac{1}{5}h(p_0S+mg)+\\frac{1}{5}CT_0$"
    cut_off = '{"extracted_answer": ' + json.dumps(answer, ensure_ascii=False) + ', "confidence": 0.8, "notes": "第(2)问'
    reply = SimpleNamespace(choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(content=cut_off))])
    create = AsyncMock(return_value=reply)
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await object.__new__(ai_service.AIService).extract_answer_from_image("qa-image", "题目")

    assert create.await_args.kwargs["max_tokens"] == 65536
    assert result["extracted_answer"] == answer and result["needs_human_review"] is True


def test_salvage_reads_only_a_complete_answer_field():
    assert ai_service._salvage_extracted_answer('{"extracted_answer": "A", "notes": "看') == "A"
    assert ai_service._salvage_extracted_answer('{"extracted_answer": "(1)$v=') is None
    assert ai_service._salvage_extracted_answer("") is None


@pytest.mark.asyncio
async def test_photo_and_text_share_doubao_grading_budget(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "doubao")
    monkeypatch.setattr(ai_service, "get_doubao_client", lambda: object())
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: object())
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa")
    reply = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
        content=json.dumps({"extracted_answer": "作答", "is_correct": True, "score": 8, "max_score": 8, "process_score": 8})))])
    create = AsyncMock(return_value=reply)
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    svc = object.__new__(ai_service.AIService)
    photo = await svc._judge_photo_answer_with_doubao("image", "题", "答案")
    assert create.await_args.kwargs["max_tokens"] == 15000
    assert (photo["score"], photo["max_score"], photo["process_score"]) == (8, 8, 100)
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: True)
    await svc.judge_text_answer("题", "答案", "作答")
    assert create.await_args.args[1] == "doubao"
    assert create.await_args.kwargs["max_tokens"] == 15000


@pytest.mark.asyncio
async def test_truncated_text_grading_remains_retryable_even_if_json_is_parseable(monkeypatch):
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: object())
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa")
    reply = SimpleNamespace(choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(
        content='{"is_correct":true}'))])
    monkeypatch.setattr(ai_service, "create_chat_completion", AsyncMock(return_value=reply))
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: False)
    with pytest.raises(ValueError, match="Truncated grading response"):
        await object.__new__(ai_service.AIService).judge_text_answer("题", "答案", "答案")
