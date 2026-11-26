"""Maintenance access to the shared scoring rubrics (no longer an approval queue).

Teachers correct and confirm rubrics on their review page, and AI drafts are used for grading
without waiting for anyone; the admin console no longer shows rubrics. These endpoints remain for
operators who need to inspect, fix or redraft a rubric directly."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.teacher.router import get_rubric_runner
from app.core.database import get_db
from app.models.question import Question
from app.services.rubric_service import RubricError, RubricService, serialize

from .router import verify_admin_token
from .teachers import current_admin_username

router = APIRouter(prefix="/api/admin/rubrics", tags=["admin-rubrics"], dependencies=[Depends(verify_admin_token)])


class RubricPart(BaseModel):
    label: str = Field(max_length=20)
    points: float
    criteria: list[str] = Field(max_length=8)


class RubricReview(BaseModel):
    approve: bool
    parts: list[RubricPart] | None = Field(default=None, max_length=8)
    note: str | None = Field(default=None, max_length=300)


def get_rubric_service(db: AsyncSession = Depends(get_db)) -> RubricService:
    return RubricService(db)


@router.get("")
async def list_rubrics(status: str | None = "draft", page: int = 1, service: RubricService = Depends(get_rubric_service)):
    try:
        return await service.listing(status or None, page=page)
    except RubricError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/{question_id}")
async def review_rubric(
    question_id: str,
    body: RubricReview,
    service: RubricService = Depends(get_rubric_service),
    admin_username: str = Depends(current_admin_username),
):
    try:
        rubric = await service.review(
            question_id, parts=[part.model_dump() for part in body.parts] if body.parts is not None else None,
            approve=body.approve, note=body.note, reviewer=f"admin:{admin_username}",
        )
    except RubricError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return serialize(rubric)


@router.post("/{question_id}/draft", status_code=202)
async def redraft_rubric(
    question_id: str,
    background: BackgroundTasks,
    service: RubricService = Depends(get_rubric_service),
    runner=Depends(get_rubric_runner),
):
    if await service.db.get(Question, question_id) is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    existing = (await service.for_questions([question_id])).get(question_id)
    points = existing.total_points if existing and existing.total_points else 10.0
    if existing and existing.status == "drafting":
        raise HTTPException(status_code=409, detail="正在起草中")
    if existing:
        existing.status = "drafting"
        await service.db.commit()
    else:
        await service.queue_missing([question_id])
    background.add_task(runner, [(question_id, points)])
    return {"question_id": question_id, "status": "drafting"}
