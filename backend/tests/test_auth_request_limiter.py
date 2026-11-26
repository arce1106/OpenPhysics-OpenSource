from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from redis.exceptions import ConnectionError
from app.services.auth_request_limiter import SensitiveActionLimiter

@pytest.mark.asyncio
async def test_unavailable_limiter_fails_closed():
    with pytest.raises(HTTPException) as caught:
        await SensitiveActionLimiter(SimpleNamespace(eval=AsyncMock(side_effect=ConnectionError()))).reserve([("captcha-ip", "192.0.2.1", 300, 600)])
    assert caught.value.status_code == 503

@pytest.mark.asyncio
async def test_blocked_budget_preserves_retry_after_and_hides_identity():
    redis = SimpleNamespace(eval=AsyncMock(return_value=[21, 1]))
    with pytest.raises(HTTPException) as caught:
        await SensitiveActionLimiter(redis).reserve([("account", "synthetic-account", 3, 60)])
    assert caught.value.status_code == 429 and caught.value.headers["Retry-After"] == "21"
    assert "synthetic-account" not in repr(redis.eval.call_args)
