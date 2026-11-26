import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import GradingTrustPanel from '../components/GradingTrustPanel';
import LatexSpan from '../components/LatexSpan';
import TeacherPaperVideo from '../components/TeacherPaperVideo';
import AccountAccessPanel from '../components/AccountAccessPanel';
import {
  HistoryAnswerCompare,
  HistoryEmptyState,
  HistoryFilterBar,
  HistoryHeader,
} from '../components/history';
import { QuestionDisplaySurface, RichContent } from '../components/question-workspace';
import { buildReviewMistakePath, filterHistoryRecords, type HistoryResultFilter } from '../utils/historyRecords';
import { navigateBackToPreviousPage } from '../utils/navigation';
import { getStudentProfile } from '../api/studentIdentity';
import { canReadLearningHistory } from '../utils/learningAccess';
import type { AnswerHistoryItem, Question } from '../types';
import { displayCredit, resultCredit } from '../utils/resultCredit';

const formatPoints = (value: number) => String(displayCredit(value));

const RESULT_FILTERS: Array<{ id: HistoryResultFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'correct', label: '做对' },
  { id: 'wrong', label: '做错' },
  { id: 'review', label: '需确认' },
];

const QUESTION_TYPE_LABELS: Record<string, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_in_blank: '填空题',
  knowledge_fill_in_blank: '填空题',
  experiment: '实验题',
  graph_construction: '作图题',
  problem_solving: '解答题',
  comprehensive: '综合题',
};

export default function HistoryPage() {
  const canReadHistory = canReadLearningHistory(getStudentProfile());
  const [records, setRecords] = useState<AnswerHistoryItem[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(canReadHistory);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromDate = searchParams.get('from_date') || undefined;
  const toDate = searchParams.get('to_date') || undefined;
  const resultFilter = parseResultFilter(searchParams.get('result'));
  const isGrowthScoped = searchParams.get('source') === 'growth';
  const headerSubtitle = isGrowthScoped && fromDate && toDate
    ? `成长回顾区间：${fromDate} 至 ${toDate}`
    : '按时间查看最近完成的题目、作答、批改和解析。';

  const fetchRecords = useCallback(async () => {
    if (!canReadHistory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnswerHistory({
        limit: 50,
        from_date: fromDate,
        to_date: toDate,
      });
      setRecords(data);
      if (data.length > 0) setExpanded(new Set([data[0].id]));
    } catch (e: any) {
      setError(e.message || '加载练习记录失败');
    } finally {
      setLoading(false);
    }
  }, [canReadHistory, fromDate, toDate]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const visibleRecords = useMemo(
    () => filterHistoryRecords(records, resultFilter),
    [records, resultFilter],
  );

  const setResultFilter = (next: HistoryResultFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('result'); else params.set('result', next);
    setSearchParams(params);
  };

  const toggleRecord = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <main className="history-workspace">
      <HistoryHeader
        title="练习记录"
        subtitle={headerSubtitle}
        onBack={() => navigateBackToPreviousPage(navigate, location, '/')}
        actions={(
          <HistoryFilterBar
            activeFilter={resultFilter}
            filters={RESULT_FILTERS}
            onChange={setResultFilter}
          />
        )}
      />

      {error && <div className="error-banner">{error}</div>}
      {!canReadHistory ? (
        <AccountAccessPanel
          features={['练习记录', '作答回看', '批改解析', '错题追踪']}
        />
      ) : loading ? (
        <div className="loading">正在整理练习记录...</div>
      ) : visibleRecords.length === 0 ? (
        <HistoryEmptyState title="暂无符合条件的练习记录" />
      ) : (
        <div className="history-timeline">
          {visibleRecords.map(record => (
            <HistoryRecordCard
              key={record.id}
              record={record}
              expanded={expanded.has(record.id)}
              onToggle={() => toggleRecord(record.id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function parseResultFilter(value: string | null): HistoryResultFilter {
  return value === 'correct' || value === 'wrong' || value === 'review' ? value : 'all';
}

function HistoryRecordCard({
  record,
  expanded,
  onToggle,
}: {
  record: AnswerHistoryItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const typeLabel = record.question_type ? QUESTION_TYPE_LABELS[record.question_type] || record.question_type : '题目';
  const kpNames = record.knowledge_points?.map(kp => kp.name).filter(Boolean) || [];
  const needsReview = record.process_grading?.needs_human_review;
  const grading = record.process_grading;
  // Paper homework the teacher has graded: its points, not just right or wrong.
  const teacherPaper = grading?.answer_source === 'teacher_paper';
  const points = grading?.score != null && grading?.max_score != null ? `${formatPoints(grading.score)}/${formatPoints(grading.max_score)} 分` : '';
  const credit = resultCredit(record);
  const dot = record.is_correct || credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'wrong';

  return (
    <section className={`history-record-card${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        className="history-record-summary"
      >
        <span className={`history-result-dot ${dot}`} />
        <span className="history-record-main">
          <span className="history-record-stem">
            <LatexSpan text={record.stem_text ? truncate(record.stem_text, 86) : record.question_id} />
          </span>
          <span className="history-record-tags">
            <HistoryTag text={typeLabel} />
            {kpNames.slice(0, 2).map(name => <HistoryTag key={name} text={name} />)}
            {teacherPaper && <HistoryTag text={points ? `纸质作业 ${points}` : '纸质作业'} />}
            {!teacherPaper && points && <HistoryTag text={points} />}
            {needsReview && <HistoryTag text="建议确认" tone="warn" />}
            {record.lesson_video && <HistoryTag text="有视频讲解" />}
          </span>
        </span>
        <span className="history-record-date">
          {record.created_at ? new Date(record.created_at).toLocaleDateString('zh-CN') : ''}
        </span>
      </button>

      {expanded && (
        <div className="history-detail-panel">
          <HistoryBlock title="题目">
            <QuestionDisplaySurface
              question={historyRecordToQuestion(record)}
              selected={record.given_answer || null}
              isDone
              readOnly
              disabled
            />
          </HistoryBlock>

          <HistoryAnswerCompare record={record} />

          {(record.process_grading || record.lesson_video) && <GradingTrustPanel
            grading={record.process_grading || {}}
            headerActions={record.lesson_video ? <TeacherPaperVideo
              lesson={record.lesson_video} questionId={record.question_id} answerId={record.id} /> : null} />}

          {record.explanation && (
            <HistoryBlock title="解析">
              <RichContent text={record.explanation} rendered={record.explanation_rendered} />
            </HistoryBlock>
          )}

          {!record.is_correct && !record.reviewed_at && (
            <Link className="history-review-link" to={buildReviewMistakePath(record.id)}>
              去错题本复盘
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function HistoryBlock({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone?: 'correct' | 'wrong';
}) {
  return (
    <div className={`history-block history-block-${tone || 'default'}`}>
      <div className="history-block-title">{title}</div>
      {children}
    </div>
  );
}

function HistoryTag({ text, tone }: { text: string; tone?: 'warn' }) {
  return (
    <span className={`history-tag${tone === 'warn' ? ' warn' : ''}`}>{text}</span>
  );
}

function historyRecordToQuestion(record: AnswerHistoryItem): Question {
  return {
    id: record.question_id,
    stem_text: record.stem_text || '',
    question_type: record.question_type || undefined,
    options: record.options || [],
    images: record.images || [],
    correct_answer: record.correct_answer,
    explanation: record.explanation,
    given_answer: record.given_answer,
  };
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
