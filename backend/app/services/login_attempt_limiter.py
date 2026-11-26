"""Shared, bounded credential-attempt limits; never store usernames in Redis."""

import hashlib
import hmac

from fastapi import HTTPException
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings


RESERVE_ATTEMPT = """
local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
if attempts >= tonumber(ARGV[1]) then
    return math.max(1, redis.call('TTL', KEYS[1]))
end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 0
"""


class LoginAttemptLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    @staticmethod
    def key(scope: str, username: str) -> str:
        digest = hmac.new(
            settings.student_auth_secret.encode(),
            f"{scope}:{username.strip().casefold()}".encode(), hashlib.sha256,
        ).hexdigest()
        return f"auth-attempts:v1:{digest}"

    async def check(self, scope: str, username: str) -> str:
        key = self.key(scope, username)
        limit, window = (5, 900) if scope in {"admin", "teacher"} else (8, 300)
        try:
            retry_after = int(await self.redis.eval(RESERVE_ATTEMPT, 1, key, limit, window))
        except RedisError as exc:
            # An unavailable shared guard must not silently permit unlimited
            # password hashing on every worker. Existing sessions remain usable.
            raise HTTPException(status_code=503, detail="登录服务暂时不可用，请稍后重试") from exc
        if retry_after:
            raise HTTPException(
                status_code=429, detail="尝试次数较多，请稍后重试",
                headers={"Retry-After": str(retry_after)},
            )
        return key

    async def succeeded(self, key: str) -> None:
        try:
            await self.redis.delete(key)
        except RedisError:
            # A successful authentication may continue; the bounded key expires.
            pass

    async def captcha_required(self, key: str, *, next_attempt: bool = False) -> bool:
        try:
            attempts = int(await self.redis.get(key) or 0)
        except RedisError:
            raise HTTPException(status_code=503, detail="登录服务暂时不可用，请稍后重试") from None
        return attempts >= (3 if next_attempt else 4)


async def get_login_limiter():
    redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
    try:
        yield LoginAttemptLimiter(redis)
    finally:
        await redis.aclose()
