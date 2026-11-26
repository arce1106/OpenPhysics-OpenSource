"""Keep topic performance distinct from attributable foundation evidence."""

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.question import Question
from app.models.teacher_paper import TeacherPaperAttempt

TOPIC_LAYERS = {"diagnostic", "foundation", "breakthrough", "transfer", "paper"}


def normalize_topic_context(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"catalog_code", "node_id", "layer"}:
        raise ValueError("Invalid topic context")
    if value["catalog_code"] != "gaokao_review" or value["layer"] not in TOPIC_LAYERS:
        raise ValueError("Invalid topic context")
    if not isinstance(value["node_id"], str) or not 0 < len(value["node_id"]) <= 128:
        raise ValueError("Invalid topic context")
    return dict(value)


def includes_basic_mastery(grading):
    return not isinstance(grading, dict) or grading.get("_mastery_scope") != "topic_only"


def topic_updates_basic(context, question):
    if context is None:
        return True
    # Only foundation practice with an unambiguous primary target is evidence
    # of foundation mastery; a whole composite question cannot diagnose it.
    primary = {label.label_id for label in question.labels
               if label.label_type == "knowledge_point"
               and str(label.role or "").strip().lower() in {"primary", "主要"}}
    return context["layer"] == "foundation" and len(primary) == 1


async def resolve_topic_context(db, student_id, question, context=None, paper_attempt_id=None):
    context = normalize_topic_context(context)
    if paper_attempt_id:
        attempt = await db.scalar(select(TeacherPaperAttempt).where(
            TeacherPaperAttempt.id == paper_attempt_id, TeacherPaperAttempt.student_id == student_id))
        if not attempt or question.id not in attempt.question_ids:
            raise ValueError("Invalid topic paper attempt")
        expected = {"catalog_code": attempt.catalog_code, "node_id": attempt.node_id, "layer": "paper"}
        if context is not None and context != expected:
            raise ValueError("Topic context does not match the paper attempt")
        return expected
    if context:
        from app.services.learning_catalog_service import LearningCatalogService
        catalog = LearningCatalogService(db)
        if not await catalog._get_topic_node(context["catalog_code"], context["node_id"]):
            raise ValueError("Topic not found")
        if question.id not in await catalog.resolve_question_ids(context["node_id"]):
            raise ValueError("Question does not belong to this topic")
    return context


async def loaded_question(db, question_id):
    return await db.scalar(select(Question).where(Question.id == question_id).options(selectinload(Question.labels)))


def topic_answer_score(answer):
    grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
    correction = grading.get("manual_correction")
    if isinstance(correction, dict) and isinstance(correction.get("is_correct"), bool):
        return float(correction["is_correct"])
    score = grading.get("process_score")
    if isinstance(score, (int, float)) and not isinstance(score, bool):
        import math
        if math.isfinite(score):
            return max(0.0, min(1.0, float(score) / 100))
    return float(bool(answer.is_correct))
