from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.student import schemas
from app.models.improvement import StudentImprovementPlan, StudentImprovementRetestAttempt, StudentImprovementTask
from app.models.knowledge import KnowledgePoint
from app.models.question import Question
from app.models.student import StudentAnswer
from app.services.diagnostic_attempt_service import DiagnosticAttemptService
from app.services.knowledge_service import KnowledgeService
from app.services.learning_state_rules import PRACTICE_RECOMMENDATION_THRESHOLD
from app.services.adaptive_service import AdaptiveService, _is_self_review_supported
from app.services.question_ordering import ordered_questions_for_student
from app.services.question_service import QuestionService
from app.services.student_access_policy import StudentAccessPolicy
from app.services.student_service import StudentService


ACTION_REASONS: dict[str, str] = {
    "review_then_practice": "本次定位暴露基础不稳，建议先回看关键概念，再做一组专项练。",
    "practice": "掌握还不稳定，建议完成一组针对性训练。",
    "challenge": "基础较稳定，可以做一组提升题检查综合应用。",
    "retest": "完成训练后建议复测，确认问题是否解决。",
}

CLIENT_TASK_STATUSES = {"pending", "in_progress", "practiced", "needs_retest"}
TASK_REOPEN_STATUSES = {"pending", "in_progress", "practiced", "needs_retest"}
RETEST_PASS_CORRECT_RATE = 0.7
ERR_NO_RETEST_QUESTIONS = "No questions available for retest"
ERR_NO_TASKS_READY_FOR_RETEST = "No tasks ready for retest"
MIN_DATETIME = datetime.min.replace(tzinfo=timezone.utc)
FINAL_LABELS = {
    "passed": "已通过",
    "needs_retest": "仍需补弱",
    "practiced": "待复测",
    "in_progress": "提升中",
    "pending": "待提升",
}


def recommended_action_for(item: schemas.ScopeKpResult, is_weak: bool) -> str:
    if is_weak and item.mastery_after < 0.3:
        return "review_then_practice"
    if is_weak:
        return "practice"
    if item.mastery_after >= 0.75:
        return "challenge"
    return "practice"


def group_info_for(kp: KnowledgePoint | None) -> tuple[str | None, str | None]:
    if not kp or not kp.section:
        return None, None
    if kp.chapter:
        return f"{kp.chapter}||{kp.section}", kp.section
    return kp.section, kp.section


def mastery_before_from_payload(
    answers: list[schemas.SubmittedDiagnosticAnswer],
    kp_id: str,
    fallback: float,
) -> float:
    for answer in answers:
        update = answer.mastery_update.get(kp_id)
        if update:
            return update.before
    return fallback


