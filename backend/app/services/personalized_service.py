"""Personalized homework: one paper per student, drafted from that student's own answers.

The rules are deliberately simple and each chosen question says why it was chosen
(plan section 7). Slots are filled in this order:

1. same_error: a recent wrong answer in scope -> an unseen variation on the same
   knowledge point, same physics model when possible, no harder than the original;
2. weak_kp: knowledge points whose mastery is weak or developing -> easier questions;
3. step_up: knowledge points answered correctly lately -> one difficulty tier up;
4. coverage: the least practised knowledge points in scope, at medium difficulty.

Questions the student has already answered are never chosen, choice slots take only
choice questions, and one paper avoids repeating a knowledge point while it can.
"""
from __future__ import annotations

import hashlib
import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.knowledge import KnowledgePoint
from app.models.question import QualityStatus, Question, QuestionLabel
from app.models.student import Student, StudentAnswer, StudentMastery
from app.models.teacher import TeacherAssignment, TeacherStudentPaper
from app.models.teacher_scan import TeacherSubmission, TeacherSubmissionItem
from app.models.teacher_paper import TeacherPaperAttempt
from app.services.grading_reliability import is_pending_confirmation
from app.services.learning_evidence import answer_observed_at
from app.services.teacher_learning_evidence import HOMEWORK_CATALOG, released_teacher_evidence
from app.services.teacher_service import mask_phone
from app.services.knowledge_mastery_judgment_service import KnowledgeMasteryJudgmentService
from app.services.knowledge_service import canonical_kp_name
from app.services.paper_items import is_choice
from app.services.physics_error_types import error_type_name
from app.services.physics_models import canonical_model_id
from app.services.teacher_service import TeacherServiceError

TIERS = ["easy", "moderate_easy", "medium", "moderate_hard", "hard"]
TIER_NAMES = {"easy": "易", "moderate_easy": "较易", "medium": "中等", "moderate_hard": "较难", "hard": "难"}
RULES = ("same_error", "weak_kp", "step_up", "coverage")
WRONG_WINDOW = timedelta(days=90)
CORRECT_WINDOW = timedelta(days=30)
MAX_PER_KIND = 20
DEFAULT_CHOICE_COUNT, DEFAULT_AREA_COUNT = 4, 2


@dataclass(frozen=True)
class Candidate:
    id: str
    kp_id: str
    choice: bool
    tier: str | None
    model: str | None
    question_type: str | None = None


@dataclass(frozen=True)
class WrongAnswer:
    question: Candidate
    error_type: str | None
    source: str


@dataclass
class Evidence:
    done: set[str] = field(default_factory=set)
    wrong: list[WrongAnswer] = field(default_factory=list)  # most recent first
    mastery: dict[str, float] = field(default_factory=dict)
    attempts: dict[str, int] = field(default_factory=dict)
    recent_correct: dict[str, str] = field(default_factory=dict)  # kp -> hardest tier answered right

    @property
    def empty(self) -> bool:
        return not (self.wrong or self.mastery or self.recent_correct)


def _tier_rank(tier: str | None) -> int:
    return TIERS.index(tier) if tier in TIERS else TIERS.index("medium")


def _not_harder(tier: str | None) -> list[str]:
    """The original tier first, then easier ones, then harder ones."""
    rank = _tier_rank(tier)
    return [TIERS[rank], *reversed(TIERS[:rank]), *TIERS[rank + 1:]]


def _around(tier: str) -> list[str]:
    rank = TIERS.index(tier)
    return sorted(TIERS, key=lambda other: (abs(TIERS.index(other) - rank), TIERS.index(other)))


def _spread(seed: str, value: str) -> str:
    """A stable per-student order among equally good choices, so classmates' papers differ."""
    return hashlib.sha256(f"{seed}:{value}".encode()).hexdigest() if seed else value


