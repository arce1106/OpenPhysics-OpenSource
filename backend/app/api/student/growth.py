from app.services.learning_path_service import LearningPathService
from app.services.reward_service import RewardService
from app.services.quest_service import QuestService
from app.services.growth_report_service import GrowthReportService
from app.services.daily_learning_loop_service import DailyLearningLoopService
from fastapi import APIRouter, Depends

from .dependencies import (
    get_current_student_id,
    get_current_learning_student_id,
    get_daily_learning_loop_service,
    get_growth_report_service,
    get_learning_path_service,
    get_quest_service,
    get_reward_service,
)

router = APIRouter()

@router.get("/learning-path")
async def get_learning_path(
    student_id: str = Depends(get_current_learning_student_id),
    lp_svc: LearningPathService = Depends(get_learning_path_service),
):
    return await lp_svc.generate_path(student_id)


@router.get("/learning-path/next")
async def get_next_step(
    student_id: str = Depends(get_current_learning_student_id),
    lp_svc: LearningPathService = Depends(get_learning_path_service),
):
    return await lp_svc.get_next_step(student_id)


@router.get("/learning-path/stats")
async def get_path_stats(
    student_id: str = Depends(get_current_learning_student_id),
    lp_svc: LearningPathService = Depends(get_learning_path_service),
):
    return await lp_svc.get_stats(student_id)


# ── Reward & Growth ─────────────────────────────────────────────────────────────


@router.get("/reward/status")
async def get_reward_status(
    student_id: str = Depends(get_current_student_id),
    reward_svc: RewardService = Depends(get_reward_service),
):
    """Get student XP, level, energy, and recent rewards."""
    xp_status = await reward_svc.get_xp_status(student_id)
    history = await reward_svc.get_reward_history(student_id, limit=10)
    return {"xp": xp_status, "recent_rewards": history}


@router.get("/reward/daily-loop")
async def get_daily_learning_loop(
    student_id: str = Depends(get_current_student_id),
    loop_svc: DailyLearningLoopService = Depends(get_daily_learning_loop_service),
):
    """Get today's learning loop state based on real practice and review records."""
    return await loop_svc.get_daily_loop(student_id)


@router.get("/reward/daily-loop/history")
async def get_daily_learning_loop_history(
    days: int = 35,
    student_id: str = Depends(get_current_student_id),
    loop_svc: DailyLearningLoopService = Depends(get_daily_learning_loop_service),
):
    """Get recent practice/review ring history for calendar statistics."""
    return await loop_svc.get_loop_history(student_id, days=days)


@router.get("/reward/badges")
async def get_badges(
    student_id: str = Depends(get_current_student_id),
    reward_svc: RewardService = Depends(get_reward_service),
):
    """Get all badges and student's earned status."""
    badges = await reward_svc.get_badges(student_id)
    return {"badges": badges}


@router.get("/reward/quests")
async def get_quests(
    student_id: str = Depends(get_current_learning_student_id),
    quest_svc: QuestService = Depends(get_quest_service),
    reward_svc: RewardService = Depends(get_reward_service),
):
    """Get daily quests for the student."""
    quests = await quest_svc.get_or_generate_daily_quests(student_id)
    return {"quests": quests}


@router.get("/reward/growth-report")
async def get_growth_report(
    student_id: str = Depends(get_current_student_id),
    report_svc: GrowthReportService = Depends(get_growth_report_service),
    refresh: bool = False,
):
    """Get a saved report, or a current read-only preview with ?refresh=true."""
    report = (
        await report_svc.generate_weekly_report(student_id, persist=False)
        if refresh else await report_svc.get_latest_report(student_id)
    )
    return {"report": report}


@router.post("/reward/growth-report")
async def generate_growth_report(
    student_id: str = Depends(get_current_learning_student_id),
    report_svc: GrowthReportService = Depends(get_growth_report_service),
):
    """Generate a new weekly growth report."""
    report = await report_svc.generate_weekly_report(student_id)
    return {"report": report}


# ── Dashboard BFF ───────────────────────────────────────────────────────────────
