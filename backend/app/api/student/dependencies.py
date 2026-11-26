import asyncio
import logging
from typing import Any

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.services.adaptive_service import AdaptiveService
from app.services.ai_service import AIService
from app.services.daily_learning_loop_service import DailyLearningLoopService
from app.services.diagnostic_attempt_service import DiagnosticAttemptService
from app.services.growth_report_service import GrowthReportService
from app.services.improvement_plan_service import ImprovementPlanService
from app.services.knowledge_mastery_judgment_service import KnowledgeMasteryJudgmentService
from app.services.knowledge_service import KnowledgeService
from app.services.learning_path_service import LearningPathService
from app.services.learning_service import LearningService
from app.services.learning_catalog_service import LearningCatalogService
from app.services.learning_trace_service import LearningTraceService
from app.services.learning_video_curation_service import LearningVideoCurationService
from app.services.model_graph_service import ModelGraphService
from app.services.quest_service import QuestService
from app.services.question_service import QuestionService
from app.services.reward_service import RewardService
from app.services.rich_content_render_service import RichContentRenderService
from app.services.student_service import StudentService
from app.services.student_learning_state_service import StudentLearningStateService
from app.services.student_access_policy import StudentAccessPolicy
from app.services.student_ai_usage_service import StudentAiUsageService
from app.services.video_recommendation_service import VideoRecommendationService


_rich_content_render_service = RichContentRenderService()
logger = logging.getLogger(__name__)


def include_rendered_requested(
    include_rendered: bool | str | None = False,
    x_openphysics_include_rendered: str | None = None,
) -> bool:
    """Return whether this request explicitly asks for pre-rendered rich content."""
    return _truthy(include_rendered) or _truthy(x_openphysics_include_rendered)


async def maybe_enrich_rich_content(
    rich_content_svc: Any,
    method_name: str,
    *args: Any,
    include_rendered: bool = False,
) -> Any | None:
    """Call a rich-content enrichment method only when requested, without failing the API."""
    logger.debug("rich content include_rendered=%s method=%s", include_rendered, method_name)
    if not include_rendered or not hasattr(rich_content_svc, method_name):
        return None
    try:
        return await asyncio.to_thread(getattr(rich_content_svc, method_name), *args)
    except Exception as exc:  # pragma: no cover - defensive API fallback
        logger.warning("rich content enrichment failed method=%s: %s", method_name, exc)
        return None


def _truthy(value: bool | str | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def get_student_ai_usage_service(db: AsyncSession = Depends(get_db)) -> StudentAiUsageService:
    return StudentAiUsageService(db)


def get_adaptive_service(
    db: AsyncSession = Depends(get_db),
    ai_usage_svc: StudentAiUsageService = Depends(get_student_ai_usage_service),
) -> AdaptiveService:
    return AdaptiveService(db, ai_usage_svc=ai_usage_svc)


def get_learning_path_service(db: AsyncSession = Depends(get_db)) -> LearningPathService:
    return LearningPathService(db)


def get_student_service(db: AsyncSession = Depends(get_db)) -> StudentService:
    return StudentService(db)


def get_student_access_policy(
    student_svc: StudentService = Depends(get_student_service),
) -> StudentAccessPolicy:
    return StudentAccessPolicy(student_svc)


def get_student_learning_state_service(db: AsyncSession = Depends(get_db)) -> StudentLearningStateService:
    return StudentLearningStateService(db)


def get_knowledge_service(db: AsyncSession = Depends(get_db)) -> KnowledgeService:
    return KnowledgeService(db)


def get_knowledge_mastery_judgment_service(
    db: AsyncSession = Depends(get_db),
) -> KnowledgeMasteryJudgmentService:
    return KnowledgeMasteryJudgmentService(db)


def get_question_service(db: AsyncSession = Depends(get_db)) -> QuestionService:
    return QuestionService(db)


def get_learning_service(db: AsyncSession = Depends(get_db)) -> LearningService:
    return LearningService(db)


def get_learning_catalog_service(
    db: AsyncSession = Depends(get_db),
) -> LearningCatalogService:
    return LearningCatalogService(db)


def get_learning_trace_service(db: AsyncSession = Depends(get_db)) -> LearningTraceService:
    return LearningTraceService(db)


def get_learning_video_curation_service(db: AsyncSession = Depends(get_db)) -> LearningVideoCurationService:
    return LearningVideoCurationService(db)


def get_model_graph_service(db: AsyncSession = Depends(get_db)) -> ModelGraphService:
    return ModelGraphService(db)


def get_ai_service() -> AIService:
    return AIService()


def get_video_recommendation_service() -> VideoRecommendationService:
    return VideoRecommendationService(
        search_api_key=settings.web_search_api_key,
        search_api_url=settings.web_search_api_url,
    )


def get_rich_content_render_service() -> RichContentRenderService:
    return _rich_content_render_service


def get_reward_service(db: AsyncSession = Depends(get_db)) -> RewardService:
    return RewardService(db)


def get_quest_service(db: AsyncSession = Depends(get_db)) -> QuestService:
    return QuestService(db)


def get_growth_report_service(db: AsyncSession = Depends(get_db)) -> GrowthReportService:
    return GrowthReportService(db)


def get_daily_learning_loop_service(db: AsyncSession = Depends(get_db)) -> DailyLearningLoopService:
    return DailyLearningLoopService(db)


def get_improvement_plan_service(db: AsyncSession = Depends(get_db)) -> ImprovementPlanService:
    return ImprovementPlanService(db)


def get_diagnostic_attempt_service(db: AsyncSession = Depends(get_db)) -> DiagnosticAttemptService:
    return DiagnosticAttemptService(db)


async def get_current_student_id(
    authorization: str | None = Header(default=None),
    student_svc: StudentService = Depends(get_student_service),
) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Student login required")
    token = authorization.split(" ", 1)[1].strip()
    student_id = student_svc.decode_access_token(token)
    if not student_id:
        raise HTTPException(status_code=401, detail="Invalid or expired student token")
    student = await student_svc.get_student(student_id)
    if not student or student.status != "active":
        raise HTTPException(status_code=401, detail="Student account unavailable")
    if not student_svc.token_matches_auth_version(token, student):
        raise HTTPException(status_code=401, detail="Student credentials changed; please sign in again")
    return student.id


async def get_current_learning_student_id(
    student_id: str = Depends(get_current_student_id),
    access_policy: StudentAccessPolicy = Depends(get_student_access_policy),
) -> str:
    return await access_policy.ensure_full_learning_access(student_id)


async def student_has_full_learning_access(student_id: str, student_svc: StudentService) -> bool:
    return await StudentAccessPolicy(student_svc).has_full_learning_access(student_id)


async def ensure_student_can_access_kp(
    student_id: str,
    kp_id: str,
    student_svc: StudentService,
) -> str:
    return await StudentAccessPolicy(student_svc).ensure_can_access_kp(student_id, kp_id)


async def ensure_student_can_access_question(
    student_id: str,
    question_id: str,
    student_svc: StudentService,
) -> str:
    return await StudentAccessPolicy(student_svc).ensure_can_access_question(student_id, question_id)