def draft_paper(
    evidence: Evidence,
    pool: dict[str, list[Candidate]],
    kp_names: dict[str, str],
    choice_count: int,
    area_count: int,
    seed: str = "",
    *,
    experiment_count: int | None = None,
    calculation_count: int | None = None,
) -> list[dict]:
    """Pick questions for one student; each item carries its rule and a reason in Chinese.

    Ties are broken by ``seed`` (the student id), so the same student always gets the same
    draft while classmates with the same evidence get different questions."""
    split_areas = experiment_count is not None or calculation_count is not None
    slots = ({"choice": choice_count, "experiment": experiment_count or 0, "calculation": calculation_count or 0}
             if split_areas else {"choice": choice_count, "area": area_count})
    kind_order = {kind: index for index, kind in enumerate(slots)}
    chosen: list[dict] = []
    taken: set[str] = set()
    used_kps: set[str] = set()

    def open_slots() -> int:
        return sum(slots.values())

    def kind_of(candidate: Candidate) -> str | None:
        if candidate.choice:
            return "choice"
        if not split_areas:
            return "area"
        return "calculation" if candidate.question_type == "problem_solving" else candidate.question_type

    def prefer_choice() -> bool:
        return slots["choice"] >= sum(count for kind, count in slots.items() if kind != "choice")

    def take(kp_id: str, prefer_choice: bool, tiers: list[str], model: str | None = None) -> Candidate | None:
        kinds = sorted(slots, key=lambda kind: ((kind == "choice") != prefer_choice, -slots[kind], kind_order[kind]))
        for kind in kinds:
            if slots[kind] <= 0:
                continue
            options = [c for c in pool.get(kp_id, [])
                       if kind_of(c) == kind and c.id not in evidence.done and c.id not in taken]
            if not options:
                continue
            options.sort(key=lambda c: (
                tiers.index(c.tier) if c.tier in tiers else len(tiers),
                model is not None and c.model != model,
                _spread(seed, c.id),
            ))
            return options[0]
        return None

    def add(candidate: Candidate, rule: str, reason: str, **extra) -> None:
        slots[kind_of(candidate)] -= 1
        taken.add(candidate.id)
        used_kps.add(candidate.kp_id)
        chosen.append({"question_id": candidate.id, "rule": rule, "reason": reason, **extra})

    def kp(kp_id: str) -> str:
        return kp_names.get(kp_id, kp_id)

    # 1. Same error, a different situation. Leave room for the other rules.
    budget = math.ceil(open_slots() / 2)
    for wrong in evidence.wrong:
        if budget <= 0 or open_slots() <= 0:
            break
        original = wrong.question
        if original.kp_id in used_kps:
            continue
        picked = take(original.kp_id, original.choice, _not_harder(original.tier), original.model)
        if picked is None:
            continue
        same = "模型" if original.model and picked.model == original.model else "知识点"
        cause = (f"因“{error_type_name(wrong.error_type)}”做错"
                 if wrong.error_type and wrong.error_type not in {"none", "unknown"} else "做错")
        # Easier or equal variations come first; a harder one is used only when none is left, and says so.
        harder = "（同难度及更易的题已做完，选了更难一级）" if _tier_rank(picked.tier) > _tier_rank(original.tier) else ""
        add(picked, "same_error", f"{wrong.source}{cause}，推同{same}变式{harder}",
            source_question_id=original.id, error_type=wrong.error_type)
        budget -= 1

    # 2. Weak and developing knowledge points, weakest first, on easier questions.
    for kp_id, mastery in sorted(evidence.mastery.items(), key=lambda pair: (pair[1], pair[0])):
        if open_slots() <= 0:
            break
        level = KnowledgeMasteryJudgmentService._mastery_level(mastery)
        if kp_id in used_kps or level not in {"weak", "developing"}:
            continue
        tiers = ["easy", "moderate_easy", "medium"] if level == "weak" else ["medium", "moderate_easy", "moderate_hard"]
        picked = take(kp_id, prefer_choice(), tiers)
        if picked:
            label = "薄弱" if level == "weak" else "待巩固"
            add(picked, "weak_kp",
                f"“{kp(kp_id)}”掌握度 {round(mastery * 100)}%（{label}），补练{TIER_NAMES.get(picked.tier, '中等')}题")

    # 3. Recently right: one tier up.
    for kp_id, tier in evidence.recent_correct.items():
        if open_slots() <= 0:
            break
        if kp_id in used_kps:
            continue
        target = TIERS[min(_tier_rank(tier) + 1, len(TIERS) - 1)]
        picked = take(kp_id, prefer_choice(), [target, tier if tier in TIERS else "medium"])
        if picked:
            done_tier = TIER_NAMES.get(tier, "中等")
            reason = (f"最近“{kp(kp_id)}”{done_tier}题做对，升一级练{TIER_NAMES.get(picked.tier, '中等')}题"
                      if _tier_rank(picked.tier) > _tier_rank(tier)
                      else f"最近“{kp(kp_id)}”{done_tier}题做对，再练一道巩固")
            add(picked, "step_up", reason)

    # 4. Coverage: the least practised knowledge points; repeat points only when needed.
    order = sorted(pool, key=lambda kp_id: (evidence.attempts.get(kp_id, 0), _spread(seed, kp_id) if seed else kp(kp_id)))
    for allow_repeat in (False, True):
        for kp_id in order:
            while open_slots() > 0 and (allow_repeat or kp_id not in used_kps):
                picked = take(kp_id, prefer_choice(), _around("medium"))
                if picked is None:
                    break
                reason = (f"暂无足够作答数据，按范围补练“{kp(kp_id)}”" if evidence.empty
                          else f"按范围补练“{kp(kp_id)}”（练习较少）")
                add(picked, "coverage", reason)
                if not allow_repeat:
                    break

    # Choice questions lead the paper, as in a class test.
    kinds_by_id = {c.id: kind_of(c) for candidates in pool.values() for c in candidates}
    return sorted(chosen, key=lambda item: kind_order[kinds_by_id[item["question_id"]]])


