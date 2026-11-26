from __future__ import annotations

from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.student import schemas
from app.models.improvement import (
    StudentImprovementPlan,
    StudentScopeDiagnosticAttempt,
    StudentScopeDiagnosticKpResult,
)
from app.models.knowledge import KnowledgePoint


class DiagnosticAttemptService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_from_scope_result(
        self,
        student_id: str,
        result: schemas.ScopeDiagnosticResult,
        question_ids: list[str] | None = None,
        answer_ids: list[int | str] | None = None,
    ) -> StudentScopeDiagnosticAttempt:
        canonical_answer_ids = sorted(
            list(answer_ids or []),
            key=lambda answer_id: str(answer_id),
        )
        fingerprint_answer_ids = [
            str(answer_id) for answer_id in canonical_answer_ids
        ]
        if canonical_answer_ids:
            existing = await self._find_submission_attempt(
                student_id=student_id,
                scope_type=result.scope_type,
                scope_id=result.scope_id,
                answer_ids=canonical_answer_ids,
            )
            if existing:
                return existing

        result_payload = result.model_dump(mode="json", exclude={"diagnostic_attempt_id"})
        attempt_id = (
            uuid5(
                NAMESPACE_URL,
                "|".join(
                    [
                        "openphysics-scope-diagnostic",
                        student_id,
                        result.scope_type,
                        result.scope_id,
                        *fingerprint_answer_ids,
                    ]
                ),
            ).hex
            if canonical_answer_ids
            else uuid4().hex
        )
        attempt = StudentScopeDiagnosticAttempt(
            id=attempt_id,
            student_id=student_id,
            scope_type=result.scope_type,
            scope_id=result.scope_id,
            scope_name=result.scope_name,
            diagnostic_type="scope",
            status="submitted",
            question_ids=list(question_ids or []),
            answer_ids=canonical_answer_ids,
            result=result_payload,
            correct_count=result.correct_count,
            total_count=result.total_count,
            weak_count=len(result.weak_kp_ids),
            weak_kp_ids=list(result.weak_kp_ids),
            recommendation=result.recommendation,
            feedback=result.feedback,
        )
        weak_kp_ids = set(result.weak_kp_ids)
        group_index = await self._load_group_index([item.kp_id for item in result.kp_results])
        attempt.kp_results = [
            StudentScopeDiagnosticKpResult(
                id=uuid4().hex,
                attempt_id=attempt.id,
                student_id=student_id,
                kp_id=item.kp_id,
                kp_name=item.kp_name,
                group_id=group_index.get(item.kp_id, (None, None))[0],
                group_name=group_index.get(item.kp_id, (None, None))[1],
                correct_count=item.correct_count,
                total_count=item.total_count,
                mastery_before=item.mastery_before,
                mastery_after=item.mastery_after,
                is_weak=item.kp_id in weak_kp_ids,
            )
            for item in result.kp_results
        ]
        self.db.add(attempt)
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            existing = await self.db.get(StudentScopeDiagnosticAttempt, attempt_id)
            if existing and existing.student_id == student_id:
                return existing
            raise
        await self.db.refresh(attempt)
        return attempt

    async def _find_submission_attempt(
        self,
        *,
        student_id: str,
        scope_type: str,
        scope_id: str,
        answer_ids: list[int | str],
    ) -> StudentScopeDiagnosticAttempt | None:
        result = await self.db.execute(
            select(StudentScopeDiagnosticAttempt).where(
                StudentScopeDiagnosticAttempt.student_id == student_id,
                StudentScopeDiagnosticAttempt.scope_type == scope_type,
                StudentScopeDiagnosticAttempt.scope_id == scope_id,
                StudentScopeDiagnosticAttempt.answer_ids == answer_ids,
            )
        )
        return result.scalar_one_or_none()

    async def ensure_attempt_for_scope_result(
        self,
        student_id: str,
        result: schemas.ScopeDiagnosticResult,
        question_ids: list[str] | None = None,
        answer_ids: list[int | str] | None = None,
    ) -> StudentScopeDiagnosticAttempt:
        if result.diagnostic_attempt_id:
            attempt = await self.db.get(StudentScopeDiagnosticAttempt, result.diagnostic_attempt_id)
            if not attempt:
                raise HTTPException(status_code=404, detail="Diagnostic attempt not found")
            if attempt.student_id != student_id:
                raise HTTPException(status_code=404, detail="Diagnostic attempt not found")
            if attempt.scope_type != result.scope_type or attempt.scope_id != result.scope_id:
                raise HTTPException(status_code=400, detail="Diagnostic attempt does not match scope result")
            return attempt
        return await self.create_from_scope_result(
            student_id,
            result,
            question_ids=question_ids,
            answer_ids=answer_ids,
        )

    async def list_attempts(
        self,
        student_id: str,
        limit: int = 10,
        offset: int = 0,
        scope_type: str | None = None,
        scope_id: str | None = None,
    ) -> schemas.ScopeDiagnosticAttemptListResponse:
        safe_limit = min(50, max(1, int(limit or 10)))
        safe_offset = max(0, int(offset or 0))
        filters = [StudentScopeDiagnosticAttempt.student_id == student_id]
        if scope_type:
            filters.append(StudentScopeDiagnosticAttempt.scope_type == scope_type)
        if scope_id:
            filters.append(StudentScopeDiagnosticAttempt.scope_id == scope_id)

        total_result = await self.db.execute(
            select(func.count()).select_from(StudentScopeDiagnosticAttempt).where(*filters)
        )
        total = int(total_result.scalar_one() or 0)
        result = await self.db.execute(
            select(StudentScopeDiagnosticAttempt)
            .where(*filters)
            .order_by(
                StudentScopeDiagnosticAttempt.submitted_at.desc(),
                StudentScopeDiagnosticAttempt.created_at.desc(),
            )
            .limit(safe_limit)
            .offset(safe_offset)
        )
        attempts = result.scalars().all()
        plan_by_attempt_id = await self._linked_plans_by_attempt([attempt.id for attempt in attempts], student_id)
        return schemas.ScopeDiagnosticAttemptListResponse(
            items=[
                self._serialize_list_item(attempt, plan_by_attempt_id.get(attempt.id))
                for attempt in attempts
            ],
            total=total,
            limit=safe_limit,
            offset=safe_offset,
        )

    async def get_attempt(
        self,
        student_id: str,
        attempt_id: str,
    ) -> schemas.ScopeDiagnosticAttemptDetailResponse:
        result = await self.db.execute(
            select(StudentScopeDiagnosticAttempt)
            .where(
                StudentScopeDiagnosticAttempt.id == attempt_id,
                StudentScopeDiagnosticAttempt.student_id == student_id,
            )
            .options(selectinload(StudentScopeDiagnosticAttempt.kp_results))
        )
        attempt = result.scalars().first()
        if not attempt:
            raise HTTPException(status_code=404, detail="Diagnostic attempt not found")
        plan_by_attempt_id = await self._linked_plans_by_attempt([attempt.id], student_id)
        return self._serialize_detail(attempt, plan_by_attempt_id.get(attempt.id))

    async def _load_group_index(self, kp_ids: list[str]) -> dict[str, tuple[str | None, str | None]]:
        if not kp_ids:
            return {}
        result = await self.db.execute(select(KnowledgePoint).where(KnowledgePoint.id.in_(kp_ids)))
        group_index: dict[str, tuple[str | None, str | None]] = {}
        for kp in result.scalars().all():
            if kp.section and kp.chapter:
                group_index[kp.id] = (f"{kp.chapter}||{kp.section}", kp.section)
            elif kp.section:
                group_index[kp.id] = (kp.section, kp.section)
            else:
                group_index[kp.id] = (None, None)
        return group_index

    async def _linked_plans_by_attempt(
        self,
        attempt_ids: list[str],
        student_id: str,
    ) -> dict[str, StudentImprovementPlan]:
        if not attempt_ids:
            return {}
        result = await self.db.execute(
            select(StudentImprovementPlan)
            .where(
                StudentImprovementPlan.student_id == student_id,
                StudentImprovementPlan.diagnostic_attempt_id.in_(attempt_ids),
            )
            .order_by(StudentImprovementPlan.created_at.desc())
        )
        plan_by_attempt_id: dict[str, StudentImprovementPlan] = {}
        for plan in result.scalars().all():
            if plan.diagnostic_attempt_id and plan.diagnostic_attempt_id not in plan_by_attempt_id:
                plan_by_attempt_id[plan.diagnostic_attempt_id] = plan
        return plan_by_attempt_id

    def _serialize_list_item(
        self,
        attempt: StudentScopeDiagnosticAttempt,
        linked_plan: StudentImprovementPlan | None,
    ) -> schemas.ScopeDiagnosticAttemptListItem:
        return schemas.ScopeDiagnosticAttemptListItem(
            attempt_id=attempt.id,
            scope_type=attempt.scope_type,
            scope_id=attempt.scope_id,
            scope_name=attempt.scope_name,
            diagnostic_type=attempt.diagnostic_type,
            created_at=attempt.created_at,
            submitted_at=attempt.submitted_at,
            correct_count=attempt.correct_count,
            total_count=attempt.total_count,
            weak_count=attempt.weak_count,
            recommendation=attempt.recommendation,
            feedback=attempt.feedback,
            linked_plan_id=linked_plan.id if linked_plan else None,
            linked_plan_status=linked_plan.status if linked_plan else None,
            linked_report_available=bool(linked_plan and linked_plan.status == "completed"),
        )

    def _serialize_detail(
        self,
        attempt: StudentScopeDiagnosticAttempt,
        linked_plan: StudentImprovementPlan | None,
    ) -> schemas.ScopeDiagnosticAttemptDetailResponse:
        kp_results = sorted(attempt.kp_results, key=lambda item: (item.created_at, item.kp_id))
        return schemas.ScopeDiagnosticAttemptDetailResponse(
            attempt_id=attempt.id,
            student_id=attempt.student_id,
            scope_type=attempt.scope_type,
            scope_id=attempt.scope_id,
            scope_name=attempt.scope_name,
            diagnostic_type=attempt.diagnostic_type,
            status=attempt.status,
            created_at=attempt.created_at,
            submitted_at=attempt.submitted_at,
            question_ids=attempt.question_ids,
            answer_ids=attempt.answer_ids,
            result=attempt.result,
            correct_count=attempt.correct_count,
            total_count=attempt.total_count,
            weak_count=attempt.weak_count,
            weak_kp_ids=attempt.weak_kp_ids,
            recommendation=attempt.recommendation,
            feedback=attempt.feedback,
            kp_results=[
                schemas.ScopeDiagnosticAttemptKpResultResponse(
                    id=item.id,
                    kp_id=item.kp_id,
                    kp_name=item.kp_name,
                    group_id=item.group_id,
                    group_name=item.group_name,
                    correct_count=item.correct_count,
                    total_count=item.total_count,
                    mastery_before=item.mastery_before,
                    mastery_after=item.mastery_after,
                    is_weak=item.is_weak,
                )
                for item in kp_results
            ],
            linked_plan_id=linked_plan.id if linked_plan else None,
            linked_plan_status=linked_plan.status if linked_plan else None,
            linked_report_available=bool(linked_plan and linked_plan.status == "completed"),
        )