class ImprovementPlanService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_from_scope_result(
        self,
        student_id: str,
        diagnostic_result: schemas.ScopeDiagnosticResult,
    ) -> schemas.ImprovementPlanResponse:
        scope_kps = await self._load_scope_kps(diagnostic_result.scope_type, diagnostic_result.scope_id)
        directory_index = await self._ensure_scope_result_allowed(student_id, diagnostic_result, scope_kps)
        attempt = await DiagnosticAttemptService(self.db).ensure_attempt_for_scope_result(
            student_id,
            diagnostic_result,
        )
        scope_order = {kp.id: index for index, kp in enumerate(scope_kps)}
        source_result = diagnostic_result.model_dump(mode="json")
        plan = StudentImprovementPlan(
            id=uuid4().hex,
            student_id=student_id,
            diagnostic_attempt_id=attempt.id,
            scope_type=diagnostic_result.scope_type,
            scope_id=diagnostic_result.scope_id,
            scope_name=diagnostic_result.scope_name,
            status="diagnosed",
            correct_count=diagnostic_result.correct_count,
            total_count=diagnostic_result.total_count,
            weak_count=len(diagnostic_result.weak_kp_ids),
            source_result=source_result,
        )

        weak_kp_ids = set(diagnostic_result.weak_kp_ids)
        indexed_items = [
            (item, item.kp_id in weak_kp_ids)
            for item in diagnostic_result.kp_results
        ]
        sorted_items = sorted(
            indexed_items,
            key=lambda row: (
                0 if row[1] else 1,
                row[0].mastery_after,
                0 if row[0].total_count > 0 else 1,
                scope_order.get(row[0].kp_id, len(scope_order)),
                row[0].kp_name,
            ),
        )

        tasks: list[StudentImprovementTask] = []
        for priority, (item, is_weak) in enumerate(sorted_items, start=1):
            action = recommended_action_for(item, is_weak)
            group_id, group_name = group_info_for(directory_index.get(item.kp_id))
            tasks.append(StudentImprovementTask(
                id=uuid4().hex,
                plan_id=plan.id,
                student_id=student_id,
                kp_id=item.kp_id,
                kp_name=item.kp_name,
                group_id=group_id,
                group_name=group_name,
                correct_count=item.correct_count,
                total_count=item.total_count,
                mastery_before=item.mastery_before,
                mastery_after=item.mastery_after,
                is_weak=is_weak,
                priority=priority,
                status="pending",
                recommended_action=action,
                reason=ACTION_REASONS[action],
            ))
        plan.current_task_id = tasks[0].id if tasks else None
        plan.tasks = tasks

        self.db.add(plan)
        await self.db.commit()
        return await self.get_plan(student_id, plan.id)

    async def get_latest_plan(
        self,
        student_id: str,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> schemas.ImprovementPlanResponse | None:
        stmt = (
            select(StudentImprovementPlan)
            .where(StudentImprovementPlan.student_id == student_id)
            .where(StudentImprovementPlan.status != "completed")
            .options(selectinload(StudentImprovementPlan.tasks))
            .order_by(StudentImprovementPlan.created_at.desc(), StudentImprovementPlan.updated_at.desc())
            .limit(1)
        )
        if scope_type:
            stmt = stmt.where(StudentImprovementPlan.scope_type == scope_type)
        if scope_id:
            stmt = stmt.where(StudentImprovementPlan.scope_id == scope_id)
        result = await self.db.execute(stmt)
        plan = result.scalars().first()
        if not plan:
            return None
        return self.serialize_plan(plan)

    async def get_plan(self, student_id: str, plan_id: str) -> schemas.ImprovementPlanResponse:
        plan = await self._get_plan_model(student_id, plan_id)
        return self.serialize_plan(plan)

    async def get_improvement_report(
        self,
        student_id: str,
        plan_id: str,
    ) -> schemas.ImprovementReportResponse:
        plan = await self._get_plan_model(student_id, plan_id)
        return self.serialize_report(plan)

    async def get_latest_completed_report(
        self,
        student_id: str,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> schemas.ImprovementReportResponse | None:
        stmt = (
            select(StudentImprovementPlan)
            .where(StudentImprovementPlan.student_id == student_id)
            .where(StudentImprovementPlan.status == "completed")
            .options(
                selectinload(StudentImprovementPlan.tasks),
                selectinload(StudentImprovementPlan.retest_attempts),
            )
            .order_by(
                StudentImprovementPlan.completed_at.desc().nullslast(),
                StudentImprovementPlan.updated_at.desc(),
                StudentImprovementPlan.created_at.desc(),
            )
            .limit(1)
        )
        if scope_type:
            stmt = stmt.where(StudentImprovementPlan.scope_type == scope_type)
        if scope_id:
            stmt = stmt.where(StudentImprovementPlan.scope_id == scope_id)
        result = await self.db.execute(stmt)
        plan = result.scalars().first()
        if not plan:
            return None
        return self.serialize_report(plan)

    async def list_completed_reports(
        self,
        student_id: str,
        limit: int = 10,
        offset: int = 0,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> schemas.ImprovementReportListResponse:
        safe_limit = min(50, max(1, int(limit or 10)))
        safe_offset = max(0, int(offset or 0))
        filters = [
            StudentImprovementPlan.student_id == student_id,
            StudentImprovementPlan.status == "completed",
        ]
        if scope_type:
            filters.append(StudentImprovementPlan.scope_type == scope_type)
        if scope_id:
            filters.append(StudentImprovementPlan.scope_id == scope_id)

        total_result = await self.db.execute(
            select(func.count()).select_from(StudentImprovementPlan).where(*filters)
        )
        total = int(total_result.scalar_one() or 0)
        stmt = (
            select(StudentImprovementPlan)
            .where(*filters)
            .options(
                selectinload(StudentImprovementPlan.tasks),
                selectinload(StudentImprovementPlan.retest_attempts),
            )
            .order_by(
                StudentImprovementPlan.completed_at.desc().nullslast(),
                StudentImprovementPlan.updated_at.desc(),
                StudentImprovementPlan.created_at.desc(),
            )
            .limit(safe_limit)
            .offset(safe_offset)
        )
        result = await self.db.execute(stmt)
        plans = result.scalars().all()
        return schemas.ImprovementReportListResponse(
            items=[self._serialize_report_list_item(plan) for plan in plans],
            total=total,
            limit=safe_limit,
            offset=safe_offset,
        )

    async def update_task_status(
        self,
        student_id: str,
        plan_id: str,
        task_id: str,
        status: str,
    ) -> schemas.ImprovementPlanResponse:
        if status not in CLIENT_TASK_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid improvement task status")
        plan = await self._get_plan_model(student_id, plan_id)
        task = next((item for item in plan.tasks if item.id == task_id and item.student_id == student_id), None)
        if not task:
            raise HTTPException(status_code=404, detail="Improvement task not found")
        if plan.status == "completed":
            raise HTTPException(status_code=400, detail="Completed improvement plan cannot be modified")
        if task.status == "passed" and status in TASK_REOPEN_STATUSES:
            raise HTTPException(status_code=400, detail="Passed improvement task cannot be reopened")
        if task.status == "practiced" and plan.status == "ready_for_retest" and status == "in_progress":
            raise HTTPException(status_code=400, detail="Practiced task is waiting for retest")

        now = datetime.now(timezone.utc)
        task.status = status
        if status == "in_progress":
            if not task.started_at:
                task.started_at = now
            plan.status = "in_progress"
            plan.current_task_id = task.id
        elif status == "practiced":
            task.practiced_at = now
            self._advance_after_practice(plan)
        elif status in {"pending", "needs_retest"}:
            if not plan.current_task_id:
                plan.current_task_id = task.id
            if plan.status == "ready_for_retest":
                plan.status = "in_progress"
        plan.updated_at = now

        await self.db.commit()
        return await self.get_plan(student_id, plan_id)

    async def move_to_next_task(
        self,
        student_id: str,
        plan_id: str,
        mark_in_progress: bool = True,
    ) -> schemas.ImprovementPlanResponse:
        plan = await self._get_plan_model(student_id, plan_id)
        now = datetime.now(timezone.utc)
        next_task = self._next_pending_task(plan)
        if next_task:
            plan.current_task_id = next_task.id
            plan.status = "in_progress"
            if mark_in_progress:
                next_task.status = "in_progress"
                if not next_task.started_at:
                    next_task.started_at = now
        else:
            plan.current_task_id = None
            plan.status = "ready_for_retest"
        plan.updated_at = now
        await self.db.commit()
        return await self.get_plan(student_id, plan_id)

    async def start_retest(
        self,
        student_id: str,
        plan_id: str,
        question_count_per_task: int = 1,
        max_questions: int = 10,
    ) -> schemas.ImprovementRetestSessionResponse:
        plan = await self._get_plan_model(student_id, plan_id)
        if plan.status not in {"ready_for_retest", "in_progress"}:
            raise HTTPException(status_code=400, detail="Improvement plan is not ready for retest")

        retest_tasks = [
            task
            for task in sorted(plan.tasks, key=lambda item: item.priority)
            if task.status in {"practiced", "needs_retest"}
        ]
        if not retest_tasks:
            raise HTTPException(status_code=400, detail=ERR_NO_TASKS_READY_FOR_RETEST)

        access_policy = StudentAccessPolicy(StudentService(self.db))
        question_svc = QuestionService(self.db)
        count_per_task = max(1, int(question_count_per_task or 1))
        limit = max(1, int(max_questions or 10))
        questions = []
        question_targets: dict[str, str] = {}
        seen_question_ids: set[str] = set()
        for task in retest_tasks:
            if len(questions) >= limit:
                break
            await access_policy.ensure_can_access_kp(student_id, task.kp_id)
            candidates = await question_svc.get_questions_by_knowledge_point(task.kp_id, limit=count_per_task)
            for question in candidates:
                if question.id in seen_question_ids:
                    continue
                await access_policy.ensure_can_access_question(student_id, question.id)
                seen_question_ids.add(question.id)
                question_targets[question.id] = task.kp_id
                questions.append(question)
                if len(questions) >= limit:
                    break

        questions = ordered_questions_for_student(questions)[:limit]
        if not questions:
            raise HTTPException(status_code=400, detail=ERR_NO_RETEST_QUESTIONS)

        attempt = StudentImprovementRetestAttempt(
            id=uuid4().hex,
            plan_id=plan.id,
            student_id=student_id,
            status="in_progress",
            question_ids=[question.id for question in questions],
        )
        plan.updated_at = datetime.now(timezone.utc)
        self.db.add(attempt)
        await self.db.commit()

        return schemas.ImprovementRetestSessionResponse(
            attempt_id=attempt.id,
            plan=await self.get_plan(student_id, plan.id),
            session=schemas.PracticeSessionResponse(
                student_id=student_id,
                session_type="improvement_retest",
                strategy="improvement_retest",
                session_objective=f"阶段复测「{plan.scope_name}」",
                session_structure=schemas.SessionStructure(
                    phases=[schemas.SessionPhase(
                        phase="retest",
                        question_indices=list(range(len(questions))),
                    )],
                    total=len(questions),
                ),
                learner_profile=None,
                questions=[self._serialize_question(question, question_targets[question.id]) for question in questions],
            ),
        )

    async def submit_retest_feedback(
        self,
        student_id: str,
        plan_id: str,
        attempt_id: str,
        answers: list[schemas.SubmittedDiagnosticAnswer],
    ) -> schemas.ImprovementRetestResultResponse:
        plan = await self._get_plan_model(student_id, plan_id)
        attempt = await self._get_retest_attempt_model(student_id, plan_id, attempt_id)
        if attempt.status == "submitted":
            return await self._serialize_retest_result(student_id, plan, attempt)

        submitted_rows = await self._load_submitted_answer_rows(student_id, answers)
        attempt_question_ids = set(attempt.question_ids or [])
        submitted_question_ids_list = [
            answer.question_id
            for _, (answer, _) in submitted_rows
        ]
        submitted_question_ids = set(submitted_question_ids_list)
        if len(submitted_question_ids_list) != len(submitted_question_ids):
            raise HTTPException(status_code=400, detail="Duplicate retest answers are not allowed")
        if submitted_question_ids - attempt_question_ids:
            raise HTTPException(status_code=400, detail="Submitted answer does not belong to retest attempt")
        if submitted_question_ids != attempt_question_ids:
            raise HTTPException(status_code=400, detail="Retest submission must include all attempt questions")

        task_by_kp = {task.kp_id: task for task in plan.tasks}
        stats: dict[str, dict] = {}
        for submitted, (answer, question) in submitted_rows:
            kp_id = StudentService.evidence_knowledge_point_id(answer, question, set(task_by_kp))
            if kp_id not in task_by_kp:
                raise HTTPException(status_code=400, detail="Retest question does not match improvement tasks")
            task = task_by_kp[kp_id]
            row = stats.setdefault(task.id, {
                "task": task,
                "correct_count": 0,
                "total_count": 0,
                "submitted_answers": [],
            })
            row["total_count"] += 1
            row["correct_count"] += 1 if answer.is_correct else 0
            row["submitted_answers"].append(submitted)

        if not stats:
            raise HTTPException(status_code=400, detail="Submitted answers do not match retest tasks")

        now = datetime.now(timezone.utc)
        student_svc = StudentService(self.db)
        task_results: list[schemas.ImprovementRetestTaskResult] = []
        for task in sorted(plan.tasks, key=lambda item: item.priority):
            row = stats.get(task.id)
            if not row:
                continue
            total_count = int(row["total_count"])
            correct_count = int(row["correct_count"])
            current_mastery = await student_svc.get_mastery(student_id, task.kp_id)
            mastery_after = current_mastery.mastery if current_mastery else task.mastery_after
            mastery_before = mastery_before_from_payload(answers, task.kp_id, mastery_after)
            correct_rate = correct_count / total_count if total_count else 0.0
            passed = (
                total_count > 0
                and correct_rate >= RETEST_PASS_CORRECT_RATE
                and mastery_after >= PRACTICE_RECOMMENDATION_THRESHOLD
            )
            next_status = "passed" if passed else "needs_retest"
            task.status = next_status
            if passed:
                task.passed_at = now
            task.updated_at = now
            feedback = (
                f"复测 {correct_count}/{total_count} 正确，掌握度达到 {(mastery_after * 100):.0f}%，本步已通过。"
                if passed
                else f"复测 {correct_count}/{total_count} 正确，掌握度 {(mastery_after * 100):.0f}%，建议继续补弱后再测。"
            )
            task_results.append(schemas.ImprovementRetestTaskResult(
                task_id=task.id,
                kp_id=task.kp_id,
                kp_name=task.kp_name,
                correct_count=correct_count,
                total_count=total_count,
                mastery_before=mastery_before,
                mastery_after=mastery_after,
                passed=passed,
                next_status=next_status,
                feedback=feedback,
            ))

        passed_count = sum(1 for item in task_results if item.passed)
        needs_retest_count = sum(1 for item in task_results if not item.passed)
        total_count = sum(item.total_count for item in task_results)
        correct_count = sum(item.correct_count for item in task_results)

        if plan.tasks and all(task.status == "passed" for task in plan.tasks):
            plan.status = "completed"
            plan.current_task_id = None
            plan.completed_at = now
        else:
            next_needs_retest = next(
                (
                    task
                    for task in sorted(plan.tasks, key=lambda item: item.priority)
                    if task.status == "needs_retest"
                ),
                None,
            )
            if next_needs_retest:
                plan.status = "in_progress"
                plan.current_task_id = next_needs_retest.id
            else:
                plan.status = "ready_for_retest"
                plan.current_task_id = None
        plan.updated_at = now

        attempt.status = "submitted"
        attempt.submitted_at = now
        attempt.correct_count = correct_count
        attempt.total_count = total_count
        attempt.passed_count = passed_count
        attempt.needs_retest_count = needs_retest_count
        attempt.task_results = [item.model_dump(mode="json") for item in task_results]

        await self.db.commit()
        return await self._serialize_retest_result(student_id, plan, attempt)

    def serialize_plan(self, plan: StudentImprovementPlan) -> schemas.ImprovementPlanResponse:
        tasks = sorted(plan.tasks, key=lambda item: item.priority)
        return schemas.ImprovementPlanResponse(
            id=plan.id,
            student_id=plan.student_id,
            diagnostic_attempt_id=plan.diagnostic_attempt_id,
            scope_type=plan.scope_type,
            scope_id=plan.scope_id,
            scope_name=plan.scope_name,
            created_at=plan.created_at,
            updated_at=plan.updated_at,
            completed_at=plan.completed_at,
            correct_count=plan.correct_count,
            total_count=plan.total_count,
            weak_count=plan.weak_count,
            status=plan.status,
            current_task_id=plan.current_task_id,
            source_result=plan.source_result,
            tasks=[
                schemas.ImprovementTaskResponse(
                    id=task.id,
                    plan_id=task.plan_id,
                    student_id=task.student_id,
                    kp_id=task.kp_id,
                    kp_name=task.kp_name,
                    group_id=task.group_id,
                    group_name=task.group_name,
                    correct_count=task.correct_count,
                    total_count=task.total_count,
                    mastery_before=task.mastery_before,
                    mastery_after=task.mastery_after,
                    is_weak=task.is_weak,
                    priority=task.priority,
                    status=task.status,
                    recommended_action=task.recommended_action,
                    reason=task.reason,
                    started_at=task.started_at,
                    practiced_at=task.practiced_at,
                    passed_at=task.passed_at,
                    created_at=task.created_at,
                    updated_at=task.updated_at,
                )
                for task in tasks
            ],
        )

    def serialize_report(self, plan: StudentImprovementPlan) -> schemas.ImprovementReportResponse:
        tasks = sorted(plan.tasks, key=lambda item: item.priority)
        submitted_attempts = [
            attempt
            for attempt in (plan.retest_attempts or [])
            if attempt.status == "submitted"
        ]
        attempts_desc = sorted(
            plan.retest_attempts or [],
            key=lambda item: item.submitted_at or item.created_at or MIN_DATETIME,
            reverse=True,
        )
        latest_submitted_attempt = submitted_attempts and sorted(
            submitted_attempts,
            key=lambda item: item.submitted_at or item.created_at or MIN_DATETIME,
            reverse=True,
        )[0] or None
        latest_result_by_task = self._latest_retest_result_by_task(submitted_attempts)
        diagnostic_accuracy = plan.correct_count / plan.total_count if plan.total_count else 0.0
        latest_retest_accuracy = (
            latest_submitted_attempt.correct_count / latest_submitted_attempt.total_count
            if latest_submitted_attempt and latest_submitted_attempt.total_count
            else None
        )
        passed_task_count = sum(1 for task in tasks if task.status == "passed")
        needs_retest_task_count = sum(1 for task in tasks if task.status == "needs_retest")
        practiced_task_count = sum(1 for task in tasks if task.status == "practiced")
        pending_task_count = sum(1 for task in tasks if task.status in {"pending", "in_progress"})

        report_tasks = [
            self._serialize_report_task(task, latest_result_by_task.get(task.id))
            for task in tasks
        ]
        remaining_weaknesses = [
            f"「{task.kp_name}」复测后仍需继续补弱。"
            for task in tasks
            if task.status == "needs_retest"
        ]
        summary = schemas.ImprovementReportSummary(
            plan_id=plan.id,
            scope_type=plan.scope_type,
            scope_id=plan.scope_id,
            scope_name=plan.scope_name,
            plan_status=plan.status,
            created_at=plan.created_at,
            completed_at=plan.completed_at,
            diagnostic_correct_count=plan.correct_count,
            diagnostic_total_count=plan.total_count,
            diagnostic_accuracy=diagnostic_accuracy,
            task_count=len(tasks),
            weak_task_count=sum(1 for task in tasks if task.is_weak),
            passed_task_count=passed_task_count,
            needs_retest_task_count=needs_retest_task_count,
            practiced_task_count=practiced_task_count,
            pending_task_count=pending_task_count,
            retest_attempt_count=len(plan.retest_attempts or []),
            latest_retest_accuracy=latest_retest_accuracy,
            completed=plan.status == "completed",
        )

        return schemas.ImprovementReportResponse(
            summary=summary,
            diagnostic_result=plan.source_result,
            tasks=report_tasks,
            retest_attempts=[
                schemas.ImprovementReportRetestAttempt(
                    attempt_id=attempt.id,
                    status=attempt.status,
                    correct_count=attempt.correct_count,
                    total_count=attempt.total_count,
                    passed_count=attempt.passed_count,
                    needs_retest_count=attempt.needs_retest_count,
                    created_at=attempt.created_at,
                    submitted_at=attempt.submitted_at,
                )
                for attempt in attempts_desc
            ],
            strengths=self._report_strengths(plan, passed_task_count, latest_retest_accuracy),
            remaining_weaknesses=remaining_weaknesses,
            next_actions=self._report_next_actions(plan, tasks),
        )

    def _serialize_report_task(
        self,
        task: StudentImprovementTask,
        retest_result: dict | None,
    ) -> schemas.ImprovementReportTaskItem:
        return schemas.ImprovementReportTaskItem(
            task_id=task.id,
            kp_id=task.kp_id,
            kp_name=task.kp_name,
            group_id=task.group_id,
            group_name=task.group_name,
            priority=task.priority,
            status=task.status,
            recommended_action=task.recommended_action,
            reason=self._report_task_feedback(task, retest_result),
            diagnostic_correct_count=task.correct_count,
            diagnostic_total_count=task.total_count,
            mastery_before=task.mastery_before,
            mastery_after_diagnostic=task.mastery_after,
            latest_retest_correct_count=retest_result.get("correct_count") if retest_result else None,
            latest_retest_total_count=retest_result.get("total_count") if retest_result else None,
            latest_retest_mastery_before=retest_result.get("mastery_before") if retest_result else None,
            latest_retest_mastery_after=retest_result.get("mastery_after") if retest_result else None,
            latest_retest_passed=retest_result.get("passed") if retest_result else None,
            final_label=FINAL_LABELS.get(task.status, "待提升"),
        )

    def _serialize_report_list_item(
        self,
        plan: StudentImprovementPlan,
    ) -> schemas.ImprovementReportListItem:
        tasks = list(plan.tasks or [])
        task_count = len(tasks)
        passed_task_count = sum(1 for task in tasks if task.status == "passed")
        needs_retest_task_count = sum(1 for task in tasks if task.status == "needs_retest")
        latest_attempt = self._latest_submitted_attempt(plan.retest_attempts or [])
        latest_retest_accuracy = (
            latest_attempt.correct_count / latest_attempt.total_count
            if latest_attempt and latest_attempt.total_count
            else None
        )
        if task_count > 0 and passed_task_count == task_count:
            highlight = f"已通过 {passed_task_count}/{task_count} 个提升任务"
        elif needs_retest_task_count > 0:
            highlight = f"仍有 {needs_retest_task_count} 个知识点需继续补弱"
        else:
            highlight = "提升路径已完成"
        return schemas.ImprovementReportListItem(
            plan_id=plan.id,
            scope_type=plan.scope_type,
            scope_id=plan.scope_id,
            scope_name=plan.scope_name,
            created_at=plan.created_at,
            completed_at=plan.completed_at,
            diagnostic_correct_count=plan.correct_count,
            diagnostic_total_count=plan.total_count,
            diagnostic_accuracy=plan.correct_count / plan.total_count if plan.total_count else 0.0,
            task_count=task_count,
            passed_task_count=passed_task_count,
            needs_retest_task_count=needs_retest_task_count,
            latest_retest_accuracy=latest_retest_accuracy,
            summary_label="已完成" if task_count > 0 and passed_task_count == task_count else "部分完成",
            highlight=highlight,
        )

    def _latest_submitted_attempt(
        self,
        attempts: list[StudentImprovementRetestAttempt],
    ) -> StudentImprovementRetestAttempt | None:
        submitted = [attempt for attempt in attempts if attempt.status == "submitted"]
        if not submitted:
            return None
        return sorted(
            submitted,
            key=lambda item: item.submitted_at or item.created_at or MIN_DATETIME,
            reverse=True,
        )[0]

    def _latest_retest_result_by_task(
        self,
        submitted_attempts: list[StudentImprovementRetestAttempt],
    ) -> dict[str, dict]:
        latest: dict[str, tuple[datetime, dict]] = {}
        for attempt in submitted_attempts:
            marker = attempt.submitted_at or attempt.created_at or MIN_DATETIME
            for item in attempt.task_results or []:
                task_id = item.get("task_id")
                if not task_id:
                    continue
                current = latest.get(task_id)
                if current is None or marker >= current[0]:
                    latest[task_id] = (marker, item)
        return {task_id: row for task_id, (_, row) in latest.items()}

    def _report_task_feedback(self, task: StudentImprovementTask, retest_result: dict | None) -> str:
        if retest_result and retest_result.get("feedback"):
            return str(retest_result["feedback"])
        return task.reason

    def _report_strengths(
        self,
        plan: StudentImprovementPlan,
        passed_task_count: int,
        latest_retest_accuracy: float | None,
    ) -> list[str]:
        strengths: list[str] = []
        if passed_task_count > 0:
            strengths.append(f"已通过 {passed_task_count} 个提升任务，说明相关知识点已基本稳定。")
        if latest_retest_accuracy is not None and latest_retest_accuracy >= 0.8:
            strengths.append("阶段复测正确率较高，补弱效果明显。")
        if plan.status == "completed":
            strengths.append(f"本轮「{plan.scope_name}」提升闭环已完成。")
        return strengths[:3]

    def _report_next_actions(
        self,
        plan: StudentImprovementPlan,
        tasks: list[StudentImprovementTask],
    ) -> list[str]:
        if plan.status == "completed":
            return [
                "可以回到巩固提升首页选择新的章节或单元继续检测。",
                "建议隔几天后再次做一组综合练习，确认长期稳定。",
            ]
        if plan.status == "ready_for_retest":
            return ["请完成阶段复测，确认本轮补弱是否真正稳定。"]
        needs_retest = next((task for task in tasks if task.status == "needs_retest"), None)
        if needs_retest:
            return [f"优先继续处理「{needs_retest.kp_name}」。"]
        if any(task.status in {"pending", "in_progress"} for task in tasks):
            return ["继续按提升路径完成剩余任务。"]
        return ["回到巩固提升首页，选择新的范围继续检测。"]

    async def _serialize_retest_result(
        self,
        student_id: str,
        plan: StudentImprovementPlan,
        attempt: StudentImprovementRetestAttempt,
    ) -> schemas.ImprovementRetestResultResponse:
        plan_response = await self.get_plan(student_id, plan.id)
        return schemas.ImprovementRetestResultResponse(
            attempt_id=attempt.id,
            plan=plan_response,
            correct_count=attempt.correct_count,
            total_count=attempt.total_count,
            passed_count=attempt.passed_count,
            needs_retest_count=attempt.needs_retest_count,
            task_results=[
                schemas.ImprovementRetestTaskResult(**item)
                for item in (attempt.task_results or [])
            ],
        )

    async def _load_scope_kps(self, scope_type: str, scope_id: str) -> list[KnowledgePoint]:
        knowledge_svc = KnowledgeService(self.db)
        if scope_type == "chapter":
            kps = await knowledge_svc.get_points_by_chapter(scope_id)
        elif scope_type == "section":
            if "||" not in scope_id:
                raise HTTPException(status_code=400, detail="Invalid section scope id")
            chapter, section = scope_id.split("||", 1)
            kps = await knowledge_svc.get_points_by_section(chapter, section)
        else:
            raise HTTPException(status_code=400, detail="Invalid improvement scope type")

        if not kps:
            raise HTTPException(status_code=404, detail="Improvement scope has no knowledge points")
        return kps

    async def _ensure_scope_result_allowed(
        self,
        student_id: str,
        diagnostic_result: schemas.ScopeDiagnosticResult,
        scope_kps: list[KnowledgePoint],
    ) -> dict[str, KnowledgePoint]:
        scope_index = {kp.id: kp for kp in scope_kps}
        submitted_kp_ids = [item.kp_id for item in diagnostic_result.kp_results]
        outside_scope_ids = sorted({kp_id for kp_id in submitted_kp_ids if kp_id not in scope_index})
        if outside_scope_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Diagnostic result contains knowledge points outside scope: {', '.join(outside_scope_ids)}",
            )

        access_policy = StudentAccessPolicy(StudentService(self.db))
        for kp_id in dict.fromkeys(submitted_kp_ids):
            await access_policy.ensure_can_access_kp(student_id, kp_id)
        return scope_index

    async def _get_plan_model(self, student_id: str, plan_id: str) -> StudentImprovementPlan:
        result = await self.db.execute(
            select(StudentImprovementPlan)
            .where(
                StudentImprovementPlan.id == plan_id,
                StudentImprovementPlan.student_id == student_id,
            )
            .options(
                selectinload(StudentImprovementPlan.tasks),
                selectinload(StudentImprovementPlan.retest_attempts),
            )
            .execution_options(populate_existing=True)
        )
        plan = result.scalars().first()
        if not plan:
            raise HTTPException(status_code=404, detail="Improvement plan not found")
        return plan

    async def _get_retest_attempt_model(
        self,
        student_id: str,
        plan_id: str,
        attempt_id: str,
    ) -> StudentImprovementRetestAttempt:
        result = await self.db.execute(
            select(StudentImprovementRetestAttempt).where(
                StudentImprovementRetestAttempt.id == attempt_id,
                StudentImprovementRetestAttempt.plan_id == plan_id,
                StudentImprovementRetestAttempt.student_id == student_id,
            )
        )
        attempt = result.scalars().first()
        if not attempt:
            raise HTTPException(status_code=404, detail="Improvement retest attempt not found")
        return attempt

    async def _load_submitted_answer_rows(
        self,
        student_id: str,
        answers: list[schemas.SubmittedDiagnosticAnswer],
    ) -> list[tuple[schemas.SubmittedDiagnosticAnswer, tuple[StudentAnswer, Question]]]:
        answer_ids = [answer.answer_id for answer in answers]
        if not answer_ids:
            raise HTTPException(status_code=400, detail="No submitted answers provided")

        result = await self.db.execute(
            select(StudentAnswer, Question)
            .join(Question, Question.id == StudentAnswer.question_id)
            .where(
                StudentAnswer.student_id == student_id,
                StudentAnswer.id.in_(answer_ids),
            )
            .options(selectinload(Question.labels))
        )
        rows_by_id = {answer.id: (answer, question) for answer, question in result.all()}
        missing_ids = [answer_id for answer_id in answer_ids if answer_id not in rows_by_id]
        if missing_ids:
            raise HTTPException(status_code=400, detail="Submitted answers are invalid")
        return [(answer, rows_by_id[answer.answer_id]) for answer in answers]

    def _serialize_question(self, question: Question, target_knowledge_point_id: str | None = None) -> dict:
        labels_by_type: dict[str, list[str]] = {}
        for label in question.labels or []:
            labels_by_type.setdefault(label.label_type, []).append(label.label_id)
        serialized = {
            "id": question.id,
            "stem_text": question.stem_text,
            "question_type": question.question_type.value if question.question_type else None,
            "difficulty": question.difficulty,
            "difficulty_tier": question.difficulty_tier.value if question.difficulty_tier else None,
            "knowledge_point_ids": labels_by_type.get("knowledge_point", []),
            "target_knowledge_point_id": target_knowledge_point_id or AdaptiveService.resolve_target_knowledge_point_id(question),
            "physics_model": self._first_label(labels_by_type.get("physics_model")),
            "ability_dimension": self._first_label(labels_by_type.get("ability_dimension")),
            "question_structure": self._first_label(labels_by_type.get("question_structure")),
            "solution_strategy": self._first_label(labels_by_type.get("solution_strategy")),
            "labels_by_type": labels_by_type,
            "session_phase": "retest",
            "options": [{"label": option.label, "text": option.text} for option in (question.options or [])],
            "images": [
                {
                    "id": image.id,
                    "image_path": image.image_path,
                    "image_type": image.image_type,
                    "description": image.description,
                }
                for image in (question.images or [])
            ],
            "route": "improvement_retest",
        }
        if _is_self_review_supported(question):
            serialized["answer"] = question.answer
            serialized["correct_answer"] = question.answer
            serialized["explanation"] = question.explanation
        return serialized

    @staticmethod
    def _first_label(values: list[str] | None) -> str | None:
        return values[0] if values else None

    def _advance_after_practice(self, plan: StudentImprovementPlan) -> None:
        if plan.tasks and all(task.status in {"practiced", "passed"} for task in plan.tasks):
            plan.status = "ready_for_retest"
            plan.current_task_id = None
            return
        next_task = self._next_pending_task(plan)
        if next_task:
            plan.status = "in_progress"
            plan.current_task_id = next_task.id

    def _next_pending_task(self, plan: StudentImprovementPlan) -> StudentImprovementTask | None:
        return next(
            (
                task
                for task in sorted(plan.tasks, key=lambda item: item.priority)
                if task.status in {"pending", "needs_retest"}
            ),
            None,
        )
