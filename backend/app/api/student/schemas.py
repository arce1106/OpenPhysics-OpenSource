from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class StudentLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=128)
    captcha_id: str | None = Field(default=None, max_length=64)
    captcha_answer: str | None = Field(default=None, max_length=16)


class StudentAuthCapabilitiesResponse(BaseModel):
    self_registration_enabled: bool
    sms_login_enabled: bool = False
    sms_password_reset_enabled: bool = False
    sms_phone_change_enabled: bool = False
    sms_phone_bind_enabled: bool = False
    # A class invitation code lets a new phone register even while open registration is off.
    invite_registration_enabled: bool = False
    login_captcha_after_failures: int = 3


class StudentPasswordChangeRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)
    captcha_id: str | None = Field(default=None, max_length=64)
    captcha_answer: str | None = Field(default=None, max_length=16)


class AccountCredentialsRequest(BaseModel):
    username: str | None = Field(default=None, max_length=128)
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str | None = Field(default=None, min_length=6, max_length=128)
    renew_session: bool = False


class AccountCredentialsSettings(BaseModel):
    username: str
    masked_phone: str | None
    has_password: bool
    username_change_limit: int
    username_change_window_days: int
    username_changes_remaining: int
    username_next_change_at: str | None


class StudentCaptchaResponse(BaseModel):
    challenge_id: str
    image_base64: str
    expires_in_seconds: int
    debug_answer: str | None = None


