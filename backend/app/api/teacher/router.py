"""Teacher API: every class route is scoped to classes the signed-in teacher owns."""
from urllib.parse import quote
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session, get_db
from app.models.student import Student
from app.models.teacher import Teacher, TeacherClass
from app.services.login_attempt_limiter import LoginAttemptLimiter, get_login_limiter
from app.services.teacher_ai_service import ModelScanRecognizer, ScanRecognizer, TeacherAiService
from app.services.paper_items import is_choice
from app.services.rubric_service import RubricDrafter, RubricService, TextModelRubricDrafter
from app.services.teacher_assignment_service import TeacherAssignmentService
from app.services.teacher_grading_service import ModelPaperGrader, PaperGrader, TeacherGradingService
from app.services.teacher_scan_service import TeacherScanService, resolve_signed_image
from app.services.teacher_auth_service import TeacherAuthService
from app.services.teacher_service import TeacherService, TeacherServiceError, mask_phone
from app.services.teacher_pdf_service import render_pdf

from . import schemas


def get_teacher_service(db: AsyncSession = Depends(get_db)) -> TeacherService:
    return TeacherService(db)


def get_assignment_service(db: AsyncSession = Depends(get_db)) -> TeacherAssignmentService:
    return TeacherAssignmentService(db)


def ensure_teacher_login_configured() -> None:
    if not settings.teacher_login_configured():
        raise HTTPException(status_code=503, detail="Teacher login is not configured")


async def get_current_teacher(
    authorization: str | None = Header(default=None),
    service: TeacherService = Depends(get_teacher_service),
) -> Teacher:
    ensure_teacher_login_configured()
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Teacher login required")
    claims = TeacherAuthService.decode_access_token(
        authorization.split(" ", 1)[1].strip(), settings.teacher_auth_secret,
    )
    teacher = await service.teacher_for_token(claims) if claims else None
    if not teacher:
        raise HTTPException(status_code=401, detail="Invalid or expired teacher token")
    return teacher


async def get_ready_teacher(teacher: Teacher = Depends(get_current_teacher)) -> Teacher:
    """Class data stays closed until the administrator-issued password is replaced."""
    if teacher.must_change_password:
        raise HTTPException(status_code=403, detail="请先修改初始密码")
    return teacher


