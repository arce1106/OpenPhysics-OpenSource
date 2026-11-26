"""Shared interpretation and replay of an answer's learning evidence."""

from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.choice_scoring import PARTIAL_CREDIT, PARTIAL_EVIDENCE_WEIGHT, is_partial_multiple_choice
from app.services.knowledge_tracing import KnowledgeTracingEngine
from app.services.physics_error_types import process_grading_credit


STUDENT_VERDICT_WEIGHT = 0.35
PROCESS_SCORE_QUESTION_TYPES = {
    "fill_in_blank", "knowledge_fill_in_blank", "experiment", "problem_solving", "comprehensive",
}


@dataclass(frozen=True)
class MasteryEvidence:
    correct: bool
    credit: float
    weight: float | None = None
    learning_transfer: bool = True
    initial_mastery: float | None = None


def answer_observed_at(answer) -> datetime:
    grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
    try:
        observed_at = datetime.fromisoformat(grading.get("_evidence_observed_at", ""))
    except (TypeError, ValueError):
        observed_at = answer.created_at
    return observed_at if observed_at.tzinfo else observed_at.replace(tzinfo=timezone.utc)


def answer_mastery_evidence(question, is_correct: bool, given_answer: str | None, grading: dict | None) -> MasteryEvidence:
    grading = grading if isinstance(grading, dict) else {}
    correction = grading.get("manual_correction")
    if isinstance(correction, dict) and isinstance(correction.get("is_correct"), bool):
        # A student's own verdict counts like self-review: recorded, not decisive.
        is_correct = correction["is_correct"]
        given_answer = correction.get("corrected_answer", given_answer)
        blank = not is_correct and not str(given_answer or "").strip()
        return MasteryEvidence(is_correct, float(is_correct), STUDENT_VERDICT_WEIGHT,
                               learning_transfer=not blank, initial_mastery=0.0 if blank else None)

    blank = not is_correct and not str(given_answer or "").strip()
    if grading.get("answer_source") == "self_review":
        items = grading.get("self_review_items")
        scores = [float(item["score"]) for item in (items or [])
                  if isinstance(item, dict) and isinstance(item.get("score"), (int, float))]
        score = sum(scores) / len(scores) if scores else process_grading_credit(grading)
        return MasteryEvidence(is_correct, max(0.0, min(1.0, score if score is not None else float(is_correct))),
                               STUDENT_VERDICT_WEIGHT)

    question_type = getattr(question, "question_type", None)
    question_type = getattr(question_type, "value", question_type)
    if not is_correct and is_partial_multiple_choice(question_type, getattr(question, "answer", None), given_answer):
        # 高考 rule: correct but incomplete multiple choice earns half.
        return MasteryEvidence(False, PARTIAL_CREDIT, PARTIAL_EVIDENCE_WEIGHT)
    score = process_grading_credit(grading) if question_type in PROCESS_SCORE_QUESTION_TYPES else None
    if score is not None:
        return MasteryEvidence(is_correct, 0.0 if blank else score, 0.55,
                               initial_mastery=0.0 if blank else None)
    return MasteryEvidence(is_correct, float(is_correct), learning_transfer=not blank,
                           initial_mastery=0.0 if blank else None)


def mastery_values_after_evidence(
    *, prior: float, attempts: int, correct_rate: float, last_practiced: datetime | None,
    observed_at: datetime, evidence: MasteryEvidence, question=None, forgetting_enabled: bool = False,
) -> dict:
    if evidence.initial_mastery is not None and attempts == 0 and last_practiced is None:
        prior = max(0.0, min(1.0, evidence.initial_mastery))
    if forgetting_enabled and last_practiced is not None:
        previous = last_practiced if last_practiced.tzinfo else last_practiced.replace(tzinfo=timezone.utc)
        current = observed_at if observed_at.tzinfo else observed_at.replace(tzinfo=timezone.utc)
        prior = KnowledgeTracingEngine.apply_forgetting(prior, (current - previous).total_seconds() / 86400)

    if evidence.weight is None:
        value = KnowledgeTracingEngine.p_learn(prior, evidence.correct,
            p_t=None if evidence.learning_transfer else 0.0, question=question)
        confidence = KnowledgeTracingEngine.entropy(value)
    else:
        value = max(0.0, min(1.0, prior + (evidence.credit - prior) * evidence.weight))
        confidence = KnowledgeTracingEngine.entropy(value) * evidence.weight
    return {
        "mastery": value, "confidence": confidence, "attempts": attempts + 1,
        "correct_rate": (correct_rate * attempts + evidence.credit) / (attempts + 1),
        "last_practiced": observed_at,
    }
