import re
from typing import Any

from app.services.grading_trust_service import normalize_grading_trust
from app.services.grading_reliability import (
    CHOICE_QUESTION_TYPES,
    DETERMINISTIC_ANSWER_SOURCE,
    DETERMINISTIC_GRADING_BASIS,
    PENDING_GRADING_BASIS,
    is_deterministic_grading,
    is_pending_confirmation,
)

# A student's own correction is recorded, but it is not an independent check.
STUDENT_CORRECTION_CONFIDENCE = 0.6
STUDENT_CORRECTION_BASIS = "已按学生纠错结果修正，按低权重计入学习记录。"


PHYSICS_ERROR_TYPES = {
    "concept_misunderstanding": "概念理解错误",
    "model_selection": "模型选择错误",
    "condition_extraction": "条件识别错误",
    "diagram_analysis": "图像分析错误",
    "force_analysis": "受力分析错误",
    "equation_setup": "方程建立错误",
    "calculation": "数学处理错误",
    "unit_direction": "单位或方向错误",
    "expression_norm": "表达不规范",
    "none": "无明显错误",
    "unknown": "未能判断",
}


def error_type_name(error_type: str | None) -> str:
    return PHYSICS_ERROR_TYPES.get(error_type or "unknown", PHYSICS_ERROR_TYPES["unknown"])


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
    return None


