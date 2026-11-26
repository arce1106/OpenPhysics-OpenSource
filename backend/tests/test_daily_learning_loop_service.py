from datetime import datetime, timedelta, timezone

import pytest

from app.models.question import Question
from app.models.reward import LearningEvent
from app.models.student import StudentAnswer
from app.services.daily_learning_loop_service import DailyLearningLoopService


async def _question(db_session, question_id: str) -> None:
    db_session.add(
        Question(
            id=question_id,
            stem_text=f"Test stem {question_id}",
            answer="A",
        )
    )
    await db_session.flush()


async def _answer(
    db_session,
    *,
    student_id: str = "student-1",
    question_id: str = "q1",
    given_answer: str | None = "A",
    time_spent_ms: int | None = 5000,
    created_at: datetime | None = None,
    reviewed_at: datetime | None = None,
    is_correct: bool = True,
) -> None:
    await _question(db_session, question_id)
    db_session.add(
        StudentAnswer(
            student_id=student_id,
            question_id=question_id,
            given_answer=given_answer,
            is_correct=is_correct,
            time_spent_ms=time_spent_ms,
            misconception_ids=[],
            grading_result={},
            created_at=created_at or datetime.now(timezone.utc),
            reviewed_at=reviewed_at,
        )
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_daily_loop_starts_empty(db_session):
    service = DailyLearningLoopService(db_session)

    result = await service.get_daily_loop("student-1")

    assert result["is_effective_day"] is False
    assert result["is_high_quality_day"] is False
    assert result["rings"]["practice"]["completed"] is False
    assert result["rings"]["review"]["completed"] is True
    assert result["rings"]["review"]["auto_completed"] is True


@pytest.mark.asyncio
async def test_daily_loop_counts_real_practice_and_review(db_session):
    now = datetime.now(timezone.utc)
    for index in range(5):
        await _answer(
            db_session,
            question_id=f"q-practice-{index}",
            created_at=now - timedelta(minutes=3),
            time_spent_ms=12000,
        )
    await _answer(
        db_session,
        question_id="q-practice-wrong",
        created_at=now - timedelta(minutes=2),
        reviewed_at=now - timedelta(minutes=1),
        time_spent_ms=12000,
        is_correct=False,
    )
    for index in range(3):
        await _answer(
            db_session,
            question_id=f"q-review-{index}",
            is_correct=False,
            created_at=now - timedelta(days=1),
            reviewed_at=now - timedelta(minutes=1),
        )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["is_effective_day"] is True
    assert result["is_high_quality_day"] is True
    assert result["rings"]["practice"]["completed"] is True
    assert result["rings"]["practice"]["current"] == 5
    assert result["rings"]["practice"]["target"] == 5
    assert result["rings"]["review"]["completed"] is True
    assert result["rings"]["review"]["current"] == 3
    assert result["rings"]["review"]["target"] == 3


@pytest.mark.asyncio
async def test_daily_loop_practice_counts_only_correct_answers(db_session):
    now = datetime.now(timezone.utc)
    for index in range(5):
        await _answer(
            db_session,
            question_id=f"q-wrong-{index}",
            created_at=now - timedelta(minutes=index + 1),
            time_spent_ms=12000,
            is_correct=False,
        )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["rings"]["practice"]["current"] == 0
    assert result["rings"]["practice"]["completed"] is False
    assert result["is_high_quality_day"] is False


@pytest.mark.asyncio
async def test_daily_loop_ignores_too_fast_empty_submissions(db_session):
    await _answer(
        db_session,
        given_answer="A",
        time_spent_ms=800,
    )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["is_effective_day"] is False
    assert result["rings"]["practice"]["current"] == 0


@pytest.mark.asyncio
async def test_daily_loop_counts_correction_events_as_review(db_session):
    now = datetime.now(timezone.utc)
    await _answer(
        db_session,
        question_id="q-pending",
        is_correct=False,
        created_at=now - timedelta(minutes=5),
        reviewed_at=None,
    )
    db_session.add(
        LearningEvent(
            id="event-1",
            student_id="student-1",
            event_type="question_corrected",
            question_id="q1",
            knowledge_point_id="kp1",
            payload={},
            created_at=now,
        )
    )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["is_effective_day"] is True
    assert result["rings"]["review"]["completed"] is False
    assert result["rings"]["review"]["current"] == 1


@pytest.mark.asyncio
async def test_daily_loop_review_only_closes_when_pending_mistakes_are_cleared(db_session):
    now = datetime.now(timezone.utc)
    await _answer(
        db_session,
        question_id="q-still-pending",
        is_correct=False,
        created_at=now - timedelta(days=1),
        reviewed_at=None,
    )
    for index in range(3):
        await _answer(
            db_session,
            question_id=f"q-reviewed-{index}",
            is_correct=False,
            created_at=now - timedelta(days=2),
            reviewed_at=now - timedelta(minutes=index + 1),
        )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["rings"]["review"]["actual_current"] == 3
    assert result["rings"]["review"]["pending_mistakes"] == 1
    assert result["rings"]["review"]["completed"] is False
    assert result["is_high_quality_day"] is False


@pytest.mark.asyncio
async def test_daily_loop_auto_completes_review_when_no_pending_mistakes(db_session):
    service = DailyLearningLoopService(db_session)

    result = await service.get_daily_loop("student-1")

    assert result["is_effective_day"] is False
    assert result["rings"]["review"]["completed"] is True
    assert result["rings"]["review"]["auto_completed"] is True
    assert result["rings"]["review"]["current"] == 3
    assert result["rings"]["review"]["target"] == 3


@pytest.mark.asyncio
async def test_daily_loop_history_returns_calendar_totals(db_session):
    now = datetime.now(timezone.utc)
    for index in range(6):
        await _answer(
            db_session,
            question_id=f"q-history-practice-{index}",
            created_at=now - timedelta(minutes=index + 1),
            time_spent_ms=6000,
        )
    for index in range(4):
        await _answer(
            db_session,
            question_id=f"q-history-review-{index}",
            is_correct=False,
            created_at=now - timedelta(days=2),
            reviewed_at=now - timedelta(minutes=index + 1),
        )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    history = await service.get_loop_history("student-1", days=7)

    assert history["summary"]["practice_total"] == 6
    assert history["summary"]["review_total"] == 4
    assert history["summary"]["dual_closed_days"] >= 1
    today = history["days"][-1]
    assert today["rings"]["practice"]["completed"] is True
    assert today["rings"]["practice"]["actual_current"] == 6
    assert today["rings"]["practice"]["overflow"] == 1
    assert today["rings"]["review"]["completed"] is True
    assert today["rings"]["review"]["actual_current"] == 4
    assert today["rings"]["review"]["overflow"] == 1


@pytest.mark.asyncio
async def test_daily_loop_streak_uses_effective_practice_or_review_only(db_session):
    now = datetime.now(timezone.utc)
    await _answer(
        db_session,
        question_id="q-today",
        created_at=now - timedelta(minutes=10),
        time_spent_ms=5000,
    )
    await _answer(
        db_session,
        question_id="q-yesterday",
        created_at=now - timedelta(days=1),
        time_spent_ms=5000,
    )
    db_session.add(
        LearningEvent(
            id="lesson-only",
            student_id="student-1",
            event_type="lesson_completed",
            question_id=None,
            knowledge_point_id="kp1",
            payload={},
            created_at=now - timedelta(days=2),
        )
    )
    await db_session.commit()

    service = DailyLearningLoopService(db_session)
    result = await service.get_daily_loop("student-1")

    assert result["streak_days"] == 2