async def paper_for(db: AsyncSession, assignment: TeacherAssignment, student_id: str) -> tuple[list[dict], dict[str, dict]]:
    """The published items a student answers and their frozen questions by id: their own paper in a
    personalized homework, the class paper otherwise."""
    if assignment.kind == "personalized":
        paper = (await db.execute(
            select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id == assignment.id,
                                              TeacherStudentPaper.student_id == student_id)
        )).scalar_one_or_none()
        if paper is None:
            return [], {}
        return paper.items, {question["id"]: question for question in paper.question_snapshot or []}
    return assignment.items, {question["id"]: question for question in assignment.question_snapshot or []}


async def question_map(db: AsyncSession, assignment: TeacherAssignment) -> dict[str, dict]:
    """Every frozen question of a published assignment by id, across all students' papers."""
    if assignment.kind != "personalized":
        return {question["id"]: question for question in assignment.question_snapshot or []}
    papers = (await db.execute(
        select(TeacherStudentPaper.question_snapshot).where(TeacherStudentPaper.assignment_id == assignment.id)
    )).scalars().all()
    return {question["id"]: question for snapshot in papers for question in snapshot or []}


def _primary_kp(question: Question) -> str | None:
    labels = [label for label in question.labels if label.label_type == "knowledge_point"]
    primary = next((label for label in labels if (label.role or "").strip().lower() in {"primary", "主要"}), None)
    return (primary or (labels[0] if labels else None)).label_id if labels else None


def _model(question: Question) -> str | None:
    label = next((label for label in question.labels if label.label_type == "physics_model"), None)
    return canonical_model_id(label.label_id) if label else None


def _enum_value(value) -> str | None:
    return getattr(value, "value", value)


