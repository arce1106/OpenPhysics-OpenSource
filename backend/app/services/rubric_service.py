"""Scoring rubrics for bank questions, shared by every teacher.

A rubric splits a question into its parts, "(1)", "(2)", ..., each with points
and the scoring points that earn them. Points are relative: a paper that gives
the question another total scales them.

AI drafts a rubric when a question first goes out (or, at the latest, before AI pre-grading),
and the draft is used right away to grade by part. Teachers correct and confirm rubrics while
reviewing; a confirmed rubric is the one every teacher uses from then on. There is no approval
queue: waiting for one would leave AI grading a whole question that it could grade by part.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.question import Question
from app.models.teacher_scan import QuestionRubric, TeacherAiCall
from app.services.teacher_ai_service import AiReading

logger = logging.getLogger(__name__)

STATUSES = ("drafting", "draft", "approved", "rejected", "failed")
# A draft is used as it is; "approved" means a teacher (or, before, an administrator) confirmed it.
USABLE = ("draft", "approved")


def usable_parts(rubric: "QuestionRubric | None") -> list[dict] | None:
    return list(rubric.parts) if rubric is not None and rubric.status in USABLE and rubric.parts else None
MAX_PARTS = 8
MAX_CRITERIA = 8

DRAFT_PROMPT = """你是高中物理阅卷组长，为一道题制定评分细则。

要求：
1. 按小问拆分；题目没有小问时只写一个部分，label 写“全题”。
2. 每个部分给出分值 points（正数，可以是 0.5 的倍数）和 2 到 5 条采分点 criteria。
   每条采分点写清楚“做到什么得几分”，例如“写出 v=v_0+at 得 2 分”。
3. 各部分分值之和等于给定的满分。
4. 公式用 LaTeX，并用 $...$ 包裹；采分点用中文。
5. 只依据题干、标准答案和解析，不要编造题目没有的条件。
6. 每条采分点控制在 40 字以内，不要输出解题过程或其他说明。
7. 采分点按物理含义写，不规定某一种写法或符号约定。
只输出 JSON：{"parts": [{"label": "(1)", "points": 6, "criteria": ["...", "..."]}]}"""


class RubricError(ValueError):
    pass


class RubricDrafter(Protocol):
    async def draft(self, question: dict) -> AiReading: ...


class TextModelRubricDrafter:
    """Draft with the same primary and backup graders as student answers."""

    async def draft(self, question: dict) -> AiReading:
        from app.services.ai_service import AIService

        result, response, _ = await AIService().request_grading_json(
            answer_tokens=4000,
            validate=lambda result: clean_parts(result.get("parts")),
            messages=[
                {"role": "system", "content": DRAFT_PROMPT},
                {"role": "user", "content": json.dumps(question, ensure_ascii=False)},
            ],
        )
        usage = getattr(response, "usage", None)
        return AiReading(
            result=result,
            input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
            output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
        )


def clean_parts(raw) -> list[dict]:
    """Validated parts, or RubricError with a message an administrator can act on."""
    if not isinstance(raw, list) or not raw:
        raise RubricError("评分细则至少要有一个部分")
    if len(raw) > MAX_PARTS:
        raise RubricError(f"评分细则最多 {MAX_PARTS} 个部分")
    parts, labels = [], set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise RubricError("评分细则格式不正确")
        label = str(entry.get("label") or "").strip()[:20]
        if not label or label in labels:
            raise RubricError("每个部分需要一个不重复的名称，如 (1)")
        try:
            points = float(entry.get("points"))
        except (TypeError, ValueError):
            raise RubricError(f"{label} 的分值不是数字") from None
        if not 0 < points <= 100 or (points * 2) != int(points * 2):
            raise RubricError(f"{label} 的分值需为 0.5 的倍数且不超过 100")
        criteria = [str(text).strip()[:200] for text in entry.get("criteria") or [] if str(text).strip()]
        if not criteria:
            raise RubricError(f"{label} 至少要有一条采分点")
        labels.add(label)
        parts.append({"label": label, "points": points, "criteria": criteria[:MAX_CRITERIA]})
    return parts


def scaled_parts(parts: list[dict], total: float) -> list[dict]:
    """Parts rescaled to a paper's points for the question, in half points, summing exactly."""
    base = sum(part["points"] for part in parts)
    if not parts or base <= 0:
        return []
    # base_points keeps the rubric's own points, which the criteria texts are written in.
    scaled = [{**part, "base_points": part["points"], "points": round(part["points"] / base * total * 2) / 2}
              for part in parts]
    scaled[-1]["points"] = round((total - sum(part["points"] for part in scaled[:-1])) * 2) / 2
    if scaled[-1]["points"] < 0:
        return [{"label": "全题", "points": total, "criteria": [c for part in parts for c in part["criteria"]]}]
    return scaled


def serialize(rubric: QuestionRubric | None) -> dict | None:
    if rubric is None:
        return None
    return {
        "question_id": rubric.question_id,
        "status": rubric.status,
        "parts": rubric.parts,
        "total_points": rubric.total_points,
        "source": rubric.source,
        "note": rubric.note,
        "drafted_at": rubric.drafted_at,
        "reviewed_by": rubric.reviewed_by,
        "reviewed_at": rubric.reviewed_at,
    }


