from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.student import journey
from app.api.student.journey import _review_question_exclusions
from app.services.adaptive_service import AdaptiveService


def service_with_answered_candidates():
    svc = object.__new__(AdaptiveService)
    svc.student_svc = SimpleNamespace()
    svc.question_svc = SimpleNamespace()
    original = SimpleNamespace(id="original", labels=[
        SimpleNamespace(label_type="knowledge_point", label_id="kp")
    ])
    previous = SimpleNamespace(id="previous", labels=original.labels)
    older = SimpleNamespace(id="older", labels=original.labels)
    svc.student_svc.get_answer_history = AsyncMock(return_value=[
        SimpleNamespace(id=1, question_id="original", grading_result={}),
        SimpleNamespace(id=2, question_id="previous"),
        SimpleNamespace(id=3, question_id="older"),
    ])
    svc.question_svc.get_question = AsyncMock(return_value=original)
    svc.question_svc.get_questions_by_knowledge_point = AsyncMock(return_value=[previous, older])
    svc._best_surface_match_candidates = lambda original, candidates: candidates
    svc._variation_score = lambda *args: 1
    svc._serialize_question = lambda question, **kwargs: {"id": question.id}
    return svc


@pytest.mark.asyncio
async def test_new_review_round_never_reuses_explicitly_excluded_wrong_question():
    svc = service_with_answered_candidates()
    result = await svc.get_variation_questions("student", 1, limit=1, exclude_question_ids={"previous"})
    assert result[0]["question"]["id"] == "older"


@pytest.mark.asyncio
async def test_exhausted_pool_returns_empty_instead_of_reopening_failed_round():
    svc = service_with_answered_candidates()
    result = await svc.get_variation_questions("student", 1, limit=1, exclude_question_ids={"previous", "older"})
    assert result == []
    assert await svc.get_similar_question("student", 1, exclude_question_ids={"previous", "older"}) is None


def test_review_exclusion_input_is_bounded_and_deduplicated():
    assert _review_question_exclusions("q1, q2,q1,,") == {"q1", "q2"}
    with pytest.raises(HTTPException) as error:
        _review_question_exclusions(",".join(f"q{i}" for i in range(201)))
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_legacy_android_variation_request_keeps_its_existing_fallback():
    svc = service_with_answered_candidates()
    result = await svc.get_variation_questions("student", 1, limit=1)
    assert result[0]["question"]["id"] == "previous"


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["variations", "retry"])
@pytest.mark.parametrize("exclusions", [None, " previous,older,previous "])
async def test_review_routes_accept_legacy_calls_and_forward_web_round_exclusions(monkeypatch, endpoint, exclusions):
    monkeypatch.setattr(journey, "ensure_student_can_access_question", AsyncMock())
    question = {"id": "available", "stem_text": "兼容性验收题"}
    adaptive = SimpleNamespace(
        get_variation_questions=AsyncMock(return_value=[{"variation_type": "foundation", "question": question}]),
        get_similar_question=AsyncMock(return_value=question),
    )
    student = SimpleNamespace(get_answer=AsyncMock(return_value=SimpleNamespace(question_id="original")))
    handler = journey.get_review_variations if endpoint == "variations" else journey.retry_similar
    response = await handler(
        answer_id=1, student_id="student", adaptive_svc=adaptive, student_svc=student,
        include_rendered=False, x_openphysics_include_rendered=None, exclude_question_ids=exclusions,
    )
    kwargs = {"exclude_question_ids": {"previous", "older"}} if exclusions else {}
    if endpoint == "variations":
        adaptive.get_variation_questions.assert_awaited_once_with("student", 1, limit=1, **kwargs)
        assert response.variations[0].question["id"] == "available"
    else:
        adaptive.get_similar_question.assert_awaited_once_with("student", 1, **kwargs)
        assert response.question["id"] == "available"
