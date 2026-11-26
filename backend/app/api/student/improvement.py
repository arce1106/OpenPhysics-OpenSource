from fastapi import APIRouter, Body, Depends, Header

from app.services.improvement_plan_service import ImprovementPlanService
from app.services.rich_content_render_service import RichContentRenderService

from . import schemas
from .dependencies import (
    get_current_learning_student_id,
    get_current_student_id,
    get_improvement_plan_service,
    get_rich_content_render_service,
    include_rendered_requested,
    maybe_enrich_rich_content,
)


router = APIRouter(prefix="/improvement", tags=["student-improvement"])


@router.post("/plans/from-scope-result", response_model=schemas.ImprovementPlanResponse)
async def create_improvement_plan_from_scope_result(
    body: schemas.CreateImprovementPlanFromScopeRequest,
    student_id: str = Depends(get_current_learning_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.create_from_scope_result(student_id, body.diagnostic_result)


@router.get("/plans/latest", response_model=schemas.ImprovementPlanResponse | None)
async def get_latest_improvement_plan(
    scope_type: str | None = None,
    scope_id: str | None = None,
    student_id: str = Depends(get_current_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.get_latest_plan(student_id, scope_type=scope_type, scope_id=scope_id)


@router.get("/plans/{plan_id}", response_model=schemas.ImprovementPlanResponse)
async def get_improvement_plan(
    plan_id: str,
    student_id: str = Depends(get_current_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.get_plan(student_id, plan_id)


@router.get("/plans/{plan_id}/report", response_model=schemas.ImprovementReportResponse)
async def get_improvement_report(
    plan_id: str,
    student_id: str = Depends(get_current_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.get_improvement_report(student_id, plan_id)


@router.get("/reports/latest-completed", response_model=schemas.ImprovementReportResponse | None)
async def get_latest_completed_improvement_report(
    scope_type: str | None = None,
    scope_id: str | None = None,
    student_id: str = Depends(get_current_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.get_latest_completed_report(student_id, scope_type=scope_type, scope_id=scope_id)


@router.get("/reports", response_model=schemas.ImprovementReportListResponse)
async def list_completed_improvement_reports(
    limit: int = 10,
    offset: int = 0,
    scope_type: str | None = None,
    scope_id: str | None = None,
    student_id: str = Depends(get_current_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.list_completed_reports(
        student_id,
        limit=limit,
        offset=offset,
        scope_type=scope_type,
        scope_id=scope_id,
    )


@router.patch("/plans/{plan_id}/tasks/{task_id}", response_model=schemas.ImprovementPlanResponse)
async def update_improvement_task_status(
    plan_id: str,
    task_id: str,
    body: schemas.UpdateImprovementTaskStatusRequest,
    student_id: str = Depends(get_current_learning_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.update_task_status(student_id, plan_id, task_id, body.status)


@router.post("/plans/{plan_id}/next", response_model=schemas.ImprovementPlanResponse)
async def move_to_next_improvement_task(
    plan_id: str,
    body: schemas.MoveToNextImprovementTaskRequest = Body(default_factory=schemas.MoveToNextImprovementTaskRequest),
    student_id: str = Depends(get_current_learning_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.move_to_next_task(
        student_id,
        plan_id,
        mark_in_progress=body.mark_in_progress,
    )


@router.post("/plans/{plan_id}/retest/start", response_model=schemas.ImprovementRetestSessionResponse)
async def start_improvement_retest(
    plan_id: str,
    body: schemas.ImprovementRetestStartRequest = Body(default_factory=schemas.ImprovementRetestStartRequest),
    student_id: str = Depends(get_current_learning_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
    rich_content_svc: RichContentRenderService = Depends(get_rich_content_render_service),
    include_rendered: bool = False,
    x_openphysics_include_rendered: str | None = Header(default=None, alias="X-OpenPhysics-Include-Rendered"),
):
    result = await improvement_svc.start_retest(
        student_id,
        plan_id,
        question_count_per_task=body.question_count_per_task,
        max_questions=body.max_questions,
    )
    session = result.get("session") if isinstance(result, dict) else getattr(result, "session", None)
    questions = session.get("questions") if isinstance(session, dict) else getattr(session, "questions", None)
    await maybe_enrich_rich_content(
        rich_content_svc,
        "enrich_questions",
        questions,
        include_rendered=include_rendered_requested(include_rendered, x_openphysics_include_rendered),
    )
    return result


@router.post(
    "/plans/{plan_id}/retest/{attempt_id}/submitted-feedback",
    response_model=schemas.ImprovementRetestResultResponse,
)
async def submit_improvement_retest_feedback(
    plan_id: str,
    attempt_id: str,
    body: schemas.ImprovementRetestSubmittedFeedbackRequest,
    student_id: str = Depends(get_current_learning_student_id),
    improvement_svc: ImprovementPlanService = Depends(get_improvement_plan_service),
):
    return await improvement_svc.submit_retest_feedback(student_id, plan_id, attempt_id, body.answers)
