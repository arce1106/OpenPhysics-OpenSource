"""A retry must preserve worksheet numbering and never regrade saved answers."""
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from starlette.datastructures import Headers, UploadFile
from app.api.student import answer_grading


@pytest.mark.asyncio
@pytest.mark.parametrize('complete', [False, True])
async def test_paper_retry_keeps_original_indices_and_reuses_saved_answers(monkeypatch, tmp_path, complete):
    original_ids = ['q1', 'q2', 'q3']
    saved = {qid: {'answer_id': i + 1, 'is_correct': True} for i, qid in enumerate(original_ids)
             if complete or qid != 'q2'}
    adaptive = SimpleNamespace(
        get_existing_submission_response=AsyncMock(side_effect=lambda student, qid, submission: saved.get(qid)),
        submit_answer=AsyncMock(return_value={'answer_id': 2, 'is_correct': True, 'idempotent_replay': True}),
    )
    question = SimpleNamespace(question_type=SimpleNamespace(value='experiment'), stem_text='实验题', answer='2', options=[])
    question_svc = SimpleNamespace(get_question=AsyncMock(return_value=question))
    ai = SimpleNamespace(judge_paper_batch_answers=AsyncMock(return_value=[
        {'question_id': 'q2', 'extracted_answer': '2', 'is_correct': True, 'feedback': '正确'}]))
    async def run(student, *, operation, **kwargs):
        return await operation()
    usage = SimpleNamespace(run=AsyncMock(side_effect=run))
    crop = Mock(return_value={'q2': '/static/test/q2.jpg'})
    monkeypatch.setattr(answer_grading, '__file__', str(tmp_path / 'backend/app/api/student/answer_grading.py'))
    monkeypatch.setattr(answer_grading, 'ensure_student_can_access_question', AsyncMock())
    monkeypatch.setattr(answer_grading, 'crop_paper_batch_by_separators', crop)
    monkeypatch.setattr(answer_grading, 'maybe_enrich_rich_content', AsyncMock())
    monkeypatch.setattr(answer_grading.answer_media_service, 'secure_payload', lambda student, payload: payload)
    result = await answer_grading.submit_paper_batch_answers(
        images=[UploadFile(io.BytesIO(b'fake'), headers=Headers({'content-type': 'image/png'}))],
        question_ids=json.dumps(original_ids), student_id='test-student', time_spent_ms=0,
        submission_id='same-worksheet', teacher_paper_attempt_id=None, topic_context=None,
        target_knowledge_point_ids=None, adaptive_svc=adaptive, ai_svc=ai, question_svc=question_svc,
        reward_svc=SimpleNamespace(), quest_svc=SimpleNamespace(), student_svc=SimpleNamespace(),
        ai_usage_svc=usage, rich_content_svc=SimpleNamespace(), include_rendered=False,
        x_openphysics_include_rendered=None,
    )
    assert set(result['results']) == set(original_ids)
    assert result['results']['q1'] == saved['q1']
    assert result['results']['q3'] == saved['q3']
    if complete:
        ai.judge_paper_batch_answers.assert_not_called()
        adaptive.submit_answer.assert_not_called()
        crop.assert_not_called()
    else:
        pending = ai.judge_paper_batch_answers.call_args.args[1]
        assert [(q['question_id'], q['question_index']) for q in pending] == [('q2', 2)]
        assert crop.call_args.kwargs['question_ids'] == original_ids
        assert adaptive.submit_answer.call_count == 1
        assert adaptive.submit_answer.call_args.args[1] == 'q2'
        assert adaptive.submit_answer.call_args.kwargs['submission_id'] == 'same-worksheet'
        assert usage.run.call_args.kwargs['submission_key'] != 'same-worksheet'
