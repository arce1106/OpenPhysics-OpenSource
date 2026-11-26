import pytest
from sqlalchemy import select
from app.services.question_service import QuestionService
from app.models.question import QualityStatus
from app.models.student import ItemStats
from app.services.knowledge_service import KnowledgeService


@pytest.mark.asyncio
async def test_create_question_with_options(db_session):
    svc = QuestionService(db_session)
    q = await svc.create_question({
        "id": "q_test_1",
        "stem_text": "一个物体质量为2kg，受到5N的力，求加速。",
        "answer": "2.5 m/s²",
        "explanation": "F = ma，a = F/m = 5/2 = 2.5 m/s²",
        "question_type": "problem_solving",
        "difficulty": 2.0,
        "source": "human",
        "options": [
            {"label": "A", "text": "2.5 m/s²", "is_correct": True},
            {"label": "B", "text": "10 m/s²", "is_correct": False},
        ],
        "labels": [
            {"label_type": "knowledge_point", "label_id": "v1c3s1k01", "role": "主要"},
        ],
        "formulas": [
            {"id": "fml_1", "latex": "F = ma", "formula_role": "solution_formula"},
        ],
        "images": [],
    })
    assert q.id == "q_test_1"
    assert len(q.options) == 2
    assert len(q.labels) == 1
    assert len(q.formulas) == 1


@pytest.mark.asyncio
async def test_review_question(db_session):
    svc = QuestionService(db_session)
    q = await svc.create_question({
        "id": "q_test_2",
        "stem_text": "测试题目",
        "answer": "A",
        "explanation": "解析",
        "source": "ai_generated",
        "options": [],
        "labels": [],
        "formulas": [],
        "images": [],
    })
    assert q.quality_status == QualityStatus.draft

    reviewed = await svc.review_question("q_test_2", QualityStatus.approved)
    assert reviewed.quality_status == QualityStatus.approved


@pytest.mark.asyncio
async def test_delete_question_removes_item_stats(db_session):
    svc = QuestionService(db_session)
    await svc.create_question({
        "id": "q_delete_with_stats",
        "stem_text": "带统计记录的题目",
        "answer": "A",
        "explanation": "解析",
        "source": "human",
        "options": [{"label": "A", "text": "A", "is_correct": True}],
        "labels": [],
        "formulas": [],
        "images": [],
    })
    db_session.add(ItemStats(
        question_id="q_delete_with_stats",
        total_attempts=2,
        correct_rate=0.5,
        avg_time_ms=1000,
        difficulty_estimate=0.5,
    ))
    await db_session.commit()

    assert await svc.delete_question("q_delete_with_stats") is True
    assert await svc.get_question("q_delete_with_stats") is None
    assert (await db_session.execute(
        select(ItemStats).where(ItemStats.question_id == "q_delete_with_stats")
    )).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_list_questions_can_page_by_chapter_scope(db_session):
    kp_svc = KnowledgeService(db_session)
    await kp_svc.create_point({
        "id": "scope_ch_kp_1",
        "name": "章内知识点一",
        "volume": "测试册",
        "chapter": "第一章 测试章",
        "section": "1 测试节",
    })
    await kp_svc.create_point({
        "id": "scope_ch_kp_2",
        "name": "章内知识点二",
        "volume": "测试册",
        "chapter": "第一章 测试章",
        "section": "2 测试节",
    })
    await kp_svc.create_point({
        "id": "scope_ch_kp_3",
        "name": "章外知识点",
        "volume": "测试册",
        "chapter": "第二章 章外",
        "section": "1 测试节",
    })

    svc = QuestionService(db_session)
    for qid, kp_id in [
        ("q_scope_ch_1", "scope_ch_kp_1"),
        ("q_scope_ch_2", "scope_ch_kp_2"),
        ("q_scope_ch_3", "scope_ch_kp_3"),
    ]:
        await svc.create_question({
            "id": qid,
            "stem_text": "范围测试题",
            "answer": "A",
            "explanation": "解析",
            "question_type": "single_choice",
            "difficulty": 1.0,
            "difficulty_tier": "easy",
            "source": "curated",
            "quality_status": "draft",
            "labels": [
                {"label_type": "knowledge_point", "label_id": kp_id, "role": "主要", "confidence": 1.0, "source": "test"},
            ],
        })

    items = await svc.list_questions(
        volume="测试册",
        chapter="第一章 测试章",
        limit=20,
        offset=0,
    )
    total = await svc.count_questions(volume="测试册", chapter="第一章 测试章")

    assert total == 2
    assert {item.id for item in items} == {"q_scope_ch_1", "q_scope_ch_2"}


@pytest.mark.asyncio
async def test_question_usage_reports_answers_that_block_deletion(db_session):
    from app.services.student_service import StudentService

    svc = QuestionService(db_session)
    for qid in ("q_usage_answered", "q_usage_unused"):
        await svc.create_question({
            "id": qid,
            "stem_text": "题干",
            "answer": "A",
            "explanation": "解析",
            "source": "human",
            "options": [{"label": "A", "text": "A", "is_correct": True}],
            "labels": [],
            "formulas": [],
            "images": [],
        })
    students = StudentService(db_session)
    student = await students.create_student("usage_student", "pass123", "usage_student")
    await students.record_answer(student.id, "q_usage_answered", "A", True, 1000)

    assert await svc.question_usage("q_usage_missing") is None
    assert await svc.question_usage("q_usage_unused") == {}
    assert await svc.question_usage("q_usage_answered") == {"学生作答": 1}
