import asyncio
import json
from types import SimpleNamespace

import pytest
from app.services import ai_service
from app.services.student_ai_execution_service import _task_timeout


@pytest.mark.asyncio
async def test_ten_written_questions_are_split_without_losing_order_or_indices(monkeypatch):
    questions = [{"question_id": f"q{i}", "question_index": i, "question_type": "problem_solving",
                  "stem": "题", "correct_answer": "答案"} for i in range(1, 11)]
    groups = ai_service._paper_question_groups(questions)
    assert [len(group) for group in groups] == [2, 2, 2, 2, 2]
    assert all(ai_service._paper_output_tokens(g) <= ai_service.PAPER_GRADING_MAX_TOKENS for g in groups)
    assert all(ai_service._paper_output_tokens(g, extraction=True) <= ai_service.PAPER_EXTRACT_MAX_TOKENS for g in groups)
    monkeypatch.setattr(ai_service.AIService, "_use_doubao_single_pass", lambda self: True)
    monkeypatch.setattr(ai_service, "get_doubao_client", lambda: object())
    # Doubao's per-group answer budget is what this checks; DeepSeek's covers reasoning too.
    monkeypatch.setattr(ai_service.settings, "grading_primary_provider", "doubao")
    calls = []
    async def create(*args, **kwargs):
        calls.append(kwargs)
        prompt = json.loads(kwargs["messages"][1]["content"][0]["text"])
        await asyncio.sleep(0)
        items = [{"question_id": q["question_id"], "question_index": q["question_index"],
                  "extracted_answer": "答案", "is_correct": True, "score": 12, "max_score": 12}
                 for q in prompt["题目列表"]]
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=json.dumps(items)))])
    monkeypatch.setattr(ai_service, "create_chat_completion", create)
    result = await object.__new__(ai_service.AIService).judge_paper_batch_answers(["page"], questions)
    assert [(r["question_id"], r["question_index"]) for r in result] == [(q["question_id"], q["question_index"]) for q in questions]
    assert len(calls) == 5
    assert all(c["max_tokens"] == 30512 for c in calls)
    assert all(r["process_score"] == 100 for r in result)


def test_paper_timeout_covers_several_groups_without_changing_single_question_timeout(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "student_ai_timeout_seconds", 90)
    monkeypatch.setattr(ai_service.settings, "student_ai_paper_batch_timeout_seconds", 300)
    assert _task_timeout("practice.paper_batch_grading") == 300
    assert _task_timeout("practice.photo_vision_grading") == 90


def test_choice_heavy_papers_are_not_split_like_long_derivations():
    questions = [{"question_type": "single_choice"} for _ in range(20)]
    assert len(ai_service._paper_question_groups(questions)) == 1
