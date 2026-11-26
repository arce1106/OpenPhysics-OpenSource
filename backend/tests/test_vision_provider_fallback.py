import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import APIConnectionError

from app.services import ai_service
from app.services.ai_call_budget import ai_call_budget


def reply(content, finish="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish,
        message=SimpleNamespace(content=json.dumps(content) if not isinstance(content, str) else content))])


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "paper_grading_provider", "doubao_single_pass")
    # These cases cover the Doubao-first order (GRADING_PRIMARY_PROVIDER=doubao) and its backup.
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "doubao")
    monkeypatch.setattr(ai_service.settings, "ark_api_key", "qa")
    monkeypatch.setattr(ai_service.settings, "doubao_tutor_model", "qa-doubao")
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa")
    monkeypatch.setattr(ai_service.settings, "deepseek_grading_model", "deepseek-flash")
    monkeypatch.setattr(ai_service.settings, "deepseek_grading_max_tokens", 65536)
    monkeypatch.setattr(ai_service.settings, "deepseek_paper_grading_max_tokens", 131072)
    monkeypatch.setattr(ai_service, "get_doubao_client", lambda: "doubao-client")
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: "deepseek-client")
    return object.__new__(ai_service.AIService)


@pytest.mark.asyncio
@pytest.mark.parametrize("primary_failure", ["connection", "length", "json"])
async def test_deepseek_reads_original_image_when_doubao_cannot_grade(setup, monkeypatch, primary_failure):
    calls = []
    async def create(client, provider, timeout, **kwargs):
        calls.append((client, provider, kwargs))
        if provider == "doubao":
            if primary_failure == "connection":
                raise APIConnectionError(request=httpx.Request("POST", "https://provider.invalid"))
            if primary_failure == "length":
                return reply({"extracted_answer": "部分答案"}, "length")
            return reply("not JSON")
        return reply({"extracted_answer": "原图解答", "is_correct": True,
                      "score": 8, "max_score": 8, "confidence": 0.9})
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_photo_answer("synthetic-image", "题干", "答案", "problem_solving")
    assert [c[1] for c in calls] == ["doubao", "deepseek"]
    fallback = calls[1][2]
    assert fallback["model"] == "deepseek-flash"
    assert fallback["max_tokens"] == 65536
    assert fallback["response_format"] == {"type": "json_object"}
    assert fallback["messages"][1]["content"][1]["image_url"]["url"].endswith("synthetic-image")
    assert result["vision_grading_model"] == "deepseek-flash"
    assert (result["score"], result["max_score"], result["process_score"]) == (8, 8, 100)


@pytest.mark.asyncio
async def test_healthy_doubao_never_calls_deepseek(setup, monkeypatch):
    create = AsyncMock(return_value=reply({"extracted_answer": "A", "is_correct": True}))
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_photo_answer("image", "题干", "A")
    assert create.await_count == 1
    assert create.await_args.args[1] == "doubao"
    assert result["vision_grading_model"] == "qa-doubao"


@pytest.mark.asyncio
@pytest.mark.parametrize("primary_response", ["broken JSON", {}, [], {"results": [{"question_id": "unrelated"}]}])
async def test_paper_fallback_uses_deepseek_vision_and_keeps_question_numbers(setup, monkeypatch, primary_response):
    calls = []
    async def create(client, provider, timeout, **kwargs):
        calls.append(provider)
        if provider == "doubao":
            return reply(primary_response)
        assert kwargs["max_tokens"] == 131072
        prompt = json.loads(kwargs["messages"][1]["content"][0]["text"])
        assert '"results"' in prompt["输出格式"]
        return reply({"results": [{"question_id": "q5", "question_index": 5,
            "extracted_answer": "答案", "is_correct": True, "score": 12, "max_score": 12}]})
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_paper_batch_answers(["image"], [{"question_id": "q5", "question_index": 5,
        "question_type": "problem_solving", "stem": "题干", "correct_answer": "答案"}])
    assert calls == ["doubao", "deepseek"]
    assert result[0]["question_index"] == 5
    assert result[0]["vision_grading_model"] == "deepseek-flash"


@pytest.mark.asyncio
async def test_extract_only_also_uses_doubao_then_deepseek(setup, monkeypatch):
    create = AsyncMock(side_effect=[reply("bad"), reply({"extracted_answer": "学生原文"})])
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.extract_answer_from_image("image", "题")
    assert [call.args[1] for call in create.await_args_list] == ["doubao", "deepseek"]
    assert result["extracted_answer"] == "学生原文"
    assert result["vision_extraction_model"] == "deepseek-flash"


@pytest.mark.asyncio
async def test_both_providers_failing_does_not_invent_an_answer(setup, monkeypatch):
    monkeypatch.setattr(ai_service, "create_chat_completion", AsyncMock(return_value=reply("bad")))
    with pytest.raises(ValueError):
        await setup.judge_photo_answer("image", "题", "答案")


@pytest.mark.asyncio
async def test_typed_answers_use_doubao_without_a_deepseek_second_judgment(setup, monkeypatch):
    create = AsyncMock(return_value=reply({"is_correct": True, "score": 8, "max_score": 8}))
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_answer("题", "答案", "作答")
    assert create.await_count == 1
    assert create.await_args.args[1] == "doubao"
    assert create.await_args.kwargs["max_tokens"] == 15000
    assert result["text_grading_model"] == "qa-doubao"
    assert result["process_score"] == 100


