export interface KnowledgePoint {
  id: string;
  name: string;
  volume?: string;
  chapter?: string;
  section?: string;
  description?: string;
  difficulty: number;
}

export interface QuestionOption {
  label: string;
  text: string;
  is_correct: boolean;
  targets_misconception?: string;
}

export interface QuestionLabel {
  label_type: string;
  label_id: string;
  role: string;
  confidence?: number;
  source: string;
  related_kp_id?: string;
}

export interface QuestionImage {
  id: string;
  image_path: string;
  image_type?: string;
  description?: string;
  extracted_structure?: Record<string, unknown> | null;
}

export interface QuestionFormula {
  id: string;
  latex: string;
  formula_role?: string;
  description?: string;
}

export interface Question {
  id: string;
  stem_text: string;
  answer?: string;
  explanation?: string;
  question_type?: string;
  difficulty?: number;
  difficulty_tier?: string;  // easy, moderate_easy, medium, moderate_hard, hard
  source?: string;
  quality_status: string;
  created_at: string;
  options: QuestionOption[];
  labels: QuestionLabel[];
  images: QuestionImage[];
  formulas: QuestionFormula[];
  has_video?: boolean;
  video?: QuestionVideo | null;
}

export interface QuestionVideo {
  id: string;
  question_id: string;
  title: string;
  duration_seconds: number;
  status: 'draft' | 'approved';
}

export interface QuestionPage {
  items: Question[];
  total: number;
  page: number;
  page_size: number;
}


// Knowledge point with question stats
export interface TierCounts {
  easy: number;
  moderate_easy: number;
  medium: number;
  moderate_hard: number;
  hard: number;
}

export interface KpWithStats extends KnowledgePoint {
  question_count: number;
  tier_counts: TierCounts;
}

