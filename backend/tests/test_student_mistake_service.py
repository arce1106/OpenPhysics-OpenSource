import pytest

from app.services.review_mistake_utils import (
    choice_misconception_from_option,
    readable_misconception_name,
)
from app.services.question_service import QuestionService
from app.services.student_service import StudentService


@pytest.mark.asyncio
async def test_wrong_answers_are_deduplicated_by_question_and_clear_together(db_session):
    q_svc = QuestionService(db_session)
    for question_id in ("q_same", "q_other"):
        await q_svc.create_question({
            "id": question_id,
            "stem_text": "测试题",
            "answer": "D",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty_tier": "easy",
            "source": "human",
            "options": [],
            "labels": [],
            "formulas": [],
            "images": [],
        })

    svc = StudentService(db_session)
    student = await svc.create_student("mistake_dedup", "pass123", "mistake_dedup")

    first = await svc.record_answer(student.id, "q_same", "A", False, 1000)
    second = await svc.record_answer(student.id, "q_same", "B", False, 2000)
    other = await svc.record_answer(student.id, "q_other", "C", False, 3000)

    mistakes = await svc.get_wrong_answers(student.id, limit=10)

    assert [answer.question_id for answer in mistakes] == ["q_other", "q_same"]
    assert next(answer for answer in mistakes if answer.question_id == "q_same").id == second.id

    cleared = await svc.mark_mistake_reviewed(student.id, second.id)
    assert cleared is True

    remaining = await svc.get_wrong_answers(student.id, limit=10)
    assert [answer.question_id for answer in remaining] == ["q_other"]

    counts = await svc.get_mistake_clearance_counts(student.id)
    assert counts == {"reviewed": 1, "total": 2}
    assert first.id != second.id
    assert other.id != second.id


@pytest.mark.asyncio
async def test_choice_mistake_uses_option_misconception_as_chinese_fallback(db_session):
    q_svc = QuestionService(db_session)
    question = await q_svc.create_question({
        "id": "q_choice_misconception",
        "stem_text": "速度图像中斜率表示什么？",
        "answer": "A",
        "explanation": "v-t 图像斜率表示加速度。",
        "question_type": "single_choice",
        "difficulty_tier": "easy",
        "source": "human",
        "options": [
            {"label": "A", "text": "加速度", "is_correct": True},
            {
                "label": "B",
                "text": "位移",
                "is_correct": False,
                "targets_misconception": "diagram_analysis",
            },
        ],
        "labels": [],
        "formulas": [],
        "images": [],
    })

    misconception = choice_misconception_from_option(question, "B")

    assert misconception == {"id": "diagram_analysis", "name": "图像分析错误"}


def test_unknown_imported_misconceptions_keep_readable_fallbacks():
    assert readable_misconception_name("mics_avg") == "常见概念误区"
    assert readable_misconception_name("misc_avg_velocity_avg_speed") == "常见概念误区"
    assert readable_misconception_name("self_review_needed") == "自评待复盘"
