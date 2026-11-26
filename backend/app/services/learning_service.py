from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import ContentType, ContentSource, LearningContent, LearningProgress
from app.models.student import StudentMastery
from app.services.knowledge_tracing import KnowledgeTracingEngine
from app.core.config import settings

# Weaker learning transfer for passive study vs active practice
P_T_PASSIVE = 0.05


class LearningService:
    """Delivers learning content and tracks consumption for the Learning phase."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Content retrieval ──────────────────────────────────────────────────────

    async def get_content_for_kp(self, kp_id: str) -> list[LearningContent]:
        result = await self.db.execute(
            select(LearningContent)
            .where(LearningContent.knowledge_point_id == kp_id)
            .order_by(LearningContent.content_type, LearningContent.version.desc())
        )
        # Keep only latest version per content_type
        seen: set[ContentType] = set()
        contents: list[LearningContent] = []
        for c in result.scalars().all():
            if c.content_type not in seen:
                seen.add(c.content_type)
                contents.append(c)
        return contents

    async def get_content_by_type(
        self, kp_id: str, content_type: str
    ) -> LearningContent | None:
        ct = ContentType(content_type)
        result = await self.db.execute(
            select(LearningContent)
            .where(
                LearningContent.knowledge_point_id == kp_id,
                LearningContent.content_type == ct,
            )
            .order_by(LearningContent.version.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ── Content creation / upsert ──────────────────────────────────────────────

    async def upsert_content(
        self,
        kp_id: str,
        content_type: str,
        title: str,
        body: dict,
        source: str = "curated",
        content_id: str | None = None,
    ) -> LearningContent:
        ct = ContentType(content_type)
        cs = ContentSource(source)

        # Check existing
        existing = await self.get_content_by_type(kp_id, content_type)
        if existing:
            existing.body = body
            existing.title = title
            existing.updated_at = datetime.now(timezone.utc)
            await self.db.commit()
            await self.db.refresh(existing)
            return existing

        import uuid
        cid = content_id or f"{kp_id}-{content_type}-{uuid.uuid4().hex[:6]}"
        content = LearningContent(
            id=cid,
            knowledge_point_id=kp_id,
            content_type=ct,
            title=title,
            body=body,
            source=cs,
        )
        self.db.add(content)
        await self.db.commit()
        await self.db.refresh(content)
        return content

    # ── Progress tracking ──────────────────────────────────────────────────────

    async def get_progress(
        self, student_id: str, kp_id: str
    ) -> list[LearningProgress]:
        result = await self.db.execute(
            select(LearningProgress).where(
                LearningProgress.student_id == student_id,
                LearningProgress.knowledge_point_id == kp_id,
            )
        )
        return list(result.scalars().all())

    async def mark_content_consumed(
        self,
        student_id: str,
        kp_id: str,
        content_id: str,
        content_type: str,
        time_spent_seconds: int = 0,
    ) -> LearningProgress:
        ct = ContentType(content_type)
        # Check for duplicate
        result = await self.db.execute(
            select(LearningProgress).where(
                LearningProgress.student_id == student_id,
                LearningProgress.knowledge_point_id == kp_id,
                LearningProgress.content_id == content_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.consumed_at = datetime.now(timezone.utc)
            if time_spent_seconds > 0:
                existing.time_spent_seconds = time_spent_seconds
            await self.db.commit()
            await self.db.refresh(existing)
            return existing

        progress = LearningProgress(
            student_id=student_id,
            knowledge_point_id=kp_id,
            content_id=content_id,
            content_type=ct,
            time_spent_seconds=time_spent_seconds,
        )
        self.db.add(progress)
        await self.db.commit()
        await self.db.refresh(progress)
        return progress

    # ── BKT update on learning completion ──────────────────────────────────────

    async def record_learning_completion(
        self, student_id: str, kp_id: str
    ) -> StudentMastery | None:
        """Apply a BKT update with reduced learning transfer for passive study.

        Passive study (reading cards, watching slides) has weaker effect than
        active practice. Uses p_t=0.05 instead of the default 0.10.
        """
        from app.models.student import StudentMastery

        result = await self.db.execute(
            select(StudentMastery).where(
                StudentMastery.student_id == student_id,
                StudentMastery.knowledge_point_id == kp_id,
            )
        )
        mastery = result.scalar_one_or_none()

        if not mastery:
            from app.models.knowledge import KnowledgePoint
            kp_result = await self.db.execute(
                select(KnowledgePoint).where(KnowledgePoint.id == kp_id)
            )
            kp = kp_result.scalar_one_or_none()
            p_l0 = KnowledgeTracingEngine.initial_p_l(
                kp.difficulty if kp else None
            )
            mastery = StudentMastery(
                student_id=student_id,
                knowledge_point_id=kp_id,
                attempts=0,
                correct_rate=0.0,
                mastery=p_l0,
            )
            self.db.add(mastery)
            await self.db.flush()

        # Apply forgetting
        if settings.mastery_forgetting_enabled and mastery.last_practiced:
            days = (
                datetime.now(timezone.utc) - mastery.last_practiced
            ).total_seconds() / 86400.0
            p_l_prior = KnowledgeTracingEngine.apply_forgetting(mastery.mastery, days)
        else:
            p_l_prior = mastery.mastery

        # BKT with passive learning transfer (simulate "correct" with weak p_t)
        new_mastery = KnowledgeTracingEngine.p_learn(
            p_l_prior, is_correct=True, p_t=P_T_PASSIVE
        )
        new_confidence = KnowledgeTracingEngine.entropy(new_mastery)

        mastery.mastery = new_mastery
        mastery.confidence = new_confidence
        # Don't increment attempts or update correct_rate — passive study is not a practice attempt
        mastery.last_practiced = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(mastery)
        return mastery

    async def get_mastery_for_kp(
        self, student_id: str, kp_id: str
    ) -> StudentMastery | None:
        result = await self.db.execute(
            select(StudentMastery).where(
                StudentMastery.student_id == student_id,
                StudentMastery.knowledge_point_id == kp_id,
            )
        )
        return result.scalar_one_or_none()