export interface Student {
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

export interface AdminLoginResponse {
  access_token: string;
  token_type: string;
  username: string;
}

export interface AdminMe {
  username: string;
}


export interface QualityReport {
  summary: {
    question_count: number;
    approved_count: number;
    pending_count: number;
    draft_count: number;
    retired_count: number;
    label_complete_count: number;
    label_complete_rate: number;
    health_score: number;
    /** Full number of questions with issues; issue_questions is capped for display. Older backends omit it. */
    issue_question_count?: number;
  };
  /** count = questions carrying at least one label of the type; label_count = total labels. */
  label_coverage: Record<string, { count: number; rate: number; label_count?: number }>;
  issue_counts: Record<string, number>;
  issue_questions: QualityIssueQuestion[];
  chapter_coverage: QualityChapterCoverage[];
  kp_coverage: QualityKpCoverage[];
  model_coverage: QualityModelCoverage[];
  error_audit: {
    error_counts: { error_type: string; error_type_name: string; count: number }[];
    samples: QualityErrorSample[];
  };
  grading_metrics?: GradingMetrics;
}

/** Site-wide online grading rates; a rate is null when its denominator is 0. */
export interface GradingMetrics {
  window_days: number;
  ai_graded_count: number;
  correction_count: number;
  correction_rate: number | null;
  needs_review_count: number;
  needs_review_rate: number | null;
  process_conflict_count: number;
  photo_item_count: number;
  unrecognized_count: number;
  unrecognized_rate: number | null;
  no_answer_key_count: number;
  /** Grading calls that ended without a result, after both graders were tried. */
  ai_task_count?: number;
  ai_failure_count?: number;
  ai_failure_rate?: number | null;
  /** Homework items a teacher confirmed, and how many changed the AI's score. */
  teacher_review_count?: number;
  teacher_change_count?: number;
  teacher_change_rate?: number | null;
  by_model?: GradingModelMetrics[];
  sample_truncated?: boolean;
}

export interface GradingModelMetrics {
  model: string;
  ai_graded_count: number;
  needs_review_rate: number | null;
  correction_rate: number | null;
  teacher_review_count: number;
  teacher_change_rate: number | null;
}

export interface QualityIssueQuestion {
  id: string;
  stem_preview: string;
  status: string;
  question_type?: string | null;
  difficulty_tier?: string | null;
  kp_ids: string[];
  kp_names: string[];
  missing_labels: string[];
  issues: string[];
  completeness: number;
}

export interface QualityChapterCoverage {
  volume: string;
  chapter: string;
  kp_count: number;
  question_count: number;
  empty_kp_count: number;
  empty_kp_ids: string[];
  empty_knowledge_points: {
    kp_id: string;
    kp_name: string;
    section?: string | null;
  }[];
  tier_counts: Record<string, number>;
}

export interface QualityKpCoverage {
  kp_id: string;
  kp_name: string;
  volume?: string | null;
  chapter?: string | null;
  section?: string | null;
  question_count: number;
  tier_counts: Record<string, number>;
  risk: 'empty' | 'thin' | 'ok' | string;
}

export interface QualityModelCoverage {
  model_id: string;
  model_name: string;
  domain: string;
  layer: string;
  question_count: number;
  tier_counts: Record<string, number>;
  type_counts: Record<string, number>;
  chapter_counts: {
    volume: string;
    chapter: string;
    question_count: number;
    tier_counts: Record<string, number>;
    type_counts: Record<string, number>;
  }[];
  risk: 'empty' | 'thin' | 'ok' | 'unknown_model' | string;
}

export interface QualityErrorSample {
  answer_id: number;
  question_id: string;
  error_type: string;
  error_type_name: string;
  first_error: string;
  feedback: string;
  created_at?: string | null;
}

export interface LearningContentSummary {
  id: string;
  content_type: string;
  title: string;
  source: string;
  version: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LearningDemoSummary {
  demo_id: string;
  title: string;
  description: string;
  source: 'local' | 'backend' | string;
}

export interface LearningResourceItem {
  kp_id: string;
  kp_name: string;
  volume?: string | null;
  chapter?: string | null;
  section?: string | null;
  question_count: number;
  contents: Partial<Record<'card' | 'slides' | 'simulation' | 'example', LearningContentSummary>>;
  video: {
    curated_count: number;
    top_title?: string | null;
  };
  simulations: {
    learning_content?: LearningContentSummary | null;
    local_demos: LearningDemoSummary[];
    backend_simulations: LearningDemoSummary[];
    has_simulation: boolean;
  };
}

export interface LearningVideoCuration {
  id: number;
  knowledge_point_id: string;
  video_type: 'lecture' | 'experiment' | string;
  title: string;
  url: string;
  uploader?: string | null;
  duration?: string | null;
  cover_url?: string | null;
  reason?: string | null;
  match_focus?: string | null;
  priority: number;
  enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LearningVideoCurationPayload {
  knowledge_point_id?: string;
  video_type?: 'lecture' | 'experiment' | string;
  title?: string;
  url?: string;
  uploader?: string | null;
  duration?: string | null;
  cover_url?: string | null;
  reason?: string | null;
  match_focus?: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface LearningResourceReport {
  summary: {
    kp_count: number;
    card_count: number;
    video_count: number;
    simulation_count: number;
    missing_card_count: number;
    missing_video_count: number;
    missing_simulation_count: number;
  };
  items: LearningResourceItem[];
}

export interface TeachingSummary {
  student_count: number;
  active_student_count: number;
  class_count: number;
  pending_mistake_count: number;
  avg_mastery: number;
}

export interface TeachingClassSummary {
  class_name: string;
  student_count: number;
  active_student_count: number;
  avg_mastery: number;
  pending_mistake_count: number;
}

export interface TeachingWeakChapter {
  volume: string;
  chapter: string;
  avg_mastery: number;
  weak_kp_count: number;
}

export interface TeachingStudentSummary {
  id: string;
  username: string;
  display_name: string;
  class_name?: string | null;
  status: string;
  last_login_at?: string | null;
  avg_mastery: number;
  pending_mistake_count: number;
  weak_chapters: TeachingWeakChapter[];
}

export interface TeachingWeakPoint {
  kp_id: string;
  kp_name: string;
  volume?: string | null;
  chapter?: string | null;
  section?: string | null;
  weak_student_count: number;
  avg_mastery: number;
  pending_mistake_count: number;
}

export interface TeachingHotMistake {
  question_id: string;
  stem_preview: string;
  wrong_count: number;
  affected_student_count: number;
  kp_id?: string | null;
  kp_name?: string | null;
  error_type?: string | null;
  error_type_name: string;
  latest_at?: string | null;
}

export interface TeachingDashboard {
  summary: TeachingSummary;
  classes: TeachingClassSummary[];
  students: TeachingStudentSummary[];
  weak_points: TeachingWeakPoint[];
  hot_mistakes: TeachingHotMistake[];
}

export type TeacherClassLevel = 'advanced' | 'standard' | 'foundation';

export interface AdminTeacherClass {
  id: string;
  teacher_id: string;
  name: string;
  grade: string | null;
  level: TeacherClassLevel;
  archived: boolean;
  member_count: number;
}

export interface AdminTeacher {
  id: string;
  username: string;
  display_name: string;
  status: 'active' | 'disabled';
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string | null;
  classes: AdminTeacherClass[];
}

export interface AdminClassMember {
  id: string;
  username: string;
  display_name: string;
  status: string;
  teacher_ai_authorized?: boolean;
  teacher_ai_grantor?: 'school' | 'guardian' | null;
}

/** The platform's view of where students learn badly, for content work (教学工作台). */
export interface TeachingInsightPoint {
  kp_id: string;
  kp_name: string;
  volume: string | null;
  chapter: string | null;
  section: string | null;
  weak_students: number;
  evidence_students: number;
  avg_mastery: number;
  wrong_recent: number;
  video_count: number;
}

export interface TeachingInsightQuestion {
  question_id: string;
  stem_preview: string;
  kp_id: string | null;
  kp_name: string | null;
  answers: number;
  wrong: number;
  wrong_students: number;
  wrong_rate: number;
  main_cause: string | null;
  /** Nearly everyone gets it wrong: check the answer key and explanation first. */
  suspect: boolean;
}

export interface TeachingInsights {
  scope: { class_id: string | null; include_internal: boolean; active_days: number; mistake_days: number };
  summary: { student_count: number; active_students: number; to_correct: number; weak_point_count: number; suspect_questions: number };
  weak_points: TeachingInsightPoint[];
  hot_mistakes: TeachingInsightQuestion[];
  classes: Array<{ id: string; name: string; teacher_name: string }>;
}
