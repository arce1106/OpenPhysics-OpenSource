from collections import Counter, defaultdict
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.question import Question
from app.models.student import Student, StudentAnswer, StudentMastery
from app.services.knowledge_service import canonical_kp_name
from app.services.physics_error_types import error_type_name


MASTERY_WEAK_THRESHOLD = 0.5
LEGACY_DEFAULT_STUDENT_ID = "default"


def _round(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


UNASSIGNED_CLASS = "未分班"

class AdminTeachingService:
    """Build teacher-facing learning signals from student practice data."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def build_dashboard(self, class_name: str | None = None, limit: int = 20) -> dict:
        all_students = await self._load_students()
        scoped_students = [
            student
            for student in all_students
            # Students without a class are listed under the "未分班" button.
            if class_name is None or (student.class_name or UNASSIGNED_CLASS) == class_name
        ]
        all_masteries = await self._load_masteries([student.id for student in all_students])
        all_wrong_answers = await self._load_wrong_answers([student.id for student in all_students])

        return {
            **await self.build_signals_for_students(scoped_students, limit=limit),
            "classes": self._build_class_summaries(all_students, all_masteries, all_wrong_answers),
        }

    async def build_signals_for_students(self, students: list[Student], limit: int = 20) -> dict:
        """Summary, student rows, weak points and hot mistakes for exactly these students."""
        student_ids = [student.id for student in students]

        kps = await self._load_kps()
        kp_map = {kp.id: kp for kp in kps}
        masteries = await self._load_masteries(student_ids)
        wrong_answers = await self._load_wrong_answers(student_ids)
        question_ids = sorted({answer.question_id for answer in wrong_answers})
        questions = await self._load_questions(question_ids)
        question_map = {question.id: question for question in questions}
        question_kp_map = self._question_kp_map(questions)

        pending_answers = [answer for answer in wrong_answers if answer.reviewed_at is None]

        return {
            "summary": self._build_summary(students, masteries, pending_answers),
            "students": self._build_student_summaries(
                students,
                masteries,
                pending_answers,
                kp_map,
            )[:limit],
            "weak_points": self._build_weak_points(
                masteries,
                pending_answers,
                kp_map,
                question_kp_map,
            )[:limit],
            "hot_mistakes": self._build_hot_mistakes(
                wrong_answers,
                question_map,
                kp_map,
                question_kp_map,
            )[:limit],
        }

    async def list_students(self, class_name: str | None = None, limit: int = 100) -> list[dict]:
        dashboard = await self.build_dashboard(class_name=class_name, limit=limit)
        return dashboard["students"]

    async def list_weak_points(self, class_name: str | None = None, limit: int = 20) -> list[dict]:
        dashboard = await self.build_dashboard(class_name=class_name, limit=limit)
        return dashboard["weak_points"]

    async def list_hot_mistakes(self, class_name: str | None = None, limit: int = 20) -> list[dict]:
        dashboard = await self.build_dashboard(class_name=class_name, limit=limit)
        return dashboard["hot_mistakes"]

    async def _load_students(self) -> list[Student]:
        result = await self.db.execute(
            select(Student)
            .where(Student.id != LEGACY_DEFAULT_STUDENT_ID)
            .order_by(Student.class_name, Student.username)
        )
        return list(result.scalars().all())

    async def _load_kps(self) -> list[KnowledgePoint]:
        result = await self.db.execute(select(KnowledgePoint).order_by(KnowledgePoint.id))
        return list(result.scalars().all())

    async def _load_masteries(self, student_ids: list[str]) -> list[StudentMastery]:
        if not student_ids:
            return []
        result = await self.db.execute(
            select(StudentMastery).where(StudentMastery.student_id.in_(student_ids))
        )
        return list(result.scalars().all())

    async def _load_wrong_answers(self, student_ids: list[str]) -> list[StudentAnswer]:
        if not student_ids:
            return []
        result = await self.db.execute(
            select(StudentAnswer)
            .where(
                StudentAnswer.student_id.in_(student_ids),
                StudentAnswer.is_correct == False,
            )
            .order_by(StudentAnswer.created_at.desc(), StudentAnswer.id.desc())
            .limit(500)
        )
        return list(result.scalars().all())

    async def _load_questions(self, question_ids: list[str]) -> list[Question]:
        if not question_ids:
            return []
        result = await self.db.execute(
            select(Question)
            .where(Question.id.in_(question_ids))
            .options(selectinload(Question.labels))
        )
        return list(result.scalars().unique().all())

    def _question_kp_map(self, questions: list[Question]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for question in questions:
            kp_labels = [
                label
                for label in question.labels
                if label.label_type == "knowledge_point"
            ]
            primary = next((label for label in kp_labels if label.role == "主要"), None)
            chosen = primary or (kp_labels[0] if kp_labels else None)
            if chosen:
                mapping[question.id] = chosen.label_id
        return mapping

    def _build_summary(
        self,
        students: list[Student],
        masteries: list[StudentMastery],
        pending_answers: list[StudentAnswer],
    ) -> dict:
        mastery_values = [mastery.mastery for mastery in masteries]
        return {
            "student_count": len(students),
            "active_student_count": sum(1 for student in students if student.status == "active"),
            "class_count": len({student.class_name for student in students if student.class_name}),
            "pending_mistake_count": len(pending_answers),
            "avg_mastery": _round(mean(mastery_values), 4) if mastery_values else 0.0,
        }

    def _build_class_summaries(
        self,
        students: list[Student],
        masteries: list[StudentMastery],
        wrong_answers: list[StudentAnswer],
    ) -> list[dict]:
        students_by_class: dict[str, list[Student]] = defaultdict(list)
        for student in students:
            students_by_class[student.class_name or UNASSIGNED_CLASS].append(student)

        mastery_by_student: dict[str, list[float]] = defaultdict(list)
        for mastery in masteries:
            mastery_by_student[mastery.student_id].append(mastery.mastery)

        pending_by_student = Counter(
            answer.student_id for answer in wrong_answers if answer.reviewed_at is None
        )

        rows = []
        for class_name, class_students in students_by_class.items():
            values = [
                value
                for student in class_students
                for value in mastery_by_student.get(student.id, [])
            ]
            rows.append({
                "class_name": class_name,
                "student_count": len(class_students),
                "active_student_count": sum(1 for student in class_students if student.status == "active"),
                "avg_mastery": _round(mean(values), 4) if values else 0.0,
                "pending_mistake_count": sum(pending_by_student[student.id] for student in class_students),
            })
        return sorted(rows, key=lambda row: row["class_name"])

    def _build_student_summaries(
        self,
        students: list[Student],
        masteries: list[StudentMastery],
        pending_answers: list[StudentAnswer],
        kp_map: dict[str, KnowledgePoint],
    ) -> list[dict]:
        mastery_by_student: dict[str, list[StudentMastery]] = defaultdict(list)
        for mastery in masteries:
            mastery_by_student[mastery.student_id].append(mastery)

        pending_by_student = Counter(answer.student_id for answer in pending_answers)
        rows = []
        for student in students:
            student_masteries = mastery_by_student.get(student.id, [])
            values = [mastery.mastery for mastery in student_masteries]
            rows.append({
                "id": student.id,
                "username": student.username,
                "display_name": student.display_name,
                "class_name": student.class_name,
                "status": student.status,
                "last_login_at": student.last_login_at.isoformat() if student.last_login_at else None,
                "avg_mastery": _round(mean(values), 4) if values else 0.0,
                "pending_mistake_count": pending_by_student[student.id],
                "weak_chapters": self._build_student_weak_chapters(student_masteries, kp_map),
            })
        return sorted(
            rows,
            key=lambda row: (
                -row["pending_mistake_count"],
                row["avg_mastery"],
                row["username"],
            ),
        )

    def _build_student_weak_chapters(
        self,
        masteries: list[StudentMastery],
        kp_map: dict[str, KnowledgePoint],
    ) -> list[dict]:
        grouped: dict[tuple[str, str], list[StudentMastery]] = defaultdict(list)
        for mastery in masteries:
            if mastery.mastery >= MASTERY_WEAK_THRESHOLD:
                continue
            kp = kp_map.get(mastery.knowledge_point_id)
            if not kp:
                continue
            grouped[(kp.volume or "未分册", kp.chapter or "未分章")].append(mastery)

        rows = []
        for (volume, chapter), items in grouped.items():
            rows.append({
                "volume": volume,
                "chapter": chapter,
                "avg_mastery": _round(mean(item.mastery for item in items), 4),
                "weak_kp_count": len({item.knowledge_point_id for item in items}),
            })
        return sorted(rows, key=lambda row: (row["avg_mastery"], row["volume"], row["chapter"]))

    def _build_weak_points(
        self,
        masteries: list[StudentMastery],
        pending_answers: list[StudentAnswer],
        kp_map: dict[str, KnowledgePoint],
        question_kp_map: dict[str, str],
    ) -> list[dict]:
        weak_by_kp: dict[str, list[StudentMastery]] = defaultdict(list)
        for mastery in masteries:
            if mastery.mastery < MASTERY_WEAK_THRESHOLD:
                weak_by_kp[mastery.knowledge_point_id].append(mastery)

        pending_by_kp = Counter(
            question_kp_map[answer.question_id]
            for answer in pending_answers
            if answer.question_id in question_kp_map
        )

        rows = []
        for kp_id, items in weak_by_kp.items():
            kp = kp_map.get(kp_id)
            rows.append({
                "kp_id": kp_id,
                "kp_name": canonical_kp_name(kp_id, kp.name if kp else None),
                "volume": kp.volume if kp else None,
                "chapter": kp.chapter if kp else None,
                "section": kp.section if kp else None,
                "weak_student_count": len({item.student_id for item in items}),
                "avg_mastery": _round(mean(item.mastery for item in items), 4),
                "pending_mistake_count": pending_by_kp[kp_id],
            })
        return sorted(
            rows,
            key=lambda row: (
                -row["weak_student_count"],
                -row["pending_mistake_count"],
                row["avg_mastery"],
                row["volume"] or "",
                row["chapter"] or "",
            ),
        )

    def _build_hot_mistakes(
        self,
        wrong_answers: list[StudentAnswer],
        question_map: dict[str, Question],
        kp_map: dict[str, KnowledgePoint],
        question_kp_map: dict[str, str],
    ) -> list[dict]:
        answers_by_question: dict[str, list[StudentAnswer]] = defaultdict(list)
        for answer in wrong_answers:
            answers_by_question[answer.question_id].append(answer)

        rows = []
        for question_id, answers in answers_by_question.items():
            question = question_map.get(question_id)
            kp_id = question_kp_map.get(question_id)
            kp = kp_map.get(kp_id or "")
            error_type = self._dominant_error_type(answers)
            latest_at = max((answer.created_at for answer in answers if answer.created_at), default=None)
            rows.append({
                "question_id": question_id,
                "stem_preview": (question.stem_text if question else "")[:120],
                "wrong_count": len(answers),
                "affected_student_count": len({answer.student_id for answer in answers}),
                "kp_id": kp_id,
                "kp_name": canonical_kp_name(kp_id or "", kp.name if kp else None) if kp_id else None,
                "error_type": error_type,
                "error_type_name": error_type_name(error_type) if error_type else "未归类错因",
                "latest_at": latest_at.isoformat() if latest_at else None,
            })
        return sorted(
            rows,
            key=lambda row: (
                -row["wrong_count"],
                -row["affected_student_count"],
                row["question_id"],
            ),
        )

    def _dominant_error_type(self, answers: list[StudentAnswer]) -> str | None:
        counts = Counter()
        for answer in answers:
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            error_type = grading.get("error_type")
            if isinstance(error_type, str) and error_type:
                counts[error_type] += 1
        return counts.most_common(1)[0][0] if counts else None
