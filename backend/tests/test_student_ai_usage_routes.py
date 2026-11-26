import pytest
from fastapi import HTTPException

from app.api.student import schemas
from app.api.student import tutor as tutor_api


class _Question:
    stem_text = "物体做匀速直线运动"
    answer = "A"
    explanation = "速度不变。"


class _QuestionService:
    async def get_question(self, question_id: str):
        return _Question()


class _StudentService:
    pass


class _AiService:
    def __init__(self):
        self.called = False

    async def generate_hint(self, **kwargs):
        self.called = True
        return "先判断速度是否变化。"


class _BlockedAiUsageService:
    async def run(self, student_id: str, *, feature: str, operation):
        raise HTTPException(status_code=429, detail="今日 AI 使用额度已达上限，明天可继续使用。")


@pytest.mark.asyncio
async def test_tutor_hint_checks_ai_quota_before_calling_model(monkeypatch):
    async def allow_question(*args, **kwargs):
        return "student-1"

    monkeypatch.setattr(tutor_api, "ensure_student_can_access_question", allow_question)
    ai_svc = _AiService()

    with pytest.raises(HTTPException) as exc:
        await tutor_api.get_tutor_hint(
            body=schemas.TutorHintRequest(question_id="q1", given_answer="B", hint_type="hint"),
            student_id="student-1",
            question_svc=_QuestionService(),
            student_svc=_StudentService(),
            ai_svc=ai_svc,
            ai_usage_svc=_BlockedAiUsageService(),
        )

    assert exc.value.status_code == 429
    assert ai_svc.called is False
