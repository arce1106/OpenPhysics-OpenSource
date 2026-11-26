import pytest

from app.services.ai_service import AIService


class _FakeMessage:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str):
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str):
        self.choices = [_FakeChoice(content)]


def test_default_ai_client_is_doubao(monkeypatch):
    doubao_client = object()
    monkeypatch.setattr(
        "app.services.ai_service.get_doubao_client",
        lambda: doubao_client,
    )

    assert AIService().client is doubao_client


@pytest.mark.asyncio
async def test_generation_labeling_and_diagnosis_use_doubao_tutor_model(monkeypatch):
    captured_models: list[str] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_models.append(kwargs["model"])
            return _FakeResponse("{}")

    class FakeChat:
        completions = FakeCompletions()

    class FakeDoubaoClient:
        chat = FakeChat()

    monkeypatch.setattr(
        "app.services.ai_service.settings.doubao_tutor_model",
        "ep-seed-2-pro",
    )
    service = AIService(FakeDoubaoClient())

    await service.generate_questions([], 1, "single_choice", count=1)
    await service.label_question({}, [])
    await service.diagnose_student([], [])

    assert captured_models == ["ep-seed-2-pro"] * 3


@pytest.mark.asyncio
async def test_question_tutor_chat_uses_doubao_tutor_model(monkeypatch):
    service = object.__new__(AIService)
    service.client = object()
    captured: dict = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _FakeResponse("先看第一处错误：方向判断要回到磁通量变化。")

    class FakeChat:
        completions = FakeCompletions()

    class FakeDoubaoClient:
        chat = FakeChat()

    monkeypatch.setattr("app.services.ai_service.settings.ark_api_key", "test-key")
    monkeypatch.setattr("app.services.ai_service.settings.doubao_tutor_model", "ep-seed-2-pro")
    monkeypatch.setattr("app.services.ai_service.get_doubao_client", lambda: FakeDoubaoClient())

    result = await service.question_tutor_chat(
        question_stem="线圈进入磁场，判断感应电流方向。",
        correct_answer="A",
        given_answer="B",
        message="为什么我错了？",
    )

    assert captured["model"] == "ep-seed-2-pro"
    assert result == "先看第一处错误：方向判断要回到磁通量变化。"


@pytest.mark.asyncio
async def test_learning_chat_uses_doubao_tutor_model(monkeypatch):
    service = object.__new__(AIService)
    service.client = object()
    captured: dict = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _FakeResponse("楞次定律的关键是阻碍磁通量的变化。")

    class FakeChat:
        completions = FakeCompletions()

    class FakeDoubaoClient:
        chat = FakeChat()

    monkeypatch.setattr("app.services.ai_service.settings.ark_api_key", "test-key")
    monkeypatch.setattr("app.services.ai_service.settings.doubao_tutor_model", "ep-seed-2-pro")
    monkeypatch.setattr("app.services.ai_service.get_doubao_client", lambda: FakeDoubaoClient())

    chunks = [
        chunk
        async for chunk in service.stream_learning_chat(
            kp_name="楞次定律表述",
            kp_description="判断感应电流方向",
            kp_chapter="第二章 电磁感应",
            card_context="核心理解：阻碍变化。",
            message="为什么不是阻碍磁场？",
            history=[],
        )
    ]

    assert captured["model"] == "ep-seed-2-pro"
    assert any('"content"' in chunk for chunk in chunks)
    assert chunks[-1] == "data: [DONE]\n\n"
