from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.student import schemas
from app.models.improvement import (
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentScopeDiagnosticAttempt,
    StudentScopeDiagnosticKpResult,
)
from app.models.knowledge import KnowledgePoint
from app.models.question import Question
from app.models.student import StudentAnswer, StudentMastery
from app.services.knowledge_service import KnowledgeService, canonical_kp_name
from app.services.learning_state_rules import (
    MASTERED_THRESHOLD,
    REINFORCEMENT_THRESHOLD,
    STABLE_LEVEL_THRESHOLD,
)
from app.services.student_access_policy import StudentAccessPolicy
from app.services.student_service import StudentService


MASTERY_LEVEL_ORDER = ["weak", "developing", "stable", "mastered"]
EVIDENCE_PRIORITY = ["retest", "improvement_task", "diagnostic", "recent_answer", "mastery"]


@dataclass
class RecentAnswerStats:
    correct_count: int = 0
    total_count: int = 0
    last_answered_at: datetime | None = None

    @property
    def correct_rate(self) -> float | None:
        if self.total_count <= 0:
            return None
        return self.correct_count / self.total_count


@dataclass
class DiagnosticEvidence:
    attempt_id: str
    submitted_at: datetime | None
    correct_count: int
    total_count: int
    is_weak: bool


@dataclass
class TaskEvidence:
    plan_id: str
    plan_status: str
    task_id: str
    task_status: str
    updated_at: datetime | None
    passed_at: datetime | None


@dataclass
class RetestEvidence:
    attempt_id: str
    submitted_at: datetime | None
    passed: bool
    correct_count: int
    total_count: int
    task_id: str | None


@dataclass
class JudgmentContext:
    kps: dict[str, KnowledgePoint]
    mastery: dict[str, StudentMastery]
    recent_answers: dict[str, RecentAnswerStats]
    diagnostics: dict[str, DiagnosticEvidence]
    tasks: dict[str, TaskEvidence]
    retests: dict[str, RetestEvidence]


