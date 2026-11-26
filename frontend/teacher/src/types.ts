export type ClassLevel = 'advanced' | 'standard' | 'foundation';

export interface TeacherProfile {
  id: string;
  username: string;
  display_name: string;
  must_change_password: boolean;
}

export interface TeacherAuth {
  access_token: string;
  teacher: TeacherProfile;
}

export interface TeacherClassSummary {
  id: string;
  name: string;
  grade: string | null;
  level: ClassLevel;
  archived: boolean;
  member_count: number;
}

export interface ClassMember {
  id: string;
  username: string;
  display_name: string;
  status: string;
  last_login_at: string | null;
  student_number: string | null;
  teacher_ai_authorized?: boolean;
  /** invitation: joined with the class code; admin: placed on a school or guardian authorization; null: older rows. */
  joined_via?: 'invitation' | 'admin' | null;
  joined_at?: string | null;
  /** Declined AI processing in the iOS app: written answers to App homework cannot be submitted there. */
  app_ai_declined?: boolean;
}

export interface TeacherClassDetail extends TeacherClassSummary {
  members: ClassMember[];
}

export interface DashboardSummary {
  student_count: number;
  active_student_count: number;
  pending_mistake_count: number;
  avg_mastery: number;
}

export interface WeakChapter {
  volume: string;
  chapter: string;
  avg_mastery: number;
  weak_kp_count: number;
}

export interface StudentSignal {
  id: string;
  username: string;
  display_name: string;
  avg_mastery: number;
  pending_mistake_count: number;
  weak_chapters: WeakChapter[];
}

export interface WeakPoint {
  kp_id: string;
  kp_name: string;
  chapter: string | null;
  section: string | null;
  weak_student_count: number;
  avg_mastery: number;
  pending_mistake_count: number;
}

export interface HotMistake {
  question_id: string;
  stem_preview: string;
  wrong_count: number;
  affected_student_count: number;
  kp_name: string | null;
  error_type_name: string;
}

export interface KnowledgeEvidence {
  student_id: string;
  practice_count: number;
  practice_graded: number;
  practice_correct: number;
  homework_earned: number;
  homework_full: number;
  mastery: number | null;
  mastery_attempts?: number;
  mastery_updated_at?: string | null;
  /** Answered questions behind `score`: graded practice plus released homework items. */
  evidence?: number;
  /** Average score per question (practice partial credit, homework score / full marks), 0–1. */
  score?: number | null;
  level?: PerformanceLevel;
  homework_items?: number;
}

/** 已掌握 / 待巩固 / 薄弱, or too few questions to say. */
export type PerformanceLevel = 'mastered' | 'developing' | 'weak' | 'insufficient';

export interface StudentPointRef { kp_id: string; kp_name: string; score: number }
export interface AttentionReason { code: 'inactive' | 'missed' | 'low' | 'weak'; text: string }

export interface ClassStudentStatistics {
  student_id: string;
  display_name: string;
  student_number: string | null;
  practice_count: number;
  practice_graded: number;
  practice_correct_rate: number | null;
  homework_expected: number;
  homework_submitted: number;
  homework_scored: number;
  homework_rate: number | null;
  latest_activity_at: string | null;
  mastery: number | null;
  knowledge_count: number;
  recent_practice_count?: number;
  homework_missed?: number;
  evidence?: number;
  score?: number | null;
  level?: PerformanceLevel;
  weak_points?: StudentPointRef[];
  strong_points?: StudentPointRef[];
  /** Why a teacher might look at this student now; empty when nothing stands out. */
  attention?: AttentionReason[];
}

export interface ClassKnowledgeStatistics {
  kp_id: string;
  kp_name: string;
  chapter: string | null;
  section: string | null;
  student_count: number;
  practice_count: number;
  practice_correct_rate: number | null;
  homework_rate: number | null;
  evidence?: number;
  score?: number | null;
  level?: PerformanceLevel;
  weak_students?: number;
  developing_students?: number;
  students: KnowledgeEvidence[];
}

export interface ClassStatistics {
  summary: {
    data_students: number; practice_count: number; released_assignments: number;
    active_students?: number; recent_practice_count?: number; recent_days?: number;
  };
  thresholds?: { min_evidence: number; mastered: number; developing: number };
  students: ClassStudentStatistics[];
  knowledge_points: ClassKnowledgeStatistics[];
}

