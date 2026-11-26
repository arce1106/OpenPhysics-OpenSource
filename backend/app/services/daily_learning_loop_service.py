from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reward import LearningEvent
from app.models.student import StudentAnswer


LOCAL_TZ = ZoneInfo("Asia/Shanghai")
MIN_EFFECTIVE_ANSWER_MS = 2000
REVIEW_EVENT_TYPES = ("question_corrected", "misconception_fixed")
PRACTICE_TARGET = 5
REVIEW_TARGET = 3


class DailyLearningLoopService:
    """Compute daily learning closure from real answer and review records."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_daily_loop(self, student_id: str) -> dict:
        start, end, day = self._today_window()
        result = await self._build_day_loop(student_id, start, end, day)
        result["streak_days"] = await self.get_streak_days(student_id)
        return result

    async def get_loop_history(self, student_id: str, days: int = 35) -> dict:
        today = datetime.now(LOCAL_TZ).date()
        days = max(1, min(days, 62))
        first_day = today - timedelta(days=days - 1)
        items = []

        for offset in range(days):
            day = first_day + timedelta(days=offset)
            start, end = self._day_window(day)
            items.append(await self._build_day_loop(student_id, start, end, day))

        return {
            "start_date": first_day.isoformat(),
            "end_date": today.isoformat(),
            "practice_target": PRACTICE_TARGET,
            "review_target": REVIEW_TARGET,
            "summary": {
                "practice_total": sum(item["rings"]["practice"]["actual_current"] for item in items),
                "review_total": sum(item["rings"]["review"]["actual_current"] for item in items),
                "practice_closed_days": sum(1 for item in items if item["rings"]["practice"]["completed"]),
                "review_closed_days": sum(1 for item in items if item["rings"]["review"]["completed"]),
                "dual_closed_days": sum(1 for item in items if item["is_high_quality_day"]),
                "effective_days": sum(1 for item in items if item["is_effective_day"]),
            },
            "days": items,
        }

    async def _build_day_loop(
        self,
        student_id: str,
        start: datetime,
        end: datetime,
        day: date,
    ) -> dict:
        practice_count = await self._count_effective_practice(student_id, start, end)
        reviewed_answer_count = await self._count_reviewed_answers(student_id, start, end)
        review_event_count = await self._count_review_events(student_id, start, end)
        review_count = reviewed_answer_count + review_event_count
        pending_mistakes = await self._count_pending_mistakes(student_id, end)

        practice_done = practice_count >= PRACTICE_TARGET
        review_auto_completed = pending_mistakes == 0
        review_done = review_auto_completed
        effective_day = practice_count > 0 or review_count > 0
        high_quality_day = practice_done and review_done

        return {
            "date": day.isoformat(),
            "is_effective_day": effective_day,
            "is_high_quality_day": high_quality_day,
            "rings": {
                "practice": {
                    "key": "practice",
                    "label": "做题环",
                    "completed": practice_done,
                    "current": practice_count,
                    "actual_current": practice_count,
                    "target": PRACTICE_TARGET,
                    "overflow": max(0, practice_count - PRACTICE_TARGET),
                    "auto_completed": False,
                    "evidence": self._practice_evidence(practice_count),
                },
                "review": {
                    "key": "review",
                    "label": "复盘环",
                    "completed": review_done,
                    "current": REVIEW_TARGET if review_auto_completed else min(review_count, REVIEW_TARGET),
                    "actual_current": review_count,
                    "target": REVIEW_TARGET,
                    "overflow": max(0, review_count - REVIEW_TARGET),
                    "auto_completed": review_auto_completed,
                    "pending_mistakes": pending_mistakes,
                    "evidence": self._review_evidence(review_count, review_auto_completed, pending_mistakes),
                },
            },
            "summary": self._summary(practice_done, review_done),
            "next_action": self._next_action(practice_done, review_done),
        }

    async def get_streak_days(self, student_id: str, lookback_days: int = 60) -> int:
        today = datetime.now(LOCAL_TZ).date()
        local_start = datetime.combine(today, time.min, tzinfo=LOCAL_TZ)
        cutoff = local_start - timedelta(days=lookback_days)
        cutoff_utc = cutoff.astimezone(timezone.utc)

        dates = await self._effective_dates(student_id, cutoff_utc)
        if today not in dates:
            return 0

        streak = 0
        current = today
        while current in dates:
            streak += 1
            current = current - timedelta(days=1)
        return streak

    def _today_window(self) -> tuple[datetime, datetime, date]:
        now = datetime.now(LOCAL_TZ)
        day = now.date()
        return (*self._day_window(day), day)

    def _day_window(self, day: date) -> tuple[datetime, datetime]:
        local_start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
        local_end = datetime.combine(day, time.max, tzinfo=LOCAL_TZ)
        return (
            local_start.astimezone(timezone.utc),
            local_end.astimezone(timezone.utc),
        )

    async def _count_effective_practice(
        self,
        student_id: str,
        start: datetime,
        end: datetime,
    ) -> int:
        stmt = select(func.count()).select_from(StudentAnswer).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.created_at >= start,
            StudentAnswer.created_at <= end,
            StudentAnswer.given_answer.is_not(None),
            func.length(func.trim(StudentAnswer.given_answer)) > 0,
            StudentAnswer.is_correct.is_(True),
            or_(
                StudentAnswer.time_spent_ms.is_(None),
                StudentAnswer.time_spent_ms >= MIN_EFFECTIVE_ANSWER_MS,
            ),
        )
        return int(await self.db.scalar(stmt) or 0)

    async def _count_reviewed_answers(
        self,
        student_id: str,
        start: datetime,
        end: datetime,
    ) -> int:
        stmt = select(func.count()).select_from(StudentAnswer).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.reviewed_at >= start,
            StudentAnswer.reviewed_at <= end,
        )
        return int(await self.db.scalar(stmt) or 0)

    async def _count_review_events(
        self,
        student_id: str,
        start: datetime,
        end: datetime,
    ) -> int:
        stmt = select(func.count()).select_from(LearningEvent).where(
            and_(
                LearningEvent.student_id == student_id,
                LearningEvent.event_type.in_(REVIEW_EVENT_TYPES),
                LearningEvent.created_at >= start,
                LearningEvent.created_at <= end,
            )
        )
        return int(await self.db.scalar(stmt) or 0)

    async def _count_pending_mistakes(self, student_id: str, end: datetime) -> int:
        stmt = select(func.count()).select_from(StudentAnswer).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.is_correct == False,
            StudentAnswer.created_at <= end,
            or_(
                StudentAnswer.reviewed_at.is_(None),
                StudentAnswer.reviewed_at > end,
            ),
        )
        return int(await self.db.scalar(stmt) or 0)

    async def _effective_dates(self, student_id: str, cutoff: datetime) -> set:
        dates = set()

        practice_stmt = select(StudentAnswer.created_at).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.created_at >= cutoff,
            StudentAnswer.given_answer.is_not(None),
            func.length(func.trim(StudentAnswer.given_answer)) > 0,
            StudentAnswer.is_correct.is_(True),
            or_(
                StudentAnswer.time_spent_ms.is_(None),
                StudentAnswer.time_spent_ms >= MIN_EFFECTIVE_ANSWER_MS,
            ),
        )
        reviewed_stmt = select(StudentAnswer.reviewed_at).where(
            StudentAnswer.student_id == student_id,
            StudentAnswer.reviewed_at.is_not(None),
            StudentAnswer.reviewed_at >= cutoff,
        )
        event_stmt = select(LearningEvent.created_at).where(
            LearningEvent.student_id == student_id,
            LearningEvent.event_type.in_(REVIEW_EVENT_TYPES),
            LearningEvent.created_at >= cutoff,
        )

        for stmt in (practice_stmt, reviewed_stmt, event_stmt):
            result = await self.db.execute(stmt)
            for value in result.scalars():
                if value:
                    dates.add(value.astimezone(LOCAL_TZ).date())

        return dates

    def _practice_evidence(self, count: int) -> str:
        if count <= 0:
            return "今日还没有正确做题记录"
        return f"今日已完成 {count} 道正确练习"

    def _review_evidence(self, count: int, auto_completed: bool = False, pending_mistakes: int = 0) -> str:
        if auto_completed:
            return "暂无待复盘错题，复盘环已闭合"
        if count <= 0:
            return "今日还没有错题复盘记录"
        return f"今日已完成 {count} 次错题复盘，仍有 {pending_mistakes} 道待清理"

    def _summary(self, practice_done: bool, review_done: bool) -> str:
        if practice_done and review_done:
            return "今天已经完成正确做题，并清理完待复盘错题。"
        if practice_done:
            return "今天已经完成正确做题，待复盘错题还需要继续清理。"
        if review_done:
            return "待复盘错题已经清零，可以再做一组练习保持手感。"
        return "今天还没有形成有效学习记录。"

    def _next_action(self, practice_done: bool, review_done: bool) -> str:
        if practice_done and review_done:
            return "保持节奏，明天继续从错题或薄弱点开始。"
        if practice_done:
            return "优先处理一道待复盘错题。"
        if review_done:
            return "完成一组正确练习。"
        return "先做一道题，或完成一次错题复盘。"
