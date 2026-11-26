"""Account state controls learning; no purchase is needed or serialized."""
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.core.config import settings
from app.services.student_service import StudentService
from app.services.student_access_policy import StudentAccessPolicy
from app.services.student_ai_usage_service import daily_ai_limit_for_student


def account(status="active"):
    return SimpleNamespace(id="demo", username="demo", display_name="演示", phone=None,
        class_name=None, grade=None, account_source="self_registered", status=status,
        last_login_at=None, created_at=None)


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["admin", "self_registered"])
async def test_active_accounts_have_full_access_without_purchases(source):
    person = account()
    person.account_source = source
    class Students:
        async def get_student(self, student_id): return person
    policy = StudentAccessPolicy(Students())
    assert await policy.has_full_learning_access(person.id)
    assert await policy.ensure_can_access_kp(person.id, "x3c5s5k01") == person.id
    assert await policy.ensure_can_access_question(person.id, "demo_ch01_020") == person.id
    assert daily_ai_limit_for_student(person) == settings.student_ai_daily_limit
    profile = StudentService.serialize_student(person)
    assert not any(key.startswith("subscription_") or key == "trial_used" for key in profile)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["disabled", "deleted", "inactive"])
async def test_disabled_accounts_cannot_learn_or_use_ai(status):
    person = account(status)
    class Students:
        async def get_student(self, student_id): return person
    policy = StudentAccessPolicy(Students())
    assert not await policy.has_full_learning_access(person.id)
    with pytest.raises(HTTPException) as error:
        await policy.ensure_can_access_question(person.id, "demo_ch01_020")
    assert error.value.status_code == 401
    assert daily_ai_limit_for_student(person) == 0