export interface ClassPracticeRecord {
  id: number | string;
  source?: 'practice' | 'teacher_app' | 'teacher_paper';
  assignment_id?: string;
  assignment_title?: string;
  score?: number;
  max_score?: number;
  first_error?: string | null;
  student_id: string;
  display_name: string;
  created_at: string | null;
  question: BankQuestion | null;
  given_answer: string | null;
  is_correct: boolean | null;
  /** 0–1: full marks, part of the marks, or none; null while a practice answer awaits confirmation. */
  credit?: number | null;
  image_url: string | null;
  feedback: string | null;
  error_type_name: string | null;
}

/** The class page's data: statistics only (older servers also sent all-time signals, now unused). */
export interface ClassDashboard {
  statistics?: ClassStatistics;
  summary?: DashboardSummary;
  students?: StudentSignal[];
  weak_points?: WeakPoint[];
  hot_mistakes?: HotMistake[];
}

export type BoxSize = 'small' | 'medium' | 'large';

export interface BankQuestion {
  id: string;
  question_type: string | null;
  difficulty_tier: string | null;
  stem_text: string;
  options: Array<{ label: string; text: string }>;
  image_paths: string[];
  /** diagram / option / explanation for each image_paths entry; missing in older paper snapshots. */
  image_types?: Array<string | null>;
  answer: string | null;
  explanation?: string | null;
  primary_kp: { id: string; name: string; chapter: string | null } | null;
  default_points: number;
  default_box: BoxSize | null;
  class_attempted: number;
  class_correct_rate: number | null;
}

export interface QuestionPage {
  items: BankQuestion[];
  total: number;
  page: number;
  page_size: number;
}

/** Approved questions per catalogue level; keys join the level's names with "||". */
export interface OutlineCounts {
  /** Approved questions in the whole bank, each counted once. */
  total?: number;
  volumes: Record<string, number>;
  chapters: Record<string, number>;
  sections: Record<string, number>;
  points: Record<string, number>;
}

export interface KnowledgePointOption {
  id: string;
  name: string;
  volume: string | null;
  chapter: string | null;
  section: string | null;
}

export interface PrintLayout {
  figure?: 'auto' | 'wrap' | 'block';
  figure_width_mm?: number | null;
  break_before?: 'column' | null;
}

export interface AssignmentItem {
  number: number;
  question_id: string;
  points: number;
  box: BoxSize | null;
  /** Answer area height the teacher set in the print preview; the box preset applies when absent. */
  area_mm?: number | null;
  print_layout?: PrintLayout | null;
  question: BankQuestion | null;
}

export interface AssignmentSummary {
  delivery?: 'app' | 'paper' | null;
  id: string;
  /** null: the teacher's own paper or personalized settings, assigned to classes from the library. */
  class_id: string | null;
  /** On a class copy: the paper or settings it was assigned from. */
  source_id?: string | null;
  title: string;
  /** test: one paper for the class; personalized: one paper per student. */
  kind: 'test' | 'personalized' | string;
  /** saved: a paper of the teacher's own, fixed as printed and ready to publish to classes. */
  status: 'draft' | 'saved' | 'published';
  /** Per student for a personalized homework. */
  question_count: number;
  /** null for a personalized homework, where each paper has its own total. */
  total_points: number | null;
  created_at: string | null;
  published_at: string | null;
  results_released_at?: string | null;
  removed_at?: string | null;
}

export interface AssignmentDetail extends AssignmentSummary {
  class_name: string | null;
  collected?: number;
  items: AssignmentItem[];
  settings?: Partial<PersonalizedSettings> | null;
  papers?: StudentPaper[];
  /** On a paper or settings: the classes it was already assigned to. A saved paper's published_at is when it was saved. */
  assigned?: ClassAssignment[];
}

/** One class's copy of a paper or personalized homework. */
export interface ClassAssignment {
  delivery?: 'app' | 'paper' | null;
  /** App first, yet printed for these students who never signed in. */
  paper_students?: number;
  id: string;
  class_id: string;
  class_name: string;
  archived: boolean;
  status: 'draft' | 'published';
  created_at: string | null;
  published_at: string | null;
  results_released_at: string | null;
  collected: number;
  member_count: number;
}

/** A row of the 作业 page: a paper or settings with its classes, or a class row standing alone. */
export interface LibraryEntry extends AssignmentSummary {
  is_paper: boolean;
  classes: ClassAssignment[];
}

export interface ClassHomeworkRow extends AssignmentSummary {
  collected: number;
  member_count: number;
  average: number | null;
  rate: number | null;
}

