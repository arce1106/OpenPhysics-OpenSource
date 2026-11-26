
from pydantic import BaseModel, Field


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class AdminMeResponse(BaseModel):
    username: str


class KnowledgePointCreate(BaseModel):
    id: str
    name: str
    volume: str | None = None
    chapter: str | None = None
    section: str | None = None
    description: str | None = None
    difficulty: float = 0.0


class KnowledgePointUpdate(BaseModel):
    name: str | None = None
    volume: str | None = None
    chapter: str | None = None
    section: str | None = None
    description: str | None = None
    difficulty: float | None = None


class RelationCreate(BaseModel):
    source_id: str
    target_id: str
    relation_type: str
    reason: str | None = None


class QuestionOptionItem(BaseModel):
    label: str
    text: str
    is_correct: bool = False
    targets_misconception: str | None = None


class QuestionLabelItem(BaseModel):
    label_type: str
    label_id: str
    role: str = "主要"
    confidence: float | None = None
    source: str = "ai"


class QuestionFormulaItem(BaseModel):
    id: str
    latex: str
    formula_role: str | None = None
    knowledge_point_id: str | None = None
    variables: dict | None = None
    confidence: float | None = None


class QuestionImageItem(BaseModel):
    id: str
    image_path: str
    image_type: str | None = None
    description: str | None = None
    extracted_structure: dict | None = None
    related_knowledge_points: dict | None = None
    confidence: float | None = None


class QuestionCreate(BaseModel):
    id: str
    stem_text: str
    answer: str | None = None
    explanation: str | None = None
    question_type: str | None = None
    difficulty: float | None = None
    difficulty_tier: str | None = None  # easy, moderate_easy, medium, moderate_hard, hard
    source: str = "human"
    options: list[QuestionOptionItem] = []
    labels: list[QuestionLabelItem] = []
    formulas: list[QuestionFormulaItem] = []
    images: list[QuestionImageItem] = []


class QuestionReview(BaseModel):
    status: str  # approved, pending_review, calibrating, retired


class QuestionVideoReview(BaseModel):
    status: str = Field(pattern="^(approved|draft)$")


class GenerateQuestionsRequest(BaseModel):
    knowledge_point_ids: list[str]
    difficulty: int = 3
    question_type: str = "problem_solving"
    count: int = 3
    physics_models: list[str] | None = None


class LabelQuestionRequest(BaseModel):
    question_id: str


class DiagnoseRequest(BaseModel):
    student_id: str


class BatchImportRequest(BaseModel):
    questions: list[dict]
    image_dir: str | None = None


class BatchImportResponse(BaseModel):
    total: int
    created: int
    updated: int
    errors: list[dict]


class LabelUpdateRequest(BaseModel):
    labels: list[QuestionLabelItem]


class ImageUpdateRequest(BaseModel):
    image_type: str | None = None
    description: str | None = None
    extracted_structure: dict | None = None


class BatchReviewRequest(BaseModel):
    question_ids: list[str]
    status: str  # approved, pending_review, draft, retired


class LearningVideoCurationCreate(BaseModel):
    knowledge_point_id: str
    video_type: str = "lecture"
    title: str
    url: str
    uploader: str | None = None
    duration: str | None = None
    cover_url: str | None = None
    reason: str | None = None
    match_focus: str | None = None
    priority: int = 100
    enabled: bool = True


class LearningVideoCurationUpdate(BaseModel):
    video_type: str | None = None
    title: str | None = None
    url: str | None = None
    uploader: str | None = None
    duration: str | None = None
    cover_url: str | None = None
    reason: str | None = None
    match_focus: str | None = None
    priority: int | None = None
    enabled: bool | None = None


class StudentCreateRequest(BaseModel):
    username: str
    # Same length rule as students choosing their own password (6-128 characters).
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None
    class_name: str | None = None
    status: str = "active"


class StudentUpdateRequest(BaseModel):
    display_name: str | None = None
    class_name: str | None = None
    status: str | None = None


class StudentPasswordResetRequest(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class StudentAccountResetRequest(BaseModel):
    confirm: str
