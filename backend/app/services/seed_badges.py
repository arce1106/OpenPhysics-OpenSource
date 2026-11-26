"""
Seed the badges table with the initial set of 15 badges covering
knowledge-mastery, error-correction, persistence, and challenge types.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.models.reward import Badge


BADGES = [
    # Knowledge mastery badges
    {
        "id": "bdg_first_kp_mastered",
        "name": "初学者之光",
        "description": "第一个知识点达到掌握水平",
        "badge_type": "knowledge_mastery",
        "icon_url": None,
        "condition": {"type": "mastery_increase", "threshold": 70},
    },
    {
        "id": "bdg_three_kp_mastered",
        "name": "稳步前进",
        "description": "3个知识点达到掌握水平",
        "badge_type": "knowledge_mastery",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "knowledge_mastered", "threshold": 3},
    },
    {
        "id": "bdg_force_analyst",
        "name": "受力分析师",
        "description": "完成受力分析相关挑战",
        "badge_type": "knowledge_mastery",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "challenge_completed", "threshold": 1, "kp_contains": "force"},
    },
    {
        "id": "bdg_motion_master",
        "name": "运动描述掌握者",
        "description": "运动描述章节掌握度达到80%以上",
        "badge_type": "knowledge_mastery",
        "icon_url": None,
        "condition": {"type": "mastery_increase", "threshold": 80, "kp_contains": "运动"},
    },
    # Error correction badges
    {
        "id": "bdg_first_correction",
        "name": "知错能改",
        "description": "完成第一次错题订正",
        "badge_type": "error_correction",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "question_corrected", "threshold": 1},
    },
    {
        "id": "bdg_ten_corrections",
        "name": "错题修复者",
        "description": "完成10道错题订正",
        "badge_type": "error_correction",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "question_corrected", "threshold": 10},
    },
    {
        "id": "bdg_misconception_slayer",
        "name": "误区终结者",
        "description": "成功修正一个典型误区",
        "badge_type": "error_correction",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "misconception_fixed", "threshold": 1},
    },
    {
        "id": "bdg_thirty_corrections",
        "name": "纠错达人",
        "description": "完成30道错题订正",
        "badge_type": "error_correction",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "question_corrected", "threshold": 30},
    },
    # Persistence badges
    {
        "id": "bdg_first_streak_3",
        "name": "三日连学",
        "description": "连续学习3天",
        "badge_type": "persistence",
        "icon_url": None,
        "condition": {"type": "streak_days", "threshold": 3},
    },
    {
        "id": "bdg_first_streak_7",
        "name": "七日连学",
        "description": "连续学习7天",
        "badge_type": "persistence",
        "icon_url": None,
        "condition": {"type": "streak_days", "threshold": 7},
    },
    {
        "id": "bdg_daily_grinder",
        "name": "每日坚持",
        "description": "完成10次每日任务",
        "badge_type": "persistence",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "daily_goal_completed", "threshold": 10},
    },
    {
        "id": "bdg_fifty_answers",
        "name": "勤学苦练",
        "description": "累计完成50道题",
        "badge_type": "persistence",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "question_answered", "threshold": 50},
    },
    # Challenge badges
    {
        "id": "bdg_hard_correct",
        "name": "挑战者",
        "description": "正确完成一道挑战级难度题",
        "badge_type": "challenge",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "challenge_completed", "threshold": 1},
    },
    {
        "id": "bdg_perfect_session",
        "name": "完美通关",
        "description": "一次练习全部正确",
        "badge_type": "challenge",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "daily_goal_completed", "threshold": 1},
    },
    {
        "id": "bdg_speed_demon",
        "name": "思维敏捷",
        "description": "快速准确完成一道中等以上难度题",
        "badge_type": "challenge",
        "icon_url": None,
        "condition": {"type": "event_count", "event": "question_answered", "threshold": 1, "speed_bonus": True},
    },
]


async def seed_badges(db: AsyncSession) -> int:
    """Seed badges into the database. Returns count of inserted badges."""
    statement = pg_insert(Badge).values(BADGES).on_conflict_do_nothing(
        index_elements=[Badge.id]
    )
    result = await db.execute(statement)
    await db.commit()
    return int(result.rowcount or 0)
