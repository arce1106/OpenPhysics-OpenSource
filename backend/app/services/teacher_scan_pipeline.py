"""Recognition followed by optional pre-grading for a browser-controlled scan.

The existing authorization, quotas and teacher review gate apply unchanged.
All work after upload belongs to the server, not the browser's polling timer.
"""
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teacher_scan import TeacherScanBatch
from app.services.teacher_ai_service import TeacherAiService
from app.services.teacher_grading_service import PaperGrader, TeacherGradingService
from app.services.teacher_service import TeacherServiceError

async def pregrade_scan(db: AsyncSession, batch_id: str, grader: PaperGrader, *, root=None) -> None:
    batch = await db.get(TeacherScanBatch, batch_id)
    if batch is None or batch.status != "done":
        return
    teacher_id, assignment_id = batch.teacher_id, batch.assignment_id
    service = TeacherGradingService(db, TeacherAiService(db), grader, root=root)
    while True:
        try:
            run = await service.start_run(teacher_id, assignment_id)
            await service.process_run(run.id)
            return
        except TeacherServiceError as exc:
            await db.rollback()
            if exc.status_code == 409 and exc.detail == "预批正在进行中":
                # Another completed stack may still be grading; pick up this
                # stack's ungraded answers once it finishes rather than drop it.
                await asyncio.sleep(2)
                continue
            if exc.status_code in (400, 404, 409):
                # No authorized pending answers, or results have since locked.
                return
            raise
