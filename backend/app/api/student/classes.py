"""Self-service membership; identity always comes from the student's session."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.student.dependencies import get_current_student_id
from app.services.class_membership_service import ClassMembershipService
from app.services.login_attempt_limiter import LoginAttemptLimiter, get_login_limiter
from app.services.teacher_service import TeacherServiceError

router = APIRouter()


class InvitationCode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=32)


class StudentName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_name: str = Field(min_length=1, max_length=40)


class JoinClass(InvitationCode):
    disclosure_version: str = Field(min_length=1, max_length=80)
    student_name: str | None = Field(default=None, max_length=40)


async def _call(action, response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await action
    except TeacherServiceError as error:
        raise HTTPException(error.status_code, error.detail) from None


@router.get("/classes")
async def classes(response: Response, student_id: str = Depends(get_current_student_id), db: AsyncSession = Depends(get_db)):
    return await _call(ClassMembershipService(db).classes(student_id), response)


@router.post("/class-invitations/preview")
async def preview(body: InvitationCode, response: Response, student_id: str = Depends(get_current_student_id),
                  db: AsyncSession = Depends(get_db), limiter: LoginAttemptLimiter = Depends(get_login_limiter)):
    await limiter.check("class-invitation", student_id)
    return await _call(ClassMembershipService(db).preview(body.code, student_id), response)


@router.post("/classes/join")
async def join(body: JoinClass, response: Response, student_id: str = Depends(get_current_student_id),
               db: AsyncSession = Depends(get_db), limiter: LoginAttemptLimiter = Depends(get_login_limiter)):
    await limiter.check("class-invitation", student_id)
    return await _call(ClassMembershipService(db).join(body.code, student_id, body.disclosure_version, body.student_name), response)


@router.delete("/classes/{class_id}", status_code=204)
async def leave(class_id: str, student_id: str = Depends(get_current_student_id), db: AsyncSession = Depends(get_db)):
    try:
        await ClassMembershipService(db).remove(class_id, student_id, student_leave=True)
    except TeacherServiceError as error:
        raise HTTPException(error.status_code, error.detail) from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.put("/student-name")
async def rename(body: StudentName, response: Response, student_id: str = Depends(get_current_student_id),
                 db: AsyncSession = Depends(get_db)):
    """Correct the real name shown to the student's teachers."""
    return await _call(ClassMembershipService(db).rename(student_id, body.student_name), response)
