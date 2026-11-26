# The one "已掌握" line. Learning states, mastery judgments, rewards and the
# clients' mastery legends (80–100%) all follow this value.
STABLE_MASTERY_THRESHOLD = 0.8
MASTERED_THRESHOLD = STABLE_MASTERY_THRESHOLD
# Below "已掌握": 0.7–0.8 is shown as "较稳定" in mastery judgments.
STABLE_LEVEL_THRESHOLD = 0.7
PRACTICE_RECOMMENDATION_THRESHOLD = 0.5
REINFORCEMENT_THRESHOLD = 0.4


def classify_learning_state(
    status: str,
    mastery: float,
    attempts: int = 0,
    has_learning_progress: bool = False,
) -> dict[str, str]:
    """Classify a KP from backend evidence, not client-side presentation rules."""
    if mastery >= STABLE_MASTERY_THRESHOLD:
        return {"state": "mastered", "label": "已掌握", "tone": "mastered"}
    if attempts > 0 and mastery < STABLE_MASTERY_THRESHOLD:
        return {"state": "practice", "label": "待巩固", "tone": "practice"}
    # Prerequisites guide learning order; they must not erase actual practice.
    if status == "locked":
        return {"state": "locked", "label": "未开始", "tone": "locked"}
    if status == "current" or has_learning_progress:
        return {"state": "learning", "label": "学习中", "tone": "learning"}
    if status == "needs_learning":
        return {"state": "to_learn", "label": "待学习", "tone": "learning"}
    return {"state": "locked", "label": "未开始", "tone": "locked"}


def recommend_learning_action(mastery: float) -> str:
    if mastery >= STABLE_MASTERY_THRESHOLD:
        return "mastered"
    if mastery >= PRACTICE_RECOMMENDATION_THRESHOLD:
        return "practice"
    return "study"


def recommend_scope_learning_action(masteries: list[float]) -> str:
    if not masteries:
        return "study"
    if all(mastery >= STABLE_MASTERY_THRESHOLD for mastery in masteries):
        return "mastered"
    average_mastery = sum(masteries) / len(masteries)
    if average_mastery >= PRACTICE_RECOMMENDATION_THRESHOLD:
        return "practice"
    return "study"


def _field(item, name: str, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def build_learning_state_stats(items: list) -> dict[str, int]:
    return {
        "mastered": sum(1 for item in items if _field(item, "learning_state") == "mastered"),
        "learning": sum(1 for item in items if _field(item, "learning_state") == "learning"),
        "to_learn": sum(1 for item in items if _field(item, "learning_state") == "to_learn"),
        "practice": sum(1 for item in items if _field(item, "learning_state") == "practice"),
        "locked": sum(1 for item in items if _field(item, "learning_state") == "locked"),
    }
