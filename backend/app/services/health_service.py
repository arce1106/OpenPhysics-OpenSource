import asyncio

from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine


async def readiness_status() -> dict:
    checks = {"database": False, "redis": False}
    try:
        async with engine.connect() as connection:
            await asyncio.wait_for(connection.execute(text("SELECT 1")), timeout=2)
        checks["database"] = True
    except Exception:
        pass

    redis = Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    try:
        checks["redis"] = bool(await asyncio.wait_for(redis.ping(), timeout=2))
    except Exception:
        pass
    finally:
        await redis.aclose()

    return {
        "status": "ready" if all(checks.values()) else "not_ready",
        "checks": checks,
    }
