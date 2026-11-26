// ── Shared ─────────────────────────────────────────────────────────────────────

export interface QuestionOption {
  label: string;
  text: string;
  rendered?: RenderedRichContent | null;
  text_rendered?: RenderedRichContent | null;
}

export interface RenderedRichContent {
  html: string;
  renderer?: string | null;
  renderer_version?: string | null;
  content_hash?: string | null;
  has_math?: boolean | null;
  has_image?: boolean | null;
  has_markdown_table?: boolean | null;
  errors?: Array<Record<string, unknown>> | null;
}

export interface QuestionImage {
  id: string;
  image_path: string;
  image_type: string | null;
  description: string | null;
  extracted_structure?: Record<string, unknown> | null;
}

export interface TopicPracticeContext {
  catalog_code: 'gaokao_review';
  node_id: string;
  layer: LearningCatalogTopicLayer;
}

export interface Question {
  topic_context?: TopicPracticeContext;
  lesson_video?: QuestionLessonVideo | null;
  id: string;
  stem_text: string;
  question_type?: string;
  answer?: string | null;
  correct_answer?: string | null;
  explanation?: string | null;
  difficulty?: number;
  difficulty_tier?: string | null;
  knowledge_point_ids?: string[];
  target_knowledge_point_id?: string | null;
  physics_model?: string | null;
  ability_dimension?: string | null;
  question_structure?: string | null;
  solution_strategy?: string | null;
  labels_by_type?: Record<string, string[]>;
  session_phase?: string | null;
  options: QuestionOption[];
  images?: QuestionImage[];
  answer_image_paths?: string[];
  given_answer?: string | null;
  stem_rendered?: RenderedRichContent | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
}

export interface AccountCredentialsSettings {
  username: string;
  masked_phone: string | null;
  has_password: boolean;
  username_change_limit: number;
  username_change_window_days: number;
  username_changes_remaining: number;
  username_next_change_at: string | null;
}

export interface StudentProfile {
  id: string;
  username: string;
  phone?: string | null;
  display_name: string;
  class_name?: string | null;
  grade?: string | null;
  account_source?: string;
  status: string;
  last_login_at?: string | null;
  created_at?: string | null;
}


export interface StudentLoginResponse {
  access_token: string;
  token_type: string;
  student: StudentProfile;
  /** Set when sign-in carried a class invitation: the class joined, or why it was not. */
  joined_class?: { id: string; name: string; teacher_name: string; student_number: string | null } | null;
  class_join_error?: string | null;
}

/** A teacher's class invitation as shown before signing in or registering. */
export interface ClassInvitationLookup {
  id: string; name: string; grade: string | null; teacher_name: string;
  disclosure: string; disclosure_version: string;
}


export interface StudentCaptchaResponse {
  challenge_id: string;
  image_base64: string;
  expires_in_seconds: number;
  debug_answer?: string | null;
}


// ── Dashboard ──────────────────────────────────────────────────────────────────

export interface WeakPoint {
  kp_id: string;
  kp_name: string;
  mastery: number;
}

export interface DiagnosisSummary {
  overall_mastery: number;
  mastered_count: number;
  in_progress_count: number;
  locked_count: number;
  weak_points: WeakPoint[];
}

export interface PlanRecommendation {
  kp_id: string;
  kp_name: string;
  mastery: number;
  reason: string;
  estimated_questions: number;
  estimated_minutes: number;
}

export interface MotivationPanel {
  streak_days: number;
  weekly_kps_mastered: number;
  mistake_backlog_count: number;
  next_milestone: string | null;
}

export interface KpMapNode {
  kp_id: string;
  kp_name: string;
  chapter: string;
  section: string;
  status: 'mastered' | 'current' | 'needs_learning' | 'locked' | 'upcoming';
  mastery: number;
  blocked_by: string[];
}

export interface DashboardData {
  diagnosis: DiagnosisSummary;
  plan: PlanRecommendation | null;
  motivation: MotivationPanel;
  knowledge_map: KpMapNode[];
}

// ── Train ──────────────────────────────────────────────────────────────────────

export interface RecommendedKp {
  kp_id: string;
  kp_name: string;
  mastery: number;
  reason: string;
}

export interface TrainStartData {
  is_first_time: boolean;
  has_diagnosed: boolean;
  recommended_kps: RecommendedKp[];
}