class RubricService:
    def __init__(self, db: AsyncSession, drafter: RubricDrafter | None = None):
        self.db = db
        self.drafter = drafter or TextModelRubricDrafter()

    async def for_questions(self, question_ids: list[str]) -> dict[str, QuestionRubric]:
        if not question_ids:
            return {}
        result = await self.db.execute(select(QuestionRubric).where(QuestionRubric.question_id.in_(question_ids)))
        return {rubric.question_id: rubric for rubric in result.scalars().all()}

    async def queue_missing(self, question_ids: list[str]) -> list[str]:
        """Mark questions without a rubric as drafting; returns the ones to draft."""
        existing = await self.for_questions(question_ids)
        queued = []
        for question_id in dict.fromkeys(question_ids):
            if question_id in existing and existing[question_id].status != "failed":
                continue
            rubric = existing.get(question_id) or QuestionRubric(question_id=question_id, parts=[])
            rubric.status, rubric.source = "drafting", "ai"
            self.db.add(rubric)
            queued.append(question_id)
        await self.db.commit()
        return queued

    async def draft(self, question_id: str, *, default_points: float = 10.0) -> QuestionRubric:
        question = (await self.db.execute(
            select(Question).where(Question.id == question_id).options(selectinload(Question.options))
        )).scalar_one_or_none()
        if question is None:
            raise RubricError("题目不存在")
        rubric = await self.db.get(QuestionRubric, question_id) or QuestionRubric(question_id=question_id, parts=[])
        payload = {
            "题型": getattr(question.question_type, "value", question.question_type),
            "满分": default_points,
            "题干": question.stem_text,
            "标准答案": question.answer or "",
            "解析": question.explanation or "",
        }
        try:
            reading = await self.drafter.draft(payload)
            parts = clean_parts(reading.result.get("parts"))
        except Exception as exc:
            logger.warning("rubric draft failed for %s: %s", question_id, exc)
            rubric.status, rubric.note = "failed", "AI 起草失败，可以重试或手动填写"
            self.db.add(rubric)
            self.db.add(TeacherAiCall(purpose="rubric_draft", image_hash=question_id, assignment_id="",
                                      teacher_id="platform", status="error"))
            await self.db.commit()
            return rubric
        cost = (reading.input_tokens * settings.teacher_ai_input_cost_per_million
                + reading.output_tokens * settings.teacher_ai_output_cost_per_million) / 1_000_000
        self.db.add(TeacherAiCall(
            purpose="rubric_draft", image_hash=question_id, assignment_id="", teacher_id="platform",
            status="ok", result={"parts": parts}, input_tokens=reading.input_tokens,
            output_tokens=reading.output_tokens, estimated_cost=cost,
        ))
        rubric.parts, rubric.total_points = parts, sum(part["points"] for part in parts)
        rubric.status, rubric.source, rubric.note = "draft", "ai", None
        rubric.drafted_at = datetime.now(timezone.utc)
        rubric.reviewed_by = rubric.reviewed_at = None
        self.db.add(rubric)
        await self.db.commit()
        await self.db.refresh(rubric)
        return rubric

    async def review(self, question_id: str, *, parts, approve: bool, note: str | None, reviewer: str) -> QuestionRubric:
        if await self.db.get(Question, question_id) is None:
            raise RubricError("题目不存在")
        rubric = await self.db.get(QuestionRubric, question_id) or QuestionRubric(
            question_id=question_id, parts=[], source="human",
        )
        if approve or parts is not None:
            cleaned = clean_parts(parts)
            rubric.parts, rubric.total_points = cleaned, sum(part["points"] for part in cleaned)
        rubric.status = "approved" if approve else "rejected"
        rubric.note = (note or "").strip()[:300] or None
        rubric.reviewed_by, rubric.reviewed_at = reviewer, datetime.now(timezone.utc)
        self.db.add(rubric)
        await self.db.commit()
        await self.db.refresh(rubric)
        return rubric

    async def listing(self, status: str | None, page: int = 1, page_size: int = 20) -> dict:
        if status and status not in STATUSES:
            raise RubricError("未知的状态")
        query = select(QuestionRubric, Question).join(Question, Question.id == QuestionRubric.question_id)
        count = select(func.count()).select_from(QuestionRubric)
        if status:
            query = query.where(QuestionRubric.status == status)
            count = count.where(QuestionRubric.status == status)
        page = max(1, page)
        rows = (await self.db.execute(
            query.options(selectinload(Question.images))
            .order_by(QuestionRubric.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )).all()
        return {
            "total": int((await self.db.execute(count)).scalar()),
            "items": [{
                **serialize(rubric),
                "question": {
                    "id": question.id,
                    "question_type": getattr(question.question_type, "value", question.question_type),
                    "stem_text": question.stem_text,
                    "answer": question.answer,
                    "explanation": question.explanation,
                    "image_paths": [image.image_path for image in question.images],
                },
            } for rubric, question in rows],
        }