export interface ClassHomework {
  assignments: ClassHomeworkRow[];
  students: Array<{
    student_id: string;
    display_name: string;
    student_number: string | null;
    scores: Record<string, { score: number; full: number | null }>;
    /** Released homework this student was given but did not hand in. */
    missing?: string[];
  }>;
}

export interface ScopeEntry {
  volume?: string;
  chapter?: string;
  section?: string;
  kp_id?: string;
}

export interface PersonalizedSettings {
  delivery?: 'app' | 'paper';
  scope: ScopeEntry[];
  choice_count: number;
  area_count: number;
  experiment_count?: number;
  calculation_count?: number;
  /** On a class draft: explicit recipients; absent means the whole class. */
  student_ids?: string[];
}

/** same_error, weak_kp, step_up, coverage from drafting; teacher when the teacher picked it. */
export type PaperRule = 'same_error' | 'weak_kp' | 'step_up' | 'coverage' | 'teacher';

export interface PaperItem extends AssignmentItem {
  rule: PaperRule | null;
  reason: string | null;
}

export interface StudentPaper {
  student_id: string;
  display_name: string;
  student_number: string | null;
  /** app: answered in the student app; paper: printed and scanned; null: no paper yet. */
  delivery: 'app' | 'paper' | null;
  /** In the class but without a paper: joined after drafting (or after publishing). */
  missing?: boolean;
  /** App papers after publishing: in_progress (answering), grading, completed. */
  app_status?: { status: 'in_progress' | 'grading' | 'completed'; graded: number; total: number } | null;
  total_points: number;
  items: PaperItem[];
}

export interface ItemInput {
  print_layout?: PrintLayout | null;
  question_id: string;
  points?: number;
  box?: BoxSize | null;
  area_mm?: number | null;
}

export interface QuestionFilters {
  volume?: string;
  chapter?: string;
  section?: string;
  kp_id?: string;
  question_type?: string;
  difficulty_tier?: string;
  search?: string;
  exclude_attempted?: boolean;
  page?: number;
  page_size?: number;
}

export interface CollectionItem {
  number: number;
  kind: 'choice' | 'area';
  answer: string | null;
  recognized_answer: string | null;
  confidence: number | null;
  is_correct: boolean | null;
  /** Multiple choice with some correct options and none wrong: half marks (高考 rule). */
  partial?: boolean;
  status: 'recognized' | 'needs_review' | 'manual' | 'collected' | 'missing' | 'confirmed' | 'pending';
  image_url: string | null;
}

export interface CollectionStudent {
  student_id: string;
  display_name: string;
  student_number: string | null;
  ai_authorized: boolean;
  page_urls?: string[];
  submission: null | {
    id: string;
    status: 'recognized' | 'needs_review' | 'manual';
    source?: 'scan' | 'app';
    items: CollectionItem[];
  };
}

export interface ScanBatch {
  id: string;
  filename: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error: string | null;
  page_count: number;
  processed_pages: number;
  created_at: string | null;
  /** Copies this upload holds: deleting it removes them. */
  copies?: number;
}

export interface ScanBatchPages {
  batch_id: string;
  filename: string;
  pages: Array<{
    id: string;
    page_index: number;
    status: string;
    issue_label: string | null;
    student_name: string | null;
    student_number: string | null;
    image_url: string | null;
  }>;
}

export interface ScanException {
  page_id: string;
  page_index: number;
  batch_id: string;
  kind: string;
  issue: string;
  issue_label: string;
  recognized_number: string | null;
  number_confidence?: number | null;
  /** The student the read number belongs to, for the teacher to confirm. */
  suggested?: { student_id: string; display_name: string } | null;
  page_url: string | null;
  number_url: string | null;
}

export interface Collection {
  assignment_id: string;
  /** Results released: the collection is locked. */
  released?: boolean;
  collected: number;
  total: number;
  batches: ScanBatch[];
  students: CollectionStudent[];
  exceptions: ScanException[];
  ai_usage: { calls: number; input_tokens: number; output_tokens: number; estimated_cost: number };
}

export interface RubricPart {
  label: string;
  points: number;
  criteria: string[];
}

export interface PartScore {
  label: string;
  points: number;
  score: number;
  reason: string;
}

export interface GradingRun {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  error: string | null;
}

