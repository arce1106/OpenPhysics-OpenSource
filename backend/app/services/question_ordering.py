"""Pedagogical ordering for student-facing question sets."""

from __future__ import annotations

from typing import Any, Iterable, TypeVar


T = TypeVar("T")

CHOICE_TYPES = {"single_choice", "multiple_choice", "true_false"}
MID_TYPES = {"experiment", "fill_in_blank", "knowledge_fill_in_blank", "graph_construction"}
LONG_TYPES = {"problem_solving", "comprehensive"}

QUESTION_TYPE_ORDER = {
    **{question_type: 0 for question_type in CHOICE_TYPES},
    **{question_type: 1 for question_type in MID_TYPES},
    **{question_type: 2 for question_type in LONG_TYPES},
}

DIFFICULTY_TIER_ORDER = {
    "easy": 1.0,
    "moderate_easy": 2.0,
    "medium": 3.0,
    "moderate_hard": 4.0,
    "hard": 5.0,
}


def ordered_questions_for_student(questions: Iterable[T]) -> list[T]:
    """Order a question set from familiar forms to open-response, then easy to hard."""
    return sorted(questions, key=question_order_key)


def question_order_key(question: Any) -> tuple[int, float, str]:
    question_type = _value(_field(question, "question_type"))
    type_order = QUESTION_TYPE_ORDER.get(question_type or "", 9)
    return (
        type_order,
        _difficulty_value(question),
        str(_field(question, "id") or ""),
    )


def _difficulty_value(question: Any) -> float:
    difficulty = _field(question, "difficulty")
    if difficulty is not None:
        try:
            return float(difficulty)
        except (TypeError, ValueError):
            pass

    tier = _value(_field(question, "difficulty_tier"))
    return DIFFICULTY_TIER_ORDER.get(tier or "", 99.0)


def _field(question: Any, key: str) -> Any:
    if isinstance(question, dict):
        return question.get(key)
    return getattr(question, key, None)


def _value(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "value"):
        return str(value.value)
    return str(value)
