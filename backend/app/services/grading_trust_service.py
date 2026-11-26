import math
from typing import Any


UNCERTAIN_MARKERS = ("无法", "未能", "不确定", "看不清", "模糊", "建议人工")


def _as_float(value: Any, default: float = 0.75) -> float:
    try:
        if value is None or value == "":
            return default
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _as_text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    return _repair_latex_control_escapes(str(value)).strip() or fallback


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


def _repair_latex_control_escapes(text: str) -> str:
    repaired = text
    for broken, fixed in _LATEX_CONTROL_ESCAPE_REPAIRS:
        repaired = repaired.replace(broken, fixed)
    return repaired


def _normalize_step_scores(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    steps: list[dict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        raw_name = _as_text(item.get("name") or item.get("step"))
        name = _normalize_step_name(raw_name, index)
        if not name:
            continue
        score = _bounded_points(item.get("score"), 0)
        max_score = max(0.01, _bounded_points(item.get("max_score", item.get("full_score")), 1))
        if score > max_score:
            max_score = score
        comment = _as_text(item.get("comment") or item.get("basis"))
        steps.append({
            "name": name[:40],
            "score": score,
            "max_score": max_score,
            "comment": comment[:120],
        })
    return steps


def _normalize_step_name(name: str, index: int) -> str:
    if not name:
        return f"步骤{index}"
    compact = name.strip()
    formula_like = any(token in compact for token in ("$", "=", "\\frac", "_{", "^{"))
    process_like = compact.startswith(("由", "代入", "根据")) or "，" in compact or "," in compact
    if formula_like or (len(compact) > 12 and process_like):
        return f"步骤{index}"
    return compact


def _bounded_points(value: Any, default: float) -> float:
    try:
        if value is None or value == "":
            return default
        number = float(value)
        return max(0, number) if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _confidence_level(confidence: float) -> str:
    if confidence >= 0.8:
        return "high"
    if confidence >= 0.55:
        return "medium"
    return "low"


def normalize_grading_trust(raw: dict | None) -> dict:
    """Normalize AI grading trust fields into a stable education-facing shape."""
    raw = raw if isinstance(raw, dict) else {}
    feedback = _as_text(raw.get("feedback"))
    extracted = _as_text(raw.get("extracted_answer") or raw.get("final_answer"))
    error_type = _as_text(raw.get("error_type"), "unknown")
    confidence = _as_float(
        raw.get("grading_confidence", raw.get("confidence")),
        default=0.75,
    )

    uncertain_text = f"{feedback} {extracted}"
    uncertain = (
        (not extracted and raw.get("is_correct") is not True)
        or error_type == "unknown"
        or any(marker in uncertain_text for marker in UNCERTAIN_MARKERS)
        or raw.get("needs_human_review") is True
    )
    if uncertain:
        confidence = min(confidence, 0.4)

    level = _confidence_level(confidence)
    needs_human_review = bool(raw.get("needs_human_review")) or level == "low" or uncertain
    grading_basis = _as_text(raw.get("grading_basis"))
    if not grading_basis:
        if needs_human_review:
            grading_basis = "AI 对该题识别或判断不够确定，建议人工确认后再作为学习结论。"
        elif feedback:
            grading_basis = feedback
        else:
            grading_basis = "依据最终答案、关键步骤和标准答案一致性进行判断。"

    return {
        "grading_confidence": round(confidence, 2),
        "confidence_level": level,
        "needs_human_review": needs_human_review,
        "grading_basis": grading_basis[:300],
        "step_scores": _normalize_step_scores(raw.get("step_scores")),
    }
