import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {PracticeAttemptContext,TeacherPaperAttemptContext,TopicSubmissionContext,optionalAttemptScope} from '../PracticeAttemptContext';
import { api } from '../../api/client';
import type { Question, SubmitResult } from '../../types';
import {
  buildSelfReviewItems,
  canSelfReviewQuestion,
  type SelfReviewDraft,
  type SelfReviewItem,
  type SelfReviewStatus,
} from '../../utils/selfReview';
import RichContent from './RichContent';

interface SelfReviewPanelProps {
  question: Question;
  disabled?: boolean;
  deferredGrading?: boolean;
  draft?: SelfReviewDraft | null;
  getTimeSpentMs?: () => number;
  onDraftChange?: (draft: SelfReviewDraft | null) => void;
  onResult?: (result: SubmitResult) => void;
  renderLayout?: (parts: { trigger: ReactNode; body: ReactNode | null; expanded: boolean }) => ReactNode;
}

function questionAnswer(question: Question) {
  return question.correct_answer || question.answer || '';
}

function withDraftStatus(items: SelfReviewItem[], draft?: SelfReviewDraft | null) {
  if (!draft?.items?.length) return items;
  const statusByLabel = new Map(draft.items.map(item => [item.label, item.status]));
  return items.map(item => ({
    ...item,
    status: statusByLabel.get(item.label) || item.status,
  }));
}

export default function SelfReviewPanel({
  question,
  disabled,
  deferredGrading,
  draft,
  getTimeSpentMs,
  onDraftChange,
  onResult,
  renderLayout,
}: SelfReviewPanelProps) {
  const attemptScope=useContext(PracticeAttemptContext);
  const teacherPaperAttempt = useContext(TeacherPaperAttemptContext);
  const topicContext = useContext(TopicSubmissionContext);
  const answer = questionAnswer(question);
  const explanation = question.explanation || '';
  const initialItems = useMemo(
    () => buildSelfReviewItems(question, answer),
    [answer, question],
  );
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<SelfReviewItem[]>(() => withDraftStatus(initialItems, draft));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(!!draft?.items?.length);

  useEffect(() => {
    setItems(withDraftStatus(initialItems, draft));
    setSaved(!!draft?.items?.length);
    setError(null);
  }, [draft, initialItems, question.id]);

  if (!canSelfReviewQuestion(question)) return null;

  const complete = items.length > 0 && items.every(item => !!item.status);

  const updateItem = (itemIndex: number, status: SelfReviewStatus) => {
    setSaved(false);
    setError(null);
    setItems(prev => prev.map((item, index) => (
      index === itemIndex ? { ...item, status } : item
    )));
  };

  const normalizedItems = () => items.map(item => ({
    label: item.label,
    status: item.status || 'wrong',
  }));

  const handleSubmit = async () => {
    if (disabled || loading) return;
    if (!complete) {
      setError('请先完成每一小问的自评');
      return;
    }
    const payload = {
      question_id: question.id,
      items: normalizedItems(),
      time_spent_ms: getTimeSpentMs?.() ?? 0,
      target_knowledge_point_id: question.target_knowledge_point_id,
    };

    if (deferredGrading) {
      onDraftChange?.({
        items: payload.items,
        time_spent_ms: payload.time_spent_ms,
      });
      setSaved(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await teacherPaperAttempt?.beforeSubmit?.();
      const result = await api.submitSelfReview({ ...(topicContext && { topic_context: topicContext }), ...payload, ...(teacherPaperAttempt && { teacher_paper_attempt_id: teacherPaperAttempt.id }) },...optionalAttemptScope(attemptScope));
      onResult?.(result);
    } catch (e: any) {
      setError(e.message || '自评提交失败');
    } finally {
      setLoading(false);
    }
  };

  const trigger = (
      <button
        type="button"
        className="paper-self-review-toggle"
        onClick={() => setExpanded(value => !value)}
        disabled={disabled}
        aria-expanded={expanded}
      >
        对照解析自评
      </button>
  );

  const body = expanded ? (
      <div className="paper-self-review-body">
          <div className="paper-batch-result">
            <div>
              <span>标准答案：</span>
              <RichContent text={answer || '暂无标准答案'} rendered={question.correct_answer_rendered} />
            </div>
            {explanation && (
              <div>
                <span>解析：</span>
                <RichContent text={explanation} rendered={question.explanation_rendered} />
              </div>
            )}
          </div>

          <div className="paper-self-review-list">
            {items.map((item, itemIndex) => (
              <div className="paper-self-review-item" key={`${question.id}-${item.label}`}>
                <span>{item.label}</span>
                <div className="paper-self-review-actions">
                  {[
                    ['correct', '全对'],
                    ['partial', '半对'],
                    ['wrong', '不会'],
                  ].map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      className={item.status === status ? 'active' : ''}
                      onClick={() => updateItem(itemIndex, status as SelfReviewStatus)}
                      disabled={disabled || loading}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="paper-self-review-submit"
            disabled={disabled || loading || !complete}
            onClick={handleSubmit}
          >
            {loading ? '提交中...' : deferredGrading ? '保存自评' : '提交自评'}
          </button>
          {saved && deferredGrading && (
            <div className="paper-self-review-saved">已保存，整套提交时会按自评记录入库。</div>
          )}
          {error && <div className="paper-batch-error">{error}</div>}
      </div>
  ) : null;

  if (renderLayout) {
    return <>{renderLayout({ trigger, body, expanded })}</>;
  }

  return (
    <div className="paper-self-review question-self-review">
      {trigger}
      {body}
    </div>
  );
}
