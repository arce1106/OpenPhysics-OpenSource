from openai import AsyncOpenAI
from fastapi import HTTPException
from app.core.config import settings


_deepseek_client: AsyncOpenAI | None = None
_doubao_client: AsyncOpenAI | None = None


class AIConfigurationError(HTTPException):
    def __init__(self):
        super().__init__(503, "AI 服务尚未配置，请联系部署管理员。")


def get_deepseek_client() -> AsyncOpenAI:
    global _deepseek_client
    if _deepseek_client is None:
        if not settings.deepseek_api_key.strip():
            raise AIConfigurationError()
        _deepseek_client = AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            timeout=60,
        )
    return _deepseek_client


def get_doubao_client() -> AsyncOpenAI:
    global _doubao_client
    if _doubao_client is None:
        if not settings.ark_api_key.strip() or not settings.doubao_tutor_model.strip():
            raise AIConfigurationError()
        _doubao_client = AsyncOpenAI(
            api_key=settings.ark_api_key,
            base_url=settings.ark_base_url,
            timeout=90,
        )
    return _doubao_client