// ── Practice ───────────────────────────────────────────────────────────────────

export interface PracticeSession {
  answers?: Record<string, SubmitResult>;
  teacher_paper?: TeacherPaper | null;
  student_id: string;
  session_type: string;
  strategy: string;
  session_objective: string;
  session_structure: {
    phases: { phase: string; question_indices: number[] }[];
    total: number;
  };
  learner_profile?: {
    label_types: string[];
    focus_labels: PracticeProfileLabel[];
    weak_labels: Record<string, PracticeProfileLabel[]>;
    weak_label_weights?: Record<string, Record<string, number>>;
    recent_answer_count: number;
  } | null;
  questions: Question[];
}

export interface PracticeProfileLabel {
  label_type: string;
  label_id: string;
  attempts: number;
  wrong_count: number;
  correct_count: number;
  error_rate: number;
  weight: number;
}

export interface NextPracticeQuestion {
  question: Question | null;
  session_complete: boolean;
}

export interface SubmitResult {
  lesson_video?: QuestionLessonVideo | null;
  answer_id?: number | null;
  is_correct: boolean;
  correct_answer: string;
  explanation: string | null;
  mastery_update: Record<string, { before: number; after: number; name: string }>;
  detected_misconception?: {
    id: string;
    name: string;
  } | null;
  needs_intervention?: boolean;
  ai_feedback?: string | null;
  extracted_answer?: string | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
  ai_feedback_rendered?: RenderedRichContent | null;
  extracted_answer_rendered?: RenderedRichContent | null;
  process_grading?: ProcessGrading | null;
  cleared?: boolean;
  xp_awarded?: number | null;
  unlocked_badges?: Array<{ id: string; name: string; badge_type: string }> | null;
  encouragement?: string | null;
  leveled_up?: boolean;
  new_level?: number;
  new_level_name?: string;
}

export interface PaperBatchGradeResponse {
  results: Record<string, SubmitResult>;
  errors: Record<string, string>;
  solutions?: Record<string, {
    correct_answer: string;
    explanation?: string | null;
  }>;
}

export interface AnswerHistoryItem {
  lesson_video?: QuestionLessonVideo | null;
  id: number;
  question_id: string;
  stem_text?: string;
  question_type?: string | null;
  options?: QuestionOption[];
  images?: QuestionImage[];
  knowledge_points?: Array<{ id: string; name: string }>;
  given_answer: string | null;
  is_correct: boolean;
  correct_answer?: string | null;
  explanation?: string | null;
  stem_rendered?: RenderedRichContent | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
  process_grading?: ProcessGrading | null;
  reviewed_at?: string | null;
  time_spent_ms: number | null;
  created_at: string | null;
}

export interface ProcessGrading {
  final_answer?: string | null;
  process_score?: number | null;
  process_score_percent?: number | null;
  model_correct?: boolean | null;
  equation_correct?: boolean | null;
  calculation_correct?: boolean | null;
  unit_correct?: boolean | null;
  error_type?: string | null;
  error_type_name?: string | null;
  first_error?: string | null;
  next_action?: string | null;
  feedback?: string | null;
  first_error_rendered?: RenderedRichContent | null;
  next_action_rendered?: RenderedRichContent | null;
  feedback_rendered?: RenderedRichContent | null;
  grading_basis_rendered?: RenderedRichContent | null;
  answer_image_path?: string | null;
  answer_image_paths?: string[] | null;
  answer_crop_image_path?: string | null;
  answer_page_image_path?: string | null;
  answer_page_image_paths?: string[] | null;
  answer_source?: string | null;
  /** A teacher's released points on paper homework (answer_source "teacher_paper"). */
  score?: number | null;
  max_score?: number | null;
  process_evidence_kind?: string | null;
  process_evidence_image_path?: string | null;
  grading_confidence?: number | null;
  confidence_level?: 'high' | 'medium' | 'low' | string | null;
  needs_human_review?: boolean;
  grading_basis?: string | null;
  step_scores?: Array<{
    name: string;
    score: number;
    max_score: number;
    comment?: string | null;
  }>;
}

// ── Review ─────────────────────────────────────────────────────────────────────