def _as_score(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        return None


def process_grading_credit(process_grading: dict | None) -> float | None:
    """Return 0..1 credit from AI process grading, or None when unavailable."""
    if not isinstance(process_grading, dict):
        return None

    # Points are authoritative when their real denominator was supplied.
    score, maximum = process_grading.get("score"), process_grading.get("max_score")
    if (isinstance(score, (int, float)) and not isinstance(score, bool)
            and isinstance(maximum, (int, float)) and not isinstance(maximum, bool)
            and maximum > 0 and 0 <= score <= maximum):
        return score / maximum

    process_score = process_grading.get("process_score")
    if isinstance(process_score, (int, float)):
        return max(0.0, min(1.0, float(process_score) / 100.0))

    score = 0.0
    max_score = 0.0
    for item in process_grading.get("step_scores") or []:
        if not isinstance(item, dict):
            continue
        try:
            item_score = float(item.get("score") or 0)
            item_max_score = float(item.get("max_score") or 0)
        except (TypeError, ValueError):
            continue
        if item_max_score <= 0:
            continue
        score += max(0.0, item_score)
        max_score += item_max_score

    if max_score > 0:
        return max(0.0, min(1.0, score / max_score))
    return None


def answer_credit_from_grading(is_correct: bool, process_grading: dict | None) -> float:
    correction = process_grading.get("manual_correction") if isinstance(process_grading, dict) else None
    if isinstance(correction, dict) and isinstance(correction.get("is_correct"), bool):
        return float(correction["is_correct"])
    credit = process_grading_credit(process_grading)
    return credit if credit is not None else 1.0 if is_correct else 0.0


def effective_process_grading(raw: dict | None) -> dict:
    """Prefer the current manual verdict without exposing stale AI process claims."""
    raw = raw if isinstance(raw, dict) else {}
    correction = raw.get("manual_correction")
    if not isinstance(correction, dict) or not isinstance(correction.get("is_correct"), bool):
        return raw
    correct = correction["is_correct"]
    error = "none" if correct else correction.get("error_type") or raw.get("error_type") or "unknown"
    if not correct and error == "none":
        error = "unknown"
    return {
        **raw,
        "is_correct": correct,
        "final_answer": correction.get("corrected_answer", raw.get("final_answer", "")),
        "process_score": 100 if correct else 0,
        "process_score_percent": 100 if correct else 0,
        **({"score": raw["max_score"] if correct else 0, "max_score": raw["max_score"]}
           if isinstance(raw.get("max_score"), (int, float)) and raw["max_score"] > 0 else {}),
        "model_correct": None, "equation_correct": None,
        "calculation_correct": None, "unit_correct": None,
        "step_scores": [], "first_error": "", "next_action": "",
        "error_type": error, "error_type_name": error_type_name(error),
        "feedback": "已按人工纠错结果修正。",
        "grading_basis": STUDENT_CORRECTION_BASIS,
        "grading_confidence": STUDENT_CORRECTION_CONFIDENCE, "confidence_level": "medium",
        "needs_human_review": False,
    }


def _as_text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return normalize_answer_text(value, fallback=fallback)


def normalize_answer_text(value: Any, fallback: str = "") -> str:
    """Convert AI answer payloads into stable, human-readable text."""
    if value is None or value == "":
        return fallback
    if isinstance(value, str):
        return repair_latex_control_escapes(value).strip()
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            item_text = normalize_answer_text(item)
            if item_text:
                parts.append(f"{_localize_answer_key(str(key))} {item_text}")
        return "；".join(parts) or fallback
    if isinstance(value, list):
        parts = [normalize_answer_text(item) for item in value]
        return "；".join(part for part in parts if part) or fallback
    return repair_latex_control_escapes(str(value)).strip()


_LATEX_CONTROL_ESCAPE_REPAIRS = (
    ("\f" "rac", r"\frac"),
    ("\b" "eta", r"\beta"),
    ("\b" "ar", r"\bar"),
    ("\b" "oldsymbol", r"\boldsymbol"),
    ("\t" "heta", r"\theta"),
    ("\t" "imes", r"\times"),
    ("\t" "ext", r"\text"),
    ("\t" "an", r"\tan"),
    ("\r" "ight", r"\right"),
    ("\r" "ho", r"\rho"),
    ("\n" "eq", r"\neq"),
    ("\n" "abla", r"\nabla"),
)


def repair_latex_control_escapes(text: str) -> str:
    """Repair JSON control-character escapes created from unescaped LaTeX."""
    repaired = text
    for broken, fixed in _LATEX_CONTROL_ESCAPE_REPAIRS:
        repaired = repaired.replace(broken, fixed)
    return repaired


_ANSWER_KEY_LABELS = {
    "acceleration": "加速度",
    "velocity": "速度",
    "speed": "速度",
    "time": "时间",
    "displacement": "位移",
    "distance": "距离",
    "height": "高度",
    "initial_velocity": "初速度",
    "final_velocity": "末速度",
}


def _localize_answer_key(key: str) -> str:
    normalized = key.strip()
    if normalized in _ANSWER_KEY_LABELS:
        return _ANSWER_KEY_LABELS[normalized]
    match = re.fullmatch(r"displacement_after_([0-9]+(?:\.[0-9]+)?)s", normalized)
    if match:
        return f"{match.group(1)}s 后位移"
    match = re.fullmatch(r"velocity_after_([0-9]+(?:\.[0-9]+)?)s", normalized)
    if match:
        return f"{match.group(1)}s 后速度"
    return normalized


def normalize_process_grading(
    raw: dict | None,
    fallback_answer: str = "",
    fallback_feedback: str = "",
) -> dict:
    """Normalize AI grading into the stable shape used by APIs and the DB."""
    raw = effective_process_grading(raw)
    error_type = _as_text(raw.get("error_type")) or (
        "none" if raw.get("is_correct") is True else "unknown"
    )
    if error_type not in PHYSICS_ERROR_TYPES:
        error_type = "unknown"

    final_answer = _as_text(
        raw.get("final_answer") or raw.get("extracted_answer"),
        fallback_answer,
    )
    feedback = _as_text(raw.get("feedback"), fallback_feedback)

    result = {
        "final_answer": final_answer,
        "process_score": _as_score(raw.get("process_score")),
        "model_correct": _as_bool(raw.get("model_correct")),
        "equation_correct": _as_bool(raw.get("equation_correct")),
        "calculation_correct": _as_bool(raw.get("calculation_correct")),
        "unit_correct": _as_bool(raw.get("unit_correct")),
        "error_type": error_type,
        "error_type_name": error_type_name(error_type),
        "first_error": _as_text(raw.get("first_error")),
        "next_action": _as_text(raw.get("next_action")),
        "feedback": feedback,
    }
    answer_image_path = _as_text(raw.get("answer_image_path"))
    if answer_image_path:
        result["answer_image_path"] = answer_image_path
    answer_crop_image_path = _as_text(raw.get("answer_crop_image_path"))
    if answer_crop_image_path:
        result["answer_crop_image_path"] = answer_crop_image_path
    answer_page_image_path = _as_text(raw.get("answer_page_image_path"))
    if answer_page_image_path:
        result["answer_page_image_path"] = answer_page_image_path
    answer_source = _as_text(raw.get("answer_source"))
    if answer_source:
        result["answer_source"] = answer_source
    _keep_teacher_score(raw, result)
    process_evidence_kind = _as_text(raw.get("process_evidence_kind"))
    if process_evidence_kind:
        result["process_evidence_kind"] = process_evidence_kind
    process_evidence_image_path = _as_text(raw.get("process_evidence_image_path"))
    if process_evidence_image_path:
        result["process_evidence_image_path"] = process_evidence_image_path
    answer_image_paths = raw.get("answer_image_paths")
    if isinstance(answer_image_paths, list):
        paths = [normalize_answer_text(path) for path in answer_image_paths if normalize_answer_text(path)]
        if paths:
            result["answer_image_paths"] = paths
    answer_page_image_paths = raw.get("answer_page_image_paths")
    if isinstance(answer_page_image_paths, list):
        paths = [normalize_answer_text(path) for path in answer_page_image_paths if normalize_answer_text(path)]
        if paths:
            result["answer_page_image_paths"] = paths
    result.update(normalize_grading_trust({
        **raw,
        "final_answer": final_answer,
        "feedback": feedback,
        "error_type": error_type,
    }))
    correction = raw.get("manual_correction")
    if isinstance(correction, dict) and isinstance(correction.get("is_correct"), bool):
        result.update(
            grading_confidence=STUDENT_CORRECTION_CONFIDENCE,
            confidence_level="medium",
            needs_human_review=False,
            grading_basis=STUDENT_CORRECTION_BASIS,
        )
    return result


_EVIDENCE_KEYS = (
    "answer_image_path", "answer_image_paths", "answer_crop_image_path",
    "answer_page_image_path", "answer_page_image_paths",
    "process_evidence_kind", "process_evidence_image_path",
)


def display_process_grading(
    raw: dict | None,
    fallback_answer: str = "",
    fallback_feedback: str = "",
    question_type: Any = None,
) -> dict | None:
    """Grading shown to students.

    Objective options have no solving process: tapped answers and choice questions
    answered on paper show the answer (and its photo), never the model/equation/
    calculation/unit dimensions the AI could not judge. A student's correction keeps
    the full record; an unconfirmed photo keeps its "not counted yet" notice.
    """
    raw_dict = raw if isinstance(raw, dict) else {}
    choice_question = str(getattr(question_type, "value", question_type) or "") in CHOICE_QUESTION_TYPES
    corrected = isinstance(raw_dict.get("manual_correction"), dict)
    if corrected or not (choice_question or is_deterministic_grading(raw)):
        return normalize_process_grading(raw, fallback_answer=fallback_answer, fallback_feedback=fallback_feedback)
    raw = raw_dict
    pending = is_pending_confirmation(raw)
    if not pending and not any(raw.get(key) for key in _EVIDENCE_KEYS):
        return None
    # Keep attached scratch images visible without inventing AI judgments.
    normalized = normalize_process_grading(raw, fallback_answer=fallback_answer, fallback_feedback=fallback_feedback)
    shown = {key: normalized[key] for key in _EVIDENCE_KEYS if normalized.get(key)}
    shown.update({
        "final_answer": normalized.get("final_answer") or fallback_answer,
        "feedback": normalized.get("feedback") or None,
        # A photographed choice answer stays correctable; only taps are final.
        "answer_source": raw.get("answer_source") or DETERMINISTIC_ANSWER_SOURCE,
        "grading_confidence": normalized.get("grading_confidence") if pending else 1.0,
        "confidence_level": "low" if pending else "high",
        "needs_human_review": pending,
        "grading_basis": PENDING_GRADING_BASIS if pending else DETERMINISTIC_GRADING_BASIS,
        "step_scores": [],
    })
    if raw.get("answer_source") == TEACHER_PAPER_SOURCE:
        # A teacher's released score on paper: keep its points and comment, a half-right
        # multiple choice included.
        shown.update(process_score=normalized.get("process_score"), feedback=normalized.get("feedback") or None,
                     grading_basis=raw.get("grading_basis") or shown["grading_basis"])
        _keep_teacher_score(raw, shown)
    return shown


TEACHER_PAPER_SOURCE = "teacher_paper"


def _keep_teacher_score(raw: dict, result: dict) -> None:
    """Points from a teacher's review (paper homework) travel with the grading, so clients can show
    “11/12 分” rather than only right or wrong."""
    score, full = raw.get("score"), raw.get("max_score")
    if isinstance(score, (int, float)) and isinstance(full, (int, float)) and full > 0:
        result["score"], result["max_score"] = float(score), float(full)
        if isinstance(raw.get("process_score_percent"), (int, float)):
            result["process_score_percent"] = raw["process_score_percent"]