class PersonalizedHomeworkService:
    def __init__(self, db: AsyncSession, assignments):
        self.db = db
        self.assignments = assignments  # TeacherAssignmentService: validation, payloads, ownership

    # --- Scope and question pool ---

    async def scope_points(self, scope: list[dict]) -> list[KnowledgePoint]:
        conditions = []
        for entry in scope:
            if entry.get("kp_id"):
                conditions.append(KnowledgePoint.id == entry["kp_id"])
                continue
            parts = [getattr(KnowledgePoint, key) == entry[key]
                     for key in ("volume", "chapter", "section") if entry.get(key)]
            if parts:
                conditions.append(and_(*parts))
        if not conditions:
            return []
        result = await self.db.execute(select(KnowledgePoint).where(or_(*conditions)))
        return list(result.scalars().all())

    async def pool(self, kp_ids: list[str]) -> dict[str, list[Candidate]]:
        result = await self.db.execute(
            select(Question)
            .join(QuestionLabel, QuestionLabel.question_id == Question.id)
            .where(QuestionLabel.label_type == "knowledge_point", QuestionLabel.label_id.in_(kp_ids),
                   Question.quality_status == QualityStatus.approved)
            .options(selectinload(Question.labels))
            .distinct()
        )
        pool: dict[str, list[Candidate]] = {}
        wanted = set(kp_ids)
        for question in result.scalars().all():
            kp_id = _primary_kp(question)
            if kp_id not in wanted or not question.answer:
                continue
            pool.setdefault(kp_id, []).append(Candidate(
                id=question.id, kp_id=kp_id, choice=is_choice(_enum_value(question.question_type)),
                tier=_enum_value(question.difficulty_tier), model=_model(question),
                question_type=_enum_value(question.question_type),
            ))
        return pool

    # --- One student's evidence ---

    async def evidence(self, student_id: str, pool: dict[str, list[Candidate]], teacher_id: str | None = None) -> Evidence:
        """``teacher_id``: whose homework may be named in a reason. Another teacher's homework
        still shapes the choice (shared mastery evidence), but its title and question number are
        that teacher's business, so the reason only says it came from recent homework."""
        by_id = {c.id: c for candidates in pool.values() for c in candidates}
        now = datetime.now(timezone.utc)
        evidence = Evidence()
        answer_rows = (await self.db.execute(
            select(StudentAnswer, TeacherPaperAttempt.catalog_code)
            .outerjoin(TeacherPaperAttempt, TeacherPaperAttempt.id == StudentAnswer.teacher_paper_attempt_id)
            .where(StudentAnswer.student_id == student_id)
        )).all()
        answers = [answer for answer, _ in answer_rows]
        evidence.done = {answer.question_id for answer in answers}
        timed: list[tuple[datetime, WrongAnswer]] = []
        observations = []
        for answer, catalog in answer_rows:
            candidate = by_id.get(answer.question_id)
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            if candidate is None or catalog == HOMEWORK_CATALOG or is_pending_confirmation(grading) or grading.get('needs_human_review'):
                continue
            observations.append((answer_observed_at(answer), candidate, answer.is_correct,
                                 grading.get("error_type"), "App 练习中"))

        # Released teacher homework: every item counts as done; lost points count as wrong.
        rows = (await self.db.execute(
            select(TeacherSubmissionItem, TeacherAssignment.title, TeacherAssignment.results_released_at)
            .join(TeacherSubmission, TeacherSubmission.id == TeacherSubmissionItem.submission_id)
            .join(TeacherAssignment, TeacherAssignment.id == TeacherSubmission.assignment_id)
            .where(TeacherSubmission.student_id == student_id)
        )).all()
        for item, title, released in rows:
            evidence.done.add(item.question_id)
        for teacher in await released_teacher_evidence(self.db, [student_id]):
            item = teacher.item
            candidate = by_id.get(item.question_id)
            if candidate is not None and candidate.kp_id == teacher.kp_id:
                own = teacher_id is not None and teacher.assignment.teacher_id == teacher_id
                observations.append((teacher.observed_at, candidate, teacher.credit >= 1, item.error_type,
                                     f"《{teacher.assignment.title}》第 {item.number} 题" if own else "近期作业中"))
        seen = set()
        for when, candidate, correct, cause, source in sorted(observations, key=lambda row: row[0], reverse=True):
            if candidate.id in seen:
                continue
            seen.add(candidate.id)
            if not correct and now - when <= WRONG_WINDOW:
                timed.append((when, WrongAnswer(candidate, cause, source)))
            elif correct and now - when <= CORRECT_WINDOW:
                best = evidence.recent_correct.get(candidate.kp_id)
                if best is None or _tier_rank(candidate.tier) > _tier_rank(best):
                    evidence.recent_correct[candidate.kp_id] = candidate.tier or "medium"
        timed.sort(key=lambda pair: pair[0], reverse=True)
        evidence.wrong = [wrong for _, wrong in timed]

        masteries = (await self.db.execute(
            select(StudentMastery).where(StudentMastery.student_id == student_id,
                                         StudentMastery.knowledge_point_id.in_(list(pool)))
        )).scalars().all()
        for row in masteries:
            if row.attempts:
                evidence.mastery[row.knowledge_point_id] = row.mastery
            evidence.attempts[row.knowledge_point_id] = row.attempts
        return evidence

    # --- Drafting ---

    @staticmethod
    def counts(settings: dict | None) -> tuple[int, int]:
        settings = settings or {}
        return int(settings.get("choice_count", DEFAULT_CHOICE_COUNT)), int(settings.get("area_count", DEFAULT_AREA_COUNT))

    async def _draft_items(self, assignment: TeacherAssignment, student_id: str,
                           pool: dict[str, list[Candidate]], kp_names: dict[str, str]) -> list[dict]:
        choice_count, area_count = self.counts(assignment.settings)
        picked = draft_paper(await self.evidence(student_id, pool, assignment.teacher_id), pool, kp_names,
                             choice_count, area_count,
                             seed=student_id,
                             experiment_count=(assignment.settings or {}).get("experiment_count"),
                             calculation_count=(assignment.settings or {}).get("calculation_count"))
        return await self.validated(picked)

    async def validated(self, items: list[dict]) -> list[dict]:
        """Bank checks, default points and boxes, choice-first order; keeps each item's rule and reason."""
        notes = {item["question_id"]: {key: item[key] for key in ("rule", "reason", "source_question_id", "error_type")
                                       if item.get(key) is not None}
                 for item in items}
        cleaned = await self.assignments._validated_items(items)
        return [{**entry, **notes.get(entry["question_id"], {})} for entry in cleaned]

    async def _context(self, assignment: TeacherAssignment):
        points = await self.scope_points((assignment.settings or {}).get("scope") or [])
        if not points:
            raise TeacherServiceError(400, "请先选择要出题的章节范围")
        pool = await self.pool([kp.id for kp in points])
        if not pool:
            raise TeacherServiceError(400, "这个范围里没有可用的已审核题目")
        return pool, {kp.id: canonical_kp_name(kp.id, kp.name) for kp in points}

    @staticmethod
    def check_counts(choice_count: int, area_count: int, experiment_count: int | None = None,
                     calculation_count: int | None = None) -> None:
        counts = ([choice_count, experiment_count or 0, calculation_count or 0]
                  if experiment_count is not None or calculation_count is not None else [choice_count, area_count])
        if not all(0 <= count <= MAX_PER_KIND for count in counts) or sum(counts) == 0:
            raise TeacherServiceError(400, f"每类题量需在 0 到 {MAX_PER_KIND} 之间，合计至少 1 题")
        if sum(counts) > 40:
            raise TeacherServiceError(400, "每人总题量不能超过 40 题")

    @classmethod
    def make_settings(cls, scope: list[dict], choice_count: int, area_count: int,
                      experiment_count: int | None = None, calculation_count: int | None = None) -> dict:
        cls.check_counts(choice_count, area_count, experiment_count, calculation_count)
        settings = {"scope": scope, "choice_count": choice_count, "area_count": area_count}
        if experiment_count is not None or calculation_count is not None:
            settings.update(experiment_count=experiment_count or 0, calculation_count=calculation_count or 0,
                            area_count=(experiment_count or 0) + (calculation_count or 0))
        return settings

    async def create(self, teacher_id: str, class_id: str, *, title: str, scope: list[dict],
                     choice_count: int, area_count: int, experiment_count: int | None = None,
                     calculation_count: int | None = None, delivery: str | None = None) -> TeacherAssignment:
        settings = self.make_settings(scope, choice_count, area_count, experiment_count, calculation_count)
        if delivery is not None:
            if delivery not in {"app", "paper"}:
                raise TeacherServiceError(400, "布置方式只能选择 App 或打印")
            settings["delivery"] = delivery
        assignment = await self.assignments.create(teacher_id, class_id, title)
        assignment.kind = "personalized"
        assignment.settings = settings
        try:
            await self.redraft_all(assignment)
        except TeacherServiceError:
            await self.db.delete(assignment)
            await self.db.commit()
            raise
        return assignment

    async def redraft_all(self, assignment: TeacherAssignment) -> None:
        pool, kp_names = await self._context(assignment)
        members = [s for s in await self.assignments.teachers.assignment_members(assignment) if s.status == "active"]
        if not members:
            raise TeacherServiceError(400, "班级里还没有学生，无法起草")
        existing = {paper.student_id: paper for paper in await self.papers(assignment.id)}
        for student in members:
            items = await self._draft_items(assignment, student.id, pool, kp_names)
            paper = existing.get(student.id)
            if paper is None:
                self.db.add(TeacherStudentPaper(
                    id=f"sp_{uuid.uuid4().hex}", assignment_id=assignment.id, student_id=student.id,
                    items=items, delivery=self.delivery_for(assignment, student),
                ))
            else:
                paper.items = items
        await self.db.commit()

    async def redraft(self, assignment: TeacherAssignment, student_id: str) -> None:
        """Draft one student's paper again, or for the first time for a student who joined later."""
        student = next((s for s in await self.assignments.teachers.assignment_members(assignment)
                        if s.id == student_id and s.status == "active"), None)
        if student is None:
            raise TeacherServiceError(404, "该学生不在本次作业的布置范围内")
        pool, kp_names = await self._context(assignment)
        existing = (await self.db.execute(
            select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id == assignment.id,
                                              TeacherStudentPaper.student_id == student_id)
        )).scalar_one_or_none()
        items = await self._draft_items(assignment, student_id, pool, kp_names)
        if existing is not None:
            existing.items = items
        else:
            self.db.add(TeacherStudentPaper(
                id=f"sp_{uuid.uuid4().hex}", assignment_id=assignment.id, student_id=student_id,
                items=items, delivery=self.delivery_for(assignment, student),
            ))
        await self.db.commit()

    async def set_delivery_all(self, assignment: TeacherAssignment, delivery: str) -> None:
        if delivery not in {"app", "paper"}:
            raise TeacherServiceError(400, "交付方式只能是 App 或纸质")
        assignment.settings = {**(assignment.settings or {}), "delivery": delivery}
        papers = await self.papers(assignment.id)
        students = {s.id: s for s in (await self.db.scalars(select(Student).where(
            Student.id.in_([paper.student_id for paper in papers])))).all()} if papers else {}
        for paper in papers:
            student = students.get(paper.student_id)
            paper.delivery = self.delivery_for(assignment, student) if student else delivery
        await self.db.commit()

    @staticmethod
    def default_delivery(student: Student) -> str:
        """Students who have signed in (App or web) answer online; the rest get a printed paper."""
        return "app" if student.last_login_at is not None else "paper"

    @classmethod
    def delivery_for(cls, assignment: TeacherAssignment, student: Student) -> str:
        """Printing reaches everyone; "App" means App first, on paper for those who never signed in."""
        mode = (assignment.settings or {}).get("delivery")
        return "paper" if mode == "paper" else cls.default_delivery(student)

    async def papers(self, assignment_id: str) -> list[TeacherStudentPaper]:
        result = await self.db.execute(
            select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id == assignment_id)
        )
        return list(result.scalars().all())

    async def paper(self, assignment_id: str, student_id: str) -> TeacherStudentPaper:
        paper = (await self.db.execute(
            select(TeacherStudentPaper).where(TeacherStudentPaper.assignment_id == assignment_id,
                                              TeacherStudentPaper.student_id == student_id)
        )).scalar_one_or_none()
        if paper is None:
            raise TeacherServiceError(404, "这个学生没有这份作业")
        return paper

    async def update_paper(self, assignment: TeacherAssignment, student_id: str, *,
                           items: list[dict] | None, delivery: str | None) -> None:
        mode = (assignment.settings or {}).get("delivery")
        if delivery == "app" and mode == "paper":
            raise TeacherServiceError(400, "这份作业选择了打印；要让学生在 App 作答，请先把布置方式改为推送 App")
        paper = await self.paper(assignment.id, student_id)
        if items is not None:
            if not items:
                raise TeacherServiceError(400, "每份作业至少保留一道题")
            done = (await self.evidence(student_id, {})).done
            previous = {item["question_id"]: item for item in paper.items}
            for item in items:
                if item["question_id"] not in previous and item["question_id"] in done:
                    raise TeacherServiceError(400, f"题目 {item['question_id']} 这个学生已经做过")
            merged = [{**previous.get(item["question_id"], {"rule": "teacher", "reason": "老师选入"}), **item}
                      for item in items]
            paper.items = await self.validated(merged)
        if delivery is not None:
            if delivery not in {"app", "paper"}:
                raise TeacherServiceError(400, "交付方式只能是 App 或纸质")
            paper.delivery = delivery
        await self.db.commit()

    async def alternatives(self, assignment: TeacherAssignment, student_id: str, question_id: str,
                           limit: int = 5) -> list[dict]:
        """Same knowledge point and kind, not done by this student and not on their paper."""
        paper = await self.paper(assignment.id, student_id)
        current = (await self.assignments._load_questions([question_id])).get(question_id)
        kp_id = _primary_kp(current) if current else None
        if not kp_id:
            return []
        pool = await self.pool([kp_id])
        done = (await self.evidence(student_id, pool)).done | {item["question_id"] for item in paper.items}
        kind = is_choice(_enum_value(current.question_type))
        tier = _enum_value(current.difficulty_tier)
        options = [c for c in pool.get(kp_id, []) if c.choice == kind and c.id not in done]
        options.sort(key=lambda c: (abs(_tier_rank(c.tier) - _tier_rank(tier)), c.id))
        questions = await self.assignments._load_questions([c.id for c in options[:limit]])
        kp_map = await self.assignments._kp_names(list(questions.values()))
        return [self.assignments._question_payload(questions[c.id], kp_map, {}) for c in options[:limit]]

    # --- Reading back ---

    async def detail_papers(self, assignment: TeacherAssignment) -> list[dict]:
        from app.services.teacher_scan_service import collection_numbers

        members = await self.assignments.teachers.assignment_members(assignment)
        numbers = (await collection_numbers(self.assignments.teachers, assignment) if assignment.status != "draft"
                   else await self.assignments.teachers.member_numbers(assignment.class_id))
        by_student = {paper.student_id: paper for paper in await self.papers(assignment.id)}
        published = assignment.status != "draft"
        progress = await self._app_progress(assignment) if published else {}
        live: dict[str, dict] = {}
        if not published:
            ids = list({item["question_id"] for paper in by_student.values() for item in paper.items})
            questions = await self.assignments._load_questions(ids)
            kp_map = await self.assignments._kp_names(list(questions.values()))
            live = {qid: self.assignments._question_payload(q, kp_map, {}) for qid, q in questions.items()}
        rows = []
        for student in members:
            paper = by_student.get(student.id)
            if paper is None:
                # Joined the class after drafting: still to be drafted before publishing, or not part of
                # this homework once it went out.
                rows.append({
                    "student_id": student.id, "display_name": mask_phone(student.display_name),
                    "student_number": numbers.get(student.id), "delivery": None, "app_status": None,
                    "total_points": 0, "items": [], "missing": True,
                })
                continue
            snapshot = {q["id"]: self.assignments.frozen_question(q) for q in paper.question_snapshot or []}
            rows.append({
                "student_id": student.id,
                "display_name": mask_phone(student.display_name),
                "student_number": numbers.get(student.id),
                "delivery": paper.delivery,
                # App papers after publishing: in_progress, grading or completed, with graded answers.
                "app_status": progress.get(student.id),
                "missing": False,
                "total_points": sum(float(item["points"]) for item in paper.items),
                "items": [{
                    "number": number,
                    "question_id": item["question_id"],
                    "points": item["points"],
                    "box": item.get("box"),
                    "area_mm": item.get("area_mm"),
                    "print_layout": item.get("print_layout"),
                    "rule": item.get("rule"),
                    "reason": item.get("reason"),
                    "question": (snapshot if published else live).get(item["question_id"]),
                } for number, item in enumerate(paper.items, start=1)],
            })
        rows.sort(key=lambda row: (row["student_number"] is None, int(row["student_number"] or 0), row["display_name"]))
        return rows

    async def _app_progress(self, assignment: TeacherAssignment) -> dict[str, dict]:
        from app.models.teacher_paper import TeacherPaperAttempt
        from app.services.teacher_homework_service import homework_paper_id

        attempts = (await self.db.execute(select(TeacherPaperAttempt).where(
            TeacherPaperAttempt.paper_id == homework_paper_id(assignment.id)))).scalars().all()
        graded = dict((await self.db.execute(
            select(StudentAnswer.teacher_paper_attempt_id, func.count()).where(
                StudentAnswer.teacher_paper_attempt_id.in_([attempt.id for attempt in attempts]))
            .group_by(StudentAnswer.teacher_paper_attempt_id))).all()) if attempts else {}
        return {attempt.student_id: {"status": attempt.status, "graded": int(graded.get(attempt.id, 0)),
                                     "total": len(attempt.question_ids)} for attempt in attempts}

    async def publish(self, assignment: TeacherAssignment) -> None:
        members = [s for s in await self.assignments.teachers.assignment_members(assignment) if s.status == "active"]
        current = {student.id for student in members}
        drafted = {paper.student_id: paper for paper in await self.papers(assignment.id)}
        waiting = [mask_phone(student.display_name) for student in members if not (drafted.get(student.id) and drafted[student.id].items)]
        if waiting:
            raise TeacherServiceError(400, f"{'、'.join(waiting[:5])}{'等' if len(waiting) > 5 else ''}还没有作业，"
                                           "请先为他们起草或在名单里确认后再发布")
        # Students who left the class since drafting do not get the homework.
        for student_id, paper in drafted.items():
            if student_id not in current:
                await self.db.delete(paper)
        papers = [paper for student_id, paper in drafted.items() if student_id in current]
        mode = (assignment.settings or {}).get("delivery")
        if mode == "paper" and any(paper.delivery != "paper" for paper in papers):
            raise TeacherServiceError(400, "这份作业选择了打印，请重新确认布置方式")
        if not papers:
            raise TeacherServiceError(400, "还没有起草好的作业")
        numbers = await self.assignments.teachers.member_numbers(assignment.class_id)
        assignment.roster = {student.id: numbers.get(student.id) for student in members}
        for paper in papers:
            paper.items = await self.validated(paper.items)
            paper.question_snapshot = await self.assignments.snapshot(paper.items)
        from app.services.teacher_homework_service import open_app_attempts

        await open_app_attempts(self.db, assignment, papers)
