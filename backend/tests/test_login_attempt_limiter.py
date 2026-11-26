import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from redis.asyncio import Redis
from redis.exceptions import ConnectionError

from app.api.student.auth import router
from app.api.student.dependencies import get_student_service
from app.services.login_attempt_limiter import LoginAttemptLimiter, get_login_limiter


class FakeRedis:
    def __init__(self):
        self.values = {}

    async def eval(self, _script, _nkeys, key, limit, window):
        if self.values.get(key, 0) >= int(limit):
            return int(window)
        self.values[key] = self.values.get(key, 0) + 1
        return 0

    async def delete(self, key):
        self.values.pop(key, None)

    async def get(self, key):
        return self.values.get(key, 0)


@pytest.mark.asyncio
async def test_login_limits_before_password_hash_and_isolates_accounts():
    redis = FakeRedis()
    limiter = LoginAttemptLimiter(redis)
    class RejectCredentials:
        calls = 0

        async def authenticate_student(self, _username, _password):
            self.calls += 1
            return None

        async def verify_captcha(self, *_args):
            return False

    service = RejectCredentials()
    app = FastAPI()
    app.include_router(router, prefix="/api/student")
    app.dependency_overrides[get_login_limiter] = lambda: limiter
    app.dependency_overrides[get_student_service] = lambda: service
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        results = [await client.post("/api/student/auth/login", json={"username": "audit", "password": "wrong"}) for _ in range(20)]
        assert [r.status_code for r in results] == [401] * 3 + [403] * 5 + [429] * 12
        assert results[2].headers["X-Login-Captcha-Required"] == "true"
        assert service.calls == 3
        assert int(results[-1].headers["Retry-After"]) > 0
        assert (await client.post("/api/student/auth/login", json={"username": "different", "password": "wrong"})).status_code == 401
    assert "audit" not in limiter.key("student", "audit")
    await limiter.succeeded(limiter.key("student", "audit"))
    await limiter.check("student", "audit")


@pytest.mark.asyncio
async def test_unavailable_guard_does_not_fail_open():
    class Unavailable:
        async def eval(self, *_args):
            raise ConnectionError("synthetic unavailable")
    with pytest.raises(HTTPException) as denied:
        await LoginAttemptLimiter(Unavailable()).check("student", "audit")
    assert denied.value.status_code == 503


@pytest.mark.asyncio
async def test_correct_password_after_three_failures_needs_fresh_captcha(db_session):
    from app.services.student_service import StudentService
    service = StudentService(db_session)
    await service.create_student("challenge-user", "right-password", "测试学生")
    limiter = LoginAttemptLimiter(FakeRedis())
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_login_limiter] = lambda: limiter
    app.dependency_overrides[get_student_service] = lambda: service
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(3):
            result = await client.post("/auth/login", json={"username": "challenge-user", "password": "wrong"})
            assert result.status_code == 401
        blocked = await client.post("/auth/login", json={"username": "challenge-user", "password": "right-password"})
        assert blocked.status_code == 403
        captcha = await service.request_captcha(return_debug_answer=True)
        accepted = await client.post("/auth/login", json={"username": "challenge-user", "password": "right-password",
            "captcha_id": captcha["challenge_id"], "captcha_answer": captcha["debug_answer"]})
        assert accepted.status_code == 200
        assert not await limiter.captcha_required(limiter.key("student", "challenge-user"))


@pytest.mark.asyncio
async def test_shared_redis_enforces_limit_atomically_and_expires():
    url = os.getenv("TEST_REDIS_URL")
    if not url:
        pytest.skip("TEST_REDIS_URL not set; use an isolated Redis")
    assert "127.0.0.1" in url, "Refusing non-local test Redis"
    redis = Redis.from_url(url)
    username = "audit-" + uuid4().hex
    first, second = LoginAttemptLimiter(redis), LoginAttemptLimiter(redis)
    key = first.key("admin", username)
    try:
        results = await asyncio.gather(*[
            (first if i % 2 else second).check("admin", username) for i in range(20)
        ], return_exceptions=True)
        assert sum(isinstance(value, str) for value in results) == 5
        assert sum(isinstance(value, HTTPException) and value.status_code == 429 for value in results) == 15
        assert 0 < await redis.ttl(key) <= 900
        await redis.expire(key, 0)
        assert await second.check("admin", username) == key
        await second.succeeded(key)
        assert await redis.exists(key) == 0
    finally:
        await redis.delete(key)
        await redis.aclose()