export interface ReviewMistake {
  lesson_video?: QuestionLessonVideo | null;
  answer_id: number;
  question_id: string;
  stem_text: string;
  question_type?: string | null;
  options?: QuestionOption[];
  images?: QuestionImage[];
  given_answer: string | null;
  correct_answer: string | null;
  explanation: string | null;
  stem_rendered?: RenderedRichContent | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
  misconception: { id: string; name: string } | null;
  process_grading?: ProcessGrading | null;
  created_at: string;
}

export interface ReviewGroup {
  kp_id: string;
  kp_name: string;
  wrong_count: number;
  mistakes: ReviewMistake[];
}

export interface ReviewErrorGroup {
  error_type: string;
  error_name: string;
  count: number;
  kp_names: string[];
  sample_answer_id?: number | null;
  sample_question_id?: string | null;
  first_error: string;
  next_action: string;
}

export interface ReviewStep {
  title: string;
  description: string;
}

export interface ReviewCenter {
  total_pending: number;
  primary_focus: ReviewErrorGroup | null;
  error_groups: ReviewErrorGroup[];
  review_steps: ReviewStep[];
  stage_counts: Record<string, number>;
}

export interface RetryData {
  question: Question | null;
}

export interface VariationQuestion {
  variation_type: 'foundation' | 'same_model' | 'transfer' | 'structure' | string;
  title: string;
  reason: string;
  question: Question;
}

export interface VariationData {
  variations: VariationQuestion[];
}

export interface ReviewData {
  groups: ReviewGroup[];
  clearance_progress: { reviewed: number; total: number };
  review_center?: ReviewCenter | null;
}

// ── Learn ────────────────────────────────────────────────────────────────────

export interface LearnContentSection {
  type: string;
  title: string;
  content: Record<string, unknown>;
}

export interface KnowledgeCard {
  content_id: string;
  kp_id: string;
  kp_name: string;
  title: string;
  sections: LearnContentSection[];
  source: string;
  consumed: boolean;
}

export interface SlideBlock {
  type: string;
  content: Record<string, unknown>;
}

export interface SlideItem {
  type: string;
  title: string;
  subtitle: string | null;
  blocks: SlideBlock[];
  layout: string;
}

export interface SlideDeck {
  content_id: string;
  kp_id: string;
  title: string;
  slides: SlideItem[];
  total: number;
  consumed: boolean;
}

export interface SimulationContent {
  content_id: string;
  kp_id: string;
  kp_name: string;
  title: string;
  config: Record<string, unknown>;
  html: string;
  consumed: boolean;
}

export interface VideoRecommendation {
  id: string;
  title: string;
  url: string;
  uploader?: string | null;
  duration?: string | null;
  cover_url?: string | null;
  source: string;
  category?: string | null;
  play_count?: string | number | null;
  reason: string;
  match_focus: string;
}

export interface VideoRecommendationResponse {
  kp_id: string;
  kp_name: string;
  query: string;
  items: VideoRecommendation[];
  experiment?: VideoRecommendation | null;
  experiments?: VideoRecommendation[];
  fallback: boolean;
}

export interface PhysicsSimulationPoint {
  t: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  theta?: number;
}

export interface PhysicsVectorDescriptor {
  symbol: string;
  label: string;
  vector3: [number, number, number];
  color: string;
  teaching_role?: string;
}

export interface PhysicsSimulation {
  model_id: string;
  title: string;
  description?: string;
  render_modes?: string[];
  params?: Record<string, any>;
  series?: PhysicsSimulationPoint[];
  annotations?: Record<string, any>[];
  formulas: string[];
  vectors?: Record<string, PhysicsVectorDescriptor>;
  views?: {
    two_d_projection?: Record<string, any>;
    three_d_video?: {
      source: string;
      url: string;
      scene?: string;
      duration_seconds?: number;
    };
  };
  ai_context?: {
    teacher_summary: string;
    common_mistakes: string[];
    student_prompt: string;
  };
}

export interface PhysicsSimulationResponse {
  kp_id: string;
  kp_name: string;
  simulation: PhysicsSimulation | null;
}

