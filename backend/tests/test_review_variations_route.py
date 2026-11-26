from types import SimpleNamespace

import pytest

from app.api.student import journey


class FakeStudentService:
    async def get_answer(self, student_id: str, answer_id: int):
        return SimpleNamespace(question_id="q_original")


class FakeAdaptiveService:
    def __init__(self):
        self.requested_limit = None

    async def get_variation_questions(self, student_id: str, answer_id: int, limit: int = 3):
        self.requested_limit = limit
        return [
            {
                "variation_type": "foundation",
                "title": "基础巩固",
                "reason": "同一知识点",
                "question": {"id": "q_variant_1", "stem_text": "第一道变式题"},
            },
            {
                "variation_type": "transfer",
                "title": "迁移挑战",
                "reason": "相邻模型",
                "question": {"id": "q_variant_2", "stem_text": "第二道迁移题"},
            },
        ]


@pytest.mark.asyncio
async def test_review_variations_returns_one_variation_question(monkeypatch):
    async def allow_access(student_id: str, question_id: str, student_svc):
        return None

    monkeypatch.setattr(journey, "ensure_student_can_access_question", allow_access)
    adaptive_svc = FakeAdaptiveService()

    response = await journey.get_review_variations(
        answer_id=33,
        student_id="student-1",
        adaptive_svc=adaptive_svc,
        student_svc=FakeStudentService(),
    )

    assert adaptive_svc.requested_limit == 1
    assert len(response.variations) == 1
    assert response.variations[0].title == "做变式题"
    assert response.variations[0].reason == "做对这道变式题即可完成本题复盘。"
    assert response.variations[0].question["id"] == "q_variant_1"