class KnowledgeMasteryJudgmentService:
    """Read-only interpretation layer over existing learning facts."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.knowledge_svc = KnowledgeService(db)
        self.student_svc = StudentService(db)
        self.access_policy = StudentAccessPolicy(self.student_svc)

    async def get_kp_judgment(
        self,
        student_id: str,
        kp_id: str,
    ) -> schemas.KnowledgeMasteryJudgmentResponse:
        batch = await self.get_kp_judgments(student_id, [kp_id])
        if not batch.items:
            raise HTTPException(status_code=404, detail="Knowledge point not found")
        return batch.items[0]

    async def get_kp_judgments(
        self,
        student_id: str,
        kp_ids: list[str],
    ) -> schemas.KnowledgeMasteryJudgmentBatchResponse:
        ordered_ids = list(dict.fromkeys(kp_ids))
        if not ordered_ids:
            return schemas.KnowledgeMasteryJudgmentBatchResponse(items=[])
        kps = await self._load_kps(ordered_ids)
        missing_ids = [kp_id for kp_id in ordered_ids if kp_id not in kps]
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Knowledge point not found: {missing_ids[0]}")
        await self._ensure_access(student_id, [kps[kp_id] for kp_id in ordered_ids])
        context = await self._build_context(student_id, ordered_ids, kps)
        return schemas.KnowledgeMasteryJudgmentBatchResponse(
            items=[self._judge_one(kp_id, context) for kp_id in ordered_ids]
        )

    async def get_scope_judgments(
        self,
        student_id: str,
        scope_type: str,
        scope_id: str,
    ) -> schemas.ScopeKnowledgeMasteryJudgmentResponse:
        if scope_type == "chapter":
            kps = await self.knowledge_svc.get_points_by_chapter(scope_id)
            scope_name = scope_id
        elif scope_type == "section":
            if "||" not in scope_id:
                raise HTTPException(status_code=400, detail="Invalid section scope id")
            chapter, section = scope_id.split("||", 1)
            kps = await self.knowledge_svc.get_points_by_section(chapter, section)
            scope_name = section
        else:
            raise HTTPException(status_code=400, detail="Invalid mastery judgment scope type")

        # Fine-grained KPs without approved primary questions are not assessed.
        practicable = await self.knowledge_svc.get_practicable_point_ids()
        kps = [kp for kp in kps if kp.id in practicable]
        if not kps:
            raise HTTPException(status_code=404, detail="Mastery judgment scope has no knowledge points")

        await self._ensure_access(student_id, kps)
        kp_ids = [kp.id for kp in kps]
        context = await self._build_context(student_id, kp_ids, {kp.id: kp for kp in kps})
        return schemas.ScopeKnowledgeMasteryJudgmentResponse(
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            items=[self._judge_one(kp_id, context) for kp_id in kp_ids],
        )

    async def _ensure_access(self, student_id: str, kps: list[KnowledgePoint]) -> None:
        for kp in kps:
            await self.access_policy.ensure_can_access_kp(student_id, kp.id)

    async def _load_kps(self, kp_ids: list[str]) -> dict[str, KnowledgePoint]:
        result = await self.db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(kp_ids)))
        return {kp.id: kp for kp in result.scalars().all()}

    async def _build_context(
        self,
        student_id: str,
        kp_ids: list[str],
        kps: dict[str, KnowledgePoint],
    ) -> JudgmentContext:
        return JudgmentContext(
            kps=kps,
            mastery=await self._load_mastery_map(student_id, kp_ids),
            recent_answers=await self._load_recent_answer_stats(student_id, kp_ids),
            diagnostics=await self._load_latest_diagnostic_by_kp(student_id, kp_ids),
            tasks=await self._load_latest_task_by_kp(student_id, kp_ids),
            retests=await self._load_latest_retest_result_by_kp(student_id, kp_ids),
        )

    async def _load_mastery_map(self, student_id: str, kp_ids: list[str]) -> dict[str, StudentMastery]:
        result = await self.db.execute(
            select(StudentMastery).where(
                StudentMastery.student_id == student_id,
                StudentMastery.knowledge_point_id.in_(kp_ids),
            )
        )
        return {item.knowledge_point_id: item for item in result.scalars().all()}

    async def _load_recent_answer_stats(
        self,
        student_id: str,
        kp_ids: list[str],
        per_kp_limit: int = 20,
    ) -> dict[str, RecentAnswerStats]:
        from app.services.grading_reliability import is_pending_confirmation
        from app.services.learning_evidence import answer_observed_at
        from app.services.teacher_learning_evidence import app_homework_attempt_ids, released_teacher_evidence

        result = await self.db.execute(
            select(StudentAnswer, Question).join(Question, Question.id == StudentAnswer.question_id)
            .where(
                StudentAnswer.student_id == student_id,
                (StudentAnswer.teacher_paper_attempt_id.is_(None)
                 | StudentAnswer.teacher_paper_attempt_id.not_in(app_homework_attempt_ids())),
            )
            .options(selectinload(Question.labels))
            .order_by(StudentAnswer.created_at.desc(), StudentAnswer.id.desc())
        )
        observations = []
        for answer, question in result.all():
            kp_id = StudentService.evidence_knowledge_point_id(answer, question, set(kp_ids))
            grading = answer.grading_result if isinstance(answer.grading_result, dict) else {}
            if kp_id and not is_pending_confirmation(grading) and not grading.get('needs_human_review'):
                observations.append((answer_observed_at(answer), kp_id, answer.is_correct))
        for teacher in await released_teacher_evidence(self.db, [student_id]):
            if teacher.kp_id in kp_ids:
                observations.append((teacher.observed_at, teacher.kp_id, teacher.credit >= 1))
        grouped: dict[str, RecentAnswerStats] = {}
        for observed_at, kp_id, correct in sorted(observations, key=lambda row: row[0], reverse=True):
            stats = grouped.setdefault(kp_id, RecentAnswerStats())
            if stats.total_count >= per_kp_limit:
                continue
            stats.total_count += 1
            stats.correct_count += int(correct)
            if stats.last_answered_at is None:
                stats.last_answered_at = observed_at
        return grouped

    async def _load_latest_diagnostic_by_kp(
        self,
        student_id: str,
        kp_ids: list[str],
    ) -> dict[str, DiagnosticEvidence]:
        result = await self.db.execute(
            select(StudentScopeDiagnosticKpResult, StudentScopeDiagnosticAttempt)
            .join(
                StudentScopeDiagnosticAttempt,
                StudentScopeDiagnosticAttempt.id == StudentScopeDiagnosticKpResult.attempt_id,
            )
            .where(
                StudentScopeDiagnosticKpResult.student_id == student_id,
                StudentScopeDiagnosticAttempt.student_id == student_id,
                StudentScopeDiagnosticKpResult.kp_id.in_(kp_ids),
            )
        )
        latest: dict[str, tuple[datetime | None, DiagnosticEvidence]] = {}
        for kp_result, attempt in result.all():
            marker = attempt.submitted_at or attempt.created_at or kp_result.created_at
            evidence = DiagnosticEvidence(
                attempt_id=attempt.id,
                submitted_at=marker,
                correct_count=kp_result.correct_count,
                total_count=kp_result.total_count,
                is_weak=kp_result.is_weak,
            )
            current = latest.get(kp_result.kp_id)
            if current is None or self._is_newer(marker, current[0]):
                latest[kp_result.kp_id] = (marker, evidence)
        return {kp_id: evidence for kp_id, (_, evidence) in latest.items()}

    async def _load_latest_task_by_kp(
        self,
        student_id: str,
        kp_ids: list[str],
    ) -> dict[str, TaskEvidence]:
        result = await self.db.execute(
            select(StudentImprovementTask, StudentImprovementPlan)
            .join(StudentImprovementPlan, StudentImprovementPlan.id == StudentImprovementTask.plan_id)
            .where(
                StudentImprovementTask.student_id == student_id,
                StudentImprovementPlan.student_id == student_id,
                StudentImprovementTask.kp_id.in_(kp_ids),
            )
        )
        latest: dict[str, tuple[datetime | None, TaskEvidence]] = {}
        for task, plan in result.all():
            marker = task.updated_at or task.passed_at or task.practiced_at or task.started_at or task.created_at or plan.updated_at
            evidence = TaskEvidence(
                plan_id=plan.id,
                plan_status=plan.status,
                task_id=task.id,
                task_status=task.status,
                updated_at=marker,
                passed_at=task.passed_at,
            )
            current = latest.get(task.kp_id)
            if current is None or self._is_newer(marker, current[0]):
                latest[task.kp_id] = (marker, evidence)
        return {kp_id: evidence for kp_id, (_, evidence) in latest.items()}

    async def _load_latest_retest_result_by_kp(
        self,
        student_id: str,
        kp_ids: list[str],
    ) -> dict[str, RetestEvidence]:
        result = await self.db.execute(
            select(StudentImprovementRetestAttempt)
            .where(
                StudentImprovementRetestAttempt.student_id == student_id,
                StudentImprovementRetestAttempt.status == "submitted",
            )
        )
        attempts = list(result.scalars().all())
        task_ids: set[str] = set()
        for attempt in attempts:
            for item in attempt.task_results or []:
                task_id = item.get("task_id")
                if task_id:
                    task_ids.add(str(task_id))
        task_kp_by_id: dict[str, str] = {}
        if task_ids:
            task_result = await self.db.execute(
                select(StudentImprovementTask.id, StudentImprovementTask.kp_id)
                .where(
                    StudentImprovementTask.student_id == student_id,
                    StudentImprovementTask.id.in_(task_ids),
                )
            )
            task_kp_by_id = {task_id: kp_id for task_id, kp_id in task_result.all()}

        allowed_kp_ids = set(kp_ids)
        latest: dict[str, tuple[datetime | None, RetestEvidence]] = {}
        for attempt in attempts:
            marker = attempt.submitted_at or attempt.created_at
            for item in attempt.task_results or []:
                task_id = str(item.get("task_id")) if item.get("task_id") else None
                kp_id = item.get("kp_id") or (task_kp_by_id.get(task_id) if task_id else None)
                if not kp_id or kp_id not in allowed_kp_ids:
                    continue
                evidence = RetestEvidence(
                    attempt_id=attempt.id,
                    submitted_at=marker,
                    passed=bool(item.get("passed")),
                    correct_count=int(item.get("correct_count") or 0),
                    total_count=int(item.get("total_count") or 0),
                    task_id=task_id,
                )
                current = latest.get(kp_id)
                if current is None or self._is_newer(marker, current[0]):
                    latest[kp_id] = (marker, evidence)
        return {kp_id: evidence for kp_id, (_, evidence) in latest.items()}

    def _judge_one(
        self,
        kp_id: str,
        context: JudgmentContext,
    ) -> schemas.KnowledgeMasteryJudgmentResponse:
        kp = context.kps[kp_id]
        mastery = context.mastery.get(kp_id)
        recent = context.recent_answers.get(kp_id, RecentAnswerStats())
        diagnostic = context.diagnostics.get(kp_id)
        task = context.tasks.get(kp_id)
        retest = context.retests.get(kp_id)

        mastery_score = self._clamp(mastery.mastery if mastery else 0.0)
        mastery_level = self._mastery_level(mastery_score)
        intervention_status = "none"
        next_action = "maintain"
        reason = "当前掌握较稳定，建议通过周期性练习保持。"

        passed_time = self._passed_marker(task, retest)
        diagnostic_time = diagnostic.submitted_at if diagnostic else None
        passed_covers_diagnostic = passed_time is not None and (
            diagnostic_time is None or self._is_newer_or_equal(passed_time, diagnostic_time)
        )

        if (retest and not retest.passed) or (task and task.task_status == "needs_retest"):
            intervention_status = "needs_retest"
            next_action = "improve"
            mastery_level = self._cap_level(mastery_level, "stable")
            reason = "最近阶段复测显示该知识点仍不稳定，建议继续专项补弱后再复测。"
        elif task and task.task_status == "in_progress":
            intervention_status = "in_improvement"
            next_action = "continue_improvement"
            reason = "该知识点正在提升路径中，建议继续完成当前专项任务。"
        elif task and task.task_status == "practiced" and task.plan_status == "ready_for_retest":
            intervention_status = "awaiting_retest"
            next_action = "retest"
            reason = "专项练习已完成，建议通过阶段复测确认是否稳定。"
        elif (task and task.task_status == "passed" and passed_covers_diagnostic) or (retest and retest.passed and passed_covers_diagnostic):
            intervention_status = "passed_recently"
            next_action = "maintain"
            mastery_level = self._at_least_level(mastery_level, "stable") if mastery_score >= STABLE_LEVEL_THRESHOLD else mastery_level
            reason = "该知识点已通过最近阶段复测，建议后续保持练习。"
        elif diagnostic and diagnostic.is_weak:
            intervention_status = "needs_practice"
            next_action = "improve"
            mastery_level = self._cap_level(mastery_level, "developing")
            reason = "最近单元检测暴露该知识点薄弱，建议进入提升路径或专项练习。"
        elif recent.total_count >= 3 and recent.correct_rate is not None and recent.correct_rate < 0.6:
            intervention_status = "needs_practice"
            next_action = "practice"
            reason = "最近练习正确率偏低，建议先做一组针对性练习。"
        elif mastery_score < REINFORCEMENT_THRESHOLD:
            intervention_status = "needs_learning"
            next_action = "learn"
            reason = "当前掌握度较低，建议先回看知识点，再进行练习。"

        evidence_sources = self._evidence_sources(mastery, recent, diagnostic, task, retest)
        evidences = self._build_evidences(kp_id, mastery, recent, diagnostic, task, retest)

        return schemas.KnowledgeMasteryJudgmentResponse(
            kp_id=kp.id,
            kp_name=canonical_kp_name(kp.id, kp.name),
            mastery_score=mastery_score,
            mastery_level=mastery_level,
            intervention_status=intervention_status,
            confidence=self._confidence(mastery, recent, diagnostic, task, retest),
            next_action=next_action,
            reason=reason,
            evidence_sources=evidence_sources,
            evidences=evidences,
            last_answered_at=recent.last_answered_at,
            last_diagnostic_at=diagnostic.submitted_at if diagnostic else None,
            last_retest_at=retest.submitted_at if retest else None,
            recent_correct_count=recent.correct_count,
            recent_total_count=recent.total_count,
            recent_correct_rate=recent.correct_rate,
            latest_diagnostic_attempt_id=diagnostic.attempt_id if diagnostic else None,
            latest_diagnostic_correct_count=diagnostic.correct_count if diagnostic else None,
            latest_diagnostic_total_count=diagnostic.total_count if diagnostic else None,
            latest_diagnostic_is_weak=diagnostic.is_weak if diagnostic else None,
            active_plan_id=task.plan_id if task else None,
            active_task_id=task.task_id if task else None,
            active_task_status=task.task_status if task else None,
            latest_retest_attempt_id=retest.attempt_id if retest else None,
            latest_retest_passed=retest.passed if retest else None,
            updated_at=self._latest_timestamp(mastery, recent, diagnostic, task, retest),
        )

    def _build_evidences(
        self,
        kp_id: str,
        mastery: StudentMastery | None,
        recent: RecentAnswerStats,
        diagnostic: DiagnosticEvidence | None,
        task: TaskEvidence | None,
        retest: RetestEvidence | None,
    ) -> list[schemas.KnowledgeMasteryEvidence]:
        evidences: list[schemas.KnowledgeMasteryEvidence] = []
        if retest:
            evidences.append(schemas.KnowledgeMasteryEvidence(
                source="retest",
                label="阶段复测",
                occurred_at=retest.submitted_at,
                strength="positive" if retest.passed else "negative",
                description=(
                    f"最近阶段复测 {retest.correct_count}/{retest.total_count} 正确，结果为已通过。"
                    if retest.passed
                    else f"最近阶段复测 {retest.correct_count}/{retest.total_count} 正确，仍需继续补弱。"
                ),
                ref_id=retest.attempt_id,
                metadata={"task_id": retest.task_id, "kp_id": kp_id},
            ))
        if task:
            evidences.append(schemas.KnowledgeMasteryEvidence(
                source="improvement_task",
                label="提升任务",
                occurred_at=task.updated_at,
                strength="positive" if task.task_status == "passed" else ("negative" if task.task_status == "needs_retest" else "neutral"),
                description=f"当前提升任务状态为 {task.task_status}，所在计划状态为 {task.plan_status}。",
                ref_id=task.task_id,
                metadata={"plan_id": task.plan_id, "task_status": task.task_status},
            ))
        if diagnostic:
            evidences.append(schemas.KnowledgeMasteryEvidence(
                source="diagnostic",
                label="单元检测",
                occurred_at=diagnostic.submitted_at,
                strength="negative" if diagnostic.is_weak else "positive",
                description=f"最近单元检测 {diagnostic.correct_count}/{diagnostic.total_count} 正确，{'判为薄弱点' if diagnostic.is_weak else '未判为薄弱点'}。",
                ref_id=diagnostic.attempt_id,
                metadata={"is_weak": diagnostic.is_weak},
            ))
        if recent.total_count:
            evidences.append(schemas.KnowledgeMasteryEvidence(
                source="recent_answer",
                label="最近练习",
                occurred_at=recent.last_answered_at,
                strength="negative" if (recent.correct_rate or 0.0) < 0.6 else "positive",
                description=f"最近相关练习 {recent.correct_count}/{recent.total_count} 正确。",
                metadata={"correct_rate": recent.correct_rate},
            ))
        if mastery:
            evidences.append(schemas.KnowledgeMasteryEvidence(
                source="mastery",
                label="掌握度",
                occurred_at=mastery.last_practiced,
                strength="positive" if mastery.mastery >= STABLE_LEVEL_THRESHOLD else ("negative" if mastery.mastery < REINFORCEMENT_THRESHOLD else "neutral"),
                description=f"当前掌握度为 {(mastery.mastery * 100):.0f}%，累计作答 {mastery.attempts} 次。",
                metadata={"attempts": mastery.attempts, "correct_rate": mastery.correct_rate},
            ))
        priority = {source: index for index, source in enumerate(EVIDENCE_PRIORITY)}
        return sorted(evidences, key=lambda item: priority.get(item.source, 99))[:5]

    @staticmethod
    def _evidence_sources(
        mastery: StudentMastery | None,
        recent: RecentAnswerStats,
        diagnostic: DiagnosticEvidence | None,
        task: TaskEvidence | None,
        retest: RetestEvidence | None,
    ) -> list[str]:
        sources: list[str] = []
        if mastery:
            sources.append("mastery")
        if recent.total_count:
            sources.append("recent_answer")
        if diagnostic:
            sources.append("diagnostic")
        if task:
            sources.append("improvement_task")
        if retest:
            sources.append("retest")
        return sorted(sources, key=lambda source: EVIDENCE_PRIORITY.index(source) if source in EVIDENCE_PRIORITY else 99)

    @staticmethod
    def _confidence(
        mastery: StudentMastery | None,
        recent: RecentAnswerStats,
        diagnostic: DiagnosticEvidence | None,
        task: TaskEvidence | None,
        retest: RetestEvidence | None,
    ) -> str:
        if (diagnostic or retest) and recent.total_count >= 3:
            return "high"
        if not mastery and recent.total_count == 0 and not diagnostic and not task and not retest:
            return "low"
        return "medium"

    @staticmethod
    def _mastery_level(score: float) -> str:
        if score < REINFORCEMENT_THRESHOLD:
            return "weak"
        if score < STABLE_LEVEL_THRESHOLD:
            return "developing"
        if score < MASTERED_THRESHOLD:
            return "stable"
        return "mastered"

    @staticmethod
    def _cap_level(level: str, cap: str) -> str:
        if MASTERY_LEVEL_ORDER.index(level) > MASTERY_LEVEL_ORDER.index(cap):
            return cap
        return level

    @staticmethod
    def _at_least_level(level: str, floor: str) -> str:
        if MASTERY_LEVEL_ORDER.index(level) < MASTERY_LEVEL_ORDER.index(floor):
            return floor
        return level

    @staticmethod
    def _clamp(value: float) -> float:
        return max(0.0, min(1.0, float(value or 0.0)))

    @staticmethod
    def _is_newer(candidate: datetime | None, current: datetime | None) -> bool:
        if candidate is None:
            return current is None
        if current is None:
            return True
        return candidate > current

    @staticmethod
    def _is_newer_or_equal(candidate: datetime | None, current: datetime | None) -> bool:
        if candidate is None:
            return current is None
        if current is None:
            return True
        return candidate >= current

    @staticmethod
    def _passed_marker(
        task: TaskEvidence | None,
        retest: RetestEvidence | None,
    ) -> datetime | None:
        markers = []
        if task and task.task_status == "passed":
            markers.append(task.passed_at or task.updated_at)
        if retest and retest.passed:
            markers.append(retest.submitted_at)
        return max([marker for marker in markers if marker is not None], default=None)

    @staticmethod
    def _latest_timestamp(
        mastery: StudentMastery | None,
        recent: RecentAnswerStats,
        diagnostic: DiagnosticEvidence | None,
        task: TaskEvidence | None,
        retest: RetestEvidence | None,
    ) -> datetime | None:
        values = [
            mastery.last_practiced if mastery else None,
            recent.last_answered_at,
            diagnostic.submitted_at if diagnostic else None,
            task.updated_at if task else None,
            retest.submitted_at if retest else None,
        ]
        return max([value for value in values if value is not None], default=None)