@pytest.mark.asyncio
@pytest.mark.parametrize("primary_failure", ["connection", "length", "json", "missing_verdict"])
async def test_typed_answers_use_same_deepseek_backup_with_reasoning_room(setup, monkeypatch, primary_failure):
    calls = []
    async def create(client, provider, timeout, **kwargs):
        calls.append((provider, timeout, kwargs))
        if provider == "doubao":
            if primary_failure == "connection":
                raise APIConnectionError(request=httpx.Request("POST", "https://provider.invalid"))
            if primary_failure == "length":
                return reply({"is_correct": True}, "length")
            return reply("invalid" if primary_failure == "json" else {})
        return reply({"is_correct": False, "score": 6, "max_score": 12})
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_text_answer("题", "标准答案", "学生作答", "problem_solving")
    assert [call[0] for call in calls] == ["doubao", "deepseek"]
    fallback = calls[1][2]
    assert fallback["model"] == "deepseek-flash"
    assert fallback["max_tokens"] == 65536
    assert fallback["reasoning_effort"] == "high"
    assert fallback["response_format"] == {"type": "json_object"}
    assert json.loads(fallback["messages"][1]["content"])["学生答案"] == "学生作答"
    assert calls[1][1] == ai_service.settings.ai_vision_call_timeout_seconds
    assert result["text_grading_model"] == "deepseek-flash"
    assert result["process_score"] == 50


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_reply", [reply({"is_correct": True}, "length"), reply("broken")])
async def test_no_successful_text_result_when_both_grading_replies_are_incomplete(setup, monkeypatch, bad_reply):
    create = AsyncMock(return_value=bad_reply)
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    with pytest.raises(ValueError):
        await setup.judge_text_answer("题", "答案", "作答")
    assert [call.args[1] for call in create.await_args_list] == ["doubao", "deepseek"]


@pytest.mark.asyncio
async def test_rubric_drafting_uses_the_same_backup_and_preserves_usage(setup, monkeypatch):
    from app.services.rubric_service import TextModelRubricDrafter

    primary = reply({"parts": []})
    backup = reply({"parts": [{"label": "全题", "points": 12, "criteria": ["结果正确得12分"]}]})
    backup.usage = SimpleNamespace(prompt_tokens=200, completion_tokens=1200)
    create = AsyncMock(side_effect=[primary, backup])
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    reading = await TextModelRubricDrafter().draft({"题干": "题目", "满分": 12})
    assert [call.args[1] for call in create.await_args_list] == ["doubao", "deepseek"]
    assert create.await_args.kwargs["max_tokens"] == 65536
    assert reading.result["parts"][0]["points"] == 12
    assert (reading.input_tokens, reading.output_tokens) == (200, 1200)


def test_deepseek_budgets_cannot_exceed_the_official_maximum():
    from pydantic import ValidationError
    from app.core.config import Settings

    for field in ("deepseek_grading_max_tokens", "deepseek_paper_grading_max_tokens"):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, app_env="development", **{field: 393217})


def test_deepseek_is_the_default_primary_and_doubao_its_backup(setup, monkeypatch):
    from app.core.config import Settings
    assert Settings.model_fields["grading_primary_provider"].default == "deepseek"
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "deepseek")
    assert setup._grading_providers() == ["deepseek", "doubao"]
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "doubao")
    assert setup._grading_providers() == ["doubao", "deepseek"]
    # A grader without credentials is skipped whichever comes first.
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "")
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "deepseek")
    assert setup._grading_providers() == ["doubao"]


@pytest.mark.asyncio
async def test_deepseek_first_grades_a_photo_without_calling_doubao(setup, monkeypatch):
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "deepseek")
    calls = []

    async def create(client, provider, timeout, **kwargs):
        calls.append(provider)
        return reply({"extracted_answer": "答案", "is_correct": True, "process_score": 100})

    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_photo_answer("image", "题", "答案", "problem_solving")
    assert calls == ["deepseek"]
    assert result["vision_grading_model"] == "deepseek-flash"


@pytest.mark.asyncio
async def test_unescaped_latex_in_a_reply_is_read_instead_of_falling_back(setup, monkeypatch):
    # Doubao's real failure: correct grading, but LaTeX backslashes not escaped in the JSON.
    raw = ('{"extracted_answer": "(1)$T_1=\\frac65T_0$；(2)$\\Delta U=\\frac15CT_0$", '
           '"is_correct": true, "process_score": 100, "feedback": "两问都对\\n继续保持"}')
    calls = []

    async def create(client, provider, timeout, **kwargs):
        calls.append(provider)
        return reply(raw)

    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await setup.judge_photo_answer("image", "题", "答案", "problem_solving")
    assert calls == ["doubao"]
    assert result["extracted_answer"] == "(1)$T_1=\\frac65T_0$；(2)$\\Delta U=\\frac15CT_0$"
    assert result["feedback"] == "两问都对\n继续保持"


def test_latex_repair_keeps_real_escapes():
    fix = ai_service._escape_latex_backslashes
    assert json.loads(fix('{"a": "$\\Delta U$"}'))["a"] == "$\\Delta U$"
    assert json.loads(fix('{"a": "$\\frac{1}{5}$ \\times 2 \\nu"}'))["a"] == "$\\frac{1}{5}$ \\times 2 \\nu"
    # Already-escaped LaTeX, quotes, unicode and a newline before Chinese stay as they are.
    assert json.loads(fix('{"a": "\\\\Delta \\"x\\" \\u4e2d\\n第二问"}'))["a"] == '\\Delta "x" 中\n第二问'
