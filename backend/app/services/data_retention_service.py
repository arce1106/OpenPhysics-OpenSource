import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.student import (
    GradingOutcome,
    StudentAiExecution,
    StudentAiUsageLog,
    StudentCaptchaChallenge,
    StudentWebLoginTicket,
)


def _expired_ai_results(now):
    return (
        (StudentAiExecution.started_at < now - timedelta(days=settings.student_ai_result_retention_days))
        & (StudentAiExecution.lease_expires_at < now)
    )


async def cleanup_student_ai_results_periodically(sessions, *, interval_seconds=3600):
    """Bound the private cache even when the backend runs for weeks without restart."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            async with sessions() as db:
                await db.execute(delete(StudentAiExecution).where(_expired_ai_results(datetime.now(timezone.utc))))
                await db.commit()
        except Exception:  # noqa: BLE001 - maintenance failure must not stop later cleanup
            # Do not put result payloads or DB credentials into a maintenance log.
            logging.getLogger("uvicorn.error.student_ai").warning("student_ai_cache_cleanup failed; will retry next interval")


async def cleanup_expired_student_data(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    ephemeral_cutoff = now - timedelta(days=settings.ephemeral_auth_retention_days)
    ai_usage_cutoff = now - timedelta(days=settings.ai_usage_retention_days)
    rules = {
        "ai_execution_results": (
            StudentAiExecution,
            _expired_ai_results(now),
        ),
        "captcha_challenges": (
            StudentCaptchaChallenge,
            StudentCaptchaChallenge.expires_at < ephemeral_cutoff,
        ),
        "web_login_tickets": (
            StudentWebLoginTicket,
            StudentWebLoginTicket.expires_at < ephemeral_cutoff,
        ),
        "ai_usage_logs": (
            StudentAiUsageLog,
            StudentAiUsageLog.created_at < ai_usage_cutoff,
        ),
        "grading_outcomes": (
            GradingOutcome,
            GradingOutcome.created_at < ai_usage_cutoff,
        ),
    }
    deleted = {}
    for name, (model, condition) in rules.items():
        result = await db.execute(delete(model).where(condition))
        deleted[name] = int(result.rowcount or 0)
    await db.commit()
    return deleted