class ClassInvitationLookup(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class JoinedClass(BaseModel):
    id: str
    name: str
    teacher_name: str
    student_number: str | None = None


class StudentPublic(BaseModel):
    id: str
    username: str
    phone: str | None = None
    display_name: str
    class_name: str | None = None
    grade: str | None = None
    account_source: str = "admin"
    status: str
    last_login_at: str | None = None
    created_at: str | None = None


class StudentLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    student: StudentPublic
    # Set when the request carried a class invitation: the class joined, or why it was not.
    joined_class: JoinedClass | None = None
    class_join_error: str | None = None


class StudentWebLoginTicketResponse(BaseModel):
    ticket: str
    expires_at: str
    expires_in_seconds: int


class StudentWebLoginTicketExchangeRequest(BaseModel):
    ticket: str


class TopicPracticeContext(BaseModel):
    model_config = {"extra": "forbid"}
    catalog_code: Literal["gaokao_review"]
    node_id: str = Field(min_length=1, max_length=128)
    layer: Literal["diagnostic", "foundation", "breakthrough", "transfer", "paper"]


class SubmitAnswerRequest(BaseModel):
    topic_context: TopicPracticeContext | None = None
    teacher_paper_attempt_id: str | None = Field(default=None, max_length=80)
    question_id: str
    given_answer: str
    time_spent_ms: int = 0
    submission_id: str | None = Field(default=None, max_length=128)
    target_knowledge_point_id: str | None = Field(default=None, max_length=128)


class ManualCorrectionRequest(BaseModel):
    corrected_answer: str = Field(max_length=4000)
    is_correct: bool
    correction_reason: str = Field(default="", max_length=500)
    error_type: str | None = Field(default=None, max_length=64)


class SelfReviewItem(BaseModel):
    label: str
    status: str


class SelfReviewRequest(BaseModel):
    topic_context: TopicPracticeContext | None = None
    teacher_paper_attempt_id: str | None = Field(default=None, max_length=80)
    question_id: str
    items: list[SelfReviewItem]
    time_spent_ms: int = 0
    submission_id: str | None = Field(default=None, max_length=128)
    target_knowledge_point_id: str | None = Field(default=None, max_length=128)


class RenderedRichContentErrorSchema(BaseModel):
    type: str
    message: str
    latex: str | None = None
    position: int | None = None


class RenderedRichContentSchema(BaseModel):
    html: str = ""
    plain_text: str = ""
    renderer: str = "katex"
    renderer_version: str = ""
    content_hash: str = ""
    has_math: bool = False
    has_image: bool = False
    has_markdown_table: bool = False
    errors: list[RenderedRichContentErrorSchema] = []


class QuestionSolution(BaseModel):
    correct_answer: str
    explanation: str | None = None
    correct_answer_rendered: RenderedRichContentSchema | None = None
    explanation_rendered: RenderedRichContentSchema | None = None


class DetectedMisconception(BaseModel):
    id: str
    name: str


class MasteryUpdateValue(BaseModel):
    before: float
    after: float
    name: str = ""


class ProcessGrading(BaseModel):
    final_answer: str | None = None
    final_answer_rendered: RenderedRichContentSchema | None = None
    process_score: int | None = None
    process_score_percent: float | None = None
    model_correct: bool | None = None
    equation_correct: bool | None = None
    calculation_correct: bool | None = None
    unit_correct: bool | None = None
    error_type: str | None = None
    error_type_name: str | None = None
    first_error: str | None = None
    first_error_rendered: RenderedRichContentSchema | None = None
    next_action: str | None = None
    next_action_rendered: RenderedRichContentSchema | None = None
    feedback: str | None = None
    feedback_rendered: RenderedRichContentSchema | None = None
    answer_image_path: str | None = None
    answer_image_paths: list[str] | None = None
    answer_crop_image_path: str | None = None
    answer_page_image_path: str | None = None
    answer_page_image_paths: list[str] | None = None
    answer_source: str | None = None
    # Actual rubric points; process_score remains their percentage for older clients.
    score: float | None = None
    max_score: float | None = None
    process_evidence_kind: str | None = None
    process_evidence_image_path: str | None = None
    grading_confidence: float | None = None
    confidence_level: str | None = None
    needs_human_review: bool = False
    grading_basis: str | None = None
    grading_basis_rendered: RenderedRichContentSchema | None = None
    step_scores: list[dict] = []


class LessonVideoSummary(BaseModel):
    id: str
    title: str
    duration_seconds: int
    available: bool = False
    locked_reason: str | None = None


class SubmitAnswerResponse(BaseModel):
    given_answer: str | None = None
    lesson_video: LessonVideoSummary | None = None
    answer_id: int | None = None
    is_correct: bool
    correct_answer: str
    correct_answer_rendered: RenderedRichContentSchema | None = None
    explanation: str | None
    explanation_rendered: RenderedRichContentSchema | None = None
    mastery_update: dict[str, MasteryUpdateValue]
    detected_misconception: DetectedMisconception | None = None
    needs_intervention: bool = False
    ai_feedback: str | None = None
    ai_feedback_rendered: RenderedRichContentSchema | None = None
    extracted_answer: str | None = None
    extracted_answer_rendered: RenderedRichContentSchema | None = None
    process_grading: ProcessGrading | None = None
    xp_awarded: int | None = None
    unlocked_badges: list[dict] | None = None
    encouragement: str | None = None
    leveled_up: bool = False
    new_level: int = 0
    new_level_name: str = ""
    idempotent_replay: bool = False


class ProcessEvidenceResponse(BaseModel):
    answer_id: int
    question_id: str
    process_grading: ProcessGrading


class PaperBatchGradeResponse(BaseModel):
    results: dict[str, SubmitAnswerResponse]
    errors: dict[str, str] = {}
    solutions: dict[str, QuestionSolution] = {}


class SessionPhase(BaseModel):
    phase: str
    question_indices: list[int]


class SessionStructure(BaseModel):
    phases: list[SessionPhase]
    total: int


class PracticeProfileLabel(BaseModel):
    label_type: str
    label_id: str
    attempts: int
    wrong_count: float
    correct_count: float
    error_rate: float
    weight: float


class PracticeLearnerProfile(BaseModel):
    label_types: list[str]
    focus_labels: list[PracticeProfileLabel]
    weak_labels: dict[str, list[PracticeProfileLabel]]
    weak_label_weights: dict[str, dict[str, float]] = {}
    recent_answer_count: int


class TeacherPaperResponse(BaseModel):
    attempt_id: str | None = None
    status: str = "not_started"
    submitted_at: str | None = None
    completed_at: str | None = None
    id: str
    title: str
    question_count: int
    has_video: bool = False
    attempt_token: str | None = None
    # Teacher homework once finished, as in TeacherHomeworkSummary.
    score: float | None = None
    max_score: float | None = None
    score_percent: int | None = None
    results_released: bool = False


class QuestionLessonVideoRequest(BaseModel):
    answer_id: int


class TeacherHomeworkSummary(BaseModel):
    attempt_id: str
    assignment_id: str
    title: str
    class_name: str
    question_count: int
    graded_count: int
    # in_progress: answering; grading: submitted, answers being graded; completed: done.
    status: str
    published_at: str | None = None
    # paper: a scanned paper the teacher has graded, shown here with its results; app: answered in the app.
    delivery: str = "app"
    # Finished work only: points on the teacher's scale and out of 100. Until results_released
    # the score is the app's own grading, which the teacher's review may still change.
    score: float | None = None
    max_score: float | None = None
    score_percent: int | None = None
    results_released: bool = False


class PracticeSessionResponse(BaseModel):
    answers: dict[str, SubmitAnswerResponse] = Field(default_factory=dict)
    student_id: str
    session_type: str
    strategy: str
    session_objective: str
    session_structure: SessionStructure
    learner_profile: PracticeLearnerProfile | None = None
    questions: list[dict]
    teacher_paper: TeacherPaperResponse | None = None


class NextPracticeQuestionRequest(BaseModel):
    target_kp: str | None = None
    recent_question_ids: list[str] = []
    recent_question_types: list[str] = []


class NextPracticeQuestionResponse(BaseModel):
    question: dict | None = None
    session_complete: bool = False


class TutorHintRequest(BaseModel):
    question_id: str
    given_answer: str
    hint_type: str = "hint"  # "hint" | "socratic" | "scaffold"
    process_grading: dict | None = None


class TutorHintResponse(BaseModel):
    hint_type: str
    text: str
    text_rendered: RenderedRichContentSchema | None = None


# ── Dashboard ──────────────────────────────────────────────────────────────────


class WeakPoint(BaseModel):
    kp_id: str
    kp_name: str
    mastery: float


class DiagnosisSummary(BaseModel):
    overall_mastery: float
    mastered_count: int
    in_progress_count: int
    locked_count: int
    weak_points: list[WeakPoint]


class PlanRecommendation(BaseModel):
    kp_id: str
    kp_name: str
    mastery: float
    reason: str
    estimated_questions: int
    estimated_minutes: int


class MotivationPanel(BaseModel):
    streak_days: int
    weekly_kps_mastered: int
    mistake_backlog_count: int
    next_milestone: str | None = None


class DashboardResponse(BaseModel):
    diagnosis: DiagnosisSummary
    plan: PlanRecommendation | None = None
    motivation: MotivationPanel
    knowledge_map: list[dict]


# ── Train ──────────────────────────────────────────────────────────────────────


class RecommendedKp(BaseModel):
    kp_id: str
    kp_name: str
    mastery: float
    reason: str


class TrainStartResponse(BaseModel):
    is_first_time: bool
    has_diagnosed: bool
    recommended_kps: list[RecommendedKp]


class DiagnoseRequest(BaseModel):
    count: int = 8


class DiagnoseResponse(BaseModel):
    session_type: str = "diagnostic"
    strategy: str
    session_objective: str
    questions: list[dict]


# ── Review ─────────────────────────────────────────────────────────────────────


class ReviewMistake(BaseModel):
    lesson_video: LessonVideoSummary | None = None
    answer_id: int
    question_id: str
    stem_text: str
    stem_rendered: RenderedRichContentSchema | None = None
    question_type: str | None = None
    options: list[dict] = []
    images: list[dict] = []
    given_answer: str | None
    given_answer_rendered: RenderedRichContentSchema | None = None
    correct_answer: str | None
    correct_answer_rendered: RenderedRichContentSchema | None = None
    explanation: str | None
    explanation_rendered: RenderedRichContentSchema | None = None
    misconception: DetectedMisconception | None = None
    process_grading: ProcessGrading | None = None
    created_at: str


class ReviewErrorGroup(BaseModel):
    error_type: str
    error_name: str
    count: int
    kp_names: list[str]
    sample_answer_id: int | None = None
    sample_question_id: str | None = None
    first_error: str = ""
    next_action: str = ""


class ReviewStep(BaseModel):
    title: str
    description: str


class ReviewCenter(BaseModel):
    total_pending: int
    primary_focus: ReviewErrorGroup | None = None
    error_groups: list[ReviewErrorGroup] = []
    review_steps: list[ReviewStep] = []
    stage_counts: dict[str, int] = {}


class ReviewResponse(BaseModel):
    groups: list[dict]
    clearance_progress: dict  # {reviewed, total}
    review_center: ReviewCenter | None = None


class RetryResponse(BaseModel):
    question: dict | None = None


class VariationQuestion(BaseModel):
    variation_type: str
    title: str
    reason: str
    question: dict


class VariationResponse(BaseModel):
    variations: list[VariationQuestion]


class ReviewRetrySubmitRequest(SubmitAnswerRequest):
    pass


class ReviewRetrySubmitResponse(SubmitAnswerResponse):
    cleared: bool = False


class CompleteReviewRequest(BaseModel):
    retry_answer_id: int | None = None


# ── Learn ──────────────────────────────────────────────────────────────────────


class LearnContentSection(BaseModel):
    type: str
    title: str
    content: dict
    content_rendered: RenderedRichContentSchema | None = None


class KnowledgeCard(BaseModel):
    content_id: str
    kp_id: str
    kp_name: str
    title: str
    sections: list[LearnContentSection]
    source: str
    consumed: bool = False


class SlideBlock(BaseModel):
    type: str
    content: dict
    content_rendered: RenderedRichContentSchema | None = None


class SlideItem(BaseModel):
    type: str
    title: str
    subtitle: str | None = None
    blocks: list[SlideBlock]
    layout: str = "content"


class SlideDeck(BaseModel):
    content_id: str
    kp_id: str
    title: str
    slides: list[SlideItem]
    total: int
    consumed: bool = False


class SimulationContent(BaseModel):
    content_id: str
    kp_id: str
    kp_name: str
    title: str
    config: dict
    html: str
    consumed: bool = False


class VideoRecommendation(BaseModel):
    id: str
    title: str
    url: str
    uploader: str | None = None
    duration: str | None = None
    cover_url: str | None = None
    source: str
    category: str | None = None
    play_count: str | int | None = None
    reason: str
    match_focus: str


class VideoRecommendationResponse(BaseModel):
    kp_id: str
    kp_name: str
    query: str
    items: list[VideoRecommendation]
    experiment: VideoRecommendation | None = None
    experiments: list[VideoRecommendation] = []
    fallback: bool = False


class PhysicsSimulationResponse(BaseModel):
    kp_id: str
    kp_name: str
    simulation: dict | None = None


class LearnBundleResponse(BaseModel):
    kp_id: str
    kp_name: str
    card: KnowledgeCard | None = None
    slides: SlideDeck | None = None
    simulations: list[SimulationContent] = []
    examples: list[dict] = []
    progress: dict = {}


class ChatMessage(BaseModel):
    role: str
    content: str


class LearnChatRequest(BaseModel):
    kp_id: str
    message: str
    history: list[ChatMessage] = []


class QuestionTutorChatRequest(BaseModel):
    question_id: str
    given_answer: str = ""
    message: str
    history: list[ChatMessage] = []
    process_grading: dict | None = None


class QuestionTutorChatResponse(BaseModel):
    text: str
    text_rendered: RenderedRichContentSchema | None = None


class LearnCompleteRequest(BaseModel):
    kp_id: str
    content_id: str
    content_type: str
    time_spent_seconds: int = 0


class LearnCompleteResponse(BaseModel):
    success: bool
    mastery_update: dict[str, MasteryUpdateValue]


# ── Directory ──────────────────────────────────────────────────────────────────


class DirectoryKpNode(BaseModel):
    id: str
    name: str
    volume: str | None = None
    chapter: str | None = None
    section: str | None = None
    mastery: float
    status: str  # mastered | current | needs_learning | locked | upcoming
    learning_state: str = "locked"  # mastered | learning | to_learn | practice | locked
    learning_state_label: str = "未开始"
    learning_state_tone: str = "locked"  # mastered | learning | practice | locked
    blocked_by: list[str]
    last_practiced: str | None = None
    content_available: bool = True
    practice_available: bool = True


class DirectoryStats(BaseModel):
    mastered: int
    in_progress: int
    locked: int
    total: int
    learning: int = 0
    to_learn: int = 0
    practice: int = 0
    pending_content: int = 0


class DirectoryRelation(BaseModel):
    id: int
    source_id: str
    target_id: str
    relation_type: str
    reason: str | None = None


class DirectoryResponse(BaseModel):
    kps: list[DirectoryKpNode]
    stats: DirectoryStats
    relations: list[DirectoryRelation]


# ── Reusable learning catalogs ────────────────────────────────────────────────


class LearningCatalogMappingSummary(BaseModel):
    knowledge_point_count: int = 0
    label_rule_count: int = 0
    question_override_count: int = 0


class LearningCatalogNodeResponse(BaseModel):
    id: str
    code: str
    node_type: str
    title: str
    description: str | None = None
    sort_order: int
    config: dict = Field(default_factory=dict)
    mapping_summary: LearningCatalogMappingSummary
    children: list["LearningCatalogNodeResponse"] = Field(default_factory=list)


class LearningCatalogResponse(BaseModel):
    id: str
    code: str
    name: str
    description: str | None = None
    version: int
    enabled: bool
    sort_order: int
    config: dict = Field(default_factory=dict)
    node_count: int
    topic_count: int
    nodes: list[LearningCatalogNodeResponse]


class LearningCatalogResumeResponse(BaseModel):
    catalog_code: str
    node_id: str | None = None
    last_practiced: str | None = None


class LearningCatalogTopicOverviewResponse(BaseModel):
    catalog_code: str
    node_id: str
    topic_code: str
    title: str
    description: str | None = None
    status: str
    status_label: str
    recommended_layer: str
    recommended_layer_name: str
    next_action: str
    core_knowledge_point_count: int
    attempted_knowledge_point_count: int
    mastered_knowledge_point_count: int
    needs_review_knowledge_point_count: int
    average_mastery: float
    performance_score: float | None = None
    evidence_count: int = 0
    untested_knowledge_point_count: int = 0
    coverage_ratio: float = 0.0
    layer_performance: list[dict] = Field(default_factory=list)
    last_practiced: str | None = None
    teacher_papers: list[TeacherPaperResponse] = Field(default_factory=list)


class LearningCatalogTopicSessionRequest(BaseModel):
    layer: Literal[
        "diagnostic",
        "foundation",
        "breakthrough",
        "transfer",
        "paper",
    ]
    question_count: int = Field(default=5, ge=1, le=10)


class LearningCatalogTopicEvidenceRequest(BaseModel):
    answer_id: int = Field(gt=0)
    layer: Literal[
        "diagnostic",
        "foundation",
        "breakthrough",
        "transfer",
        "paper",
    ]


class ModelGraphNode(BaseModel):
    id: str
    name: str
    domain: str
    layer: str
    description: str
    core_equations: list[str] = []
    typical_errors: list[str] = []
    kp_ids: list[str] = []
    kp_names: list[str] = []
    question_count: int = 0
    mastery: float = 0.0
    weakness: float = 0.0
    status: str


class ModelGraphRelation(BaseModel):
    id: int
    source_id: str
    target_id: str
    relation_type: str
    reason: str | None = None


class ModelGraphResponse(BaseModel):
    nodes: list[ModelGraphNode]
    relations: list[ModelGraphRelation]
    summary: dict


# ── Per-KP Diagnostic ──────────────────────────────────────────────────────────


class KpDiagnoseRequest(BaseModel):
    question_count: int = 3


class DiagnosticAnswer(BaseModel):
    question_id: str
    given_answer: str
    time_spent_ms: int = 0
    target_knowledge_point_id: str | None = Field(default=None, max_length=128)


class KpDiagnosticFeedbackRequest(BaseModel):
    answers: list[DiagnosticAnswer]


class SubmittedDiagnosticAnswer(BaseModel):
    answer_id: int
    mastery_update: dict[str, MasteryUpdateValue] = {}


class SubmittedKpDiagnosticFeedbackRequest(BaseModel):
    answers: list[SubmittedDiagnosticAnswer]


class KpDiagnosticResult(BaseModel):
    kp_id: str
    kp_name: str
    correct_count: int
    total_count: int
    mastery_before: float
    mastery_after: float
    recommendation: str  # "study" | "practice" | "mastered"
    feedback: str


# ── Scope Diagnostic ──────────────────────────────────────────────────────────


class ScopeDiagnoseRequest(BaseModel):
    scope_type: str  # "chapter" | "section"
    scope_id: str
    question_count: int = 6


class ScopeDiagnosticFeedbackRequest(BaseModel):
    scope_type: str
    scope_id: str
    answers: list[DiagnosticAnswer]


class SubmittedScopeDiagnosticFeedbackRequest(BaseModel):
    scope_type: str
    scope_id: str
    answers: list[SubmittedDiagnosticAnswer]


class ScopeKpResult(BaseModel):
    kp_id: str
    kp_name: str
    correct_count: int
    total_count: int
    mastery_before: float
    mastery_after: float


class ScopeDiagnosticResult(BaseModel):
    diagnostic_attempt_id: str | None = None
    scope_type: str
    scope_id: str
    scope_name: str
    kp_results: list[ScopeKpResult]
    correct_count: int
    total_count: int
    weak_kp_ids: list[str]
    recommendation: str  # "study" | "practice" | "mastered"
    feedback: str


class ScopeDiagnosticAttemptKpResultResponse(BaseModel):
    id: str
    kp_id: str
    kp_name: str
    group_id: str | None = None
    group_name: str | None = None
    correct_count: int
    total_count: int
    mastery_before: float
    mastery_after: float
    is_weak: bool


class ScopeDiagnosticAttemptListItem(BaseModel):
    attempt_id: str
    scope_type: str
    scope_id: str
    scope_name: str
    diagnostic_type: str
    created_at: datetime
    submitted_at: datetime
    correct_count: int
    total_count: int
    weak_count: int
    recommendation: str | None = None
    feedback: str | None = None
    linked_plan_id: str | None = None
    linked_plan_status: str | None = None
    linked_report_available: bool = False


class ScopeDiagnosticAttemptListResponse(BaseModel):
    items: list[ScopeDiagnosticAttemptListItem]
    total: int
    limit: int
    offset: int


class ScopeDiagnosticAttemptDetailResponse(BaseModel):
    attempt_id: str
    student_id: str
    scope_type: str
    scope_id: str
    scope_name: str
    diagnostic_type: str
    status: str
    created_at: datetime
    submitted_at: datetime
    question_ids: list[str]
    answer_ids: list[int | str]
    result: dict | None = None
    correct_count: int
    total_count: int
    weak_count: int
    weak_kp_ids: list[str]
    recommendation: str | None = None
    feedback: str | None = None
    kp_results: list[ScopeDiagnosticAttemptKpResultResponse]
    linked_plan_id: str | None = None
    linked_plan_status: str | None = None
    linked_report_available: bool = False


# ── Improvement Plan ─────────────────────────────────────────────────────────


class ImprovementTaskResponse(BaseModel):
    id: str
    plan_id: str
    student_id: str
    kp_id: str
    kp_name: str
    group_id: str | None = None
    group_name: str | None = None
    correct_count: int
    total_count: int
    mastery_before: float
    mastery_after: float
    is_weak: bool
    priority: int
    status: str
    recommended_action: str
    reason: str
    started_at: datetime | None = None
    practiced_at: datetime | None = None
    passed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ImprovementPlanResponse(BaseModel):
    id: str
    student_id: str
    diagnostic_attempt_id: str | None = None
    scope_type: str
    scope_id: str
    scope_name: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None
    correct_count: int
    total_count: int
    weak_count: int
    status: str
    current_task_id: str | None = None
    source_result: dict | None = None
    tasks: list[ImprovementTaskResponse] = Field(default_factory=list)


class CreateImprovementPlanFromScopeRequest(BaseModel):
    diagnostic_result: ScopeDiagnosticResult


class UpdateImprovementTaskStatusRequest(BaseModel):
    status: str


class MoveToNextImprovementTaskRequest(BaseModel):
    mark_in_progress: bool = True


class ImprovementRetestStartRequest(BaseModel):
    question_count_per_task: int = 1
    max_questions: int = 10


class ImprovementRetestSessionResponse(BaseModel):
    attempt_id: str
    plan: ImprovementPlanResponse
    session: PracticeSessionResponse


class ImprovementRetestTaskResult(BaseModel):
    task_id: str
    kp_id: str
    kp_name: str
    correct_count: int
    total_count: int
    mastery_before: float | None = None
    mastery_after: float | None = None
    passed: bool
    next_status: str
    feedback: str


class ImprovementRetestSubmittedFeedbackRequest(BaseModel):
    answers: list[SubmittedDiagnosticAnswer]


class ImprovementRetestResultResponse(BaseModel):
    attempt_id: str
    plan: ImprovementPlanResponse
    correct_count: int
    total_count: int
    passed_count: int
    needs_retest_count: int
    task_results: list[ImprovementRetestTaskResult]


class ImprovementReportTaskItem(BaseModel):
    task_id: str
    kp_id: str
    kp_name: str
    group_id: str | None = None
    group_name: str | None = None
    priority: int
    status: str
    recommended_action: str
    reason: str
    diagnostic_correct_count: int
    diagnostic_total_count: int
    mastery_before: float
    mastery_after_diagnostic: float
    latest_retest_correct_count: int | None = None
    latest_retest_total_count: int | None = None
    latest_retest_mastery_before: float | None = None
    latest_retest_mastery_after: float | None = None
    latest_retest_passed: bool | None = None
    final_label: str


class ImprovementReportRetestAttempt(BaseModel):
    attempt_id: str
    status: str
    correct_count: int
    total_count: int
    passed_count: int
    needs_retest_count: int
    created_at: datetime | None = None
    submitted_at: datetime | None = None


class ImprovementReportSummary(BaseModel):
    plan_id: str
    scope_type: str
    scope_id: str
    scope_name: str
    plan_status: str
    created_at: datetime | None = None
    completed_at: datetime | None = None
    diagnostic_correct_count: int
    diagnostic_total_count: int
    diagnostic_accuracy: float
    task_count: int
    weak_task_count: int
    passed_task_count: int
    needs_retest_task_count: int
    practiced_task_count: int
    pending_task_count: int
    retest_attempt_count: int
    latest_retest_accuracy: float | None = None
    completed: bool


class ImprovementReportResponse(BaseModel):
    summary: ImprovementReportSummary
    diagnostic_result: dict | None = None
    tasks: list[ImprovementReportTaskItem]
    retest_attempts: list[ImprovementReportRetestAttempt]
    strengths: list[str]
    remaining_weaknesses: list[str]
    next_actions: list[str]


class ImprovementReportListItem(BaseModel):
    plan_id: str
    scope_type: str
    scope_id: str
    scope_name: str
    created_at: datetime | None = None
    completed_at: datetime | None = None
    diagnostic_correct_count: int
    diagnostic_total_count: int
    diagnostic_accuracy: float
    task_count: int
    passed_task_count: int
    needs_retest_task_count: int
    latest_retest_accuracy: float | None = None
    summary_label: str
    highlight: str


class ImprovementReportListResponse(BaseModel):
    items: list[ImprovementReportListItem]
    total: int
    limit: int
    offset: int


# ── Learning Trace ───────────────────────────────────────────────────────────


class LearningTraceEventResponse(BaseModel):
    id: str
    event_type: str
    event_time: datetime
    student_id: str
    scope_type: str | None = None
    scope_id: str | None = None
    scope_name: str | None = None
    title: str
    description: str
    attempt_id: str | None = None
    plan_id: str | None = None
    task_id: str | None = None
    retest_attempt_id: str | None = None
    kp_id: str | None = None
    kp_name: str | None = None
    status_label: str | None = None
    primary_action: str | None = None
    report_available: bool = False
    metadata: dict[str, object] = Field(default_factory=dict)


class LearningTraceResponse(BaseModel):
    items: list[LearningTraceEventResponse]
    total: int
    limit: int
    offset: int


# ── Knowledge Mastery Judgment ───────────────────────────────────────────────


class KnowledgeMasteryEvidence(BaseModel):
    source: str
    label: str
    occurred_at: datetime | None = None
    strength: str | None = None
    description: str
    ref_id: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class KnowledgeMasteryJudgmentResponse(BaseModel):
    kp_id: str
    kp_name: str
    mastery_score: float
    mastery_level: str
    intervention_status: str
    confidence: str
    next_action: str
    reason: str
    evidence_sources: list[str]
    evidences: list[KnowledgeMasteryEvidence]
    last_answered_at: datetime | None = None
    last_diagnostic_at: datetime | None = None
    last_retest_at: datetime | None = None
    recent_correct_count: int = 0
    recent_total_count: int = 0
    recent_correct_rate: float | None = None
    latest_diagnostic_attempt_id: str | None = None
    latest_diagnostic_correct_count: int | None = None
    latest_diagnostic_total_count: int | None = None
    latest_diagnostic_is_weak: bool | None = None
    active_plan_id: str | None = None
    active_task_id: str | None = None
    active_task_status: str | None = None
    latest_retest_attempt_id: str | None = None
    latest_retest_passed: bool | None = None
    updated_at: datetime | None = None


class KnowledgeMasteryJudgmentBatchRequest(BaseModel):
    kp_ids: list[str]


class KnowledgeMasteryJudgmentBatchResponse(BaseModel):
    items: list[KnowledgeMasteryJudgmentResponse]


class ScopeKnowledgeMasteryJudgmentResponse(BaseModel):
    scope_type: str
    scope_id: str
    scope_name: str
    items: list[KnowledgeMasteryJudgmentResponse]
