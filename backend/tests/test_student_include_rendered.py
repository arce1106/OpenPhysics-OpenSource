from types import SimpleNamespace

import pytest

from app.api.student import practice


class RecordingRichContentService:
    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.enrich_questions_calls = 0

    def enrich_questions(self, questions):
        self.enrich_questions_calls += 1
        if self.fail:
            raise RuntimeError("renderer unavailable")
        for question in questions or []:
            question["stem_rendered"] = {
                "html": "<p>rendered</p>",
                "plain_text": question.get("stem_text", ""),
                "renderer": "katex",
                "renderer_version": "test",
                "content_hash": "hash",
                "has_math": False,
                "has_image": False,
                "has_markdown_table": False,
                "errors": [],
            }


class FakeAdaptiveService:
    async def get_practice_session(self, student_id, target_kp_id=None, count=5):
        return {
            "session_type": "practice",
            "questions": [
                {
                    "id": "q1",
                    "stem_text": "普通题干",
                    "options": [{"label": "A", "text": "选项"}],
                }
            ],
        }


@pytest.mark.asyncio
async def test_practice_session_defaults_to_no_rendered(monkeypatch):
    async def allow_access(student_id: str, kp_id: str, student_svc):
        return None

    monkeypatch.setattr(practice, "ensure_student_can_access_kp", allow_access)
    renderer = RecordingRichContentService()

    result = await practice.get_practice_session(
        student_id="student-1",
        target_kp="kp1",
        count=1,
        adaptive_svc=FakeAdaptiveService(),
        student_svc=SimpleNamespace(),
        rich_content_svc=renderer,
    )

    assert renderer.enrich_questions_calls == 0
    assert "stem_rendered" not in result["questions"][0]


@pytest.mark.asyncio
async def test_practice_session_include_rendered_enriches_questions(monkeypatch):
    async def allow_access(student_id: str, kp_id: str, student_svc):
        return None

    monkeypatch.setattr(practice, "ensure_student_can_access_kp", allow_access)
    renderer = RecordingRichContentService()

    result = await practice.get_practice_session(
        student_id="student-1",
        target_kp="kp1",
        count=1,
        adaptive_svc=FakeAdaptiveService(),
        student_svc=SimpleNamespace(),
        rich_content_svc=renderer,
        include_rendered=True,
    )

    assert renderer.enrich_questions_calls == 1
    assert result["questions"][0]["stem_rendered"]["renderer"] == "katex"


@pytest.mark.asyncio
async def test_practice_session_include_rendered_failure_does_not_fail_request(monkeypatch):
    async def allow_access(student_id: str, kp_id: str, student_svc):
        return None

    monkeypatch.setattr(practice, "ensure_student_can_access_kp", allow_access)
    renderer = RecordingRichContentService(fail=True)

    result = await practice.get_practice_session(
        student_id="student-1",
        target_kp="kp1",
        count=1,
        adaptive_svc=FakeAdaptiveService(),
        student_svc=SimpleNamespace(),
        rich_content_svc=renderer,
        include_rendered=True,
    )

    assert renderer.enrich_questions_calls == 1
    assert result["questions"][0]["stem_text"] == "普通题干"
    assert "stem_rendered" not in result["questions"][0]
