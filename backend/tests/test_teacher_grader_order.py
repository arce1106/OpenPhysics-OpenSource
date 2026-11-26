"""Teacher scan reading and pre-grading use the same grader order as students' work."""
import json
from types import SimpleNamespace

import pytest

from app.services import ai_service
from app.services.teacher_ai_service import ModelScanRecognizer
from app.services.teacher_grading_service import ModelPaperGrader


def reply(content, finish="stop"):
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(
        finish_reason=finish, message=SimpleNamespace(content=json.dumps(content)))])


@pytest.fixture
def graders(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "paper_grading_provider", "doubao_single_pass")
    monkeypatch.setattr(ai_service.settings, "ark_api_key", "qa")
    monkeypatch.setattr(ai_service.settings, "doubao_tutor_model", "qa-doubao")
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "qa")
    monkeypatch.setattr(ai_service.settings, "deepseek_grading_model", "deepseek-flash")
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "deepseek")
    monkeypatch.setattr(ai_service, "get_doubao_client", lambda: "doubao-client")
    monkeypatch.setattr(ai_service, "get_deepseek_client", lambda: "deepseek-client")
    calls = []

    def install(replies):
        async def create(client, provider, timeout, **kwargs):
            calls.append(provider)
            result = replies[provider]
            if isinstance(result, Exception):
                raise result
            return result
        monkeypatch.setattr("app.services.ai_call_budget.create_chat_completion", create)
        return calls
    return install


@pytest.mark.asyncio
async def test_teacher_pre_grading_asks_deepseek_first_and_tags_the_model(graders):
    calls = graders({"deepseek": reply({"results": [{"number": 1, "score": 4}]}),
                     "doubao": reply({"results": []})})
    reading = await ModelPaperGrader().grade([b"img"], [{"number": 1}])
    assert calls == ["deepseek"]
    assert reading.result["results"][0]["_grading_model"] == "deepseek-flash"


@pytest.mark.asyncio
async def test_teacher_pre_grading_falls_back_to_doubao_on_a_cut_off_reply(graders):
    calls = graders({"deepseek": reply({"results": []}, finish="length"),
                     "doubao": reply({"results": [{"number": 1, "score": 3}]})})
    reading = await ModelPaperGrader().grade([b"img"], [{"number": 1}])
    assert calls == ["deepseek", "doubao"]
    assert reading.result["results"][0]["_grading_model"] == "qa-doubao"


@pytest.mark.asyncio
async def test_scan_reading_asks_deepseek_first_then_doubao(graders):
    calls = graders({"deepseek": ValueError("bad"), "doubao": reply({"number": "12", "confidence": 0.9})})
    reading = await ModelScanRecognizer().read_number(b"img")
    assert calls == ["deepseek", "doubao"]
    assert reading.result["number"] == "12"
