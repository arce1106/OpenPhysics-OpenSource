from sqlalchemy import delete, select, func, case, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models.knowledge import KnowledgePoint
from app.models.question import (
    Question, QuestionOption, QuestionLabel, QuestionFormula, QuestionImage,
    QualityStatus,
)
from app.models.student import ItemStats
from app.models.question_video import QuestionVideo
from types import SimpleNamespace

from app.services.grading_reliability import answer_key_for

APPROVAL_NEEDS_ANSWER = "题目缺少标准答案，不能设为已审核；请先补充答案（选择题也可标记正确选项）。"


class QuestionNotGradable(ValueError):
    """An approved question must carry a standard answer that grading can rely on."""

    def __init__(self, detail: str = APPROVAL_NEEDS_ANSWER):
        super().__init__(detail)


def _is_approved(status) -> bool:
    return str(getattr(status, "value", status) or "") == QualityStatus.approved.value


def ensure_gradable_if_approved(status, answer, question_type, options) -> None:
    """Reject an approved question without an answer key at import/review time."""
    if not _is_approved(status):
        return
    candidate = SimpleNamespace(
        answer=answer,
        question_type=question_type,
        options=[
            option if not isinstance(option, dict) else SimpleNamespace(**option)
            for option in (options or [])
        ],
    )
    if not answer_key_for(candidate):
        raise QuestionNotGradable()


class QuestionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_questions(
        self, status: QualityStatus | None = None, kp_id: str | None = None,
        difficulty_tier: str | None = None, search: str | None = None,
        question_type: str | None = None,
        volume: str | None = None, chapter: str | None = None, section: str | None = None,
        limit: int = 20, offset: int = 0,
        has_video: bool | None = None,
        primary_kp_only: bool = False,
        exclude_ids=None,
    ) -> list[Question]:
        query = select(Question).options(
            selectinload(Question.options),
            selectinload(Question.labels),
            selectinload(Question.formulas),
            selectinload(Question.images),
        )
        if status:
            query = query.where(Question.quality_status == status)
        if exclude_ids is not None:
            query = query.where(Question.id.not_in(exclude_ids))
        if has_video is not None:
            has_approved_video = select(QuestionVideo.id).where(
                QuestionVideo.question_id == Question.id, QuestionVideo.status == "approved",
            ).exists()
            query = query.where(has_approved_video if has_video else ~has_approved_video)
        scope_subquery = self._scope_question_ids(kp_id, volume, chapter, section)
        if scope_subquery is not None:
            query = query.where(Question.id.in_(scope_subquery))
        if primary_kp_only:
            if not kp_id:
                raise ValueError("A target knowledge point is required for primary-only selection")
            # Filter before pagination: auxiliary labels must neither enter the
            # practice pool nor crowd primary questions out of the first page.
            query = query.where(Question.id.in_(
                select(QuestionLabel.question_id).where(
                    QuestionLabel.label_type == "knowledge_point",
                    QuestionLabel.label_id == kp_id,
                    func.lower(func.trim(func.coalesce(QuestionLabel.role, ""))).in_(["primary", "主要"]),
                )
            ))
        if difficulty_tier:
            query = query.where(Question.difficulty_tier == difficulty_tier)
        if question_type:
            query = query.where(Question.question_type == question_type)
        if search:
            pattern = f"%{search.strip()}%"
            query = query.where(or_(
                Question.id.ilike(pattern),
                Question.stem_text.ilike(pattern),
                Question.answer.ilike(pattern),
                Question.explanation.ilike(pattern),
            ))
        query = query.order_by(Question.id.desc()).offset(offset).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def count_questions(
        self, status: QualityStatus | None = None, kp_id: str | None = None,
        difficulty_tier: str | None = None, search: str | None = None,
        question_type: str | None = None,
        volume: str | None = None, chapter: str | None = None, section: str | None = None,
        has_video: bool | None = None,
        exclude_ids=None,
    ) -> int:
        query = select(func.count(func.distinct(Question.id)))
        if exclude_ids is not None:
            query = query.where(Question.id.not_in(exclude_ids))
        if has_video is not None:
            has_approved_video = select(QuestionVideo.id).where(
                QuestionVideo.question_id == Question.id, QuestionVideo.status == "approved",
            ).exists()
            query = query.where(has_approved_video if has_video else ~has_approved_video)
        scope_subquery = self._scope_question_ids(kp_id, volume, chapter, section)
        if scope_subquery is not None:
            query = query.where(Question.id.in_(scope_subquery))
        if status:
            query = query.where(Question.quality_status == status)
        if difficulty_tier:
            query = query.where(Question.difficulty_tier == difficulty_tier)
        if question_type:
            query = query.where(Question.question_type == question_type)
        if search:
            pattern = f"%{search.strip()}%"
            query = query.where(or_(
                Question.id.ilike(pattern),
                Question.stem_text.ilike(pattern),
                Question.answer.ilike(pattern),
                Question.explanation.ilike(pattern),
            ))
        result = await self.db.execute(query)
        return int(result.scalar() or 0)

    def _scope_question_ids(
        self,
        kp_id: str | None = None,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
    ):
        if not any([kp_id, volume, chapter, section]):
            return None

        query = (
            select(QuestionLabel.question_id)
            .join(KnowledgePoint, KnowledgePoint.id == QuestionLabel.label_id)
            .where(QuestionLabel.label_type == "knowledge_point")
        )
        if kp_id:
            query = query.where(QuestionLabel.label_id == kp_id)
        if volume:
            query = query.where(KnowledgePoint.volume == volume)
        if chapter:
            query = query.where(KnowledgePoint.chapter == chapter)
        if section:
            query = query.where(KnowledgePoint.section == section)
        return query.distinct()

    async def get_question(self, question_id: str) -> Question | None:
        result = await self.db.execute(
            select(Question)
            .where(Question.id == question_id)
            .options(
                selectinload(Question.options),
                selectinload(Question.labels),
                selectinload(Question.formulas),
                selectinload(Question.images),
            )
        )
        return result.scalar()

    async def create_question(self, data: dict) -> Question:
        options_data = data.pop("options", [])
        labels_data = data.pop("labels", [])
        formulas_data = data.pop("formulas", [])
        images_data = data.pop("images", [])
        ensure_gradable_if_approved(
            data.get("quality_status"), data.get("answer"), data.get("question_type"), options_data,
        )

        q = Question(**data)
        self.db.add(q)
        for opt in options_data:
            self.db.add(QuestionOption(question_id=q.id, **opt))
        for lbl in labels_data:
            self.db.add(QuestionLabel(question_id=q.id, **lbl))
        for fml in formulas_data:
            self.db.add(QuestionFormula(question_id=q.id, **fml))
        for img in images_data:
            self.db.add(QuestionImage(question_id=q.id, **img))
        await self.db.commit()
        created = await self.get_question(q.id)
        assert created is not None
        return created

    async def update_question(self, question_id: str, data: dict) -> Question | None:
        q = await self.get_question(question_id)
        if not q:
            return None
        if {"quality_status", "answer"} & set(data):
            ensure_gradable_if_approved(
                data.get("quality_status", q.quality_status), data.get("answer", q.answer),
                data.get("question_type", q.question_type), q.options,
            )
        for key, value in data.items():
            if key not in ("options", "labels", "formulas", "images"):
                setattr(q, key, value)
        await self.db.commit()
        await self.db.refresh(q)
        return q

    async def update_children(self, question_id: str, data: dict) -> Question | None:
        """Update question + all child rows (options, labels, formulas, images)."""
        q = await self.get_question(question_id)
        if not q:
            return None
        if {"quality_status", "answer", "options"} & set(data):
            ensure_gradable_if_approved(
                data.get("quality_status", q.quality_status), data.get("answer", q.answer),
                data.get("question_type", q.question_type), data.get("options", q.options),
            )

        # Update scalar fields (same blacklist pattern as update_question)
        for key, value in data.items():
            if key not in ("options", "labels", "formulas", "images"):
                setattr(q, key, value)

        # Replace children: delete old, insert new
        for child_attr, child_class, pk_col in [
            ("options", QuestionOption, "id"),
            ("labels", QuestionLabel, "id"),
            ("formulas", QuestionFormula, "id"),
            ("images", QuestionImage, "id"),
        ]:
            if child_attr in data:
                # Delete existing
                for existing in getattr(q, child_attr):
                    await self.db.delete(existing)
                # Insert new
                for item in data[child_attr]:
                    item["question_id"] = question_id
                    obj = child_class(**item)
                    self.db.add(obj)

        await self.db.commit()
        await self.db.refresh(q)
        return q

    async def question_usage(self, question_id: str) -> dict[str, int] | None:
        """Records that still point at a question; None when the question does not exist.

        A used question must be retired instead of deleted: student answers keep a
        foreign key to it and paper attempts store its id in JSON.
        """
        from app.models.student import StudentAnswer
        from app.models.teacher_paper import TeacherPaperAttempt

        if await self.db.scalar(select(Question.id).where(Question.id == question_id)) is None:
            return None
        usage: dict[str, int] = {}
        answers = await self.db.scalar(
            select(func.count()).select_from(StudentAnswer).where(StudentAnswer.question_id == question_id)
        )
        if answers:
            usage["学生作答"] = int(answers)
        attempts = await self.db.scalar(
            select(func.count()).select_from(TeacherPaperAttempt)
            .where(TeacherPaperAttempt.question_ids.contains([question_id]))
        )
        if attempts:
            usage["套卷作答"] = int(attempts)
        return usage

    async def delete_question(self, question_id: str) -> bool:
        q = await self.get_question(question_id)
        if not q:
            return False
        await self.db.execute(delete(ItemStats).where(ItemStats.question_id == question_id))
        for child_list in [q.options, q.labels, q.formulas, q.images]:
            for child in child_list:
                await self.db.delete(child)
        await self.db.delete(q)
        await self.db.commit()
        return True

    async def delete_question_image(self, question_id: str, image_id: str) -> str | None:
        """Delete a single question image. Returns the image_path if found, else None."""
        result = await self.db.execute(
            select(QuestionImage).where(
                QuestionImage.question_id == question_id,
                QuestionImage.id == image_id,
            )
        )
        img = result.scalar()
        if not img:
            return None
        path = img.image_path
        await self.db.delete(img)
        await self.db.commit()
        return path

    async def update_question_image(
        self, question_id: str, image_id: str, data: dict
    ) -> QuestionImage | None:
        """Update a single question image's metadata (description, image_type)."""
        result = await self.db.execute(
            select(QuestionImage).where(
                QuestionImage.question_id == question_id,
                QuestionImage.id == image_id,
            )
        )
        img = result.scalar()
        if not img:
            return None
        for key, value in data.items():
            if hasattr(img, key):
                setattr(img, key, value)
        await self.db.commit()
        await self.db.refresh(img)
        return img

    async def review_question(self, question_id: str, status: QualityStatus) -> Question | None:
        q = await self.get_question(question_id)
        if not q:
            return None
        ensure_gradable_if_approved(status, q.answer, q.question_type, q.options)
        q.quality_status = status
        await self.db.commit()
        await self.db.refresh(q)
        return q

    async def get_questions_by_knowledge_point(
        self, kp_id: str, limit: int = 5,
    ) -> list[Question]:
        result = await self.db.execute(
            select(Question)
            .join(Question.labels)
            .where(
                QuestionLabel.label_type == "knowledge_point",
                QuestionLabel.label_id == kp_id,
                Question.quality_status == QualityStatus.approved,
            )
            .options(
                selectinload(Question.options),
                selectinload(Question.labels),
                selectinload(Question.formulas),
                selectinload(Question.images),
            )
            .order_by(
                case(
                    (QuestionLabel.role.in_(["primary", "主要"]), 0),
                    else_=1,
                ),
                QuestionLabel.confidence.desc().nullslast(),
                QuestionLabel.id,
            )
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_questions_by_label(
        self, label_type: str, label_id: str, limit: int = 20
    ) -> list[Question]:
        result = await self.db.execute(
            select(Question)
            .join(Question.labels)
            .where(
                QuestionLabel.label_type == label_type,
                QuestionLabel.label_id == label_id,
                Question.quality_status == QualityStatus.approved,
            )
            .options(
                selectinload(Question.options),
                selectinload(Question.labels),
                selectinload(Question.formulas),
                selectinload(Question.images),
            )
            .limit(limit)
        )
        return list(result.scalars().unique().all())

    async def get_approved_questions_with_labels(self, limit: int = 5000) -> list[Question]:
        result = await self.db.execute(
            select(Question)
            .where(Question.quality_status == QualityStatus.approved)
            .options(
                selectinload(Question.labels),
                selectinload(Question.options),
                selectinload(Question.images),
            )
            .limit(limit)
        )
        return list(result.scalars().unique().all())

    async def get_questions_by_ids(self, ids: list[str]) -> list[Question]:
        result = await self.db.execute(
            select(Question)
            .where(Question.id.in_(ids))
            .options(
                selectinload(Question.options),
                selectinload(Question.labels),
                selectinload(Question.formulas),
                selectinload(Question.images),
            )
        )
        return list(result.scalars().all())

    async def update_question_labels(
        self, question_id: str, labels_data: list[dict]
    ) -> Question | None:
        """Replace all labels for a question atomically."""
        q = await self.get_question(question_id)
        if not q:
            return None
        for existing in q.labels:
            await self.db.delete(existing)
        for item in labels_data:
            item["question_id"] = question_id
            self.db.add(QuestionLabel(**item))
        # Sync question_type scalar field from labels
        for item in labels_data:
            if item.get("label_type") == "question_type":
                q.question_type = item["label_id"]
                break
        await self.db.commit()
        await self.db.refresh(q)
        return q

    async def get_question_counts_by_kp(self) -> dict[str, dict[str, int]]:
        """Return {kp_id: {total: int, easy: int, moderate_easy: int, medium: int, moderate_hard: int, hard: int}}.

        Counts all non-deleted questions (any quality_status except retired).
        """
        tier_counts = case(
            (Question.difficulty_tier == "easy", "easy"),
            (Question.difficulty_tier == "moderate_easy", "moderate_easy"),
            (Question.difficulty_tier == "medium", "medium"),
            (Question.difficulty_tier == "moderate_hard", "moderate_hard"),
            (Question.difficulty_tier == "hard", "hard"),
            else_="unlabeled",
        )

        result = await self.db.execute(
            select(
                QuestionLabel.label_id,
                tier_counts.label("tier"),
                func.count(Question.id.distinct()),
            )
            .join(Question, QuestionLabel.question_id == Question.id)
            .where(QuestionLabel.label_type == "knowledge_point")
            .group_by(QuestionLabel.label_id, tier_counts)
        )

        counts: dict[str, dict[str, int]] = {}
        for row in result:
            kp_id, tier, count = row
            if kp_id not in counts:
                counts[kp_id] = {"total": 0, "easy": 0, "moderate_easy": 0, "medium": 0, "moderate_hard": 0, "hard": 0}
            counts[kp_id][tier] = count
            counts[kp_id]["total"] += count

        return counts
