from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.core import ai_client
from app.services import ai_service


def test_non_ai_work_can_construct_ai_service_without_initializing_provider(monkeypatch):
    factory = Mock(side_effect=AssertionError("SDK must remain unused until an AI operation"))
    monkeypatch.setattr(ai_service, "get_doubao_client", factory)
    service = ai_service.AIService()
    factory.assert_not_called()
    injected_client = Mock()
    service.client = injected_client
    assert service.client is injected_client
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_missing_grading_configuration_is_not_reported_as_a_timeout(monkeypatch):
    monkeypatch.setattr(ai_service.settings, "ark_api_key", "")
    monkeypatch.setattr(ai_service.settings, "deepseek_api_key", "")
    with pytest.raises(ai_client.AIConfigurationError) as error:
        await ai_service.AIService().judge_answer("演示题", "演示答案", "演示作答")
    assert error.value.status_code == 503


@pytest.mark.parametrize("provider", ["doubao", "deepseek"])
def test_unconfigured_provider_returns_an_actionable_unavailable_error_without_sdk_calls(monkeypatch, provider):
    monkeypatch.setattr(ai_client, "_doubao_client", None)
    monkeypatch.setattr(ai_client, "_deepseek_client", None)
    monkeypatch.setattr(ai_client.settings, "ark_api_key", "")
    monkeypatch.setattr(ai_client.settings, "deepseek_api_key", "")
    sdk = Mock(side_effect=AssertionError("Do not initialize an SDK with missing credentials"))
    monkeypatch.setattr(ai_client, "AsyncOpenAI", sdk)
    with pytest.raises(HTTPException) as error:
        getattr(ai_client, f"get_{provider}_client")()
    assert error.value.status_code == 503
    assert "尚未配置" in error.value.detail
    sdk.assert_not_called()
