"""Teacher papers: choosing approved bank questions, drafting and publishing.

A draft reads questions live from the bank. Publishing freezes the item list
and a snapshot of every question, so later bank edits never change a paper
students already hold. A personalized homework holds one paper per student
instead (personalized_service).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.question import DifficultyTier, QualityStatus, Question, QuestionLabel, QuestionType
from app.models.student import StudentAnswer
from app.models.teacher import TeacherAssignment
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.services.paper_items import AREA_MM_RANGE, AREA_MM_STEP, BOX_HEIGHTS, default_box, is_choice, normalize_print_layout
from app.services.knowledge_service import canonical_kp_name
from app.services.question_service import QuestionService, answer_key_for
from app.services.teacher_service import TeacherService, TeacherServiceError

MAX_ITEMS = 40
MAX_POINTS = 100.0
TIER_ORDER = [tier.value for tier in DifficultyTier]
DEFAULT_POINTS = {
    "single_choice": 4,
    "multiple_choice": 6,
    "true_false": 2,
    "fill_in_blank": 4,
    "knowledge_fill_in_blank": 4,
    "experiment": 8,
    "graph_construction": 8,
    "problem_solving": 12,
    "comprehensive": 15,
}


# A paper of the teacher's own once saved: fixed as printed, ready to publish to classes.
SAVED = "saved"

def _enum_value(value) -> str | None:
    return getattr(value, "value", value)


def _primary_kp_label(question: Question) -> QuestionLabel | None:
    labels = [label for label in question.labels if label.label_type == "knowledge_point"]
    primary = next(
        (label for label in labels if (label.role or "").strip().lower() in {"primary", "主要"}), None,
    )
    return primary or (labels[0] if labels else None)


def default_points(question_type: str | None) -> float:
    return float(DEFAULT_POINTS.get(question_type or "", 6))


class TeacherAssignmentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.teachers = TeacherService(db)
        self.questions = QuestionService(db)

    # --- Question bank ---

    async def knowledge_points(self) -> list[dict]:
        """Knowledge points that have at least one approved question."""
        has_question = (
            select(QuestionLabel.label_id)
            .join(Question, Question.id == QuestionLabel.question_id)
            .where(QuestionLabel.label_type == "knowledge_point", Question.quality_status == QualityStatus.approved)
        )
        result = await self.db.execute(
            select(KnowledgePoint).where(KnowledgePoint.id.in_(has_question)).order_by(KnowledgePoint.id)
        )
        return [
            {
                "id": kp.id,
                "name": canonical_kp_name(kp.id, kp.name),
                "volume": kp.volume,
                "chapter": kp.chapter,
                "section": kp.section,
            }
            for kp in result.scalars().all()
        ]

    async def outline_counts(self) -> dict:
        """Approved questions per volume, chapter, section and knowledge point, each counted once per level."""
        base = (
            select(QuestionLabel.question_id, KnowledgePoint.id, KnowledgePoint.volume, KnowledgePoint.chapter,
                   KnowledgePoint.section)
            .join(Question, Question.id == QuestionLabel.question_id)
            .join(KnowledgePoint, KnowledgePoint.id == QuestionLabel.label_id)
            .where(QuestionLabel.label_type == "knowledge_point", Question.quality_status == QualityStatus.approved)
            .subquery()
        )
        counts: dict[str, dict[str, int]] = {}
        levels = {
            "volumes": [base.c.volume],
            "chapters": [base.c.volume, base.c.chapter],
            "sections": [base.c.volume, base.c.chapter, base.c.section],
            "points": [base.c.id],
        }
        for name, columns in levels.items():
            rows = await self.db.execute(
                select(*columns, func.count(func.distinct(base.c.question_id))).group_by(*columns)
            )
            counts[name] = {
                "||".join(str(value or "") for value in row[:-1]): int(row[-1]) for row in rows.all()
            }
        # A question on several knowledge points counts once in the whole bank, not once per volume.
        counts["total"] = int((await self.db.execute(select(func.count(func.distinct(base.c.question_id))))).scalar() or 0)
        return counts

    async def search_questions(
        self,
        teacher_id: str,
        class_id: str | None,
        *,
        kp_id: str | None = None,
        volume: str | None = None,
        chapter: str | None = None,
        section: str | None = None,
        question_type: str | None = None,
        difficulty_tier: str | None = None,
        search: str | None = None,
        exclude_attempted: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        if class_id:
            await self.teachers.get_owned_class(teacher_id, class_id)
        if question_type and question_type not in {item.value for item in QuestionType}:
            raise TeacherServiceError(400, "未知的题型")
        if difficulty_tier and difficulty_tier not in TIER_ORDER:
            raise TeacherServiceError(400, "未知的难度")
        page = max(1, page)
        page_size = max(1, min(page_size, 50))
        filters = dict(
            status=QualityStatus.approved, kp_id=kp_id, volume=volume, chapter=chapter, section=section,
            question_type=question_type, difficulty_tier=difficulty_tier, search=search,
        )
        members = await self.member_ids(teacher_id, class_id)
        if exclude_attempted:
            # Met in the app or on a paper homework: both count as done.
            filters["exclude_ids"] = (
                select(StudentAnswer.question_id).where(StudentAnswer.student_id.in_(members))
                .union(
                    select(TeacherSubmissionItem.question_id)
                    .join(TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id)
                    .where(TeacherSubmission.student_id.in_(members))
                )
            )
        items = await self.questions.list_questions(**filters, limit=page_size, offset=(page - 1) * page_size)
        total = await self.questions.count_questions(**filters)
        stats = await self._class_stats(members, [question.id for question in items], teacher_id)
        kp_names = await self._kp_names(items)
        return {
            "items": [self._question_payload(question, kp_names, stats) for question in items],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def _load_questions(self, question_ids: list[str]) -> dict[str, Question]:
        if not question_ids:
            return {}
        result = await self.db.execute(
            select(Question)
            .where(Question.id.in_(question_ids))
            .options(selectinload(Question.options), selectinload(Question.labels), selectinload(Question.images))
        )
        return {question.id: question for question in result.scalars().all()}

    async def _kp_names(self, questions: list[Question]) -> dict[str, KnowledgePoint]:
        kp_ids = {label.label_id for question in questions if (label := _primary_kp_label(question))}
        if not kp_ids:
            return {}
        result = await self.db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(kp_ids)))
        return {kp.id: kp for kp in result.scalars().all()}

    async def member_ids(self, teacher_id: str, class_id: str | None) -> list[str]:
        """Students of one class, or of all the teacher's current classes when no class is given."""
        if class_id:
            return [student.id for student in await self.teachers.list_members(class_id)]
        ids: list[str] = []
        for teacher_class in await self.teachers.list_classes([teacher_id], include_archived=False):
            ids.extend(student.id for student in await self.teachers.list_members(teacher_class.id))
        return list(dict.fromkeys(ids))

    async def _class_stats(self, members: list[str], question_ids: list[str], teacher_id: str) -> dict[str, dict]:
        """How many of these students met each question, and their average score on it.

        Only what this teacher may see: App answers from when the student joined one of the
        teacher's classes, and this teacher's own paper homework (released scores only for the
        rate). Released paper results also appear among a student's answers as copies; those are
        read from the paper itself, once. Partial credit counts as part of the score."""
        if not question_ids or not members:
            return {}
        from app.models.teacher import TeacherClass, TeacherClassMember
        from app.services.teacher_statistics_service import _practice_credit

        attempted: dict[str, set[str]] = {}
        outcomes: dict[str, list[float]] = {}
        joined = select(TeacherClassMember.student_id).join(TeacherClass, TeacherClass.id == TeacherClassMember.class_id).where(
            TeacherClass.teacher_id == teacher_id, TeacherClassMember.student_id == StudentAnswer.student_id,
            TeacherClassMember.added_at <= StudentAnswer.created_at,
        ).exists()
        copied = func.coalesce(StudentAnswer.grading_result['answer_source'].astext, '') == 'teacher_paper'
        app = await self.db.execute(
            select(StudentAnswer.question_id, StudentAnswer.student_id, StudentAnswer.is_correct, StudentAnswer.grading_result)
            .where(StudentAnswer.question_id.in_(question_ids), StudentAnswer.student_id.in_(members), joined, ~copied)
        )
        for question_id, student_id, correct, grading in app.all():
            attempted.setdefault(question_id, set()).add(student_id)
            if correct is not None:
                outcomes.setdefault(question_id, []).append(1.0 if correct else _practice_credit(grading or {}))
        paper = await self.db.execute(
            select(TeacherSubmissionItem.question_id, TeacherSubmission.student_id, TeacherSubmission.source,
                   TeacherSubmissionItem.score, TeacherSubmissionItem.max_score, TeacherSubmission.total_score)
            .join(TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id)
            .join(TeacherAssignment, TeacherAssignment.id == TeacherSubmission.assignment_id)
            .where(TeacherSubmissionItem.question_id.in_(question_ids), TeacherSubmission.student_id.in_(members),
                   TeacherAssignment.teacher_id == teacher_id)
        )
        for question_id, student_id, source, score, maximum, total in paper.all():
            attempted.setdefault(question_id, set()).add(student_id)
            # App homework answers are already among the app answers above.
            if source != "app" and total is not None and score is not None and maximum:
                outcomes.setdefault(question_id, []).append(min(score / maximum, 1.0))
        return {
            question_id: {
                "class_attempted": len(students),
                "class_correct_rate": round(sum(outcomes[question_id]) / len(outcomes[question_id]), 4)
                if outcomes.get(question_id) else None,
            }
            for question_id, students in attempted.items()
        }

    def _question_payload(
        self, question: Question, kp_map: dict[str, KnowledgePoint], stats: dict[str, dict],
    ) -> dict:
        label = _primary_kp_label(question)
        kp = kp_map.get(label.label_id) if label else None
        question_type = _enum_value(question.question_type)
        return {
            "id": question.id,
            "question_type": question_type,
            "difficulty_tier": _enum_value(question.difficulty_tier),
            "stem_text": question.stem_text,
            "options": [{"label": option.label, "text": option.text} for option in question.options],
            "image_paths": [image.image_path for image in question.images],
            # diagram / option / explanation, by position: figures a text does not place with
            # {{IMG:n}} are shown after the stem or the explanation, as in the admin bank.
            "image_types": [image.image_type for image in question.images],
            "answer": question.answer,
            "explanation": question.explanation,
            "primary_kp": (
                {"id": label.label_id, "name": canonical_kp_name(label.label_id, kp.name if kp else None),
                 "chapter": kp.chapter if kp else None}
                if label else None
            ),
            "default_points": default_points(question_type),
            "default_box": default_box(question_type),
            "class_attempted": stats.get(question.id, {}).get("class_attempted", 0),
            "class_correct_rate": stats.get(question.id, {}).get("class_correct_rate"),
        }

    # --- Drafts ---

    async def get_owned(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self.db.get(TeacherAssignment, assignment_id)
        if not assignment or assignment.teacher_id != teacher_id:
            raise TeacherServiceError(404, "测验不存在")
        return assignment

    async def list_for_class(self, teacher_id: str, class_id: str) -> list[TeacherAssignment]:
        await self.teachers.get_owned_class(teacher_id, class_id)
        result = await self.db.execute(
            select(TeacherAssignment)
            .where(TeacherAssignment.class_id == class_id)
            .order_by(TeacherAssignment.created_at.desc())
        )
        return list(result.scalars().all())

    async def create(self, teacher_id: str, class_id: str | None, title: str) -> TeacherAssignment:
        """A class draft (the original per-class flow), or with no class the teacher's own paper."""
        if class_id:
            teacher_class = await self.teachers.get_owned_class(teacher_id, class_id)
            if teacher_class.archived_at is not None:
                raise TeacherServiceError(400, "班级已归档，不能新建测验")
        assignment = TeacherAssignment(
            id=f"a_{uuid.uuid4().hex}",
            teacher_id=teacher_id,
            class_id=class_id,
            title=self._clean_title(title),
            items=[],
        )
        self.db.add(assignment)
        await self.db.commit()
        await self.db.refresh(assignment)
        return assignment

    async def update_draft(self, teacher_id: str, assignment_id: str, *, title: str | None, items: list[dict] | None):
        assignment = await self._owned_draft(teacher_id, assignment_id)
        if title is not None:
            assignment.title = self._clean_title(title)
        if items is not None:
            if assignment.kind == "personalized":
                raise TeacherServiceError(400, "个性化作业请逐个学生修改题目")
            assignment.items = await self._validated_items(items)
        await self.db.commit()
        await self.db.refresh(assignment)
        return assignment

    async def delete_draft(self, teacher_id: str, assignment_id: str) -> None:
        """A draft, or a paper of the teacher's own (saved or not): the classes keep what they hold."""
        assignment = await self.get_owned(teacher_id, assignment_id)
        if assignment.class_id:
            assignment = await self._owned_draft(teacher_id, assignment_id)
        await self.db.delete(assignment)
        await self.db.commit()

    async def alternatives(self, teacher_id: str, assignment_id: str, question_id: str, limit: int = 5) -> list[dict]:
        """Approved questions on the same primary knowledge point and tier, nearest tier first."""
        assignment = await self._owned_draft(teacher_id, assignment_id)
        current = (await self._load_questions([question_id])).get(question_id)
        if not current:
            raise TeacherServiceError(404, "题目不存在")
        label = _primary_kp_label(current)
        if not label:
            return []
        in_paper = {item["question_id"] for item in assignment.items} | {question_id}
        result = await self.db.execute(
            select(Question)
            .join(QuestionLabel, QuestionLabel.question_id == Question.id)
            .where(
                QuestionLabel.label_type == "knowledge_point",
                QuestionLabel.label_id == label.label_id,
                Question.quality_status == QualityStatus.approved,
                Question.question_type == current.question_type,
                Question.id.not_in(in_paper),
            )
            .options(selectinload(Question.options), selectinload(Question.labels), selectinload(Question.images))
            .distinct()
            .limit(200)
        )
        candidates = [
            question for question in result.scalars().all()
            if (primary := _primary_kp_label(question)) and primary.label_id == label.label_id
        ]
        members = await self.member_ids(teacher_id, assignment.class_id)
        stats = await self._class_stats(members, [question.id for question in candidates], teacher_id)
        tier = _enum_value(current.difficulty_tier)

        def distance(question: Question) -> int:
            other = _enum_value(question.difficulty_tier)
            if tier not in TIER_ORDER or other not in TIER_ORDER:
                return len(TIER_ORDER)
            return abs(TIER_ORDER.index(tier) - TIER_ORDER.index(other))

        # Prefer questions the class has not met yet, then the closest difficulty.
        candidates.sort(key=lambda q: (stats.get(q.id, {}).get("class_attempted", 0) > 0, distance(q), q.id))
        chosen = candidates[:limit]
        kp_names = await self._kp_names(chosen)
        return [self._question_payload(question, kp_names, stats) for question in chosen]

    async def detail(self, teacher_id: str, assignment_id: str, *, stats_class_id: str | None = None) -> dict:
        """A paper without a class counts answers across all the teacher's classes, or one chosen class."""
        from app.services.teacher_homework_service import sync_open_homework

        assignment = await self.get_owned(teacher_id, assignment_id)
        await sync_open_homework(self.db, [assignment])
        teacher_class = (await self.teachers.get_owned_class(teacher_id, assignment.class_id)
                         if assignment.class_id else None)
        if stats_class_id and not assignment.class_id:
            await self.teachers.get_owned_class(teacher_id, stats_class_id)
        members = await self.member_ids(teacher_id, assignment.class_id or stats_class_id)
        if assignment.status == "draft":
            questions = await self._load_questions([item["question_id"] for item in assignment.items])
            stats = await self._class_stats(members, list(questions), teacher_id)
            kp_names = await self._kp_names(list(questions.values()))
            payloads = {qid: self._question_payload(q, kp_names, stats) for qid, q in questions.items()}
        else:
            stats = await self._class_stats(members, [item["question_id"] for item in assignment.items], teacher_id)
            payloads = {
                snapshot["id"]: {**self.frozen_question(snapshot), **stats.get(snapshot["id"], {"class_attempted": 0, "class_correct_rate": None})}
                for snapshot in assignment.question_snapshot or []
            }
        items = []
        for number, item in enumerate(assignment.items, start=1):
            items.append({
                "number": number,
                "question_id": item["question_id"],
                "points": item["points"],
                "box": item.get("box"),
                "area_mm": item.get("area_mm"),
                "print_layout": item.get("print_layout"),
                # A draft may reference a question that has since left the approved bank.
                "question": payloads.get(item["question_id"]),
            })
        collected = (await self.db.execute(
            select(func.count()).select_from(TeacherSubmission).where(TeacherSubmission.assignment_id == assignment.id)
        )).scalar()
        detail = {
            **self.summary(assignment),
            "class_name": teacher_class.name if teacher_class else None,
            "collected": int(collected or 0),
            "items": items,
            "settings": assignment.settings,
        }
        if assignment.kind == "personalized":
            detail["settings"] = assignment.settings
            detail["papers"] = await self.personalized().detail_papers(assignment) if assignment.class_id else []
        elif (assignment.settings or {}).get("delivery") == "app" and assignment.class_id:
            detail["papers"] = await self.personalized().detail_papers(assignment)
        if not assignment.class_id:
            # The classes this paper or these settings were already given to.
            detail["assigned"] = await self.library().assigned(assignment)
        return detail

    @staticmethod
    def frozen_question(snapshot: dict) -> dict:
        """Older papers may hold the frozen explanation only in their App snapshot."""
        return {**snapshot, "explanation": snapshot.get("explanation") if "explanation" in snapshot
                else (snapshot.get("_app_snapshot") or {}).get("_explanation")}

    async def frozen_items(self, assignment: TeacherAssignment) -> list[tuple[dict, dict]]:
        """(item, question snapshot) pairs of a published assignment, across every student's paper."""
        if assignment.kind == "personalized":
            pairs: list[tuple[dict, dict]] = []
            for paper in await self.personalized().papers(assignment.id):
                pairs.extend(zip(paper.items, paper.question_snapshot or []))
            return pairs
        return list(zip(assignment.items, assignment.question_snapshot or []))

    async def owned_personalized_draft(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self._owned_draft(teacher_id, assignment_id)
        if assignment.kind != "personalized":
            raise TeacherServiceError(400, "这不是个性化作业")
        return assignment

    def personalized(self):
        from app.services.personalized_service import PersonalizedHomeworkService

        return PersonalizedHomeworkService(self.db, self)

    def library(self):
        from app.services.teacher_library_service import TeacherLibraryService

        return TeacherLibraryService(self)

    def summary(self, assignment: TeacherAssignment) -> dict:
        if assignment.kind == "personalized":
            # Each student has their own paper; the list shows the planned count per student.
            settings = assignment.settings or {}
            count = int(settings.get("choice_count", 0)) + int(settings.get("area_count", 0))
            points = None
        else:
            count = len(assignment.items)
            points = sum(float(item["points"]) for item in assignment.items)
        return {
            "id": assignment.id,
            "class_id": assignment.class_id,
            "source_id": assignment.source_id,
            "title": assignment.title,
            "kind": assignment.kind,
            "status": assignment.status,
            "question_count": count,
            "total_points": points,
            "created_at": assignment.created_at,
            "published_at": assignment.published_at,
            "results_released_at": assignment.results_released_at,
            "removed_at": assignment.removed_at,
            "delivery": (assignment.settings or {}).get("delivery"),
        }

    async def _owned_draft(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self.get_owned(teacher_id, assignment_id)
        if assignment.removed_at:
            raise TeacherServiceError(409, "作业已删除，不能修改")
        if assignment.status == SAVED:
            raise TeacherServiceError(409, "试卷已保存，不能再修改；要改动请复制一份")
        if assignment.status != "draft":
            raise TeacherServiceError(409, "测验已发布，不能再修改")
        return assignment

    @staticmethod
    def _clean_title(title: str) -> str:
        text = (title or "").strip()
        if not text:
            raise TeacherServiceError(400, "测验名称不能为空")
        if len(text) > 60:
            raise TeacherServiceError(400, "测验名称不能超过 60 个字符")
        return text

    async def _validated_items(self, items: list[dict]) -> list[dict]:
        if len(items) > MAX_ITEMS:
            raise TeacherServiceError(400, f"一份测验最多 {MAX_ITEMS} 道题")
        ids = [item["question_id"] for item in items]
        if len(set(ids)) != len(ids):
            raise TeacherServiceError(400, "同一道题不能重复出现")
        questions = await self._load_questions(ids)
        cleaned = []
        for item in items:
            question = questions.get(item["question_id"])
            if not question or question.quality_status != QualityStatus.approved:
                raise TeacherServiceError(400, f"题目 {item['question_id']} 不在已审核题库中")
            question_type = _enum_value(question.question_type)
            points = float(item.get("points") if item.get("points") is not None else default_points(question_type))
            if not 0 < points <= MAX_POINTS:
                raise TeacherServiceError(400, f"分值需在 0 到 {MAX_POINTS:g} 之间")
            box = None if is_choice(question_type) else (item.get("box") or default_box(question_type))
            if box is not None and box not in BOX_HEIGHTS:
                raise TeacherServiceError(400, "作答框大小只能是 small、medium 或 large")
            entry = {"question_id": question.id, "points": points, "box": box}
            try:
                layout = normalize_print_layout(item.get("print_layout"))
            except (ValueError, TypeError) as exc:
                raise TeacherServiceError(400, str(exc)) from exc
            if layout:
                entry["print_layout"] = layout
            area_mm = item.get("area_mm")
            if area_mm is not None and box is not None:
                low, high = AREA_MM_RANGE
                if not low <= area_mm <= high or area_mm % AREA_MM_STEP:
                    raise TeacherServiceError(400, f"作答区高度需在 {low} 到 {high} 毫米之间，按 {AREA_MM_STEP} 毫米调整")
                entry["area_mm"] = area_mm
            cleaned.append(entry)
        # Homework doubles as the answer sheet: choice questions lead, answered in one table.
        cleaned.sort(key=lambda item: not is_choice(_enum_value(questions[item["question_id"]].question_type)))
        return cleaned

    # --- Publishing ---

    async def snapshot(self, items: list[dict]) -> list[dict]:
        """Frozen copies of the questions, in paper order; every question needs an answer key."""
        questions = await self._load_questions([item["question_id"] for item in items])
        for question in questions.values():
            if not answer_key_for(question):
                raise TeacherServiceError(400, f"题目 {question.id} 缺少标准答案，不能发布")
        kp_names = await self._kp_names(list(questions.values()))
        snapshot = []
        for item in items:
            payload = self._question_payload(questions[item["question_id"]], kp_names, {})
            from app.services.teacher_paper_service import question_snapshot

            payload["_app_snapshot"] = question_snapshot(questions[item["question_id"]], route="teacher_homework")
            payload.pop("class_attempted")
            payload.pop("class_correct_rate")
            snapshot.append(payload)
        return snapshot

    async def freeze_paper(self, paper: TeacherAssignment) -> None:
        """Saving a paper of the teacher's own fixes it as printed: questions, points, answer
        areas and the question text itself. Every class it is published to gets exactly this."""
        if paper.status == SAVED:
            return
        if paper.class_id or paper.kind != "test" or paper.status != "draft":
            raise TeacherServiceError(400, "只有“我的组卷”里的测验可以保存")
        if not paper.items:
            raise TeacherServiceError(400, "试卷里还没有题目")
        # Re-check: a question may have left the approved bank since it was added.
        paper.items = await self._validated_items(paper.items)
        paper.question_snapshot = await self.snapshot(paper.items)
        paper.status = SAVED
        paper.published_at = datetime.now(timezone.utc)

    async def save_paper(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        paper = await self._owned_draft(teacher_id, assignment_id)
        await self.freeze_paper(paper)
        await self.db.commit()
        await self.db.refresh(paper)
        return paper

    async def publish(self, teacher_id: str, assignment_id: str) -> TeacherAssignment:
        assignment = await self._owned_draft(teacher_id, assignment_id)
        if not assignment.class_id:
            raise TeacherServiceError(400, "请先布置到班级")
        if assignment.kind != "personalized" and not assignment.items:
            raise TeacherServiceError(400, "测验里还没有题目")
        members = await self.teachers.list_members(assignment.class_id)
        if not [student for student in members if student.status == "active"]:
            raise TeacherServiceError(400, "班级里还没有学生，无法发布")
        assignment.roster = await self.teachers.roster_snapshot(assignment.class_id)
        if assignment.kind == "personalized":
            await self.personalized().publish(assignment)
        else:
            # Re-check: a question may have left the approved bank since it was added.
            assignment.items = await self._validated_items(assignment.items)
            assignment.question_snapshot = await self.snapshot(assignment.items)
        assignment.status = "published"
        assignment.published_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(assignment)
        return assignment
