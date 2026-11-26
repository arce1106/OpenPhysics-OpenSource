import type { ReactNode } from 'react';

interface QuestionBottomBarProps {
  questionId?: string;
  statusForQuestion?: (questionId: string) => ReactNode;
  incompleteMessage?: ReactNode;
  wholePaper?: boolean;
  submissionSummary?: {
    text: string;
    complete: boolean;
    unansweredNumbers?: number[];
  } | null;
  deferredGradingLoading: boolean;
  deferredGradingConfirming: boolean;
  deferredGradingError: string | null;
  deferredGradingProgress: {
    completed: number;
    total: number;
  };
  onCancelDeferredGrading: () => void;
  onConfirmDeferredGrading: () => void;
  children?: ReactNode;
}

export default function QuestionBottomBar({
  questionId,
  statusForQuestion,
  incompleteMessage,
  wholePaper = false,
  submissionSummary,
  deferredGradingLoading,
  deferredGradingConfirming,
  deferredGradingError,
  deferredGradingProgress,
  onCancelDeferredGrading,
  onConfirmDeferredGrading,
  children,
}: QuestionBottomBarProps) {
  const questionStatus = questionId ? statusForQuestion?.(questionId) : null;

  return (
    <>
      {questionStatus && (
        <div className="question-workspace-status">
          {questionStatus}
        </div>
      )}

      {children}

      {deferredGradingLoading ? (
        <div className="question-workspace-submit-confirm-overlay">
          <div className="question-workspace-submit-confirm" role="dialog" aria-modal="true" aria-label="整套批改进度">
            <strong>AI 正在批改{wholePaper ? '整卷' : '整套作答'}</strong>
            <span role="status">已完成 {deferredGradingProgress.completed}/{deferredGradingProgress.total} 题</span>
            <progress aria-label="批改进度" value={deferredGradingProgress.completed} max={Math.max(1, deferredGradingProgress.total)} />
            <span>作答已保留，全部完成后会显示整套结果。</span>
          </div>
        </div>
      ) : null}

      {deferredGradingConfirming && !deferredGradingLoading && (
        <div className="question-workspace-submit-confirm-overlay">
          <div
            className="question-workspace-submit-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-workspace-submit-confirm-title"
            aria-describedby="question-workspace-submit-confirm-description"
          >
            <div>
              <strong id="question-workspace-submit-confirm-title">{wholePaper ? '确认提交整卷？' : '开始整套 AI 批改？'}</strong>
              <span id="question-workspace-submit-confirm-description">
                {wholePaper ? '提交后统一批改，并保存本次作答记录。' : '可留在当前题页等待结果。'}
              </span>
              {submissionSummary && (
                <span className={`question-workspace-submit-summary${submissionSummary.complete ? ' is-complete' : ' is-incomplete'}`}>
                  {submissionSummary.text}
                </span>
              )}
              {!!submissionSummary?.unansweredNumbers?.length && (
                <span>未作答题号：{submissionSummary.unansweredNumbers.join('、')}。确认提交后将按未作答记录。</span>
              )}
            </div>
            <div className="question-workspace-submit-confirm-actions">
              <button type="button" className="question-workspace-nav-button question-workspace-nav-button-secondary" onClick={onCancelDeferredGrading}>
                {wholePaper ? '返回检查' : '暂不提交'}
              </button>
              <button type="button" className="question-workspace-nav-button question-workspace-nav-button-primary" onClick={onConfirmDeferredGrading}>
                {wholePaper ? '确认交卷并批改' : '开始AI批改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deferredGradingError && (
        <div className="error-banner question-workspace-deferred-error">
          {deferredGradingError}
        </div>
      )}

      {submissionSummary ? (
        <div
          className={`question-workspace-answer-summary${submissionSummary.complete ? ' is-complete' : ' is-incomplete'}`}
          role="status"
        >
          {submissionSummary.text}
        </div>
      ) : incompleteMessage ? (
        <div className="question-workspace-incomplete-message">
          {incompleteMessage}
        </div>
      ) : null}
    </>
  );
}
