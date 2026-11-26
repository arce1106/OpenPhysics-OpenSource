from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ClassLevel = Literal["advanced", "standard", "foundation"]


class TeacherLoginRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class TeacherProfile(BaseModel):
    id: str
    username: str
    display_name: str
    must_change_password: bool


class TeacherLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    teacher: TeacherProfile


class TeacherPasswordChangeRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class TeacherClassSummary(BaseModel):
    id: str
    name: str
    grade: str | None
    level: ClassLevel
    archived: bool
    member_count: int


class ClassMember(BaseModel):
    id: str
    # Shown masked when it is a phone number: teachers know students by name and number.
    username: str
    display_name: str
    status: str
    last_login_at: datetime | None
    student_number: str | None = None
    teacher_ai_authorized: bool = False
    # invitation: joined with the class code (name bound, sharing notice shown);
    # admin: placed by the administrator on a school or guardian authorization; None: older rows.
    joined_via: str | None = None
    joined_at: datetime | None = None
    # The student declined AI processing in the iOS app: App-delivered written answers cannot be submitted there.
    app_ai_declined: bool = False


class MemberNumberUpdate(BaseModel):
    student_number: str | None = Field(default=None, max_length=8)


class TeacherClassDetail(TeacherClassSummary):
    members: list[ClassMember]


BoxSize = Literal["small", "medium", "large"]


class AssignmentCreate(BaseModel):
    title: str = Field(max_length=120)


class AssignmentItemInput(BaseModel):
    question_id: str = Field(max_length=64)
    points: float | None = None
    box: BoxSize | None = None
    # A teacher-adjusted answer area height; overrides the box preset when set.
    area_mm: int | None = None
    # Presentation only; frozen together with the paper, never grading rules.
    print_layout: dict | None = None


class ScopeEntry(BaseModel):
    volume: str | None = Field(default=None, max_length=64)
    chapter: str | None = Field(default=None, max_length=128)
    section: str | None = Field(default=None, max_length=128)
    kp_id: str | None = Field(default=None, max_length=64)


class PersonalizedCreate(BaseModel):
    delivery: Literal["app", "paper"] | None = None
    title: str = Field(max_length=120)
    scope: list[ScopeEntry] = Field(min_length=1, max_length=60)
    choice_count: int = Field(default=4, ge=0, le=20)
    area_count: int = Field(default=2, ge=0, le=20)
    experiment_count: int | None = Field(default=None, ge=0, le=20)
    calculation_count: int | None = Field(default=None, ge=0, le=20)


class PersonalizedLibraryCreate(PersonalizedCreate):
    """Settings kept in the teacher's library, drafted at once for each chosen class."""
    class_ids: list[str] = Field(min_length=1, max_length=20)
    # Omitted classes use the whole class; an explicit list must contain at least one member.
    student_ids_by_class: dict[str, list[str]] | None = Field(default=None, max_length=20)


class AssignToClasses(BaseModel):
    delivery: Literal["app", "paper"] | None = None
    class_ids: list[str] = Field(min_length=1, max_length=20)
    student_ids_by_class: dict[str, list[str]] | None = Field(default=None, max_length=20)


class StudentPaperUpdate(BaseModel):
    items: list[AssignmentItemInput] | None = Field(default=None, max_length=40)
    delivery: str | None = Field(default=None, max_length=8)


class AssignmentUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    items: list[AssignmentItemInput] | None = Field(default=None, max_length=60)


class AssignmentSummary(BaseModel):
    id: str
    class_id: str | None
    source_id: str | None = None
    title: str
    kind: str
    status: str
    question_count: int
    total_points: float | None = None
    created_at: datetime | None
    published_at: datetime | None
    results_released_at: datetime | None = None


class ScanPageAssign(BaseModel):
    student_id: str = Field(max_length=64)
    # A copy for a student who already has one replaces it only when the teacher says so.
    replace: bool = False


class ScanPageAttach(BaseModel):
    student_id: str = Field(max_length=64)


class DeliveryUpdate(BaseModel):
    delivery: str = Field(max_length=8)


class ChoiceAnswerUpdate(BaseModel):
    answer: str = Field(max_length=8)


class PartScoreInput(BaseModel):
    label: str = Field(max_length=20)
    score: float


class RubricPartInput(BaseModel):
    label: str = Field(max_length=20)
    points: float
    criteria: list[str] = Field(max_length=8)


class RubricUpdate(BaseModel):
    parts: list[RubricPartInput] = Field(min_length=1, max_length=8)


class ItemGradeUpdate(BaseModel):
    part_scores: list[PartScoreInput] | None = Field(default=None, max_length=8)
    score: float | None = None
    error_type: str | None = Field(default=None, max_length=40)
    comment: str | None = Field(default=None, max_length=300)
