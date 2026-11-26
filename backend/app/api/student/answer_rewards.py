"""One reward path for every graded answer: typed, single photo and worksheet (audit A17).

The three submit endpoints used to fire different events: the worksheet path
hard-coded difficulty 3 and never sent "knowledge_mastered", the typed path
also hard-coded 3, and the photo path passed the question's raw difficulty,
which the XP table did not recognise. All three now share this helper.
"""

from app.services.learning_state_rules import MASTERED_THRESHOLD
from app.services.quest_service import QuestService
from app.services.reward_service import RewardService

DIFFICULTY_BY_TIER = {"easy": 1, "moderate_easy": 2, "medium": 3, "moderate_hard": 4, "hard": 5}
DEFAULT_REWARD_DIFFICULTY = 3


def reward_difficulty(question) -> int:
    """1–5 as the XP table expects: the difficulty tier, else a 1–5 difficulty, else 3."""
    tier = getattr(question, "difficulty_tier", None)
    tier = getattr(tier, "value", tier)
    if tier in DIFFICULTY_BY_TIER:
        return DIFFICULTY_BY_TIER[tier]
    value = getattr(question, "difficulty", None)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 1 <= value <= 5:
        return int(round(value))
    return DEFAULT_REWARD_DIFFICULTY


async def award_answer_rewards(
    result: dict,
    *,
    student_id: str,
    question_id: str,
    question,
    time_spent_ms: int | None,
    reward_svc: RewardService,
    quest_svc: QuestService,
) -> dict:
    """Fire the answer's reward events and attach the reward fields to ``result``."""
    if result.get("idempotent_replay"):
        return result
    mastery_update = result.get("mastery_update") or {}
    first_kp = next(iter(mastery_update.keys()), None)
    kp_data = mastery_update.get(first_kp, {}) if first_kp else {}
    difficulty = reward_difficulty(question)
    event_payload = {
        "question_id": question_id,
        "knowledge_point_id": first_kp,
        "is_correct": result.get("is_correct"),
        "difficulty": difficulty,
        "time_spent_sec": (time_spent_ms or 0) // 1000,
        "kp_name": kp_data.get("name", ""),
        "mastery_before": kp_data.get("before", 0),
        "mastery_after": kp_data.get("after", 0),
    }
    reward_result, unlocked_badges = await reward_svc.record_event(
        student_id, "question_answered",
        question_id=question_id,
        knowledge_point_id=first_kp,
        payload=event_payload,
    )
    for kp_id, kp_d in mastery_update.items():
        if kp_d.get("after", 0) >= MASTERED_THRESHOLD and kp_d.get("before", 0) < MASTERED_THRESHOLD:
            await reward_svc.record_event(
                student_id, "knowledge_mastered",
                knowledge_point_id=kp_id,
                payload={"kp_name": kp_d.get("name", ""), "mastery": kp_d["after"]},
            )
    _, all_daily_done = await quest_svc.update_quest_progress(
        student_id, kp_id=first_kp, event_type="question_answered"
    )
    if all_daily_done:
        await reward_svc.record_event(
            student_id, "daily_goal_completed",
            payload={"streak": (await reward_svc.get_xp_status(student_id))["streak_days"]},
        )
    if result.get("is_correct") and difficulty >= 4:
        await reward_svc.record_event(
            student_id, "challenge_completed",
            question_id=question_id,
            knowledge_point_id=first_kp,
            payload={"difficulty": difficulty, "kp_name": event_payload["kp_name"]},
        )
    result["xp_awarded"] = reward_result.get("xp_awarded", 0)
    result["unlocked_badges"] = unlocked_badges
    result["leveled_up"] = reward_result.get("leveled_up", False)
    result["new_level"] = reward_result.get("new_level", 0)
    result["new_level_name"] = reward_result.get("new_level_name", "")
    result["encouragement"] = await reward_svc.generate_encouragement(
        student_id, "question_answered", event_payload
    )
    return result
