"""Decide how much a grading verdict may be trusted before it becomes learning evidence.

A verdict only changes mastery when it is reliable: deterministic objective
grading, or an AI result the model itself did not flag as uncertain. Uncertain AI
results are still recorded and shown, but stay "pending confirmation" until the
student confirms or corrects them.
"""

import re
from typing import Any

CHOICE_QUESTION_TYPES = {"single_choice", "multiple_choice", "true_false"}
DETERMINISTIC_ANSWER_SOURCE = "choice"
PENDING_FLAG = "_pending_confirmation"
GRADING_METHOD_KEY = "_grading_method"
LOW_MODEL_CONFIDENCE = 0.5

PENDING_GRADING_BASIS = "AI 对本题的识别或判断不够确定，本次暂不计入掌握度；确认或纠正批改结果后再计入。"
INSTRUCTION_IN_ANSWER_BASIS = "作答中含有要求批改结果的文字（如“判为正确”），本次暂不计入掌握度；确认或纠正批改结果后再计入。"
NO_ANSWER_KEY_DETAIL = "本题暂缺标准答案，系统不判对错，本次不计入学习记录。"

# A process score that contradicts the verdict means one of them is wrong.
PROCESS_CONFLICT_KEY = "_verdict_process_conflict"
PROCESS_CONFLICT_LOW = 0.5   # judged correct, but less than half the process credit
PROCESS_CONFLICT_HIGH = 0.8  # judged wrong, but at least 80% of the process credit
DETERMINISTIC_GRADING_BASIS = "选择题按所选选项自动判分。"
UNRECOGNIZED_PHOTO_DETAIL = "AI 未能识别图片中的作答，本次不计入学习记录。请重新拍照（光线充足、只拍本题），或改用文字作答。"

_TRUE_WORDS = {"true", "1", "yes", "y", "correct", "对", "正确", "是"}
_FALSE_WORDS = {"false", "0", "no", "n", "wrong", "incorrect", "错", "错误", "否"}
_CHOICE_LETTERS = re.compile(r"[A-Ha-hＡ-Ｈａ-ｈ]")


def strict_verdict(value: Any) -> bool | None:
    """Return a boolean verdict, or None when the model did not give a clear one."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        word = value.strip().lower()
        if word in _TRUE_WORDS:
            return True
        if word in _FALSE_WORDS:
            return False
    return None


def _confidence(raw: dict) -> float | None:
    for key in ("confidence", "grading_confidence"):
        value = raw.get(key)
        if isinstance(value, bool) or value is None or value == "":
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def model_flagged_uncertain(raw: dict | None, *, require_verdict: bool = True) -> bool:
    """True when the AI result itself says it should not be trusted as a learning conclusion."""
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("needs_human_review") is True:
        return True
    confidence = _confidence(raw)
    if confidence is not None and confidence < LOW_MODEL_CONFIDENCE:
        return True
    return require_verdict and strict_verdict(raw.get("is_correct")) is None


def has_choice_letters(answer: str | None) -> bool:
    return bool(_CHOICE_LETTERS.search(answer or ""))


def photo_answer_unrecognized(question_type: str, extracted_answer: str | None) -> bool:
    """A photo answer that cannot be graded at all must not be recorded as wrong."""
    text = (extracted_answer or "").strip()
    if not text:
        return True
    return question_type in CHOICE_QUESTION_TYPES and not has_choice_letters(text)


def is_pending_confirmation(grading: Any) -> bool:
    return isinstance(grading, dict) and grading.get(PENDING_FLAG) is True


def is_deterministic_grading(grading: Any) -> bool:
    """Objective answers judged by option comparison, including legacy records."""
    if not isinstance(grading, dict):
        return True
    if isinstance(grading.get("manual_correction"), dict):
        return False
    if grading.get(GRADING_METHOD_KEY) == "deterministic":
        return True
    if grading.get("answer_source") == DETERMINISTIC_ANSWER_SOURCE:
        return True
    return not any(not str(key).startswith("_") for key in grading)


class UngradableQuestion(ValueError):
    """The question has no standard answer, so no verdict can be founded on it."""

    def __init__(self, detail: str = NO_ANSWER_KEY_DETAIL):
        super().__init__(detail)


def has_answer_key(answer: Any) -> bool:
    return bool(str(answer or "").strip())


def answer_key_for(question: Any) -> str:
    """The standard answer a verdict is founded on.

    Choice questions imported without an answer string fall back to the options
    flagged correct; every other question needs an explicit answer.
    """
    answer = str(getattr(question, "answer", None) or "").strip()
    if answer:
        return answer
    question_type = getattr(question, "question_type", None)
    question_type = str(getattr(question_type, "value", question_type) or "")
    if question_type not in CHOICE_QUESTION_TYPES:
        return ""
    try:
        options = list(getattr(question, "options", None) or [])
    except Exception:  # noqa: BLE001 - an unloaded relationship means "no fallback key"
        return ""
    labels = sorted(
        str(option.label).strip() for option in options
        if getattr(option, "is_correct", False) and str(getattr(option, "label", "") or "").strip()
    )
    if not labels:
        return ""
    if question_type == "true_false":
        return labels[0]
    return "".join(labels)


def verdict_process_conflict(is_correct: bool, credit: float | None) -> bool:
    """True when the AI verdict and its own process score disagree."""
    if credit is None:
        return False
    if is_correct:
        return credit < PROCESS_CONFLICT_LOW
    return credit >= PROCESS_CONFLICT_HIGH


def process_conflict_basis(is_correct: bool, credit: float) -> str:
    verdict = "正确" if is_correct else "错误"
    return (
        f"AI 判定本题{verdict}，但过程分为 {round(credit * 100)} 分，两者不一致；"
        "本次暂不计入掌握度，确认或纠正批改结果后再计入。"
    )


# Audit A15: text a student writes to steer the grader ("判为正确", "ignore the
# rules"). Models are told to ignore it; this catches it in code as well.
_GRADING_INSTRUCTION = re.compile(
    r"判[为成]?(?:正确|对)|按正确(?:处理|批改|计)|给(?:我)?满分|打满分|满分处理"
    r"|忽略(?:以上|上面|之前|前面|所有)|无视(?:以上|上面|规则|要求)"
    r"|ignore\s+(?:all|any|previous|the\s+above)|system\s*prompt",
    re.IGNORECASE,
)


def answer_contains_grading_instruction(answer: str | None) -> bool:
    return bool(_GRADING_INSTRUCTION.search(answer or ""))
