from __future__ import annotations

from app.services.physics_error_types import error_type_name
from app.services.review_mistake_utils import readable_misconception_name


def build_review_center(groups: list[dict]) -> dict:
    """Build a learning summary for the wrong-answer notebook."""
    total_pending = sum(len(group.get("mistakes", [])) for group in groups)
    error_map: dict[str, dict] = {}

    for group in groups:
        kp_name = group.get("kp_name") or group.get("kp_id") or "未归类知识点"
        for mistake in group.get("mistakes", []):
            grading = mistake.get("process_grading") if isinstance(mistake.get("process_grading"), dict) else {}
            misconception = mistake.get("misconception") if isinstance(mistake.get("misconception"), dict) else {}
            # "unknown"/"none" from AI grading carries no cause; let a diagnosed misconception speak.
            error_type = grading.get("error_type")
            if error_type in {None, "", "none", "unknown"}:
                error_type = misconception.get("id") or "unknown"
            if error_type in {"none", ""}:
                error_type = "unknown"
            error_name = (
                readable_misconception_name(
                    error_type,
                    grading.get("error_type_name") or misconception.get("name"),
                )
                if error_type
                else error_type_name(error_type)
            )
            row = error_map.setdefault(error_type, {
                "error_type": error_type,
                "error_name": error_name,
                "count": 0,
                "kp_names": [],
                "sample_answer_id": mistake.get("answer_id"),
                "sample_question_id": mistake.get("question_id"),
                "first_error": "",
                "next_action": "",
            })
            row["count"] += 1
            if kp_name not in row["kp_names"]:
                row["kp_names"].append(kp_name)
            if not row["first_error"] and grading.get("first_error"):
                row["first_error"] = grading["first_error"]
            if not row["next_action"] and grading.get("next_action"):
                row["next_action"] = grading["next_action"]

    error_groups = sorted(
        error_map.values(),
        key=lambda item: (-item["count"], item["error_name"]),
    )
    primary_focus = error_groups[0] if error_groups else None

    return {
        "total_pending": total_pending,
        "primary_focus": primary_focus,
        "error_groups": error_groups,
        "review_steps": _build_review_steps(primary_focus),
        "stage_counts": {
            "待复盘": total_pending,
            "错因明确": sum(1 for item in error_groups if item["error_type"] != "unknown"),
            "需要人工确认": sum(item["count"] for item in error_groups if item["error_type"] == "unknown"),
        },
    }


def _build_review_steps(primary_focus: dict | None) -> list[dict[str, str]]:
    if not primary_focus:
        return [
            {"title": "保持练习", "description": "当前没有待复盘错题。"},
        ]

    first_error = primary_focus.get("first_error") or "先重新读题，找出第一处判断或列式错误。"
    next_action = primary_focus.get("next_action") or "完成一题同类变式，确认这个错误已经修正。"
    return [
        {
            "title": "先看第一处错误",
            "description": first_error,
        },
        {
            "title": "再看正确解法",
            "description": "对照解析，只订正导致后续错误的关键一步。",
        },
        {
            "title": "最后做同类变式",
            "description": next_action,
        },
    ]
