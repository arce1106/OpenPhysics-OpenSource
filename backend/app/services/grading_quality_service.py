"""Online grading quality: correction, needs-review and recognition-failure rates (audit A11).

The three rates come from data the grading flow already keeps:

- 纠错率: AI-graded answers the student later corrected;
- 需人工确认率: AI-graded answers whose verdict waited for confirmation
  (model doubt, unclear verdict, or a verdict that contradicts its process score);
- 识别失败率: photographed questions the model could not read. Those are never
  saved as answers, so each photographed question leaves one identity-free
  GradingOutcome row.

To compare graders after switching GRADING_PRIMARY_PROVIDER it also reports the
AI task failure rate, how often teachers changed the AI's homework score, and
the review/correction/change rates per grading model.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student import GradingOutcome, StudentAiExecution, StudentAnswer
from app.models.teacher_scan import TeacherSubmissionItem
from app.services.grading_reliability import PENDING_FLAG, PROCESS_CONFLICT_KEY, is_deterministic_grading

OUTCOME_GRADED = "graded"
OUTCOME_UNRECOGNIZED = "unrecognized"
OUTCOME_NO_ANSWER_KEY = "no_answer_key"
RATE_WINDOW_DAYS = 30
# Bounds the admin report's work; a month of answers is well below this today.
ANSWER_SAMPLE_LIMIT = 20000


async def record_grading_outcomes(db: AsyncSession | None, source: str, outcomes: list[tuple[str | None, str]]) -> None:
    """Persist (question_type, outcome) pairs for one photo submission; never blocks grading."""
    if db is None or not outcomes:
        return
    db.add_all(
        GradingOutcome(source=source, question_type=question_type or None, outcome=outcome)
        for question_type, outcome in outcomes
    )
    await db.commit()


def is_ai_graded(grading: Any) -> bool:
    """A verdict an AI model produced (not a tapped option or a student's self-review)."""
    # A student's self-review and a teacher's released paper score are not AI verdicts.
    if not isinstance(grading, dict) or grading.get("answer_source") in {"self_review", "teacher_paper"}:
        return False
    return not is_deterministic_grading(grading)


def waited_for_confirmation(grading: dict) -> bool:
    original = grading.get("_original_grading")
    for record in (grading, original if isinstance(original, dict) else {}):
        if record.get(PENDING_FLAG) is True or record.get("needs_human_review") is True:
            return True
    return False


def _rate(count: int, total: int) -> float | None:
    return round(count / total, 4) if total else None


UNRECORDED_MODEL = "未记录"
SCAN_PREGRADE_MODEL = "老师阅卷预批"


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def teacher_changed_ai_score(item_score: Any, ai_result: Any) -> bool | None:
    """Whether a teacher's confirmed score differs from the AI's; None when the AI score is unknown."""
    if not isinstance(ai_result, dict) or ai_result.get("error"):
        return None
    proposed = _number(ai_result.get("_ai_score"))
    final = _number(item_score)
    if proposed is None:
        return None
    return final is None or abs(final - proposed) >= 0.5


class GradingQualityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def online_rates(self, *, days: int = RATE_WINDOW_DAYS, now: datetime | None = None) -> dict:
        since = (now or datetime.now(timezone.utc)) - timedelta(days=days)
        gradings = (await self.db.scalars(
            select(StudentAnswer.grading_result)
            .where(StudentAnswer.created_at >= since)
            .order_by(StudentAnswer.created_at.desc())
            .limit(ANSWER_SAMPLE_LIMIT)
        )).all()
        ai = [grading for grading in gradings if is_ai_graded(grading)]
        corrected = sum(1 for grading in ai if isinstance(grading.get("manual_correction"), dict))
        needs_review = sum(1 for grading in ai if waited_for_confirmation(grading))
        conflicts = sum(1 for grading in ai if isinstance(grading.get(PROCESS_CONFLICT_KEY), dict))

        outcome_counts = Counter(dict((await self.db.execute(
            select(GradingOutcome.outcome, func.count())
            .where(GradingOutcome.created_at >= since)
            .group_by(GradingOutcome.outcome)
        )).all()))
        photo_items = outcome_counts[OUTCOME_GRADED] + outcome_counts[OUTCOME_UNRECOGNIZED]

        # Grading calls that ended without a result (both graders failed or ran out of time).
        task_counts = Counter(dict((await self.db.execute(
            select(StudentAiExecution.status, func.count())
            .where(StudentAiExecution.started_at >= since,
                   StudentAiExecution.feature.like("practice.%grading"),
                   StudentAiExecution.status.in_(("succeeded", "failed")))
            .group_by(StudentAiExecution.status)
        )).all()))
        tasks = task_counts["succeeded"] + task_counts["failed"]

        reviewed = (await self.db.execute(
            select(TeacherSubmissionItem.score, TeacherSubmissionItem.ai_result)
            .where(TeacherSubmissionItem.kind == "area", TeacherSubmissionItem.grade_status == "confirmed",
                   TeacherSubmissionItem.reviewed_at >= since)
            .limit(ANSWER_SAMPLE_LIMIT)
        )).all()
        per_model: dict[str, Counter] = {}

        def bucket(model: str) -> Counter:
            return per_model.setdefault(model, Counter())

        for grading in ai:
            counts = bucket(str(grading.get("_grading_model") or UNRECORDED_MODEL))
            counts["graded"] += 1
            counts["needs_review"] += waited_for_confirmation(grading)
            counts["corrected"] += isinstance(grading.get("manual_correction"), dict)
        teacher_reviews = teacher_changes = 0
        for score, ai_result in reviewed:
            changed = teacher_changed_ai_score(score, ai_result)
            if changed is None:
                continue
            model = str(ai_result.get("_grading_model")
                        or (UNRECORDED_MODEL if ai_result.get("source") == "app" else SCAN_PREGRADE_MODEL))
            counts = bucket(model)
            counts["teacher_reviewed"] += 1
            counts["teacher_changed"] += changed
            teacher_reviews += 1
            teacher_changes += changed
        by_model = [
            {
                "model": model,
                "ai_graded_count": counts["graded"],
                "needs_review_rate": _rate(counts["needs_review"], counts["graded"]),
                "correction_rate": _rate(counts["corrected"], counts["graded"]),
                "teacher_review_count": counts["teacher_reviewed"],
                "teacher_change_rate": _rate(counts["teacher_changed"], counts["teacher_reviewed"]),
            }
            for model, counts in sorted(per_model.items(), key=lambda kv: -(kv[1]["graded"] + kv[1]["teacher_reviewed"]))
        ]
        return {
            "window_days": days,
            "ai_graded_count": len(ai),
            "correction_count": corrected,
            "correction_rate": _rate(corrected, len(ai)),
            "needs_review_count": needs_review,
            "needs_review_rate": _rate(needs_review, len(ai)),
            "process_conflict_count": conflicts,
            "photo_item_count": photo_items,
            "unrecognized_count": outcome_counts[OUTCOME_UNRECOGNIZED],
            "unrecognized_rate": _rate(outcome_counts[OUTCOME_UNRECOGNIZED], photo_items),
            "no_answer_key_count": outcome_counts[OUTCOME_NO_ANSWER_KEY],
            "ai_task_count": tasks,
            "ai_failure_count": task_counts["failed"],
            "ai_failure_rate": _rate(task_counts["failed"], tasks),
            "teacher_review_count": teacher_reviews,
            "teacher_change_count": teacher_changes,
            "teacher_change_rate": _rate(teacher_changes, teacher_reviews),
            "by_model": by_model,
            "sample_truncated": len(gradings) >= ANSWER_SAMPLE_LIMIT,
        }
