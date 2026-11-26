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


@pytest.mark.asyncio
async def test_paper_batch_fallback_keeps_original_question_index():
    service = object.__new__(AIService)
    prompts: list[str] = []

    async def fake_judge_photo_answer(**kwargs):
        prompts.append(kwargs["question_stem"])
        return {
            "extracted_answer": "AC",
            "is_correct": True,
            "feedback": "识别成功",
        }

    service.judge_photo_answer = fake_judge_photo_answer

    await service._judge_paper_batch_by_question(
        ["fake-image"],
        [
            {
                "question_id": "q2",
                "question_index": 2,
                "question_type": "multiple_choice",
                "stem": "第二题题干",
                "options": [],
                "correct_answer": "AC",
            },
            {
                "question_id": "q3",
                "question_index": 3,
                "question_type": "problem_solving",
                "stem": "第三题题干",
                "options": [],
                "correct_answer": "(1)6 s",
            },
        ],
    )

    assert "第 2 题" in prompts[0]
    assert "第 3 题" in prompts[1]


@pytest.mark.asyncio
async def test_photo_answer_uses_doubao_single_pass_as_main(monkeypatch):
    service = object.__new__(AIService)
    monkeypatch.setattr("app.services.ai_service.settings.paper_grading_provider", "doubao_single_pass")
    monkeypatch.setattr("app.services.ai_service.settings.ark_api_key", "test-key")
    monkeypatch.setattr("app.services.ai_service.settings.doubao_tutor_model", "ep-test")
    captured_messages: list[dict] = []
    captured_models: list[str] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_messages.extend(kwargs["messages"])
            captured_models.append(kwargs["model"])
            return _FakeResponse(
                '{"extracted_answer": "AC", "is_correct": true, "feedback": "豆包一次完成批改", "confidence": 0.92}'
            )

    class FakeChat:
        completions = FakeCompletions()

    class FakeDoubaoClient:
        chat = FakeChat()

    monkeypatch.setattr("app.services.ai_service.get_doubao_client", lambda: FakeDoubaoClient())

    result = await service.judge_photo_answer(
        image_base64="fake-image",
        question_stem="某多选题",
        correct_answer="AC",
    )

    assert "读出作答并批改" in captured_messages[0]["content"]
    assert captured_models == ["ep-test"]
    assert result["extracted_answer"] == "AC"
    assert result["feedback"] == "豆包一次完成批改"
    assert result["vision_grading_model"] == "ep-test"


@pytest.mark.asyncio
async def test_paper_batch_uses_doubao_single_pass_as_main(monkeypatch):
    service = object.__new__(AIService)
    monkeypatch.setattr("app.services.ai_service.settings.paper_grading_provider", "doubao_single_pass")
    monkeypatch.setattr("app.services.ai_service.settings.ark_api_key", "test-key")
    monkeypatch.setattr("app.services.ai_service.settings.doubao_tutor_model", "ep-test")
    captured_messages: list[dict] = []
    captured_models: list[str] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            captured_messages.extend(kwargs["messages"])
            captured_models.append(kwargs["model"])
            return _FakeResponse(
                '[{"question_id": "q1", "question_index": 1, "extracted_answer": "BC", '
                '"is_correct": true, "feedback": "豆包批改正确", "confidence": 0.91}]'
            )

    class FakeChat:
        completions = FakeCompletions()

    class FakeDoubaoClient:
        chat = FakeChat()

    monkeypatch.setattr("app.services.ai_service.get_doubao_client", lambda: FakeDoubaoClient())

    result = await service.judge_paper_batch_answers(
        ["fake-image"],
        [
            {
                "question_id": "q1",
                "question_index": 1,
                "question_type": "multiple_choice",
                "stem": "第一题题干",
                "options": [],
                "correct_answer": "BC",
            },
        ],
    )

    assert "读出作答并批改" in captured_messages[0]["content"]
    assert captured_models == ["ep-test"]
    assert result[0]["question_id"] == "q1"
    assert result[0]["is_correct"] is True
    assert result[0]["vision_grading_model"] == "ep-test"
