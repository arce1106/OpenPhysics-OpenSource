from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.student import schemas
from app.models.improvement import (
    StudentImprovementPlan,
    StudentImprovementRetestAttempt,
    StudentImprovementTask,
    StudentScopeDiagnosticAttempt,
)


EVENT_PRIORITY: dict[str, int] = {
    "improvement_completed": 90,
    "retest_submitted": 80,
    "retest_started": 70,
    "task_passed": 60,
    "task_needs_retest": 55,
    "task_practiced": 50,
    "task_started": 40,
    "improvement_plan_created": 30,
    "diagnostic_submitted": 20,
}

PLAN_STATUS_LABELS: dict[str, str] = {
    "diagnosed": "已生成提升路径",
    "in_progress": "提升中",
    "ready_for_retest": "待阶段复测",
    "completed": "已完成提升闭环",
}

TASK_STATUS_LABELS: dict[str, str] = {
    "pending": "待提升",
    "in_progress": "提升中",
    "practiced": "已练习",
    "needs_retest": "仍需补弱",
    "passed": "已通过",
}


def safe_count(value: list[Any] | None) -> int:
    return len(value or [])


def scope_kind_label(scope_type: str | None) -> str:
    return "小节" if scope_type == "section" else "单元"


def event_sort_key(event: schemas.LearningTraceEventResponse) -> tuple[datetime, int, str]:
    event_time = event.event_time
    if event_time.tzinfo is None:
        event_time = event_time.replace(tzinfo=timezone.utc)
    return (event_time, EVENT_PRIORITY.get(event.event_type, 0), event.id)


class LearningTraceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_learning_trace(
        self,
        student_id: str,
        limit: int = 20,
        offset: int = 0,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> schemas.LearningTraceResponse:
        safe_limit = min(50, max(1, int(limit or 20)))
        safe_offset = max(0, int(offset or 0))
        attempts = await self._load_attempts(student_id, scope_type=scope_type, scope_id=scope_id)
        plans = await self._load_plans(student_id, scope_type=scope_type, scope_id=scope_id)

        events: list[schemas.LearningTraceEventResponse] = []
        events.extend(self._diagnostic_events(attempts))
        for plan in plans:
            events.extend(self._plan_events(plan))

        sorted_events = sorted(events, key=event_sort_key, reverse=True)
        return schemas.LearningTraceResponse(
            items=sorted_events[safe_offset:safe_offset + safe_limit],
            total=len(sorted_events),
            limit=safe_limit,
            offset=safe_offset,
        )

    async def _load_attempts(
        self,
        student_id: str,
        *,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> list[StudentScopeDiagnosticAttempt]:
        stmt = select(StudentScopeDiagnosticAttempt).where(StudentScopeDiagnosticAttempt.student_id == student_id)
        if scope_type:
            stmt = stmt.where(StudentScopeDiagnosticAttempt.scope_type == scope_type)
        if scope_id:
            stmt = stmt.where(StudentScopeDiagnosticAttempt.scope_id == scope_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def _load_plans(
        self,
        student_id: str,
        *,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> list[StudentImprovementPlan]:
        stmt = (
            select(StudentImprovementPlan)
            .where(StudentImprovementPlan.student_id == student_id)
            .options(
                selectinload(StudentImprovementPlan.tasks),
                selectinload(StudentImprovementPlan.retest_attempts),
            )
        )
        if scope_type:
            stmt = stmt.where(StudentImprovementPlan.scope_type == scope_type)
        if scope_id:
            stmt = stmt.where(StudentImprovementPlan.scope_id == scope_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    def _diagnostic_events(
        self,
        attempts: list[StudentScopeDiagnosticAttempt],
    ) -> list[schemas.LearningTraceEventResponse]:
        events: list[schemas.LearningTraceEventResponse] = []
        for attempt in attempts:
            event_time = attempt.submitted_at or attempt.created_at
            if not event_time:
                continue
            events.append(self._event(
                event_type="diagnostic_submitted",
                event_time=event_time,
                student_id=attempt.student_id,
                scope_type=attempt.scope_type,
                scope_id=attempt.scope_id,
                scope_name=attempt.scope_name,
                title=f"完成「{attempt.scope_name}」{scope_kind_label(attempt.scope_type)}检测",
                description=f"正确 {attempt.correct_count}/{attempt.total_count}，发现 {attempt.weak_count} 个薄弱点。",
                attempt_id=attempt.id,
                status_label="检测完成",
                primary_action="view_diagnostic",
                metadata={
                    "correct_count": attempt.correct_count,
                    "total_count": attempt.total_count,
                    "weak_count": attempt.weak_count,
                    "recommendation": attempt.recommendation,
                },
            ))
        return events

    def _plan_events(self, plan: StudentImprovementPlan) -> list[schemas.LearningTraceEventResponse]:
        events: list[schemas.LearningTraceEventResponse] = []
        events.extend(self._improvement_plan_events(plan))
        events.extend(self._task_events(plan))
        events.extend(self._retest_events(plan))
        return events

    def _improvement_plan_events(
        self,
        plan: StudentImprovementPlan,
    ) -> list[schemas.LearningTraceEventResponse]:
        events: list[schemas.LearningTraceEventResponse] = []
        if plan.created_at:
            events.append(self._event(
                event_type="improvement_plan_created",
                event_time=plan.created_at,
                student_id=plan.student_id,
                scope_type=plan.scope_type,
                scope_id=plan.scope_id,
                scope_name=plan.scope_name,
                title=f"生成「{plan.scope_name}」提升路径",
                description=f"生成 {len(plan.tasks or [])} 个提升任务，当前状态：{PLAN_STATUS_LABELS.get(plan.status, plan.status)}。",
                attempt_id=plan.diagnostic_attempt_id,
                plan_id=plan.id,
                status_label=PLAN_STATUS_LABELS.get(plan.status, plan.status),
                primary_action="view_plan",
                report_available=bool(plan.status == "completed" and plan.completed_at),
                metadata={
                    "correct_count": plan.correct_count,
                    "total_count": plan.total_count,
                    "weak_count": plan.weak_count,
                    "task_count": len(plan.tasks or []),
                    "plan_status": plan.status,
                },
            ))
        if plan.completed_at:
            events.append(self._event(
                event_type="improvement_completed",
                event_time=plan.completed_at,
                student_id=plan.student_id,
                scope_type=plan.scope_type,
                scope_id=plan.scope_id,
                scope_name=plan.scope_name,
                title=f"完成「{plan.scope_name}」提升闭环",
                description="本轮提升任务和阶段复测已完成，可以查看提升报告。",
                attempt_id=plan.diagnostic_attempt_id,
                plan_id=plan.id,
                status_label="已完成提升闭环",
                primary_action="view_report",
                report_available=True,
                metadata={
                    "task_count": len(plan.tasks or []),
                    "passed_task_count": sum(1 for task in plan.tasks or [] if task.status == "passed"),
                    "retest_attempt_count": safe_count(plan.retest_attempts),
                },
            ))
        return events

    def _task_events(self, plan: StudentImprovementPlan) -> list[schemas.LearningTraceEventResponse]:
        events: list[schemas.LearningTraceEventResponse] = []
        for task in sorted(plan.tasks or [], key=lambda item: item.priority):
            if task.started_at:
                events.append(self._task_event(
                    plan,
                    task,
                    event_type="task_started",
                    event_time=task.started_at,
                    title=f"开始提升「{task.kp_name}」",
                    description=task.reason,
                    status_label="提升中",
                ))
            if task.practiced_at:
                events.append(self._task_event(
                    plan,
                    task,
                    event_type="task_practiced",
                    event_time=task.practiced_at,
                    title=f"完成「{task.kp_name}」专项练习",
                    description="本步专项练习已记录，后续可进入阶段复测。",
                    status_label="已练习",
                ))
            if task.status == "needs_retest" and task.updated_at:
                events.append(self._task_event(
                    plan,
                    task,
                    event_type="task_needs_retest",
                    event_time=task.updated_at,
                    title=f"「{task.kp_name}」仍需补弱",
                    description="阶段复测后仍有不稳定点，建议继续专项练习后再测。",
                    status_label=TASK_STATUS_LABELS["needs_retest"],
                ))
            if task.passed_at:
                events.append(self._task_event(
                    plan,
                    task,
                    event_type="task_passed",
                    event_time=task.passed_at,
                    title=f"「{task.kp_name}」已通过复测",
                    description="本知识点已通过阶段复测。",
                    status_label="已通过",
                ))
        return events

    def _task_event(
        self,
        plan: StudentImprovementPlan,
        task: StudentImprovementTask,
        *,
        event_type: str,
        event_time: datetime,
        title: str,
        description: str,
        status_label: str,
    ) -> schemas.LearningTraceEventResponse:
        return self._event(
            event_type=event_type,
            event_time=event_time,
            student_id=plan.student_id,
            scope_type=plan.scope_type,
            scope_id=plan.scope_id,
            scope_name=plan.scope_name,
            title=title,
            description=description,
            attempt_id=plan.diagnostic_attempt_id,
            plan_id=plan.id,
            task_id=task.id,
            kp_id=task.kp_id,
            kp_name=task.kp_name,
            status_label=status_label,
            primary_action="view_plan",
            report_available=bool(plan.status == "completed" and plan.completed_at),
            metadata={
                "task_status": task.status,
                "priority": task.priority,
                "correct_count": task.correct_count,
                "total_count": task.total_count,
                "mastery_before": task.mastery_before,
                "mastery_after": task.mastery_after,
            },
        )

    def _retest_events(self, plan: StudentImprovementPlan) -> list[schemas.LearningTraceEventResponse]:
        events: list[schemas.LearningTraceEventResponse] = []
        for attempt in plan.retest_attempts or []:
            if attempt.created_at:
                events.append(self._retest_event(
                    plan,
                    attempt,
                    event_type="retest_started",
                    event_time=attempt.created_at,
                    title=f"开始「{plan.scope_name}」阶段复测",
                    description=f"本次复测包含 {safe_count(attempt.question_ids)} 道题。",
                    status_label="复测中" if attempt.status != "submitted" else "已提交",
                    primary_action="view_plan",
                ))
            if attempt.submitted_at:
                report_available = bool(plan.status == "completed" and plan.completed_at)
                events.append(self._retest_event(
                    plan,
                    attempt,
                    event_type="retest_submitted",
                    event_time=attempt.submitted_at,
                    title=f"提交「{plan.scope_name}」阶段复测",
                    description=(
                        f"复测正确 {attempt.correct_count}/{attempt.total_count}，"
                        f"通过 {attempt.passed_count} 个任务，仍需补弱 {attempt.needs_retest_count} 个。"
                    ),
                    status_label="复测已提交",
                    primary_action="view_report" if report_available else "view_plan",
                    report_available=report_available,
                ))
        return events

    def _retest_event(
        self,
        plan: StudentImprovementPlan,
        attempt: StudentImprovementRetestAttempt,
        *,
        event_type: str,
        event_time: datetime,
        title: str,
        description: str,
        status_label: str,
        primary_action: str,
        report_available: bool = False,
    ) -> schemas.LearningTraceEventResponse:
        return self._event(
            event_type=event_type,
            event_time=event_time,
            student_id=plan.student_id,
            scope_type=plan.scope_type,
            scope_id=plan.scope_id,
            scope_name=plan.scope_name,
            title=title,
            description=description,
            attempt_id=plan.diagnostic_attempt_id,
            plan_id=plan.id,
            retest_attempt_id=attempt.id,
            status_label=status_label,
            primary_action=primary_action,
            report_available=report_available,
            metadata={
                "retest_status": attempt.status,
                "question_count": safe_count(attempt.question_ids),
                "correct_count": attempt.correct_count,
                "total_count": attempt.total_count,
                "passed_count": attempt.passed_count,
                "needs_retest_count": attempt.needs_retest_count,
            },
        )

    def _event(
        self,
        *,
        event_type: str,
        event_time: datetime,
        student_id: str,
        scope_type: str | None,
        scope_id: str | None,
        scope_name: str | None,
        title: str,
        description: str,
        attempt_id: str | None = None,
        plan_id: str | None = None,
        task_id: str | None = None,
        retest_attempt_id: str | None = None,
        kp_id: str | None = None,
        kp_name: str | None = None,
        status_label: str | None = None,
        primary_action: str | None = None,
        report_available: bool = False,
        metadata: dict[str, object] | None = None,
    ) -> schemas.LearningTraceEventResponse:
        event_id_parts = [
            event_type,
            attempt_id,
            plan_id,
            task_id,
            retest_attempt_id,
            kp_id,
        ]
        event_id = ":".join(part for part in event_id_parts if part)
        return schemas.LearningTraceEventResponse(
            id=event_id,
            event_type=event_type,
            event_time=event_time,
            student_id=student_id,
            scope_type=scope_type,
            scope_id=scope_id,
            scope_name=scope_name,
            title=title,
            description=description,
            attempt_id=attempt_id,
            plan_id=plan_id,
            task_id=task_id,
            retest_attempt_id=retest_attempt_id,
            kp_id=kp_id,
            kp_name=kp_name,
            status_label=status_label,
            primary_action=primary_action,
            report_available=report_available,
            metadata=metadata or {},
        )
