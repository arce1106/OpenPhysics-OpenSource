"""Keep rubric points alongside the percentage used by learning statistics."""
import math


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def normalize_grading_scores(raw: dict) -> dict:
    result = dict(raw)
    process = _number(raw.get("process_score"))
    score = _number(raw.get("score"))
    maximum = _number(raw.get("max_score"))
    if maximum is None:
        maximum = _number(raw.get("process_score_max", raw.get("full_score")))
    if score is None and maximum is not None:
        score = process

    # Only complete, explicit step denominators establish a rubric. Never invent
    # full marks from a "correct" verdict or from steps that omitted their maxima.
    steps = raw.get("step_scores")
    if maximum is None and isinstance(steps, list) and steps:
        earned = full = 0.0
        for step in steps:
            if not isinstance(step, dict):
                break
            points = _number(step.get("score"))
            possible = _number(step.get("max_score", step.get("full_score")))
            if points is None or possible is None or possible <= 0 or not 0 <= points <= possible:
                break
            earned += points
            full += possible
        else:
            # Legacy models sometimes returned earned points as process_score;
            # a percentage such as 80 with steps totaling 8/10 stays a percentage.
            if (process is None or math.isclose(process, earned, abs_tol=0.01)
                    or math.isclose(process, 100 * earned / full, abs_tol=0.01)):
                score, maximum = earned, full

    if score is not None and maximum is not None:
        if maximum > 0 and 0 <= score <= maximum:
            result.update(score=score, max_score=maximum,
                          process_score=round(100 * score / maximum),
                          process_score_percent=round(100 * score / maximum, 4))
        else:
            result["needs_human_review"] = True
            result["process_score"] = None
    return result


def apply_full_points(raw: dict, full_points: float | None) -> dict:
    """Points are shown only on the question's real scale.

    A model is never told a bank question's value, so any max_score it returns is
    its own invention. With the teacher's points for this question, the earned
    share is restated on that scale (half points, like the teacher's sheet);
    without them only the percentage remains.
    """
    result = normalize_grading_scores(raw)
    score, maximum = _number(result.get("score")), _number(result.get("max_score"))
    ratio = None
    if score is not None and maximum is not None and maximum > 0 and 0 <= score <= maximum:
        ratio = score / maximum
    elif _number(result.get("process_score")) is not None:
        ratio = max(0.0, min(1.0, _number(result.get("process_score")) / 100))
    result.pop("score", None)
    result.pop("max_score", None)
    full = _number(full_points)
    if full is not None and full > 0 and ratio is not None:
        earned = round(full * ratio * 2) / 2
        result.update(score=earned, max_score=full,
                      process_score=round(100 * earned / full),
                      process_score_percent=round(100 * earned / full, 4))
    elif ratio is not None:
        result.update(process_score=round(100 * ratio), process_score_percent=round(100 * ratio, 4))
    return result
