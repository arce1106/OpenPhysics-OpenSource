"""Teacher homework in the student apps: the list on the home screen, and opening one.

Opening returns the same paper session as the 高考复习 teacher papers, so the apps answer it
with their existing paper flow (answer all, submit, then each answer is graded).
"""
from fastapi import APIRouter, Depends, Header, HTTPException

from app.services.adaptive_service import AdaptiveService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.teacher_homework_service import homework_attempt, student_homework
from app.services.teacher_paper_service import attempt_session

from . import schemas
from .dependencies import (
    get_adaptive_service,
    get_current_student_id,
    get_rich_content_render_service,
    include_rendered_requested,
)

router = APIRouter()


@router.get("/teacher-homework", response_model=list[schemas.TeacherHomeworkSummary])
async def list_teacher_homework(
    history: bool = False,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
):
    """The home card's list; with ``history`` every homework the student has finished stays in it."""
    return await student_homework(adaptive_svc.db, student_id, history=history)


@router.post("/teacher-homework/{attempt_id}/session", response_model=schemas.PracticeSessionResponse)
async def open_teacher_homework(
    attempt_id: str,
    student_id: str = Depends(get_current_student_id),
    adaptive_svc: AdaptiveService = Depends(get_adaptive_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    attempt = await homework_attempt(adaptive_svc.db, student_id, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="没有这份老师作业")
    return await attempt_session(adaptive_svc.db, student_id, attempt, adaptive_svc, rich_content_svc,
                                 include_rendered_requested(include_rendered, x_openphysics_include_rendered))
