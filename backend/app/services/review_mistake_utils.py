import re
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.services.physics_error_types import PHYSICS_ERROR_TYPES, error_type_name


CHOICE_TYPES = {"single_choice", "multiple_choice", "true_false"}
SEED_DIR = Path(__file__).resolve().parent.parent / "seed"



@lru_cache(maxsize=1)
def _seed_misconception_names() -> dict[str, str]:
    path = SEED_DIR / "misconceptions.json"
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        str(row.get("id")): str(row.get("name")).strip()
        for row in rows
        if row.get("id") and row.get("name")
    }


def _has_chinese(text: str | None) -> bool:
    return bool(text and re.search(r"[\u4e00-\u9fff]", text))


# Ids the grader records itself rather than taking from the misconception seed.
SYSTEM_MISCONCEPTION_NAMES = {
    "self_review_needed": "自评待复盘",
}


def readable_misconception_name(misconception_id: str | None, fallback: str | None = None) -> str:
    """Return a student-facing Chinese label for legacy and current misconception ids."""
    if _has_chinese(fallback):
        return str(fallback)

    raw_id = (misconception_id or "").strip()
    if not raw_id:
        return "未能判断"

    if raw_id in SYSTEM_MISCONCEPTION_NAMES:
        return SYSTEM_MISCONCEPTION_NAMES[raw_id]

    canonical_id = raw_id
    seed_name = _seed_misconception_names().get(canonical_id)
    if seed_name:
        return seed_name

    if canonical_id in PHYSICS_ERROR_TYPES:
        return error_type_name(canonical_id)

    if raw_id.startswith(("misc_", "mics_")):
        return "常见概念误区"
    return fallback or raw_id


def choice_misconception_from_option(question: Any, given_answer: str | None) -> dict | None:
    """Infer a readable misconception for objective questions from selected options."""
    question_type = getattr(question, "question_type", None)
    question_type_value = question_type.value if hasattr(question_type, "value") else question_type
    if question_type_value not in CHOICE_TYPES:
        return None

    selected_labels = _selected_option_labels(given_answer)
    if not selected_labels:
        return {"id": "choice_misjudgment", "name": "选项判断错误"}

    options = list(getattr(question, "options", []) or [])
    for option in options:
        if option.label in selected_labels and getattr(option, "targets_misconception", None):
            misconception_id = option.targets_misconception
            name = readable_misconception_name(misconception_id)
            if name == error_type_name("unknown"):
                name = "选项理解偏差"
            return {"id": misconception_id, "name": name}

    return {"id": "choice_misjudgment", "name": "选项判断错误"}


def _selected_option_labels(given_answer: str | None) -> set[str]:
    text = (given_answer or "").strip().upper()
    if not text:
        return set()
    return set(re.findall(r"\b[A-H]\b|[A-H]", text))
