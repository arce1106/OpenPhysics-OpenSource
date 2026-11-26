"""Where students learn badly, read for content work: which knowledge points need more practice or a
better explanation, and which questions go wrong unusually often (sometimes a sign the question
itself — its answer or explanation — is at fault).

Per-student learning belongs to the teachers' class pages; this is the platform's view. Internal
accounts (the administrator's own, review and acceptance accounts) are left out unless asked for,
so testing does not drag the figures.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.learning import LearningVideoCuration
from app.models.question import Question
from app.models.student import Student, StudentAnswer, StudentMastery
from app.models.teacher import Teacher, TeacherClass, TeacherClassMember
from app.services.knowledge_service import canonical_kp_name
from app.services.physics_error_types import error_type_name

# Legacy student groups used for testing and app-store review, not real learners.
INTERNAL_GROUPS = frozenset({"admin", "审核测试", "平台审核账号", "系统验收"})
LEGACY_DEFAULT_STUDENT_ID = "default"
WEAK = 0.5                 # mastery below this is weak
WEAK_SHARE = 0.2           # a knowledge point needs work when at least this share of its learners is weak
ACTIVE_DAYS = 7
MISTAKE_DAYS = 30
SUSPECT_MIN_ANSWERS = 5    # a question needs this many answers before its wrong rate means anything
SUSPECT_WRONG_RATE = 0.8   # wrong this often: check the answer key and explanation first
LIMIT = 30


def _primary_kp(question: Question) -> str | None:
    labels = [label for label in question.labels if label.label_type == "knowledge_point"]
    primary = next((label for label in labels if (label.role or "").strip().lower() in {"primary", "主要"}), None)
    chosen = primary or (labels[0] if labels else None)
    return chosen.label_id if chosen else None


class AdminContentInsightsService:
    def __init__(self, db):
        self.db = db

    async def classes(self) -> list[dict]:
        rows = (await self.db.execute(
            select(TeacherClass, Teacher.display_name).join(Teacher, Teacher.id == TeacherClass.teacher_id)
            .where(TeacherClass.archived_at.is_(None)).order_by(TeacherClass.created_at)
        )).all()
        return [{"id": cls.id, "name": cls.name, "teacher_name": teacher} for cls, teacher in rows]

    async def _scope(self, class_id: str | None, include_internal: bool) -> list[str]:
        if class_id:
            return list((await self.db.scalars(select(TeacherClassMember.student_id).where(
                TeacherClassMember.class_id == class_id))).all())
        query = select(Student.id).where(Student.id != LEGACY_DEFAULT_STUDENT_ID, Student.status == "active")
        if not include_internal:
            query = query.where(func.coalesce(Student.class_name, "").not_in(INTERNAL_GROUPS))
        return list((await self.db.scalars(query)).all())

    async def build(self, *, class_id: str | None = None, include_internal: bool = False) -> dict:
        ids = await self._scope(class_id, include_internal)
        now = datetime.now(timezone.utc)
        recent, window = now - timedelta(days=ACTIVE_DAYS), now - timedelta(days=MISTAKE_DAYS)
        graded = func.coalesce(StudentAnswer.grading_result["_pending_confirmation"].astext, "false") != "true"

        active = await self.db.scalar(select(func.count(func.distinct(StudentAnswer.student_id))).where(
            StudentAnswer.student_id.in_(ids), StudentAnswer.created_at >= recent)) if ids else 0
        to_correct = await self.db.scalar(select(func.count()).select_from(
            select(StudentAnswer.student_id, StudentAnswer.question_id).where(
                StudentAnswer.student_id.in_(ids), StudentAnswer.is_correct.is_(False),
                StudentAnswer.reviewed_at.is_(None), graded,
            ).distinct().subquery())) if ids else 0

        # Recent answers, for both views: wrong ones per knowledge point and per question.
        answers = (await self.db.execute(select(
            StudentAnswer.student_id, StudentAnswer.question_id, StudentAnswer.is_correct, StudentAnswer.grading_result,
        ).where(StudentAnswer.student_id.in_(ids), StudentAnswer.created_at >= window,
                StudentAnswer.is_correct.is_not(None), graded))).all() if ids else []
        question_ids = {row.question_id for row in answers}
        questions = {q.id: q for q in (await self.db.scalars(select(Question).where(Question.id.in_(question_ids))
                                                             .options(selectinload(Question.labels)))).all()} if question_ids else {}
        kp_of = {qid: _primary_kp(q) for qid, q in questions.items()}

        by_question: dict[str, dict] = defaultdict(lambda: {"answers": 0, "wrong": 0, "students": set(), "causes": Counter()})
        wrong_by_kp: Counter = Counter()
        for row in answers:
            entry = by_question[row.question_id]
            entry["answers"] += 1
            if row.is_correct is False:
                entry["wrong"] += 1
                entry["students"].add(row.student_id)
                cause = (row.grading_result or {}).get("error_type") if isinstance(row.grading_result, dict) else None
                if cause and cause not in {"none", "unknown"}:
                    entry["causes"][cause] += 1
                if kp_of.get(row.question_id):
                    wrong_by_kp[kp_of[row.question_id]] += 1

        masteries = (await self.db.scalars(select(StudentMastery).where(
            StudentMastery.student_id.in_(ids), StudentMastery.attempts > 0))).all() if ids else []
        by_kp: dict[str, list[float]] = defaultdict(list)
        for mastery in masteries:
            by_kp[mastery.knowledge_point_id].append(mastery.mastery)
        points = {kp.id: kp for kp in (await self.db.scalars(select(KnowledgePoint).where(
            KnowledgePoint.id.in_(set(by_kp) | set(wrong_by_kp))))).all()} if by_kp or wrong_by_kp else {}
        videos = dict((await self.db.execute(select(LearningVideoCuration.knowledge_point_id, func.count())
                                             .where(LearningVideoCuration.knowledge_point_id.in_(list(by_kp)))
                                             .group_by(LearningVideoCuration.knowledge_point_id))).all()) if by_kp else {}
        weak_points = []
        for kp_id, values in by_kp.items():
            weak = sum(value < WEAK for value in values)
            if not weak or weak / len(values) < WEAK_SHARE:
                continue
            kp = points.get(kp_id)
            weak_points.append({
                "kp_id": kp_id, "kp_name": canonical_kp_name(kp_id, kp.name if kp else None),
                "volume": kp.volume if kp else None, "chapter": kp.chapter if kp else None, "section": kp.section if kp else None,
                "weak_students": weak, "evidence_students": len(values),
                "avg_mastery": round(sum(values) / len(values), 4),
                "wrong_recent": wrong_by_kp.get(kp_id, 0), "video_count": int(videos.get(kp_id, 0)),
            })
        weak_points.sort(key=lambda p: (-p["weak_students"], p["avg_mastery"], -p["wrong_recent"]))

        hot = []
        for qid, entry in by_question.items():
            if not entry["wrong"]:
                continue
            question = questions.get(qid)
            rate = entry["wrong"] / entry["answers"]
            kp_id = kp_of.get(qid)
            cause = entry["causes"].most_common(1)[0][0] if entry["causes"] else None
            hot.append({
                "question_id": qid,
                "stem_preview": (question.stem_text if question else "")[:80],
                "kp_id": kp_id,
                "kp_name": canonical_kp_name(kp_id, points[kp_id].name) if kp_id in points else None,
                "answers": entry["answers"], "wrong": entry["wrong"], "wrong_students": len(entry["students"]),
                "wrong_rate": round(rate, 4),
                "main_cause": error_type_name(cause) if cause else None,
                # Nearly everyone gets it wrong: the key or explanation may be at fault, not the students.
                "suspect": entry["answers"] >= SUSPECT_MIN_ANSWERS and rate >= SUSPECT_WRONG_RATE,
            })
        hot.sort(key=lambda q: (-q["wrong_students"], -q["wrong_rate"], -q["answers"]))

        return {
            "scope": {"class_id": class_id, "include_internal": include_internal,
                      "active_days": ACTIVE_DAYS, "mistake_days": MISTAKE_DAYS},
            "summary": {
                "student_count": len(ids), "active_students": int(active or 0),
                "to_correct": int(to_correct or 0), "weak_point_count": len(weak_points),
                "suspect_questions": sum(q["suspect"] for q in hot),
            },
            "weak_points": weak_points[:LIMIT],
            "hot_mistakes": hot[:LIMIT],
        }
