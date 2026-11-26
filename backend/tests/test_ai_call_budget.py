"""Provider calls inside one grading task share a deadline and a call cap (audit A6)."""
import asyncio
import json
import time

import pytest
from openai import APIConnectionError
import httpx

from app.services import ai_call_budget
from app.services.ai_call_budget import (
    AiBudgetExhausted,
    ai_call_budget as budget_scope,
    create_chat_completion,
    current_budget,
    provider_skipped,
)
from app.services.ai_service import AIService


def test_call_timeout_is_capped_by_the_remaining_task_time(monkeypatch):
    with budget_scope(20, max_calls=10) as budget:
        assert budget.call_timeout(45) == pytest.approx(20 - ai_call_budget.SETTLE_RESERVE_SECONDS, abs=0.2)
        assert budget.call_timeout(5) == 5
        budget.deadline = time.monotonic() + ai_call_budget.SETTLE_RESERVE_SECONDS + 1
        with pytest.raises(AiBudgetExhausted):
            budget.call_timeout(45)
    assert current_budget() is None


def test_call_cap_stops_further_provider_calls():
    with budget_scope(None, max_calls=2) as budget:
        budget.calls = 2
        with pytest.raises(AiBudgetExhausted):
            budget.call_timeout(45)


def test_nested_scope_keeps_the_outer_budget():
    with budget_scope(60, max_calls=5) as outer:
        with budget_scope(10, max_calls=1) as inner:
            assert inner is outer


class _Failing:
    def __init__(self):
        self.calls = 0

        class Completions:
            async def create(inner, **kwargs):
                self.calls += 1
                raise APIConnectionError(request=httpx.Request("POST", "https://provider.invalid"))

        class Chat:
            completions = Completions()

        self.chat = Chat()


class _Reply:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]


@pytest.mark.asyncio
async def test_a_failed_provider_is_skipped_by_later_fallbacks(monkeypatch):
    monkeypatch.setattr("app.services.ai_service.settings.paper_grading_provider", "doubao_single_pass")
    monkeypatch.setattr("app.services.ai_service.settings.ark_api_key", "k")
    monkeypatch.setattr("app.services.ai_service.settings.doubao_tutor_model", "ep")
    monkeypatch.setattr("app.services.ai_service.settings.deepseek_api_key", "qa")
    # Doubao first here, so its failure is what later calls must skip.
    monkeypatch.setattr("app.services.ai_service.settings.grading_primary_provider", "doubao")
    doubao = _Failing()
    deepseek_calls = []

    class DeepSeek:
        class chat:
            class completions:
                @staticmethod
                async def create(**kwargs):
                    deepseek_calls.append(kwargs)
                    return _Reply(json.dumps({"extracted_answer": "v=2", "is_correct": True, "confidence": 0.9}))

    monkeypatch.setattr("app.services.ai_service.get_doubao_client", lambda: doubao)
    monkeypatch.setattr("app.services.ai_service.get_deepseek_client", lambda: DeepSeek)
    service = object.__new__(AIService)
    with budget_scope(80, max_calls=20) as budget:
        first = await service.judge_photo_answer(image_base64="img", question_stem="题", correct_answer="v=2")
        second = await service.judge_photo_answer(image_base64="img", question_stem="题", correct_answer="v=2")
        assert provider_skipped("doubao")
        assert budget.calls == 3  # doubao once, then DeepSeek for both questions
    assert doubao.calls == 1
    assert len(deepseek_calls) == 2
    assert first["extracted_answer"] == second["extracted_answer"] == "v=2"


@pytest.mark.asyncio
async def test_worksheet_fallback_is_concurrent_bounded_and_stops_when_spent(monkeypatch):
    monkeypatch.setattr("app.services.ai_service.settings.paper_fallback_concurrency", 3)
    service = object.__new__(AIService)
    active = peak = 0
    calls = 0

    async def judge_photo_answer(**kwargs):
        nonlocal active, peak, calls
        budget = current_budget()
        budget.call_timeout(45)  # what create_chat_completion checks before a call
        budget.calls += 1
        calls += 1
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return {"extracted_answer": "", "is_correct": False, "feedback": "未找到"}

    service.judge_photo_answer = judge_photo_answer
    questions = [{"question_id": f"q{i}", "question_index": i, "stem": "题"} for i in range(1, 9)]
    with budget_scope(80, max_calls=10):
        items = await service._judge_paper_batch_by_question(["page1", "page2"], questions)
    assert [item["question_id"] for item in items] == [f"q{i}" for i in range(1, 9)]
    assert peak == 3
    assert calls == 10  # 8 questions x 2 pages would be 16; the cap stops it at 10
    assert any("未能完成这道题的识别" in item["feedback"] for item in items)
