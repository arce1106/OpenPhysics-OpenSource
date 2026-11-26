"""Atomic request limits for authentication and account changes."""

import hashlib
import hmac
import ipaddress

from fastapi import HTTPException, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings

CAPTCHA_IP_LIMIT = 300

RESERVE = """
local wait = 0
local blocked = 0
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i*2-1]) then
    local ttl = math.max(1, redis.call('TTL', key))
    if ttl >= wait then wait = ttl; blocked = i end
  end
end
if wait > 0 then return {wait, blocked} end
for i, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ARGV[i*2]) end
end
return {0, 0}
"""


def request_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    try:
        address = ipaddress.ip_address(peer)
        trusted = any(address in ipaddress.ip_network(cidr.strip())
                      for cidr in settings.auth_trusted_proxy_cidrs.split(",") if cidr.strip())
        if trusted and request.headers.get("x-real-ip"):
            return str(ipaddress.ip_address(request.headers["x-real-ip"]))
        return str(address)
    except ValueError:
        return peer


class SensitiveActionLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def reserve(self, budgets: list[tuple[str, str, int, int]]) -> None:
        keys, args = [], []
        for scope, identity, limit, seconds in budgets:
            digest = hmac.new(settings.student_auth_secret.encode(),
                              f"{scope}:{identity}".encode(), hashlib.sha256).hexdigest()
            keys.append(f"auth-request:v1:{digest}")
            args.extend((limit, seconds))
        try:
            retry, blocked = map(int, await self.redis.eval(RESERVE, len(keys), *keys, *args))
        except RedisError:
            raise HTTPException(503, "账号安全服务暂时不可用，请稍后重试") from None
        if retry:
            message = "操作频繁，请稍后重试"
            raise HTTPException(429, message, headers={"Retry-After": str(retry)})


async def get_sensitive_action_limiter():
    redis = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
    try:
        yield SensitiveActionLimiter(redis)
    finally:
        await redis.aclose()


def captcha_ip_budget(ip: str) -> tuple[str, str, int, int]:
    return ("captcha-ip", ip, CAPTCHA_IP_LIMIT, 600)