export interface ReviewQuestion {
  number: number;
  question_id: string;
  question_type: string | null;
  points: number;
  stem_text: string;
  answer: string | null;
  image_paths: string[];
  collected: number;
  kind: 'choice' | 'area';
  pending: number;
  distribution?: Record<string, number>;
  correct_rate?: number | null;
  rubric_status?: string | null;
  rubric_parts?: RubricPart[] | null;
  /** Grading began before the current rubric: this homework keeps the rubric it started with. */
  rubric_frozen?: boolean;
  /** The shared rubric as written, in its own points: what a teacher corrects and confirms. */
  rubric_base?: RubricPart[] | null;
  rubric_source?: string | null;
  /** Who confirmed it ("王老师", "管理员"); null while it is an unconfirmed AI draft. */
  rubric_confirmed_by?: string | null;
  /** A correction still applies to this homework: no answer to the question was graded by hand. */
  rubric_applies_here?: boolean;
  auto_passed?: number;
  confirmed?: number;
}

export interface ReviewOverview {
  assignment_id: string;
  released: boolean;
  run: GradingRun | null;
  questions: ReviewQuestion[];
  /** AI full-mark results not yet confirmed by the teacher; release waits for them. */
  auto_passed?: number;
  error_types: Record<string, string>;
  /** Who has not handed in: releasing closes unfinished App work for good. */
  turn_in?: { expected: number; collected: number; missing: number; app_working: number; app_grading: number };
}

export interface ReviewEntry {
  item_id: number;
  student_id: string;
  display_name: string;
  student_number: string | null;
  ai_authorized: boolean;
  image_url: string | null;
  /** Whole scanned pages, when the answer area could not be cut out. */
  page_urls?: string[];
  answer: string | null;
  grade_status: 'ungraded' | 'manual' | 'needs_review' | 'auto_passed' | 'confirmed' | null;
  score: number | null;
  max_score: number | null;
  part_scores: PartScore[] | null;
  error_type: string | null;
  error_type_name: string | null;
  first_error: string | null;
  feedback: string | null;
  teacher_comment: string | null;
  confidence: number | null;
  ai_error: string | null;
}

export interface GradeInput {
  part_scores?: Array<{ label: string; score: number }>;
  score?: number;
  error_type?: string;
  comment?: string;
}

export interface ReportErrorCount {
  error_type: string;
  name: string;
  count: number;
}

export interface Report {
  assignment_id: string;
  class_id?: string | null;
  kind?: string;
  title: string;
  released_at: string | null;
  /** null for a personalized homework: each student has their own full marks. */
  total_points: number | null;
  /** Positions on the students' papers that score columns are listed by. */
  positions?: number[];
  /** Personalized homework: of the questions set to repair a past mistake, how many lost points again. */
  same_error?: {
    questions: number;
    missed_again: number;
    same_cause_again?: number;
    comparable?: number;
    unknown?: number;
    rate: number | null;
    same_cause_rate?: number | null;
    by_error: Array<{ error_type: string; name: string; questions: number; missed_again: number; same_cause_again?: number; comparable?: number; unknown?: number }>;
  };
  collected: number;
  class_size: number;
  /** Copies that arrived after release: not scored. */
  late?: number;
  average: number;
  average_rate?: number;
  highest: number | null;
  lowest: number | null;
  bands: Array<{ label: string; count: number }>;
  questions: Array<{
    number: number;
    question_id?: string;
    question_type: string | null;
    points: number;
    kp_name?: string | null;
    kp_id?: string | null;
    students?: number;
    stem_preview?: string;
    answer?: string | null;
    distribution?: Record<string, number> | null;
    average: number | null;
    rate: number | null;
    parts: Array<{ label: string; points: number; rate: number | null }>;
    errors: ReportErrorCount[];
  }>;
  errors: ReportErrorCount[];
  students: Array<{
    student_id: string;
    display_name: string;
    student_number: string | null;
    submitted: boolean;
    late?: boolean;
    total?: number;
    full_points?: number;
    percent?: number;
    /** The score band the distribution chart counted this student in. */
    band?: string;
    deviation?: number;
    scores?: Record<string, number | null>;
    items?: Array<{
      number: number;
      analysis_number: number | null;
      question_id: string;
      score: number | null;
      max_score: number | null;
      answer: string | null;
      error_type: string | null;
      error_type_name: string | null;
    }>;
    repeated_errors?: string[];
  }>;
  missing?: Array<{ display_name: string; student_number: string | null }>;
  attention: Array<{
    display_name: string;
    student_number: string | null;
    total: number;
    full_points?: number;
    percent?: number;
    deviation: number;
    repeated_errors: string[];
  }>;
}
export interface ClassInvitation { code: string | null; enabled: boolean; expires_at: string | null }
