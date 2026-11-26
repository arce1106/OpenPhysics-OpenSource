"""Topic evidence must not silently become foundation mastery evidence."""
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.models.knowledge import KnowledgePoint
from app.models.learning_catalog import LearningCatalog, LearningCatalogNode, LearningCatalogNodeEvidence, LearningCatalogNodeKnowledgePoint
from app.models.question import Question, QuestionLabel, QuestionType, QualityStatus
from app.models.student import StudentAnswer
from app.services.adaptive_service import AdaptiveService
from app.services.learning_catalog_service import LearningCatalogService
from app.services.mastery_scope import includes_basic_mastery
from app.services.student_service import StudentService

KP = "v1c1s1k01"
NODE = "scope_topic"


def context(layer="transfer"):
    return {"catalog_code": "gaokao_review", "node_id": NODE, "layer": layer}


async def seed(db):
    db.add_all([KnowledgePoint(id=KP, name="质点"), KnowledgePoint(id="scope_kp2", name="参考系"), KnowledgePoint(id="scope_kp3", name="运动")])
    db.add(LearningCatalog(id="scope_catalog", code="gaokao_review", name="高考"))
    await db.flush()
    db.add(LearningCatalogNode(id=NODE, catalog_id="scope_catalog", code="01", node_type="topic", title="专题"))
    await db.flush()
    db.add_all([LearningCatalogNodeKnowledgePoint(node_id=NODE, knowledge_point_id=kp) for kp in (KP,"scope_kp2","scope_kp3")])
    for qid, kind in [("basic", QuestionType.single_choice), ("topic", QuestionType.single_choice), ("written", QuestionType.problem_solving)]:
        db.add(Question(id=qid, stem_text="合成边界测试", answer="A", question_type=kind, quality_status=QualityStatus.approved))
        await db.flush()
        db.add(QuestionLabel(question_id=qid, label_type="knowledge_point", label_id=KP, role="主要"))
    await db.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("layer", ["diagnostic", "foundation", "breakthrough", "transfer", "paper"])
async def test_scope_for_each_layer_retry_and_replay(db_session, layer):
    db = db_session
    await seed(db)
    service = AdaptiveService(db)
    await service.submit_answer("scope_student", "basic", "A", submission_id="normal")
    before = await StudentService(db).get_mastery("scope_student", KP)
    original = (before.mastery, before.attempts, before.correct_rate)
    result = await service.submit_answer("scope_student", "topic", "B", submission_id="topic", topic_context=context(layer))
    applies = layer == "foundation"
    assert bool(result["mastery_update"]) == applies
    after = await StudentService(db).get_mastery("scope_student", KP)
    assert after.attempts == (2 if applies else 1)
    if not applies:
        assert (after.mastery, after.attempts, after.correct_rate) == original
    answer = await db.get(StudentAnswer, result["answer_id"])
    assert includes_basic_mastery(answer.grading_result) == applies
    assert answer.grading_result["_topic_context"] == context(layer)
    assert await db.scalar(select(func.count()).select_from(LearningCatalogNodeEvidence)) == 1
    replay = await service.submit_answer("scope_student", "topic", "B", submission_id="topic", topic_context=context(layer))
    assert replay["idempotent_replay"] and replay["mastery_update"] == result["mastery_update"]
    await StudentService(db).rebuild_mastery_for_kp("scope_student", KP, refresh_answer_snapshots=True)
    after_rebuild = await StudentService(db).get_mastery("scope_student", KP)
    assert after_rebuild.attempts == (2 if applies else 1)
    assert await db.scalar(select(func.count()).select_from(LearningCatalogNodeEvidence)) == 1


@pytest.mark.asyncio
async def test_self_review_and_manual_correction_only_change_topic_performance(db_session):
    db = db_session
    await seed(db)
    service = AdaptiveService(db)
    result = await service.submit_self_review("scope_student", "written", [{"label":"第一问", "status":"partial"}],
        submission_id="self", topic_context=context())
    assert result["mastery_update"] == {}
    assert await StudentService(db).get_mastery("scope_student", KP) is None
    overview = await LearningCatalogService(db).get_topic_overview("scope_student", "gaokao_review", NODE)
    assert overview["performance_score"] == .5
    assert overview["untested_knowledge_point_count"] == 2
    assert overview["coverage_ratio"] == .3333
    assert overview["evidence_count"] == 1
    assert overview["layer_performance"][1]["performance_score"] is None
    corrected = await StudentService(db).apply_manual_correction("scope_student", result["answer_id"], "A", True)
    assert corrected["mastery_update"] == {}
    assert await StudentService(db).get_mastery("scope_student", KP) is None
    overview = await LearningCatalogService(db).get_topic_overview("scope_student", "gaokao_review", NODE)
    assert overview["performance_score"] == 1
    assert overview["evidence_count"] == 1