export interface LearnBundle {
  kp_id: string;
  kp_name: string;
  card: KnowledgeCard | null;
  slides: SlideDeck | null;
  simulations: SimulationContent[];
  examples: Record<string, unknown>[];
  progress: Record<string, { consumed: number; total: number }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LearnCompleteResult {
  success: boolean;
  mastery_update: Record<string, { before: number; after: number; name: string }>;
}

// ── Directory ──────────────────────────────────────────────────────────────────

export interface DirectoryKpNode {
  id: string;
  name: string;
  volume: string | null;
  chapter: string | null;
  section: string | null;
  mastery: number;
  status: 'mastered' | 'current' | 'needs_learning' | 'locked' | 'upcoming' | 'pending_content';
  learning_state?: 'mastered' | 'learning' | 'to_learn' | 'practice' | 'locked' | 'pending_content';
  learning_state_label?: string;
  learning_state_tone?: 'mastered' | 'learning' | 'practice' | 'locked';
  blocked_by: string[];
  last_practiced: string | null;
  content_available?: boolean;
  practice_available?: boolean;
}

export interface DirectoryStats {
  mastered: number;
  in_progress: number;
  locked: number;
  total: number;
  learning?: number;
  to_learn?: number;
  practice?: number;
  pending_content?: number;
}

export interface DirectoryRelation {
  id: number;
  source_id: string;
  target_id: string;
  relation_type: string;
  reason: string | null;
}

export interface DirectoryData {
  kps: DirectoryKpNode[];
  stats: DirectoryStats;
  relations: DirectoryRelation[];
}

export interface LearningCatalogMappingSummary {
  knowledge_point_count: number;
  label_rule_count: number;
  question_override_count: number;
}

export interface LearningCatalogNode {
  id: string;
  code: string;
  node_type: 'volume' | 'chapter' | 'section' | 'knowledge_point' | 'block' | 'topic';
  title: string;
  description: string | null;
  sort_order: number;
  config: Record<string, unknown>;
  mapping_summary: LearningCatalogMappingSummary;
  children: LearningCatalogNode[];
}

export interface LearningCatalogData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  version: number;
  enabled: boolean;
  sort_order: number;
  config: Record<string, unknown>;
  node_count: number;
  topic_count: number;
  nodes: LearningCatalogNode[];
}

export interface LearningCatalogResume {
  catalog_code: string;
  node_id: string | null;
  last_practiced: string | null;
}

export type LearningCatalogTopicLayer =
  | 'diagnostic'
  | 'foundation'
  | 'breakthrough'
  | 'transfer'
  | 'paper';

export interface QuestionLessonVideo {
  id: string;
  title: string;
  duration_seconds: number;
  available: boolean;
  locked_reason?: string | null;
}

export interface TeacherPaper {
  attempt_id?: string | null;
  status?: "not_started" | "in_progress" | "grading" | "completed";
  submitted_at?: string | null;
  completed_at?: string | null;
  id: string;
  title: string;
  question_count: number;
  has_video: boolean;
  attempt_token?: string | null;
  /** Teacher homework once finished, as in TeacherHomework. */
  score_percent?: number | null;
  results_released?: boolean;
}

/** Personalized homework a teacher sent to this student's app account. */
export interface TeacherHomework {
  attempt_id: string;
  assignment_id: string;
  title: string;
  class_name: string;
  question_count: number;
  graded_count: number;
  /** in_progress: answering; grading: submitted, answers being graded; completed: done. */
  status: 'in_progress' | 'grading' | 'completed';
  published_at: string | null;
  /** paper: a scanned paper the teacher has graded, listed with its results. */
  delivery?: 'app' | 'paper';
  /** Finished work only, out of 100. Until released it is the app's own grading. */
  score_percent?: number | null;
  results_released?: boolean;
}

export interface TeacherPaperQuestionVideo {
  question_id: string;
  title: string;
  video_url: string;
  duration_seconds: number;
}

export interface LearningCatalogTopicOverview {
  catalog_code: string;
  node_id: string;
  topic_code: string;
  title: string;
  description: string | null;
  status: 'not_started' | 'needs_review' | 'in_progress' | 'stable';
  status_label: string;
  recommended_layer: LearningCatalogTopicLayer;
  recommended_layer_name: string;
  next_action: string;
  core_knowledge_point_count: number;
  attempted_knowledge_point_count: number;
  mastered_knowledge_point_count: number;
  needs_review_knowledge_point_count: number;
  average_mastery: number;
  performance_score?: number | null;
  evidence_count?: number;
  untested_knowledge_point_count?: number;
  coverage_ratio?: number;
  layer_performance?: Array<{ layer: LearningCatalogTopicLayer; name: string; evidence_count: number; performance_score: number | null }>;
  last_practiced: string | null;
  teacher_papers?: TeacherPaper[];
}

