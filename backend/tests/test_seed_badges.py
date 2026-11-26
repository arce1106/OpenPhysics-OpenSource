import pytest
from sqlalchemy import func, select

from app.models.reward import Badge
from app.services.seed_badges import BADGES, seed_badges


@pytest.mark.asyncio
async def test_seed_badges_is_safe_when_multiple_workers_start(db_session):
    first = await seed_badges(db_session)
    second = await seed_badges(db_session)
    count = await db_session.scalar(select(func.count()).select_from(Badge))

    assert first == len(BADGES)
    assert second == 0
    assert count == len(BADGES)