def _service_error(exc: TeacherServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _profile(teacher: Teacher) -> dict:
    return {
        "id": teacher.id,
        "username": teacher.username,
        "display_name": teacher.display_name,
        "must_change_password": teacher.must_change_password,
    }


def _token_response(teacher: Teacher) -> dict:
    return {
        "access_token": TeacherAuthService.create_access_token(
            teacher.id, teacher.auth_version,
            settings.teacher_auth_secret, settings.teacher_access_token_minutes,
        ),
        "token_type": "bearer",
        "teacher": _profile(teacher),
    }


def _class_summary(teacher_class: TeacherClass, member_count: int) -> dict:
    return {
        "id": teacher_class.id,
        "name": teacher_class.name,
        "grade": teacher_class.grade,
        "level": teacher_class.level,
        "archived": teacher_class.archived_at is not None,
        "member_count": member_count,
    }


def _member(student: Student, number: str | None = None, ai_authorized: bool = False,
            facts: dict | None = None, app_ai_declined: bool = False) -> dict:
    return {
        "id": student.id,
        "username": mask_phone(student.username),
        "display_name": mask_phone(student.display_name),
        "status": student.status,
        "last_login_at": student.last_login_at,
        "student_number": number,
        "teacher_ai_authorized": ai_authorized,
        "joined_via": (facts or {}).get("joined_via"),
        "joined_at": (facts or {}).get("joined_at"),
        "app_ai_declined": app_ai_declined,
    }


def _roster_order(numbers: dict[str, str | None]):
    """Numbered students by number, then the rest in name order."""
    return lambda student: (numbers.get(student.id) is None, int(numbers.get(student.id) or 0))


auth_router = APIRouter(prefix="/api/teacher/auth", tags=["teacher-auth"])
router = APIRouter(prefix="/api/teacher", tags=["teacher"])


@auth_router.post("/login", response_model=schemas.TeacherLoginResponse)
async def login_teacher(
    body: schemas.TeacherLoginRequest,
    service: TeacherService = Depends(get_teacher_service),
    limiter: LoginAttemptLimiter = Depends(get_login_limiter),
):
    ensure_teacher_login_configured()
    attempt_key = await limiter.check("teacher", body.username)
    teacher = await service.authenticate(body.username, body.password)
    if not teacher:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    await limiter.succeeded(attempt_key)
    return _token_response(teacher)


@router.get("/me", response_model=schemas.TeacherProfile)
async def get_me(teacher: Teacher = Depends(get_current_teacher)):
    return _profile(teacher)


@router.post("/me/password", response_model=schemas.TeacherLoginResponse)
async def change_password(
    body: schemas.TeacherPasswordChangeRequest,
    teacher: Teacher = Depends(get_current_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    try:
        teacher = await service.change_password(teacher, body.current_password, body.new_password)
    except TeacherServiceError as exc:
        raise _service_error(exc)
    # Changing the password revokes the old token, so hand back a fresh one.
    return _token_response(teacher)


@router.get("/classes", response_model=list[schemas.TeacherClassSummary])
async def list_classes(
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    classes = await service.list_classes([teacher.id], include_archived=False)
    counts = await service.member_counts([item.id for item in classes])
    return [_class_summary(item, counts.get(item.id, 0)) for item in classes]


@router.get("/classes/{class_id}", response_model=schemas.TeacherClassDetail)
async def get_class(
    class_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    try:
        teacher_class = await service.get_owned_class(teacher.id, class_id)
    except TeacherServiceError as exc:
        raise _service_error(exc)
    from app.services.privacy_consent_service import PrivacyConsentService
    members = await service.list_members(teacher_class.id)
    numbers = await service.member_numbers(teacher_class.id)
    ids = [student.id for student in members]
    authorized = await TeacherAiService(service.db).authorized_students(ids)
    facts = await service.membership_facts(teacher_class.id)
    declined = await PrivacyConsentService(service.db).declined_ai(ids)
    members.sort(key=_roster_order(numbers))
    return {
        **_class_summary(teacher_class, len(members)),
        "members": [_member(student, numbers.get(student.id), student.id in authorized, facts.get(student.id),
                            student.id in declined) for student in members],
    }


def _sharing_open(teacher_class: TeacherClass) -> None:
    """An archived class keeps its roster and released scores, but no longer reads students' current learning."""
    if teacher_class.archived_at is not None:
        raise HTTPException(status_code=403, detail="班级已归档，已停止共享学生学情；名单与历次成绩仍可查看")


@router.put("/classes/{class_id}/members/{student_id}/number", response_model=schemas.TeacherClassDetail)
async def set_member_number(
    class_id: str,
    student_id: str,
    body: schemas.MemberNumberUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    try:
        await service.get_owned_class(teacher.id, class_id)
        await service.set_member_number(class_id, student_id, body.student_number)
    except TeacherServiceError as exc:
        raise _service_error(exc)
    return await get_class(class_id, teacher, service)


@router.post("/classes/{class_id}/members/auto-number", response_model=schemas.TeacherClassDetail)
async def auto_number_members(
    class_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    try:
        await service.get_owned_class(teacher.id, class_id)
        await service.auto_number(class_id)
    except TeacherServiceError as exc:
        raise _service_error(exc)
    return await get_class(class_id, teacher, service)


@router.get("/classes/{class_id}/invitation")
async def class_invitation(class_id: str, response: Response, teacher: Teacher = Depends(get_ready_teacher),
                           service: TeacherService = Depends(get_teacher_service)):
    from app.services.class_membership_service import ClassMembershipService
    response.headers["Cache-Control"] = "no-store"
    return await _call(ClassMembershipService(service.db).invitation(class_id, teacher.id))


@router.post("/classes/{class_id}/invitation")
async def generate_class_invitation(class_id: str, response: Response, teacher: Teacher = Depends(get_ready_teacher),
                                    service: TeacherService = Depends(get_teacher_service)):
    from app.services.class_membership_service import ClassMembershipService
    response.headers["Cache-Control"] = "no-store"
    return await _call(ClassMembershipService(service.db).generate(class_id, teacher.id))


@router.delete("/classes/{class_id}/invitation")
async def disable_class_invitation(class_id: str, response: Response, teacher: Teacher = Depends(get_ready_teacher),
                                   service: TeacherService = Depends(get_teacher_service)):
    from app.services.class_membership_service import ClassMembershipService
    response.headers["Cache-Control"] = "no-store"
    return await _call(ClassMembershipService(service.db).disable(class_id, teacher.id))


@router.delete("/classes/{class_id}/members/{student_id}", response_model=schemas.TeacherClassDetail)
async def remove_class_member(class_id: str, student_id: str, teacher: Teacher = Depends(get_ready_teacher),
                              service: TeacherService = Depends(get_teacher_service)):
    from app.services.class_membership_service import ClassMembershipService
    await _call(ClassMembershipService(service.db).remove(class_id, student_id, teacher_id=teacher.id))
    return await get_class(class_id, teacher, service)


@router.get("/classes/{class_id}/dashboard")
async def get_class_dashboard(
    class_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    try:
        teacher_class = await service.get_owned_class(teacher.id, class_id)
    except TeacherServiceError as exc:
        raise _service_error(exc)
    _sharing_open(teacher_class)
    return await service.class_signals(teacher_class.id)


@router.get("/classes/{class_id}/students/{student_id}/statistics")
async def student_statistics(
    class_id: str,
    student_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    """One student's rows of the class statistics, without computing the whole class."""
    from app.services.teacher_statistics_service import TeacherStatisticsService
    teacher_class = await _call(service.get_owned_class(teacher.id, class_id))
    _sharing_open(teacher_class)
    student = next((s for s in await service.list_members(class_id) if s.id == student_id), None)
    if student is None:
        raise HTTPException(status_code=404, detail="该学生不在这个班级")
    return await TeacherStatisticsService(service.db).build(class_id, [student])


@router.get("/classes/{class_id}/records")
async def class_practice_records(
    class_id: str,
    student_id: str | None = None,
    kp_id: str | None = None,
    wrong_only: bool = False,
    source: Literal['practice', 'homework', 'all'] = 'practice',
    offset: int = Query(default=0, ge=0, le=2000),
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherService = Depends(get_teacher_service),
):
    from app.services.teacher_statistics_service import TeacherStatisticsService
    try:
        _sharing_open(await service.get_owned_class(teacher.id, class_id))
        return await TeacherStatisticsService(service.db).records(
            teacher.id, class_id, student_id, kp_id, wrong_only, source, offset=offset,
        )
    except TeacherServiceError as exc:
        raise _service_error(exc)


# --- Papers ---


async def _call(coro):
    try:
        return await coro
    except TeacherServiceError as exc:
        raise _service_error(exc)


@router.get("/knowledge-points")
async def list_knowledge_points(
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await service.knowledge_points()


@router.get("/question-bank/outline")
async def question_bank_outline(
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await service.outline_counts()


@router.get("/questions")
async def search_questions_any_class(
    class_id: str | None = None,
    kp_id: str | None = None,
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    question_type: str | None = None,
    difficulty_tier: str | None = None,
    search: str | None = Query(default=None, max_length=100),
    exclude_attempted: bool = False,
    page: int = 1,
    page_size: int = 20,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    """Bank search for a paper not tied to a class: answer counts over all the teacher's classes,
    or over one class of theirs when given."""
    return await search_questions(
        class_id, kp_id, volume, chapter, section, question_type, difficulty_tier, search,
        exclude_attempted, page, page_size, teacher, service,
    )


@router.get("/classes/{class_id}/questions")
async def search_questions(
    class_id: str,
    kp_id: str | None = None,
    volume: str | None = None,
    chapter: str | None = None,
    section: str | None = None,
    question_type: str | None = None,
    difficulty_tier: str | None = None,
    search: str | None = Query(default=None, max_length=100),
    exclude_attempted: bool = False,
    page: int = 1,
    page_size: int = 20,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await _call(service.search_questions(
        teacher.id, class_id, kp_id=kp_id, volume=volume, chapter=chapter, section=section,
        question_type=question_type,
        difficulty_tier=difficulty_tier, search=search, exclude_attempted=exclude_attempted,
        page=page, page_size=page_size,
    ))


@router.get("/classes/{class_id}/assignments", response_model=list[schemas.AssignmentSummary])
async def list_assignments(
    class_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    assignments = await _call(service.list_for_class(teacher.id, class_id))
    return [service.summary(item) for item in assignments]


@router.post("/classes/{class_id}/assignments", status_code=201)
async def create_assignment(
    class_id: str,
    body: schemas.AssignmentCreate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    assignment = await _call(service.create(teacher.id, class_id, body.title))
    return await service.detail(teacher.id, assignment.id)


def get_rubric_drafter() -> RubricDrafter:
    return TextModelRubricDrafter()


def get_rubric_runner(drafter: RubricDrafter = Depends(get_rubric_drafter)):
    """Drafts missing rubrics after the response, in its own database session."""
    async def run(question_points: list[tuple[str, float]]) -> None:
        async with async_session() as db:
            service = RubricService(db, drafter)
            for question_id, points in question_points:
                await service.draft(question_id, default_points=points)
    return run


# --- Homework library: papers and settings, assigned to classes ---


@router.get("/assignments")
async def list_library(
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await service.library().library(teacher.id)


@router.post("/assignments", status_code=201)
async def create_paper(
    body: schemas.AssignmentCreate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    paper = await _call(service.library().create_paper(teacher.id, body.title))
    return await service.detail(teacher.id, paper.id)


@router.post("/personalized", status_code=201)
async def create_personalized_for_classes(
    body: schemas.PersonalizedLibraryCreate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    paper, created = await _call(service.library().create_personalized(
        teacher.id, title=body.title, scope=[entry.model_dump(exclude_none=True) for entry in body.scope],
        choice_count=body.choice_count, area_count=body.area_count, class_ids=body.class_ids,
        student_ids_by_class=body.student_ids_by_class,
        experiment_count=body.experiment_count, calculation_count=body.calculation_count,
        delivery=body.delivery,
    ))
    return {"paper": service.summary(paper), "assigned": [service.summary(row) for row in created]}


@router.post("/assignments/{assignment_id}/assign")
async def assign_to_classes(
    assignment_id: str,
    body: schemas.AssignToClasses,
    background: BackgroundTasks,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
    rubric_runner=Depends(get_rubric_runner),
):
    """A class test goes out frozen to each class; a personalized homework is drafted per class."""
    created = await _call(service.library().assign(
        teacher.id, assignment_id, body.class_ids, student_ids_by_class=body.student_ids_by_class, delivery=body.delivery,
    ))
    for row in created:
        if row.status == "published":
            await _queue_rubrics(service, row, background, rubric_runner)
    return {"assigned": [service.summary(row) for row in created]}


@router.post("/assignments/{assignment_id}/save")
async def save_paper(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    """A paper of the teacher's own is fixed as it will be printed; to change it, copy it."""
    await _call(service.save_paper(teacher.id, assignment_id))
    return await service.detail(teacher.id, assignment_id)


@router.post("/assignments/{assignment_id}/copy", status_code=201)
async def copy_assignment(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    paper = await _call(service.library().copy(teacher.id, assignment_id))
    return await service.detail(teacher.id, paper.id)


@router.get("/classes/{class_id}/homework")
async def class_homework(
    class_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await _call(service.library().class_homework(teacher.id, class_id))


@router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: str,
    stats_class_id: str | None = None,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await _call(service.detail(teacher.id, assignment_id, stats_class_id=stats_class_id))


@router.get("/assignments/{assignment_id}/pdf")
async def download_assignment_pdf(
    assignment_id: str,
    edition: Literal["student", "teacher"] = "student",
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    detail = await _call(service.detail(teacher.id, assignment_id))
    if detail["kind"] != "personalized" and detail["status"] == "draft":
        raise HTTPException(status_code=409, detail="请先保存试卷，再下载 PDF")
    app_only = ((detail.get("settings") or {}).get("delivery") == "app" or detail["kind"] == "personalized") and not any(
        paper["delivery"] == "paper" and not paper.get("missing") for paper in detail.get("papers", []))
    if edition == "student" and app_only:
        raise HTTPException(status_code=409, detail="这份作业没有需要打印的学生")
    if edition == "teacher" and detail["kind"] == "personalized" and not any(not paper.get("missing") for paper in detail.get("papers", [])):
        raise HTTPException(status_code=409, detail="没有可导出的学生作业")
    classes = ([detail["class_id"]] if detail["class_id"] else
               [item.id for item in await service.teachers.list_classes([teacher.id], include_archived=False)])
    numbers = [number for class_id in classes
               for number in (await service.teachers.member_numbers(class_id)).values() if number]
    numbers.extend(paper["student_number"] for paper in detail.get("papers", []) if paper.get("student_number"))
    number_boxes = max([2, *(len(number) for number in numbers)])
    data = await _call(render_pdf({"detail": detail, "numberBoxes": number_boxes, "edition": edition}))
    filename = quote(detail["title"] + ("（教师版）" if edition == "teacher" else "") + ".pdf", safe="")
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=homework.pdf; filename*=UTF-8''{filename}",
        "Cache-Control": "no-store",
    })


@router.put("/assignments/{assignment_id}")
async def update_assignment(
    assignment_id: str,
    body: schemas.AssignmentUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    items = [item.model_dump() for item in body.items] if body.items is not None else None
    await _call(service.update_draft(teacher.id, assignment_id, title=body.title, items=items))
    return await service.detail(teacher.id, assignment_id)


@router.delete("/assignments/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: str,
    scope: str = Query(default="paper", pattern="^(paper|task)$"),
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    if scope == "task":
        await _call(service.library().remove_task(teacher.id, assignment_id))
    else:
        await _call(service.delete_draft(teacher.id, assignment_id))
    return Response(status_code=204)


@router.get("/assignments/{assignment_id}/alternatives")
async def list_alternatives(
    assignment_id: str,
    question_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    return await _call(service.alternatives(teacher.id, assignment_id, question_id))


# --- Personalized homework ---


@router.post("/classes/{class_id}/personalized", status_code=201)
async def create_personalized(
    class_id: str,
    body: schemas.PersonalizedCreate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    """Draft one paper per student from their own answers, within the chosen chapters."""
    assignment = await _call(service.personalized().create(
        teacher.id, class_id, title=body.title,
        scope=[entry.model_dump(exclude_none=True) for entry in body.scope],
        choice_count=body.choice_count, area_count=body.area_count,
        experiment_count=body.experiment_count, calculation_count=body.calculation_count,
        delivery=body.delivery,
    ))
    return await service.detail(teacher.id, assignment.id)


@router.post("/assignments/{assignment_id}/papers/{student_id}/redraft")
async def redraft_student_paper(
    assignment_id: str,
    student_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    assignment = await _call(service.owned_personalized_draft(teacher.id, assignment_id))
    await _call(service.personalized().redraft(assignment, student_id))
    return await service.detail(teacher.id, assignment_id)


@router.put("/assignments/{assignment_id}/papers/delivery")
async def update_all_deliveries(
    assignment_id: str,
    body: schemas.DeliveryUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    """Every student's paper of a personalized draft in the app, or all on paper."""
    assignment = await _call(service.owned_personalized_draft(teacher.id, assignment_id))
    await _call(service.personalized().set_delivery_all(assignment, body.delivery))
    return await service.detail(teacher.id, assignment_id)


@router.put("/assignments/{assignment_id}/papers/{student_id}")
async def update_student_paper(
    assignment_id: str,
    student_id: str,
    body: schemas.StudentPaperUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    assignment = await _call(service.owned_personalized_draft(teacher.id, assignment_id))
    items = [item.model_dump(exclude_none=True) for item in body.items] if body.items is not None else None
    await _call(service.personalized().update_paper(assignment, student_id, items=items, delivery=body.delivery))
    return await service.detail(teacher.id, assignment_id)


@router.get("/assignments/{assignment_id}/papers/{student_id}/alternatives")
async def student_paper_alternatives(
    assignment_id: str,
    student_id: str,
    question_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
):
    assignment = await _call(service.owned_personalized_draft(teacher.id, assignment_id))
    return await _call(service.personalized().alternatives(assignment, student_id, question_id))


@router.post("/assignments/{assignment_id}/publish")
async def publish_assignment(
    assignment_id: str,
    background: BackgroundTasks,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherAssignmentService = Depends(get_assignment_service),
    rubric_runner=Depends(get_rubric_runner),
):
    assignment = await _call(service.publish(teacher.id, assignment_id))
    await _queue_rubrics(service, assignment, background, rubric_runner)
    return await service.detail(teacher.id, assignment_id)


async def _queue_rubrics(service: TeacherAssignmentService, assignment, background: BackgroundTasks, rubric_runner):
    """Non-choice questions without a rubric get an AI draft, used for grading right away."""
    points = {
        question["id"]: float(item["points"])
        for item, question in await service.frozen_items(assignment)
        if not is_choice(question["question_type"])
    }
    queued = await RubricService(service.db).queue_missing(list(points))
    if queued:
        background.add_task(rubric_runner, [(question_id, points[question_id]) for question_id in queued])


# --- Collecting paper homework ---


def get_scan_recognizer() -> ScanRecognizer:
    return ModelScanRecognizer()


def get_scan_service(
    db: AsyncSession = Depends(get_db),
    recognizer: ScanRecognizer = Depends(get_scan_recognizer),
) -> TeacherScanService:
    return TeacherScanService(db, TeacherAiService(db, recognizer))


def get_paper_grader() -> PaperGrader:
    return ModelPaperGrader()


def get_scan_runner(recognizer: ScanRecognizer = Depends(get_scan_recognizer), grader: PaperGrader = Depends(get_paper_grader)):
    """Processes an uploaded batch after the response, in its own database session."""
    async def run(batch_id: str, auto_grade: bool = False) -> None:
        async with async_session() as db:
            await TeacherScanService(db, TeacherAiService(db, recognizer)).process(batch_id)
            if auto_grade:
                from app.services.teacher_scan_pipeline import pregrade_scan

                await pregrade_scan(db, batch_id, grader)
    return run


@router.post("/assignments/{assignment_id}/scans", status_code=202)
async def upload_scan(
    assignment_id: str,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    auto_grade: bool = Query(False),
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
    runner=Depends(get_scan_runner),
):
    data = await file.read()
    batch, created = await _call(service.upload(teacher.id, assignment_id, file.filename or "scan", data))
    if created:
        if auto_grade:
            background.add_task(runner, batch.id, True)
        else:
            background.add_task(runner, batch.id)
    return {"batch_id": batch.id, "created": created, "status": batch.status}


@router.get("/assignments/{assignment_id}/collection")
async def get_collection(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    return await _call(service.overview(teacher.id, assignment_id))


@router.get("/scan-batches/{batch_id}/pages")
async def scan_batch_pages(
    batch_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    return await _call(service.batch_pages(teacher.id, batch_id))


@router.delete("/scan-batches/{batch_id}", status_code=204)
async def delete_scan_batch(
    batch_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    await _call(service.delete_batch(teacher.id, batch_id))
    return Response(status_code=204)


@router.post("/scan-pages/{page_id}/assign", status_code=204)
async def assign_scan_page(
    page_id: str,
    body: schemas.ScanPageAssign,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    await _call(service.assign_page(teacher.id, page_id, body.student_id, replace=body.replace))
    return Response(status_code=204)


@router.post("/scan-pages/{page_id}/attach")
async def attach_scan_page(
    page_id: str,
    body: schemas.ScanPageAttach,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    """A continuation page whose first page went missing fills the student's missing answer areas."""
    return {"filled": await _call(service.attach_page(teacher.id, page_id, body.student_id))}


@router.post("/scan-batches/{batch_id}/retry", status_code=202)
async def retry_scan_batch(
    batch_id: str,
    background: BackgroundTasks,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
    runner=Depends(get_scan_runner),
):
    batch = await _call(service.retry_batch(teacher.id, batch_id))
    background.add_task(runner, batch.id)
    return {"batch_id": batch.id, "status": batch.status}


@router.post("/scan-pages/{page_id}/ignore", status_code=204)
async def ignore_scan_page(
    page_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    await _call(service.ignore_page(teacher.id, page_id))
    return Response(status_code=204)


@router.put("/submissions/{submission_id}/choices/{number}", status_code=204)
async def set_submission_choice(
    submission_id: str,
    number: int,
    body: schemas.ChoiceAnswerUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherScanService = Depends(get_scan_service),
):
    await _call(service.set_choice(teacher.id, submission_id, number, body.answer))
    return Response(status_code=204)


# Signed links let <img> tags load scan crops without the teacher's bearer token.
images_router = APIRouter(prefix="/api/teacher/scan-images", tags=["teacher-scans"])


@images_router.get("/{token}")
async def get_scan_image(token: str):
    path = resolve_signed_image(token)
    if not path:
        raise HTTPException(status_code=404, detail="图片不存在或链接已过期")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})


# --- Grading, review, release and report ---


def get_grading_service(
    db: AsyncSession = Depends(get_db),
    recognizer: ScanRecognizer = Depends(get_scan_recognizer),
    grader: PaperGrader = Depends(get_paper_grader),
) -> TeacherGradingService:
    return TeacherGradingService(db, TeacherAiService(db, recognizer), grader)


def get_grading_runner(grader: PaperGrader = Depends(get_paper_grader),
                       drafter: RubricDrafter = Depends(get_rubric_drafter)):
    """Runs AI pre-grading after the response, in its own database session; questions still without
    a rubric get one drafted first so the AI grades them by part."""
    async def run(run_id: str) -> None:
        async with async_session() as db:
            await TeacherGradingService(db, TeacherAiService(db), grader, rubric_drafter=drafter).process_run(run_id)
    return run


@router.post("/assignments/{assignment_id}/grading", status_code=202)
async def start_grading(
    assignment_id: str,
    background: BackgroundTasks,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
    runner=Depends(get_grading_runner),
):
    run = await _call(service.start_run(teacher.id, assignment_id))
    background.add_task(runner, run.id)
    return {"run_id": run.id, "total": run.total}


@router.put("/assignments/{assignment_id}/review/{number}/rubric")
async def save_question_rubric(
    assignment_id: str,
    number: int,
    body: schemas.RubricUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    """Correct and confirm a question's rubric: shared by every teacher from now on."""
    return await _call(service.save_rubric(teacher.id, assignment_id, number, [part.model_dump() for part in body.parts]))


@router.post("/assignments/{assignment_id}/review/{number}/rubric/draft", status_code=202)
async def redraft_question_rubric(
    assignment_id: str,
    number: int,
    background: BackgroundTasks,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
    rubric_runner=Depends(get_rubric_runner),
):
    """Ask AI for a fresh draft of this question's rubric (replacing the shared one once ready)."""
    assignment = await _call(service._assignment(teacher.id, assignment_id))
    questions, _ = await service._questions(assignment)
    question = questions.get(number)
    if question is None or is_choice(question["question_type"]):
        raise HTTPException(status_code=404, detail="这道题没有评分细则")
    rubrics = RubricService(service.db)
    existing = (await rubrics.for_questions([question["id"]])).get(question["id"])
    if existing and existing.status == "drafting":
        raise HTTPException(status_code=409, detail="正在起草中")
    if existing:
        existing.status = "drafting"
        await service.db.commit()
    else:
        await rubrics.queue_missing([question["id"]])
    background.add_task(rubric_runner, [(question["id"], float(question["points"]))])
    return {"status": "drafting"}


@router.get("/assignments/{assignment_id}/review")
async def get_review(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    return await _call(service.review_overview(teacher.id, assignment_id))


@router.get("/assignments/{assignment_id}/review/{number}")
async def get_review_question(
    assignment_id: str,
    number: int,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    return await _call(service.question_entries(teacher.id, assignment_id, number))


@router.post("/assignments/{assignment_id}/review/confirm-auto")
async def confirm_all_auto_passed(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    return {"confirmed": await _call(service.confirm_auto(teacher.id, assignment_id))}


@router.post("/assignments/{assignment_id}/review/{number}/confirm-auto")
async def confirm_auto_passed(
    assignment_id: str,
    number: int,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    return {"confirmed": await _call(service.confirm_auto(teacher.id, assignment_id, number))}


@router.put("/submission-items/{item_id}/grade", status_code=204)
async def grade_submission_item(
    item_id: int,
    body: schemas.ItemGradeUpdate,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    await _call(service.grade_item(
        teacher.id, item_id,
        part_scores=[part.model_dump() for part in body.part_scores] if body.part_scores is not None else None,
        score=body.score, error_type=body.error_type, comment=body.comment,
    ))
    return Response(status_code=204)


@router.post("/assignments/{assignment_id}/release", status_code=204)
async def release_results(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    await _call(service.release(teacher.id, assignment_id))
    return Response(status_code=204)


@router.get("/assignments/{assignment_id}/report")
async def get_report(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    return await _call(service.report(teacher.id, assignment_id))


@router.get("/assignments/{assignment_id}/report.csv")
async def download_report(
    assignment_id: str,
    teacher: Teacher = Depends(get_ready_teacher),
    service: TeacherGradingService = Depends(get_grading_service),
):
    title, text = await _call(service.report_csv(teacher.id, assignment_id))
    return Response(
        content=text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(title + '-成绩.csv')}",
                 "Cache-Control": "no-store"},
    )