export interface SubmittedDiagnosticAnswer {
  answer_id: number;
  mastery_update: SubmitResult['mastery_update'];
}

export interface KpDiagnosticResult {
  kp_id: string;
  kp_name: string;
  correct_count: number;
  total_count: number;
  mastery_before: number;
  mastery_after: number;
  recommendation: 'study' | 'practice' | 'mastered';
  feedback: string;
}

// ── Scope Diagnostic ──────────────────────────────────────────────────────────

export interface ScopeKpResult {
  kp_id: string;
  kp_name: string;
  correct_count: number;
  total_count: number;
  mastery_before: number;
  mastery_after: number;
}

export interface ScopeDiagnosticResult {
  diagnostic_attempt_id?: string | null;
  scope_type: 'chapter' | 'section';
  scope_id: string;
  scope_name: string;
  kp_results: ScopeKpResult[];
  correct_count: number;
  total_count: number;
  weak_kp_ids: string[];
  recommendation: 'study' | 'practice' | 'mastered';
  feedback: string;
}

export interface ScopeDiagnosticAttemptKpResult {
  id: string;
  kpId: string;
  kpName: string;
  groupId?: string | null;
  groupName?: string | null;
  correctCount: number;
  totalCount: number;
  masteryBefore: number;
  masteryAfter: number;
  isWeak: boolean;
}

export interface ScopeDiagnosticAttemptListItem {
  attemptId: string;
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
  diagnosticType: string;
  createdAt: string;
  submittedAt: string;
  correctCount: number;
  totalCount: number;
  weakCount: number;
  recommendation?: 'study' | 'practice' | 'mastered' | null;
  feedback?: string | null;
  linkedPlanId?: string | null;
  linkedPlanStatus?: string | null;
  linkedReportAvailable: boolean;
}