@pytest.mark.asyncio
async def test_legacy_topic_registration_removes_only_its_basic_evidence(db_session):
    db = db_session
    await seed(db)
    service = AdaptiveService(db)
    await service.submit_answer("scope_student", "basic", "A", submission_id="ordinary")
    legacy = await service.submit_answer("scope_student", "topic", "B", submission_id="old-app")
    assert (await StudentService(db).get_mastery("scope_student", KP)).attempts == 2
    catalog = LearningCatalogService(db)
    for _ in range(2):
        await catalog.record_topic_answer("scope_student", "gaokao_review", NODE, answer_id=legacy["answer_id"], layer="paper")
    repaired = await StudentService(db).get_mastery("scope_student", KP)
    assert repaired.attempts == 1 and repaired.correct_rate == 1
    answer = await db.get(StudentAnswer, legacy["answer_id"])
    assert answer.given_answer == "B" and not answer.is_correct
    assert answer.grading_result["_previous_basic_mastery_update"]
    assert answer.grading_result["_mastery_update"] == {}
    with pytest.raises(ValueError, match="different topic context"):
        await catalog.record_topic_answer("scope_student", "gaokao_review", NODE, answer_id=legacy["answer_id"], layer="foundation")


@pytest.mark.asyncio
async def test_topic_evidence_and_answer_commit_together(db_session, monkeypatch):
    db = db_session
    await seed(db)
    monkeypatch.setattr(LearningCatalogService, "record_topic_answer", AsyncMock(side_effect=RuntimeError("storage failure")))
    with pytest.raises(RuntimeError, match="storage failure"):
        await AdaptiveService(db).submit_answer("scope_student", "topic", "A", submission_id="atomic", topic_context=context())
    assert await db.scalar(select(func.count()).select_from(StudentAnswer)) == 0
    assert await StudentService(db).get_mastery("scope_student", KP) is None


@pytest.mark.asyncio
async def test_unknown_topic_and_unmapped_question_rejected_before_grading(db_session):
    db = db_session
    await seed(db)
    with pytest.raises(ValueError, match="Topic not found"):
        await AdaptiveService(db).submit_answer("scope_student", "topic", "A", topic_context={**context(), "node_id": "missing"})
    assert await db.scalar(select(func.count()).select_from(StudentAnswer)) == 0


@pytest.mark.asyncio
async def test_ambiguous_foundation_question_does_not_change_basic_mastery(db_session):
    db = db_session
    await seed(db)
    db.add(QuestionLabel(question_id="topic", label_type="knowledge_point", label_id="scope_kp2", role="主要"))
    await db.commit()
    result = await AdaptiveService(db).submit_answer("scope_student", "topic", "B", topic_context=context("foundation"))
    assert result["mastery_update"] == {}


@pytest.mark.asyncio
async def test_historical_repair_is_scoped_and_repeatable(db_session):
    from app.services.topic_mastery_repair import repair_topic_mastery
    db = db_session
    await seed(db)
    svc = AdaptiveService(db)
    normal = await svc.submit_answer("history", "basic", "A", submission_id="normal")
    old = await svc.submit_answer("history", "topic", "B", submission_id="old")
    db.add(LearningCatalogNodeEvidence(student_id="history", node_id=NODE, answer_id=old["answer_id"],
        question_id="topic", knowledge_point_id=KP, layer="paper", score=0))
    await db.commit()
    before = await repair_topic_mastery(db)
    assert before["answers_to_classify"] == before["mastery_pairs_to_rebuild"] == 1
    assert (await StudentService(db).get_mastery("history", KP)).attempts == 2
    await repair_topic_mastery(db, apply=True)
    await db.commit()
    assert (await StudentService(db).get_mastery("history", KP)).attempts == 1
    old_answer = await db.get(StudentAnswer, old["answer_id"])
    assert old_answer.given_answer == "B" and old_answer.grading_result["_mastery_update"] == {}
    normal_answer = await db.get(StudentAnswer, normal["answer_id"])
    assert includes_basic_mastery(normal_answer.grading_result)
    again = await repair_topic_mastery(db)
    assert again["answers_to_classify"] == again["mastery_pairs_to_rebuild"] == 0


@pytest.mark.asyncio
async def test_historical_owned_paper_restores_missing_topic_registration(db_session):
    from app.models.student import Student
    from app.models.teacher_paper import TeacherPaperAttempt
    from app.services.topic_mastery_repair import repair_topic_mastery
    db = db_session
    await seed(db)
    db.add(Student(id="paper_history", username="paper_history", display_name="测试", password_hash="!synthetic"))
    await db.flush()
    db.add(TeacherPaperAttempt(id="old-paper", student_id="paper_history", paper_id="synthetic", catalog_code="gaokao_review",
        node_id=NODE, title="合成套卷", question_ids=["topic"], questions=[], status="completed"))
    await db.commit()
    old = await AdaptiveService(db).submit_answer("paper_history", "topic", "A", submission_id="old-paper-answer")
    answer = await db.get(StudentAnswer, old["answer_id"])
    answer.teacher_paper_attempt_id = "old-paper"
    await db.commit()
    preview = await repair_topic_mastery(db)
    assert preview["topic_evidence_to_restore"] == 1
    await repair_topic_mastery(db, apply=True)
    await db.commit()
    overview = await LearningCatalogService(db).get_topic_overview("paper_history", "gaokao_review", NODE)
    assert overview["performance_score"] == 1 and overview["evidence_count"] == 1
    assert (await StudentService(db).get_mastery("paper_history", KP)).attempts == 0
    assert (await repair_topic_mastery(db))["topic_evidence_to_restore"] == 0
