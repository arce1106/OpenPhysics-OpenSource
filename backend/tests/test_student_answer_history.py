from datetime import datetime, timezone

import pytest

from app.models.question import QualityStatus
from app.services.question_service import QuestionService
from app.services.student_service import StudentService
from app.services.answer_image_inference import should_infer_paper_batch_image


@pytest.mark.asyncio
async def test_get_answer_history_filters_by_growth_report_window(db_session):
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_history_window",
        "stem_text": "历史记录题目",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_history_window", QualityStatus.approved)

    svc = StudentService(db_session)
    old = await svc.record_answer("student_history", "q_history_window", "B", False)
    inside = await svc.record_answer("student_history", "q_history_window", "A", True)
    later = await svc.record_answer("student_history", "q_history_window", "A", True)

    old.created_at = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
    inside.created_at = datetime(2026, 5, 14, 8, 0, tzinfo=timezone.utc)
    later.created_at = datetime(2026, 5, 16, 8, 0, tzinfo=timezone.utc)
    await db_session.commit()

    answers = await svc.get_answer_history(
        "student_history",
        from_dt=datetime(2026, 5, 14, tzinfo=timezone.utc),
        to_dt=datetime(2026, 5, 15, tzinfo=timezone.utc),
    )

    assert [answer.id for answer in answers] == [inside.id]


def test_history_does_not_infer_paper_image_for_click_choice_answer():
    assert should_infer_paper_batch_image({}, "C") is False


def test_history_can_infer_paper_image_for_paper_placeholder():
    assert should_infer_paper_batch_image({}, "[整套纸笔照片]") is True


def test_history_can_infer_paper_image_for_existing_paper_source():
    assert should_infer_paper_batch_image({"answer_source": "paper_batch"}, "AD") is True


@pytest.mark.asyncio
async def test_finds_recent_paper_batch_answer_with_image(db_session):
    q_svc = QuestionService(db_session)
    await q_svc.create_question({
        "id": "q_recent_paper",
        "stem_text": "纸笔批改复用题目",
        "answer": "A",
        "explanation": "解析",
        "question_type": "single_choice",
        "difficulty": 1.0,
        "source": "human",
        "options": [{"label": "A", "text": "正确", "is_correct": True}],
        "labels": [],
        "formulas": [],
        "images": [],
    })
    await q_svc.review_question("q_recent_paper", QualityStatus.approved)

    svc = StudentService(db_session)
    paper = await svc.record_answer(
        "student_recent_paper",
        "q_recent_paper",
        "A",
        True,
        grading_result={
            "answer_source": "paper_batch",
            "answer_image_path": "/static/uploads/answers/student/paper-q.jpg",
        },
    )

    found = await svc.find_recent_paper_batch_answer(
        "student_recent_paper",
        "q_recent_paper",
        "A",
    )

    assert found.id == paper.id
