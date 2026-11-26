"""Learning access follows account status; class ownership is checked by class APIs."""
from fastapi import HTTPException
from app.services.student_service import StudentService


class StudentAccessPolicy:
    def __init__(self, student_svc: StudentService):
        self.student_svc = student_svc

    async def has_full_learning_access(self, student_id: str) -> bool:
        student = await self.student_svc.get_student(student_id)
        return bool(student and student.status == "active")

    async def can_read_own_history(self, student_id: str) -> bool:
        return await self.has_full_learning_access(student_id)

    async def ensure_full_learning_access(self, student_id: str) -> str:
        if await self.has_full_learning_access(student_id):
            return student_id
        raise HTTPException(status_code=401, detail="Student account unavailable")

    async def ensure_can_access_kp(self, student_id: str, kp_id: str) -> str:
        return await self.ensure_full_learning_access(student_id)

    async def ensure_can_access_question(self, student_id: str, question_id: str | None) -> str:
        return await self.ensure_full_learning_access(student_id)
