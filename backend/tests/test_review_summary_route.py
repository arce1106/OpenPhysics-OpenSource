from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api.student import journey


@pytest.fixture(autouse=True)
def no_videos(monkeypatch):
    monkeypatch.setattr(journey, "answer_video_summaries", AsyncMock(return_value={}))


def question():
    return SimpleNamespace(
        id="q-1",
        stem_text="物体做匀变速直线运动，求末速度。",
        question_type=SimpleNamespace(value="calculation"),
        answer="20 m/s",
        explanation="先由速度公式列式，再代入数据。",
        labels=[SimpleNamespace(label_type="knowledge_point", label_id="kp-1")],
        images=[],
        options=[],
    )


def answer():
    return SimpleNamespace(
        id=17,
        question_id="q-1",
        given_answer="18 m/s",
        created_at=datetime(2026, 7, 26, tzinfo=timezone.utc),
        misconception_ids=[],
        grading_result={
            "error_type": "calculation_error",
            "error_type_name": "计算错误",
            "first_error": "代入数据时算错",
            "next_action": "重新核对代入",
            "feedback": "公式正确",
            "needs_human_review": False,
            "answer_image_paths": ["/static/uploads/answers/student-1/a.jpg"],
        },
    )


class FakeStudentService:
    db = None
    async def get_wrong_answers(self, student_id: str, limit: int):
        return [answer()]

    async def get_mistake_clearance_counts(self, student_id: str):
        return {"reviewed": 2, "total": 3}

    async def get_answer(self, student_id: str, answer_id: int):
        return answer() if answer_id == 17 else None


class FakeQuestionService:
    async def get_questions_by_ids(self, question_ids):
        return [question()]

    async def get_question(self, question_id: str):
        return question() if question_id == "q-1" else None


class FakeKnowledgeService:
    async def get_all_points(self):
        return [SimpleNamespace(id="kp-1", name="匀变速直线运动")]


class RecordingRichContentService:
    def __init__(self):
        self.calls = []

    def enrich_review_group_summaries(self, groups):
        self.calls.append("summary")
        groups[0]["mistakes"][0]["stem_rendered"] = {
            "html": "<p>题干</p>",
            "plain_text": "题干",
            "renderer": "katex",
            "renderer_version": "test",
            "content_hash": "hash",
            "has_math": False,
            "has_image": False,
            "has_markdown_table": False,
            "errors": [],
        }

    def enrich_review_groups(self, groups):
        self.calls.append("detail")
        groups[0]["mistakes"][0]["explanation_rendered"] = {
            "html": "<p>解析</p>",
            "plain_text": "解析",
            "renderer": "katex",
            "renderer_version": "test",
            "content_hash": "hash",
            "has_math": False,
            "has_image": False,
            "has_markdown_table": False,
            "errors": [],
        }


@pytest.mark.asyncio
async def test_review_summary_keeps_print_fields_and_omits_detail_fields():
    renderer = RecordingRichContentService()

    response = await journey.get_review(
        student_id="student-1",
        group_by="kp",
        summary_only=True,
        student_svc=FakeStudentService(),
        question_svc=FakeQuestionService(),
        knowledge_svc=FakeKnowledgeService(),
        rich_content_svc=renderer,
        include_rendered=True,
    )

    mistake = response.groups[0]["mistakes"][0]
    assert renderer.calls == ["summary"]
    assert mistake["stem_text"].startswith("物体做匀变速")
    assert mistake["stem_rendered"]["html"] == "<p>题干</p>"
    assert mistake["given_answer"] == "18 m/s"
    # The score stays so the list can show partial credit (e.g. 11/12); steps and feedback are detail fields.
    assert set(mistake["process_grading"]) == {"answer_image_paths", "needs_human_review", "process_score"}
    assert mistake["process_grading"]["answer_image_paths"][0].startswith(
        "/api/student/answer-images/student-1/a.jpg",
    )
    assert "correct_answer" not in mistake
    assert "explanation" not in mistake
    assert response.review_center.total_pending == 1
    assert response.review_center.primary_focus.first_error == "代入数据时算错"


@pytest.mark.asyncio
async def test_review_default_response_remains_complete_for_existing_clients():
    renderer = RecordingRichContentService()

    response = await journey.get_review(
        student_id="student-1",
        group_by="kp",
        summary_only=False,
        student_svc=FakeStudentService(),
        question_svc=FakeQuestionService(),
        knowledge_svc=FakeKnowledgeService(),
        rich_content_svc=renderer,
        include_rendered=True,
    )

    mistake = response.groups[0]["mistakes"][0]
    assert renderer.calls == ["detail"]
    assert mistake["correct_answer"] == "20 m/s"
    assert mistake["explanation"] == "先由速度公式列式，再代入数据。"
    assert mistake["explanation_rendered"]["html"] == "<p>解析</p>"


@pytest.mark.asyncio
async def test_review_mistake_detail_returns_complete_student_owned_mistake():
    renderer = RecordingRichContentService()

    response = await journey.get_review_mistake(
        answer_id=17,
        student_id="student-1",
        student_svc=FakeStudentService(),
        question_svc=FakeQuestionService(),
        rich_content_svc=renderer,
        include_rendered=True,
    )

    assert renderer.calls == ["detail"]
    assert response.answer_id == 17
    assert response.correct_answer == "20 m/s"
    assert response.explanation == "先由速度公式列式，再代入数据。"
    assert response.explanation_rendered.html == "<p>解析</p>"
