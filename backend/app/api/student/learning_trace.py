from fastapi import APIRouter, Depends

from app.services.learning_trace_service import LearningTraceService

from . import schemas
from .dependencies import get_current_student_id, get_learning_trace_service


router = APIRouter(prefix="/learning-trace", tags=["student-learning-trace"])


@router.get("", response_model=schemas.LearningTraceResponse)
async def list_learning_trace(
    limit: int = 20,
    offset: int = 0,
    scope_type: str | None = None,
    scope_id: str | None = None,
    student_id: str = Depends(get_current_student_id),
    trace_svc: LearningTraceService = Depends(get_learning_trace_service),
):
    return await trace_svc.list_learning_trace(
        student_id,
        limit=limit,
        offset=offset,
        scope_type=scope_type,
        scope_id=scope_id,
    )
