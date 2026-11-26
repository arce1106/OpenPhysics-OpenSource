from fastapi import APIRouter, Depends

from app.services.knowledge_mastery_judgment_service import KnowledgeMasteryJudgmentService

from . import schemas
from .dependencies import get_current_student_id, get_knowledge_mastery_judgment_service


router = APIRouter(prefix="/mastery-judgments", tags=["student-mastery-judgments"])


@router.get("/kps/{kp_id}", response_model=schemas.KnowledgeMasteryJudgmentResponse)
async def get_kp_mastery_judgment(
    kp_id: str,
    student_id: str = Depends(get_current_student_id),
    judgment_svc: KnowledgeMasteryJudgmentService = Depends(get_knowledge_mastery_judgment_service),
):
    return await judgment_svc.get_kp_judgment(student_id, kp_id)


@router.post("/kps", response_model=schemas.KnowledgeMasteryJudgmentBatchResponse)
async def get_kp_mastery_judgments(
    body: schemas.KnowledgeMasteryJudgmentBatchRequest,
    student_id: str = Depends(get_current_student_id),
    judgment_svc: KnowledgeMasteryJudgmentService = Depends(get_knowledge_mastery_judgment_service),
):
    return await judgment_svc.get_kp_judgments(student_id, body.kp_ids)


@router.get("/scope", response_model=schemas.ScopeKnowledgeMasteryJudgmentResponse)
async def get_scope_mastery_judgments(
    scope_type: str,
    scope_id: str,
    student_id: str = Depends(get_current_student_id),
    judgment_svc: KnowledgeMasteryJudgmentService = Depends(get_knowledge_mastery_judgment_service),
):
    return await judgment_svc.get_scope_judgments(student_id, scope_type, scope_id)
