"""AI reading of collected paper homework: authorization, metering, caps and a result cache.

Only small crops ever leave the server: the handwritten student-number boxes,
and, for students whose school or guardian authorized it, the strip of choice
answer cells. Every real provider call is recorded with its token usage and an
estimated cost; an identical crop is answered from that record instead of
calling the provider again.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.student import Student, StudentPrivacyConsent
from app.models.teacher_scan import TeacherAiCall

logger = logging.getLogger(__name__)

TEACHER_AI_SCOPE = "teacher_ai"
TEACHER_AI_VERSION = "teacher-ai-2026-10-22.1"
GRANTORS = {"school": "学校", "guardian": "监护人"}

NUMBER_PROMPT = (
    "图片是一名学生在作业卷右上角学号方格里手写的数字，每个方格一个数字，左侧方格可能为空。"
    "只读数字，不要猜测。只输出 JSON：{\"number\": \"读到的数字串，读不出写空字符串\", "
    "\"confidence\": 0 到 1 之间的小数}"
)
CHOICES_PROMPT = (
    "图片里每个格子上方印着题号，格子里是学生手写的选择题答案字母。"
    "多选题可能写多个字母，空格表示未作答。只识别字母，不判断对错。"
    "被划掉、涂黑或圈掉后改写的字母不算答案，只读最终保留的字母。"
    "格子里有涂改、字迹越出格线或被格线截断、看不清时，confidence 不超过 0.5。"
    "允许的选项见“题目选项”。只输出 JSON：{\"answers\": [{\"number\": 题号, "
    "\"answer\": \"按字母顺序的大写字母，未作答写空字符串\", \"confidence\": 0 到 1 之间的小数}]}"
)

_CACHED_PROMPTS = {"student_number": NUMBER_PROMPT, "choices": CHOICES_PROMPT}


class TeacherAiQuotaExceeded(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


@dataclass
class AiReading:
    result: dict
    input_tokens: int = 0
    output_tokens: int = 0


class ScanRecognizer(Protocol):
    async def read_number(self, image: bytes) -> AiReading: ...

    async def read_choices(self, image: bytes, options: dict[int, list[str]]) -> AiReading: ...


def _json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


class ModelScanRecognizer:
    """Reads scan crops (student number, choice letters) with the graders' order:
    the configured primary (GRADING_PRIMARY_PROVIDER) first, the other as its backup."""

    async def _ask(self, prompt: str, image: bytes) -> AiReading:
        from openai import OpenAIError
        from app.services.ai_call_budget import create_chat_completion
        from app.services.ai_service import AIService, _finish_reason

        service = object.__new__(AIService)
        messages = [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {
                "url": f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}",
            }},
        ]}]
        last_error: Exception | None = None
        for provider in service._grading_providers():
            client, model = service._grading_connection(provider)
            # Reading a few characters needs little room; DeepSeek's budget includes its reasoning.
            options = ({"max_tokens": 8192, "response_format": {"type": "json_object"}} if provider == "deepseek"
                       else {"max_tokens": 800, "temperature": 0})
            try:
                response = await create_chat_completion(
                    client, provider, settings.teacher_ai_call_timeout_seconds,
                    model=model, messages=messages, **options,
                )
                result = _json(response.choices[0].message.content or "")
                if not result or _finish_reason(response) == "length":
                    raise ValueError("Invalid scan reading")
            except (OpenAIError, ValueError) as exc:
                logger.warning("scan_reading_failed provider=%s kind=%s", provider, type(exc).__name__)
                last_error = exc
                continue
            usage = getattr(response, "usage", None)
            return AiReading(
                result=result,
                input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
            )
        raise last_error or RuntimeError("no vision provider available")

    async def read_number(self, image: bytes) -> AiReading:
        return await self._ask(NUMBER_PROMPT, image)

    async def read_choices(self, image: bytes, options: dict[int, list[str]]) -> AiReading:
        listing = {str(number): "".join(labels) for number, labels in options.items()}
        return await self._ask(f"{CHOICES_PROMPT}\n题目选项：{json.dumps(listing, ensure_ascii=False)}", image)


def _clean_letters(value, allowed: list[str]) -> str:
    letters = {ch for ch in str(value or "").upper() if ch in allowed}
    return "".join(sorted(letters))


def _confidence(value) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


class TeacherAiService:
    def __init__(self, db: AsyncSession, recognizer: ScanRecognizer | None = None):
        self.db = db
        self.recognizer = recognizer or ModelScanRecognizer()

    # --- Authorization ---

    async def authorized_students(self, student_ids: list[str]) -> set[str]:
        """Students whose latest teacher-AI receipt is a grant of the current version."""
        if not student_ids:
            return set()
        result = await self.db.execute(
            select(StudentPrivacyConsent)
            .where(StudentPrivacyConsent.student_id.in_(student_ids),
                   StudentPrivacyConsent.scope == TEACHER_AI_SCOPE)
            .distinct(StudentPrivacyConsent.student_id)
            .order_by(StudentPrivacyConsent.student_id, StudentPrivacyConsent.id.desc())
        )
        return {
            receipt.student_id for receipt in result.scalars().all()
            if receipt.granted and receipt.version == TEACHER_AI_VERSION
        }

    async def authorization_details(self, student_ids: list[str]) -> dict[str, dict]:
        if not student_ids:
            return {}
        result = await self.db.execute(
            select(StudentPrivacyConsent)
            .where(StudentPrivacyConsent.student_id.in_(student_ids),
                   StudentPrivacyConsent.scope == TEACHER_AI_SCOPE)
            .distinct(StudentPrivacyConsent.student_id)
            .order_by(StudentPrivacyConsent.student_id, StudentPrivacyConsent.id.desc())
        )
        return {
            receipt.student_id: {
                "granted": receipt.granted and receipt.version == TEACHER_AI_VERSION,
                "grantor": receipt.grantor,
                "recorded_at": receipt.recorded_at,
            }
            for receipt in result.scalars().all()
        }

    async def record_authorization(
        self, student_ids: list[str], *, granted: bool, grantor: str, recorded_by: str,
    ) -> int:
        """Record a school's or guardian's written authorization (or its withdrawal)."""
        if grantor not in GRANTORS:
            raise ValueError("授权方只能是学校或监护人")
        students = (await self.db.execute(
            select(Student).where(Student.id.in_(student_ids), Student.status == "active")
        )).scalars().all()
        now = datetime.now(timezone.utc)
        for student in students:
            self.db.add(StudentPrivacyConsent(
                student_id=student.id, scope=TEACHER_AI_SCOPE, version=TEACHER_AI_VERSION,
                granted=granted, recorded_at=now, source="written", grantor=grantor, recorded_by=recorded_by,
            ))
        await self.db.commit()
        return len(students)

    # --- Metered calls ---

    async def usage(self, *, assignment_id: str | None = None, teacher_id: str | None = None) -> dict:
        query = select(func.count(), func.coalesce(func.sum(TeacherAiCall.input_tokens), 0),
                       func.coalesce(func.sum(TeacherAiCall.output_tokens), 0),
                       func.coalesce(func.sum(TeacherAiCall.estimated_cost), 0.0))
        if assignment_id:
            query = query.where(TeacherAiCall.assignment_id == assignment_id)
        if teacher_id:
            query = query.where(TeacherAiCall.teacher_id == teacher_id)
        calls, input_tokens, output_tokens, cost = (await self.db.execute(query)).one()
        return {"calls": calls, "input_tokens": input_tokens, "output_tokens": output_tokens,
                "estimated_cost": round(float(cost), 4)}

    async def remaining_calls(self, assignment_id: str, teacher_id: str, student_count: int) -> tuple[int, str]:
        """How many more provider calls the caps allow now, and the message for when none are left."""
        since = datetime.now(timezone.utc) - timedelta(days=1)

        async def count(*conditions) -> int:
            return int((await self.db.execute(select(func.count()).select_from(TeacherAiCall).where(*conditions))).scalar())

        caps = [
            (max(1, student_count) * settings.teacher_ai_calls_per_student - await count(TeacherAiCall.assignment_id == assignment_id),
             "这份作业的 AI 识别次数已达上限，其余卷子请人工录入"),
            (settings.teacher_ai_daily_calls_per_teacher
             - await count(TeacherAiCall.teacher_id == teacher_id, TeacherAiCall.created_at >= since),
             "今天的 AI 识别次数已达上限，请明天继续或人工录入"),
            (settings.teacher_ai_daily_calls_total - await count(TeacherAiCall.created_at >= since),
             "平台今天的 AI 识别次数已达上限，请明天继续或人工录入"),
        ]
        left, message = min(caps, key=lambda cap: cap[0])
        return max(0, left), message

    @staticmethod
    def digest(purpose: str, data: bytes) -> str:
        # The prompt is part of the key: a reworded prompt must not be answered from old results.
        prompt = _CACHED_PROMPTS.get(purpose, "").encode()
        return hashlib.sha256(purpose.encode() + b"\0" + prompt + b"\0" + data).hexdigest()

    async def cached(self, purpose: str, data: bytes) -> dict | None:
        return (await self.db.execute(
            select(TeacherAiCall.result).where(
                TeacherAiCall.purpose == purpose, TeacherAiCall.image_hash == self.digest(purpose, data),
                TeacherAiCall.status == "ok",
            ).limit(1)
        )).scalar_one_or_none()

    def record(self, purpose: str, data: bytes, *, assignment_id: str, teacher_id: str,
               reading: AiReading | None) -> None:
        """Add the metering row for one provider call (None: the call failed); the caller commits."""
        if reading is None:
            self.db.add(TeacherAiCall(purpose=purpose, image_hash=self.digest(purpose, data),
                                      assignment_id=assignment_id, teacher_id=teacher_id, status="error"))
            return
        cost = (reading.input_tokens * settings.teacher_ai_input_cost_per_million
                + reading.output_tokens * settings.teacher_ai_output_cost_per_million) / 1_000_000
        self.db.add(TeacherAiCall(
            purpose=purpose, image_hash=self.digest(purpose, data), assignment_id=assignment_id,
            teacher_id=teacher_id, status="ok", result=reading.result, input_tokens=reading.input_tokens,
            output_tokens=reading.output_tokens, estimated_cost=cost,
        ))

    async def _metered(self, purpose: str, image: bytes, *, assignment_id: str, teacher_id: str,
                       student_count: int, read) -> dict:
        cached = await self.cached(purpose, image)
        if cached is not None:
            return cached
        left, message = await self.remaining_calls(assignment_id, teacher_id, student_count)
        if left <= 0:
            raise TeacherAiQuotaExceeded(message)
        try:
            reading = await read()
        except Exception:
            self.record(purpose, image, assignment_id=assignment_id, teacher_id=teacher_id, reading=None)
            await self.db.commit()
            raise
        self.record(purpose, image, assignment_id=assignment_id, teacher_id=teacher_id, reading=reading)
        await self.db.commit()
        return reading.result

    async def read_student_number(self, image: bytes, **meter) -> tuple[str, float]:
        result = await self._metered("student_number", image, read=lambda: self.recognizer.read_number(image), **meter)
        number = "".join(ch for ch in str(result.get("number") or "") if ch.isdigit()).lstrip("0")
        return number, _confidence(result.get("confidence"))

    async def read_choices(self, image: bytes, options: dict[int, list[str]], **meter) -> dict[int, tuple[str, float]]:
        result = await self._metered(
            "choices", image, read=lambda: self.recognizer.read_choices(image, options), **meter,
        )
        readings: dict[int, tuple[str, float]] = {}
        for entry in result.get("answers") or []:
            if not isinstance(entry, dict) or not str(entry.get("number", "")).isdigit():
                continue
            number = int(entry["number"])
            if number in options:
                readings[number] = (_clean_letters(entry.get("answer"), options[number]),
                                    _confidence(entry.get("confidence")))
        return readings

    @staticmethod
    def grading_key(images: list[bytes], questions: list[dict]) -> bytes:
        """Cache key for one student's grading: the crops and everything the model was told."""
        return b"\0".join(images) + json.dumps(questions, ensure_ascii=False, sort_keys=True).encode()
