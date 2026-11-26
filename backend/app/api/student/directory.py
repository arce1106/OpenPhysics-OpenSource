from app.services.model_graph_service import ModelGraphService
from app.services.student_learning_state_service import StudentLearningStateService
from fastapi import APIRouter, Depends

from . import schemas
from .dependencies import (
    get_current_student_id,
    get_model_graph_service,
    get_student_learning_state_service,
)

router = APIRouter()


@router.get("/directory", response_model=schemas.DirectoryResponse)
async def get_directory(
    include_pending: bool = True,
    student_id: str = Depends(get_current_student_id),
    state_svc: StudentLearningStateService = Depends(get_student_learning_state_service),
):
    """Get all KPs with mastery status for the student directory tree."""
    context = (await state_svc.build_directory_context(student_id) if include_pending
               else await state_svc.build_context(student_id))

    kps: list[schemas.DirectoryKpNode] = []
    for state in context["states"]:
        kps.append(schemas.DirectoryKpNode(
            id=state["kp_id"],
            name=state["kp_name"],
            volume=state["volume"],
            chapter=state["chapter"],
            section=state["section"],
            mastery=state["mastery"],
            status=state["status"],
            learning_state=state["learning_state"],
            learning_state_label=state["learning_state_label"],
            learning_state_tone=state["learning_state_tone"],
            blocked_by=state["blocked_by"],
            last_practiced=state["last_practiced"].isoformat() if state["last_practiced"] else None,
            content_available=state.get("content_available", True),
            practice_available=state.get("practice_available", True),
        ))

    learning_stats = context["stats"]

    return schemas.DirectoryResponse(
        kps=kps,
        stats=schemas.DirectoryStats(
            mastered=learning_stats["mastered"],
            in_progress=learning_stats["learning"] + learning_stats["to_learn"] + learning_stats["practice"],
            locked=learning_stats["locked"],
            total=len(kps),
            learning=learning_stats["learning"],
            to_learn=learning_stats["to_learn"],
            practice=learning_stats["practice"],
            pending_content=sum(s["learning_state"] == "pending_content" for s in context["states"]),
        ),
        relations=[
            schemas.DirectoryRelation(
                id=rel.id,
                source_id=rel.source_id,
                target_id=rel.target_id,
                relation_type=rel.relation_type.value,
                reason=rel.reason,
            )
            for rel in context["all_relations"]
        ],
    )


@router.get("/model-graph", response_model=schemas.ModelGraphResponse)
async def get_model_graph(
    student_id: str = Depends(get_current_student_id),
    model_graph_svc: ModelGraphService = Depends(get_model_graph_service),
):
    """Get the physics model graph while preserving the knowledge graph."""
    return await model_graph_svc.build_for_student(student_id)


# ── Per-KP Diagnostic BFF ─────────────────────────────────────────────────────
