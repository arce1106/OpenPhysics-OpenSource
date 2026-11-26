import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.models.reward import StudentXp
from app.models.student import StudentMastery
from app.services.knowledge_service import KnowledgeService
from app.services.reward_service import RewardService
from app.services.student_service import StudentService
from tests.conftest import TEST_DATABASE_URL


@pytest.mark.asyncio
async def test_update_mastery_is_safe_when_parallel_requests_create_same_kp(monkeypatch):
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as setup_session:
        await KnowledgeService(setup_session).create_point({"id": "kp_parallel", "name": "并发掌握度"})

    async def update_once(correct: bool) -> StudentMastery:
        async with session_factory() as session:
            service = StudentService(session)

            async def stale_read(_student_id: str, _kp_id: str):
                return None

            monkeypatch.setattr(service, "get_mastery", stale_read)
            return await service.update_mastery("student_parallel", "kp_parallel", correct)

    results = await asyncio.gather(update_once(True), update_once(False))

    async with session_factory() as verify_session:
        row_count = await verify_session.scalar(
            select(func.count()).select_from(StudentMastery).where(
                StudentMastery.student_id == "student_parallel",
                StudentMastery.knowledge_point_id == "kp_parallel",
            )
        )
        mastery = await verify_session.scalar(
            select(StudentMastery).where(
                StudentMastery.student_id == "student_parallel",
                StudentMastery.knowledge_point_id == "kp_parallel",
            )
        )

    await engine.dispose()

    assert row_count == 1
    assert len(results) == 2
    assert mastery is not None
    assert mastery.attempts == 2
    assert mastery.correct_rate == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_reward_xp_creation_is_safe_for_parallel_events():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    lock = asyncio.Lock()
    ready_count = 0
    ready = asyncio.Event()

    class BarrierRewardService(RewardService):
        async def _calculate_xp(self, student_id: str, event_type: str, payload: dict) -> int:
            nonlocal ready_count
            async with lock:
                ready_count += 1
                if ready_count == 2:
                    ready.set()
            await ready.wait()
            return 5

        async def _check_badges(self, student_id: str, event_type: str, payload: dict) -> list[dict]:
            return []

    async def record_once(event_type: str) -> dict:
        async with session_factory() as session:
            event, _badges = await BarrierRewardService(session).record_event(
                "student_xp_parallel",
                event_type,
            )
            return event

    results = await asyncio.gather(
        record_once("question_answered"),
        record_once("question_corrected"),
    )

    async with session_factory() as verify_session:
        row_count = await verify_session.scalar(
            select(func.count()).select_from(StudentXp).where(
                StudentXp.student_id == "student_xp_parallel",
            )
        )

    await engine.dispose()

    assert row_count == 1
    assert len(results) == 2
