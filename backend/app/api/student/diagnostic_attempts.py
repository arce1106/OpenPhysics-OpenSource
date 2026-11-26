from fastapi import APIRouter, Depends

from app.services.diagnostic_attempt_service import DiagnosticAttemptService

from . import schemas
from .dependencies import get_current_student_id, get_diagnostic_attempt_service


router = APIRouter(prefix="/diagnostics", tags=["student-diagnostics"])


@router.get("/scope/attempts", response_model=schemas.ScopeDiagnosticAttemptListResponse)
async def list_scope_diagnostic_attempts(
    limit: int = 10,
    offset: int = 0,
    scope_type: str | None = None,
    scope_id: str | None = None,
    student_id: str = Depends(get_current_student_id),
    attempt_svc: DiagnosticAttemptService = Depends(get_diagnostic_attempt_service),
):
    return await attempt_svc.list_attempts(
        student_id,
        limit=limit,
        offset=offset,
        scope_type=scope_type,
        scope_id=scope_id,
    )


@router.get("/scope/attempts/{attempt_id}", response_model=schemas.ScopeDiagnosticAttemptDetailResponse)
async def get_scope_diagnostic_attempt(
    attempt_id: str,
    student_id: str = Depends(get_current_student_id),
    attempt_svc: DiagnosticAttemptService = Depends(get_diagnostic_attempt_service),
):
    return await attempt_svc.get_attempt(student_id, attempt_id)
