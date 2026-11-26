from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.student import Student, StudentAiExecution, StudentAiUsageLog

AI_USAGE_TZ = ZoneInfo("Asia/Shanghai")


def daily_ai_limit_for_student(student: Student | None, now: datetime | None = None) -> int:
    """The deployment's resource limit applies equally to every active account."""
    return settings.student_ai_daily_limit if student and student.status == "active" else 0


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _day_bounds(now: datetime) -> tuple[datetime, datetime]:
    local_now = _as_utc(now).astimezone(AI_USAGE_TZ)
    local_start = datetime.combine(local_now.date(), time.min, tzinfo=AI_USAGE_TZ)
    local_end = datetime.combine(local_now.date(), time.max, tzinfo=AI_USAGE_TZ)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


class StudentAiUsageService:
    """Usage policy; execution owns only short admission/settlement transactions."""

    def __init__(self, db: AsyncSession, per_minute_limit: int | None = None):
        self.db = db
        self.per_minute_limit = per_minute_limit if per_minute_limit is not None else settings.student_ai_per_minute_limit

    async def ensure_ai_call_allowed(
        self,
        student_id: str,
        *,
        feature: str,
        now: datetime | None = None,
    ) -> dict:
        now = _as_utc(now or datetime.now(timezone.utc))
        student = await self.db.get(Student, student_id)
        limit = daily_ai_limit_for_student(student, now)
        if not student or student.status != "active":
            raise HTTPException(status_code=401, detail="Student account unavailable")

        day_start, day_end = _day_bounds(now)
        # The daily quota counts provider calls (a worksheet with fallbacks is
        # several), not tasks; the per-minute guard below still counts requests.
        used_today = await self.db.scalar(
            select(func.coalesce(func.sum(StudentAiUsageLog.units), 0))
            .where(
                StudentAiUsageLog.student_id == student_id,
                StudentAiUsageLog.created_at >= day_start,
                StudentAiUsageLog.created_at <= day_end,
            )
        ) or 0
        active_conditions = (
            StudentAiExecution.student_id == student_id,
            StudentAiExecution.status == "running",
            StudentAiExecution.lease_expires_at > now,
        )
        reserved = await self.db.scalar(select(func.count()).select_from(StudentAiExecution).where(*active_conditions)) or 0
        if settings.student_ai_daily_limit_enabled and used_today + reserved >= limit:
            raise HTTPException(status_code=429, detail="今日 AI 使用额度已达上限，明天可继续使用。")

        minute_start = now.replace(microsecond=0)
        minute_start = minute_start.replace(second=0)
        used_this_minute = await self.db.scalar(
            select(func.count())
            .select_from(StudentAiUsageLog)
            .where(
                StudentAiUsageLog.student_id == student_id,
                StudentAiUsageLog.created_at >= minute_start,
                StudentAiUsageLog.created_at <= now,
            )
        ) or 0
        reserved_this_minute = await self.db.scalar(select(func.count()).select_from(StudentAiExecution).where(
            *active_conditions, StudentAiExecution.started_at >= minute_start,
        )) or 0
        if used_this_minute + reserved_this_minute >= self.per_minute_limit:
            raise HTTPException(status_code=429, detail="AI 请求过于频繁，请稍后再试。")

        return {"used": used_today, "limit": limit, "remaining": max(0, limit - used_today)}

    async def record_successful_ai_call(
        self,
        student_id: str,
        *,
        feature: str,
        now: datetime | None = None,
    ) -> None:
        completed_at = _as_utc(now or datetime.now(timezone.utc))
        self.db.add(
            StudentAiUsageLog(
                student_id=student_id,
                feature=feature,
                created_at=completed_at,
            )
        )
        await self.db.commit()

    async def _execution_service(self):
        from app.services.student_ai_execution_service import StudentAiExecutionService
        # These entry points precede answer/mastery mutations. Never implicitly
        # commit unrelated writes just to release a connection before networking.
        if self.db.new or self.db.dirty or self.db.deleted:
            raise RuntimeError("AI execution must begin before pending database mutations")
        await self.db.commit()
        return StudentAiExecutionService(self.db.bind, per_minute_limit=self.per_minute_limit)

    async def run(self, student_id, *, feature, operation, submission_key=None, fingerprint=None):
        execution = await self._execution_service()
        return await execution.run(student_id, feature=feature, operation=operation,
            submission_key=submission_key, fingerprint=fingerprint)

    async def stream(self, student_id, *, feature, operation):
        execution = await self._execution_service()
        return await execution.stream(student_id, feature=feature, operation=operation)
