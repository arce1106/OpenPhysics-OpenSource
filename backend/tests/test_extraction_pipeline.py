import json
import pytest
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.question import Question
from app.services.doc_parser import DocParser
from app.services.question_importer import QuestionImporter
from app.services.question_service import QuestionService

TEST_DOC = Path("/home/quantis/.openclaw/workspace/OpenPhysics/第一章　1　质点　参考系.docx")


@pytest.mark.asyncio
async def test_parse_and_import_flow(db_session):
    """Parse a real doc, verify fragments, import a mock question."""
    if not TEST_DOC.exists():
        pytest.skip("Test document not found")

    parser = DocParser()
    fragments = parser.parse(TEST_DOC)
    assert len(fragments) > 0

    # Verify each fragment has valid structure
    for f in fragments:
        assert f.raw_text, f"Fragment {f.fragment_index} has no text"
        assert f.source_doc

    # Create a mock extracted question from first fragment
    first = fragments[0]
    mock_question = {
        "id": "q_test_e2e_001",
        "stem_text": first.raw_text[:200],
        "answer": "测试答案",
        "explanation": "测试解析",
        "question_type": "single_choice",
        "difficulty": 1.5,
        "quality_status": "draft",
        "options": [
            {"label": "A", "text": "选项A", "is_correct": True},
            {"label": "B", "text": "选项B", "is_correct": False},
        ],
        "labels": [
            {"knowledge_point_id": "v1c1s1k01", "role": "主要"},
        ],
        "formulas": [],
        "images": [],
    }

    # Import it
    qs = QuestionService(db_session)
    importer = QuestionImporter(qs)
    results = await importer.import_questions([mock_question])
    assert len(results) == 1
    assert results[0].success

    # Verify it's in the DB (eager-load children to avoid MissingGreenlet)
    result = await db_session.execute(
        select(Question)
        .where(Question.id == "q_test_e2e_001")
        .options(selectinload(Question.options), selectinload(Question.labels))
    )
    q = result.scalars().first()
    assert q is not None
    assert len(q.options) == 2
    assert len(q.labels) == 1

    # No explicit cleanup needed: the db_session fixture drops and recreates
    # all tables between tests. Note: QuestionService.delete_question has a
    # known MissingGreenlet issue with lazy-loading children in async context.


@pytest.mark.asyncio
async def test_importer_skips_existing_question_ids_by_default(db_session):
    qs = QuestionService(db_session)
    importer = QuestionImporter(qs)
    question = {
        "id": "q_duplicate_guard",
        "stem_text": "原题干",
        "answer": "A",
        "explanation": "原解析",
        "question_type": "single_choice",
        "quality_status": "draft",
        "options": [],
        "labels": [],
        "formulas": [],
        "images": [],
    }

    first = await importer.import_questions([question])
    assert first[0].action == "created"
    assert first[0].success

    duplicate = dict(question)
    duplicate["stem_text"] = "不应覆盖的新题干"
    second = await importer.import_questions([duplicate])
    assert second[0].action == "skipped"
    assert not second[0].success

    saved = await qs.get_question("q_duplicate_guard")
    assert saved.stem_text == "原题干"


@pytest.mark.asyncio
async def test_importer_allows_existing_question_updates_when_explicit(db_session):
    qs = QuestionService(db_session)
    importer = QuestionImporter(qs, allow_updates=True)
    question = {
        "id": "q_duplicate_update",
        "stem_text": "原题干",
        "answer": "A",
        "explanation": "原解析",
        "question_type": "single_choice",
        "quality_status": "draft",
        "options": [],
        "labels": [],
        "formulas": [],
        "images": [],
    }

    await importer.import_questions([question])
    updated = dict(question)
    updated["stem_text"] = "允许更新的新题干"
    result = await importer.import_questions([updated])

    assert result[0].action == "updated"
    assert result[0].success
    saved = await qs.get_question("q_duplicate_update")
    assert saved.stem_text == "允许更新的新题干"


def test_parser_with_all_docs():
    """Test parser handles all 3 chapter 1 documents."""
    base = TEST_DOC.parent
    docs = sorted(base.glob("第一章*.docx"))
    if not docs:
        pytest.skip("No test documents found")

    parser = DocParser()
    for doc in docs:
        fragments = parser.parse(doc)
        assert len(fragments) > 0, f"No fragments in {doc.name}"
        print(f"{doc.name}: {len(fragments)} fragments")