export interface ScopeDiagnosticAttemptListResponse {
  items: ScopeDiagnosticAttemptListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ScopeDiagnosticAttemptDetail {
  attemptId: string;
  studentId: string;
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
  diagnosticType: string;
  status: string;
  createdAt: string;
  submittedAt: string;
  questionIds: string[];
  answerIds: Array<number | string>;
  result?: Record<string, unknown> | null;
  correctCount: number;
  totalCount: number;
  weakCount: number;
  weakKpIds: string[];
  recommendation?: 'study' | 'practice' | 'mastered' | null;
  feedback?: string | null;
  kpResults: ScopeDiagnosticAttemptKpResult[];
  linkedPlanId?: string | null;
  linkedPlanStatus?: string | null;
  linkedReportAvailable: boolean;
}

// ── Improvement Plan ─────────────────────────────────────────────────────────

export type ImprovementTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'practiced'
  | 'needs_retest'
  | 'passed';

export type ImprovementRecommendedAction =
  | 'review_then_practice'
  | 'practice'
  | 'challenge'
  | 'retest';

export interface ImprovementTask {
  id: string;
  kpId: string;
  kpName: string;
  groupId?: string | null;
  groupName?: string | null;
  correctCount: number;
  totalCount: number;
  masteryBefore: number;
  masteryAfter: number;
  isWeak: boolean;
  priority: number;
  status: ImprovementTaskStatus;
  recommendedAction: ImprovementRecommendedAction;
  reason: string;
  startedAt?: string | null;
  practicedAt?: string | null;
  passedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ImprovementPlan {
  id: string;
  diagnosticAttemptId?: string | null;
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
  createdAt: string;
  correctCount: number;
  totalCount: number;
  weakCount: number;
  status: 'diagnosed' | 'in_progress' | 'ready_for_retest' | 'completed';
  currentTaskId?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  sourceResult?: ScopeDiagnosticResult | null;
  tasks: ImprovementTask[];
}

export interface ImprovementRetestTaskResult {
  taskId: string;
  kpId: string;
  kpName: string;
  correctCount: number;
  totalCount: number;
  masteryBefore?: number | null;
  masteryAfter?: number | null;
  passed: boolean;
  nextStatus: 'passed' | 'needs_retest';
  feedback: string;
}

export interface ImprovementRetestSession {
  attemptId: string;
  plan: ImprovementPlan;
  session: PracticeSession;
}

export interface ImprovementRetestResult {
  attemptId: string;
  plan: ImprovementPlan;
  correctCount: number;
  totalCount: number;
  passedCount: number;
  needsRetestCount: number;
  taskResults: ImprovementRetestTaskResult[];
}

export interface ImprovementReportTaskItem {
  taskId: string;
  kpId: string;
  kpName: string;
  groupId?: string | null;
  groupName?: string | null;
  priority: number;
  status: ImprovementTaskStatus;
  recommendedAction: ImprovementRecommendedAction;
  reason: string;
  diagnosticCorrectCount: number;
  diagnosticTotalCount: number;
  masteryBefore: number;
  masteryAfterDiagnostic: number;
  latestRetestCorrectCount?: number | null;
  latestRetestTotalCount?: number | null;
  latestRetestMasteryBefore?: number | null;
  latestRetestMasteryAfter?: number | null;
  latestRetestPassed?: boolean | null;
  finalLabel: string;
}

export interface ImprovementReportRetestAttempt {
  attemptId: string;
  status: string;
  correctCount: number;
  totalCount: number;
  passedCount: number;
  needsRetestCount: number;
  createdAt?: string | null;
  submittedAt?: string | null;
}

export interface ImprovementReportSummary {
  planId: string;
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
  planStatus: ImprovementPlan['status'];
  createdAt?: string | null;
  completedAt?: string | null;
  diagnosticCorrectCount: number;
  diagnosticTotalCount: number;
  diagnosticAccuracy: number;
  taskCount: number;
  weakTaskCount: number;
  passedTaskCount: number;
  needsRetestTaskCount: number;
  practicedTaskCount: number;
  pendingTaskCount: number;
  retestAttemptCount: number;
  latestRetestAccuracy?: number | null;
  completed: boolean;
}

export interface ImprovementReport {
  summary: ImprovementReportSummary;
  diagnosticResult?: ScopeDiagnosticResult | null;
  tasks: ImprovementReportTaskItem[];
  retestAttempts: ImprovementReportRetestAttempt[];
  strengths: string[];
  remainingWeaknesses: string[];
  nextActions: string[];
}

export interface ImprovementReportListItem {
  planId: string;
  scopeType: 'chapter' | 'section';
  scopeId: string;
  scopeName: string;
  createdAt?: string | null;
  completedAt?: string | null;
  diagnosticCorrectCount: number;
  diagnosticTotalCount: number;
  diagnosticAccuracy: number;
  taskCount: number;
  passedTaskCount: number;
  needsRetestTaskCount: number;
  latestRetestAccuracy?: number | null;
  summaryLabel: string;
  highlight: string;
}

export interface ImprovementReportListResponse {
  items: ImprovementReportListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ── Learning Trace ───────────────────────────────────────────────────────────

export type LearningTraceEventType =
  | 'diagnostic_submitted'
  | 'improvement_plan_created'
  | 'task_started'
  | 'task_practiced'
  | 'task_needs_retest'
  | 'task_passed'
  | 'retest_started'
  | 'retest_submitted'
  | 'improvement_completed';

export type LearningTracePrimaryAction =
  | 'view_diagnostic'
  | 'view_plan'
  | 'view_report';

export interface LearningTraceEvent {
  id: string;
  eventType: LearningTraceEventType | string;
  eventTime: string;
  studentId: string;
  scopeType?: 'chapter' | 'section' | string | null;
  scopeId?: string | null;
  scopeName?: string | null;
  title: string;
  description: string;
  attemptId?: string | null;
  planId?: string | null;
  taskId?: string | null;
  retestAttemptId?: string | null;
  kpId?: string | null;
  kpName?: string | null;
  statusLabel?: string | null;
  primaryAction?: LearningTracePrimaryAction | string | null;
  reportAvailable: boolean;
  metadata: Record<string, unknown>;
}

export interface LearningTraceResponse {
  items: LearningTraceEvent[];
  total: number;
  limit: number;
  offset: number;
}

// ── Knowledge Mastery Judgment ───────────────────────────────────────────────

export type KnowledgeMasteryLevel = 'weak' | 'developing' | 'stable' | 'mastered';

export type KnowledgeMasteryInterventionStatus =
  | 'none'
  | 'needs_learning'
  | 'needs_practice'
  | 'in_improvement'
  | 'awaiting_retest'
  | 'needs_retest'
  | 'passed_recently';

export type KnowledgeMasteryNextAction =
  | 'learn'
  | 'practice'
  | 'diagnose'
  | 'improve'
  | 'continue_improvement'
  | 'retest'
  | 'maintain';

export type KnowledgeMasteryConfidence = 'low' | 'medium' | 'high';

export interface KnowledgeMasteryEvidence {
  source: string;
  label: string;
  occurredAt?: string | null;
  strength?: 'positive' | 'negative' | 'neutral' | string | null;
  description: string;
  refId?: string | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeMasteryJudgment {
  kpId: string;
  kpName: string;
  masteryScore: number;
  masteryLevel: KnowledgeMasteryLevel | string;
  interventionStatus: KnowledgeMasteryInterventionStatus | string;
  confidence: KnowledgeMasteryConfidence | string;
  nextAction: KnowledgeMasteryNextAction | string;
  reason: string;
  evidenceSources: string[];
  evidences: KnowledgeMasteryEvidence[];
  lastAnsweredAt?: string | null;
  lastDiagnosticAt?: string | null;
  lastRetestAt?: string | null;
  recentCorrectCount: number;
  recentTotalCount: number;
  recentCorrectRate?: number | null;
  latestDiagnosticAttemptId?: string | null;
  latestDiagnosticCorrectCount?: number | null;
  latestDiagnosticTotalCount?: number | null;
  latestDiagnosticIsWeak?: boolean | null;
  activePlanId?: string | null;
  activeTaskId?: string | null;
  activeTaskStatus?: string | null;
  latestRetestAttemptId?: string | null;
  latestRetestPassed?: boolean | null;
  updatedAt?: string | null;
}

export interface KnowledgeMasteryJudgmentBatchResponse {
  items: KnowledgeMasteryJudgment[];
}

export interface ScopeKnowledgeMasteryJudgmentResponse {
  scopeType: 'chapter' | 'section' | string;
  scopeId: string;
  scopeName: string;
  items: KnowledgeMasteryJudgment[];
}

// ── Reward & Growth ────────────────────────────────────────────────────────────

export interface XpStatus {
  total_xp: number;
  level: number;
  level_name: string;
  xp_for_next_level: number;
  energy: number;
  streak_days: number;
}

export interface RewardRecord {
  id: string;
  reward_type: string;
  reward_value: number;
  reason: string;
  created_at: string;
}

export interface RewardStatus {
  xp: XpStatus;
  recent_rewards: RewardRecord[];
}

export interface DailyLoopRing {
  key: 'practice' | 'review';
  label: string;
  completed: boolean;
  current: number;
  actual_current: number;
  target: number;
  overflow: number;
  auto_completed: boolean;
  pending_mistakes?: number;
  evidence: string;
}

export interface DailyLearningLoopDay {
  date: string;
  is_effective_day: boolean;
  is_high_quality_day: boolean;
  rings: {
    practice: DailyLoopRing;
    review: DailyLoopRing;
  };
  summary: string;
  next_action: string;
}

export interface DailyLearningLoop extends DailyLearningLoopDay {
  streak_days: number;
}

export interface DailyLearningLoopHistory {
  start_date: string;
  end_date: string;
  practice_target: number;
  review_target: number;
  summary: {
    practice_total: number;
    review_total: number;
    practice_closed_days: number;
    review_closed_days: number;
    dual_closed_days: number;
    effective_days: number;
  };
  days: DailyLearningLoopDay[];
}

export interface GrowthReportData {
  id: string;
  summary: string;
  metrics: Record<string, unknown>;
  start_date: string | null;
  end_date: string | null;
  created_at?: string;
}

export interface GrowthReportResponse {
  report: GrowthReportData | null;
}
export interface StudentClass {
  id: string; name: string; grade: string | null; teacher_name: string;
  student_number: string | null; archived: boolean; teacher_active: boolean;
}
export interface StudentClassPreview extends StudentClass {
  already_joined: boolean; disclosure: string; disclosure_version: string;
}
