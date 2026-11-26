"""Check that the distributed chapter can pass the real import schema and has no dangling references."""

import json
from pathlib import Path

import pytest

from app.api.admin.schemas import QuestionCreate
from app.models.question import DifficultyTier, QuestionType
from app.services.question_importer import QuestionImporter


BACKEND = Path(__file__).resolve().parents[1]


@pytest.mark.asyncio
async def test_demo_chapter_import_schema_and_answer_integrity():
    payload = json.loads((BACKEND / "data/demo/chapter01.json").read_text())
    questions = payload["questions"]
    kps = json.loads((BACKEND / "app/seed/knowledge_points.json").read_text())
    known_kps = {row["id"] for row in kps}
    cards = json.loads((BACKEND / "app/seed/knowledge_cards.json").read_text())
    demo_kps = {card["kp_id"] for card in cards}
    ids = set()
    covered_kps = set()
    imported = []

    class ImportSink:
        async def get_question(self, question_id):
            return None

        async def create_question(self, data):
            imported.append(QuestionCreate.model_validate(data))

    results = await QuestionImporter(ImportSink(), static_dir=BACKEND / "static/questions").import_questions(questions)
    assert all(result.success for result in results)
    assert len(imported) == len(questions)
    for row, model in zip(questions, imported):
        assert model.id not in ids
        ids.add(model.id)
        QuestionType(model.question_type)
        DifficultyTier(model.difficulty_tier)
        assert model.answer and model.explanation
        kp_ids = {label.label_id for label in model.labels if label.label_type == "knowledge_point"}
        assert kp_ids and kp_ids <= known_kps
        covered_kps.update(kp_ids)
        if model.options:
            expected = {option.label for option in model.options if option.is_correct}
            assert set(model.answer) == expected
            assert len(expected) == 1 if model.question_type == "single_choice" else len(expected) > 1
        for image in row.get("images", []):
            assert (BACKEND / "static/questions" / image["ref"]).is_file()
    assert covered_kps == demo_kps


def test_demo_cards_only_reference_distributed_chapter():
    kps = {row["id"]: row for row in json.loads((BACKEND / "app/seed/knowledge_points.json").read_text())}
    cards = json.loads((BACKEND / "app/seed/knowledge_cards.json").read_text())
    assert len(cards) == 8
    assert all(kps[card["kp_id"]]["chapter"] == "第一章 运动的描述" for card in cards)
    assert len({card["id"] for card in cards}) == len(cards)


def test_complete_directory_metadata_does_not_embed_teaching_bodies():
    kps = json.loads((BACKEND / "app/seed/knowledge_points.json").read_text())
    cards = json.loads((BACKEND / "app/seed/knowledge_cards.json").read_text())
    demo_ids = {card["kp_id"] for card in cards}
    assert len(kps) == len({row["id"] for row in kps}) == 574
    assert len({row["volume"] for row in kps}) == 6
    assert len({(row["volume"], row["chapter"]) for row in kps}) == 27
    assert len({(row["volume"], row["chapter"], row["section"]) for row in kps}) == 126
    for row in kps:
        assert row["name"] and not row["name"].startswith("知识点 ")
        assert row["chapter"].startswith("第")
        # Outside the original demo, distribute only directory metadata.
        if row["id"] not in demo_ids:
            assert not row.get("description")


@pytest.mark.asyncio
async def test_original_examples_cover_every_knowledge_point_and_import_without_conflicts():
    from collections import Counter

    files = [BACKEND / 'data/demo/chapter01.json', BACKEND / 'data/demo/knowledge-point-examples.json']
    questions = [q for path in files for q in json.loads(path.read_text())['questions']]
    kps = {row['id'] for row in json.loads((BACKEND / 'app/seed/knowledge_points.json').read_text())}
    imported = []

    class ImportSink:
        async def get_question(self, question_id):
            return None

        async def create_question(self, data):
            imported.append(QuestionCreate.model_validate(data))

    results = await QuestionImporter(ImportSink(), static_dir=BACKEND / 'static/questions').import_questions(questions)
    assert all(result.success for result in results)
    assert len(imported) == len(questions) == 586
    assert len({q.id for q in imported}) == 586
    assert len({q.stem_text for q in imported}) == 586
    counts = Counter(label.label_id for q in imported for label in q.labels
                     if label.label_type == 'knowledge_point' and (label.role or '主要') == '主要')
    assert set(counts) == kps
    assert min(counts.values()) >= 1
    for q in imported:
        assert q.explanation
        if q.options:
            assert {o.label for o in q.options if o.is_correct} == set(q.answer)
    added = json.loads(files[1].read_text())['questions']
    assert len(added) == 566
    assert Counter(q['answer'] for q in added) == {'A': 283, 'B': 283}
