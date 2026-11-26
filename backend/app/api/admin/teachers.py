"""Administrator management of teacher accounts, their classes and class membership."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.student import Student
from app.models.teacher import Teacher, TeacherClass
from app.services.teacher_ai_service import TeacherAiService
from app.services.teacher_service import TeacherService, TeacherServiceError

from .router import verify_admin_token


def current_admin_username(x_admin_token: str | None = Header(default=None)) -> str:
    """Who recorded an authorization; API-token callers are recorded as "api"."""
    from app.core.config import settings
    from app.services.admin_auth_service import AdminAuthService

    return AdminAuthService.decode_access_token(x_admin_token or "", settings.admin_auth_secret) or "api"

ClassLevel = Literal["advanced", "standard", "foundation"]


class TeacherCreate(BaseModel):
    username: str = Field(max_length=64)
    display_name: str = Field(max_length=64)
    password: str = Field(max_length=128)


class TeacherUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    status: Literal["active", "disabled"] | None = None


class TeacherPasswordReset(BaseModel):
    password: str = Field(max_length=128)


class ClassCreate(BaseModel):
    name: str = Field(max_length=64)
    grade: str | None = Field(default=None, max_length=64)
    level: ClassLevel = "standard"


class ClassUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    grade: str | None = Field(default=None, max_length=64)
    level: ClassLevel | None = None
    archived: bool | None = None


class MemberAdd(BaseModel):
    username: str = Field(max_length=64)
    # Placing a student by hand needs the school's or a guardian's authorization: the class
    # teacher will see their practice records, homework and mastery.
    grantor: Literal["school", "guardian"]


class AdminClass(BaseModel):
    id: str
    teacher_id: str
    name: str
    grade: str | None
    level: ClassLevel
    archived: bool
    member_count: int


class AdminTeacher(BaseModel):
    id: str
    username: str
    display_name: str
    status: str
    must_change_password: bool
    last_login_at: datetime | None
    created_at: datetime | None
    classes: list[AdminClass]


class AdminClassMember(BaseModel):
    id: str
    username: str
    display_name: str
    status: str
    teacher_ai_authorized: bool = False
    teacher_ai_grantor: str | None = None


class AiAuthorizationUpdate(BaseModel):
    student_ids: list[str] = Field(min_length=1, max_length=500)
    granted: bool
    grantor: Literal["school", "guardian"]


class MemberAddResult(BaseModel):
    member: AdminClassMember
    added: bool


router = APIRouter(
    prefix="/api/admin",
    tags=["admin-teachers"],
    dependencies=[Depends(verify_admin_token)],
)


def get_teacher_service(db: AsyncSession = Depends(get_db)) -> TeacherService:
    return TeacherService(db)


def _class(teacher_class: TeacherClass, member_count: int) -> dict:
    return {
        "id": teacher_class.id,
        "teacher_id": teacher_class.teacher_id,
        "name": teacher_class.name,
        "grade": teacher_class.grade,
        "level": teacher_class.level,
        "archived": teacher_class.archived_at is not None,
        "member_count": member_count,
    }


def _member(student: Student) -> dict:
    return {
        "id": student.id,
        "username": student.username,
        "display_name": student.display_name,
        "status": student.status,
    }


async def _teachers_with_classes(service: TeacherService, teachers: list[Teacher]) -> list[dict]:
    classes = await service.list_classes([teacher.id for teacher in teachers])
    counts = await service.member_counts([item.id for item in classes])
    rows = []
    for teacher in teachers:
        rows.append({
            "id": teacher.id,
            "username": teacher.username,
            "display_name": teacher.display_name,
            "status": teacher.status,
            "must_change_password": teacher.must_change_password,
            "last_login_at": teacher.last_login_at,
            "created_at": teacher.created_at,
            "classes": [
                _class(item, counts.get(item.id, 0)) for item in classes if item.teacher_id == teacher.id
            ],
        })
    return rows


async def _call(coro):
    try:
        return await coro
    except TeacherServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/teachers", response_model=list[AdminTeacher])
async def list_teachers(service: TeacherService = Depends(get_teacher_service)):
    return await _teachers_with_classes(service, await service.list_teachers())


@router.post("/teachers", response_model=AdminTeacher, status_code=201)
async def create_teacher(body: TeacherCreate, service: TeacherService = Depends(get_teacher_service)):
    teacher = await _call(service.create_teacher(body.username, body.display_name, body.password))
    return (await _teachers_with_classes(service, [teacher]))[0]


@router.put("/teachers/{teacher_id}", response_model=AdminTeacher)
async def update_teacher(
    teacher_id: str, body: TeacherUpdate, service: TeacherService = Depends(get_teacher_service),
):
    teacher = await _call(service.update_teacher(teacher_id, display_name=body.display_name, status=body.status))
    return (await _teachers_with_classes(service, [teacher]))[0]


@router.post("/teachers/{teacher_id}/reset-password", response_model=AdminTeacher)
async def reset_teacher_password(
    teacher_id: str, body: TeacherPasswordReset, service: TeacherService = Depends(get_teacher_service),
):
    teacher = await _call(service.reset_password(teacher_id, body.password))
    return (await _teachers_with_classes(service, [teacher]))[0]


@router.post("/teachers/{teacher_id}/classes", response_model=AdminClass, status_code=201)
async def create_class(
    teacher_id: str, body: ClassCreate, service: TeacherService = Depends(get_teacher_service),
):
    teacher_class = await _call(service.create_class(teacher_id, body.name, body.grade, body.level))
    return _class(teacher_class, 0)


@router.put("/teacher-classes/{class_id}", response_model=AdminClass)
async def update_class(
    class_id: str, body: ClassUpdate, service: TeacherService = Depends(get_teacher_service),
):
    teacher_class = await _call(service.update_class(
        class_id, name=body.name, grade=body.grade, level=body.level, archived=body.archived,
    ))
    counts = await service.member_counts([teacher_class.id])
    return _class(teacher_class, counts.get(teacher_class.id, 0))


@router.get("/teacher-classes/{class_id}/members", response_model=list[AdminClassMember])
async def list_class_members(class_id: str, service: TeacherService = Depends(get_teacher_service)):
    await _call(service.get_class(class_id))
    students = await service.list_members(class_id)
    details = await TeacherAiService(service.db).authorization_details([student.id for student in students])
    return [
        {**_member(student),
         "teacher_ai_authorized": details.get(student.id, {}).get("granted", False),
         "teacher_ai_grantor": details.get(student.id, {}).get("grantor")}
        for student in students
    ]


@router.post("/teacher-classes/{class_id}/ai-authorization", response_model=list[AdminClassMember])
async def record_ai_authorization(
    class_id: str,
    body: AiAuthorizationUpdate,
    service: TeacherService = Depends(get_teacher_service),
    admin_username: str = Depends(current_admin_username),
):
    """Record that a school or guardian authorized (or withdrew) AI reading of paper homework."""
    await _call(service.get_class(class_id))
    members = {student.id for student in await service.list_members(class_id)}
    unknown = set(body.student_ids) - members
    if unknown:
        raise HTTPException(status_code=400, detail="有学生不在这个班级")
    await TeacherAiService(service.db).record_authorization(
        body.student_ids, granted=body.granted, grantor=body.grantor, recorded_by=f"admin:{admin_username}",
    )
    return await list_class_members(class_id, service)


@router.post("/teacher-classes/{class_id}/members", response_model=MemberAddResult)
async def add_class_member(
    class_id: str, body: MemberAdd, service: TeacherService = Depends(get_teacher_service),
    admin_username: str = Depends(current_admin_username),
):
    student, added = await _call(service.add_member(class_id, body.username, grantor=body.grantor,
                                                   recorded_by=f"admin:{admin_username}"))
    return {"member": _member(student), "added": added}


@router.delete("/teacher-classes/{class_id}/members/{student_id}", status_code=204)
async def remove_class_member(
    class_id: str, student_id: str, service: TeacherService = Depends(get_teacher_service),
):
    await _call(service.remove_member(class_id, student_id))
    return Response(status_code=204)
