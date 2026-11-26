import type { ImprovementRetestResult, KnowledgeMasteryJudgment } from '../../types';
import { getRetestJudgmentLabel } from '../../utils/knowledgeMasteryJudgment';

interface TrainRetestResultPanelProps {
  result: ImprovementRetestResult;
  onContinueWeak: () => void;
  onBackToPlan: () => void;
  onBackToEntry: () => void;
  onViewReport?: () => void;
  taskJudgments?: Record<string, KnowledgeMasteryJudgment | undefined>;
  className?: string;
}

const EMPTY_TASK_JUDGMENTS: Record<string, KnowledgeMasteryJudgment | undefined> = {};

function RetestJudgmentBadge({ label }: { label: string }) {
  return (
    <span className="train-task-judgment-badge" aria-label={`统一判断：${label}`}>
      {label}
    </span>
  );
}

export default function TrainRetestResultPanel({
  result,
  onContinueWeak,
  onBackToPlan,
  onBackToEntry,
  onViewReport,
  taskJudgments = EMPTY_TASK_JUDGMENTS,
  className = '',
}: TrainRetestResultPanelProps) {
  const completed = result.plan.status === 'completed';

  return (
    <div className={['card train-complete-card train-retest-result-panel', className].filter(Boolean).join(' ')} style={{ padding: '32px 30px' }}>
      <div className="train-complete-title">阶段复测完成</div>
      <div className="train-complete-score">
        正确 {result.correctCount}/{result.totalCount} · 已通过 {result.passedCount} 项 · 仍需补弱 {result.needsRetestCount} 项
      </div>

      <div className="train-complete-next-step">
        <div className="train-complete-next-title">
          {completed ? '本轮提升已通过' : '还有知识点需要继续补弱'}
        </div>
        <div className="train-complete-next-text">
          {completed
            ? '这轮提升路径已经闭环，可以回到巩固提升首页选择新的范围。'
            : '先处理仍不稳定的知识点，完成一组针对性训练后再回到复测。'}
        </div>
      </div>

      <div className="train-improvement-path">
        {result.taskResults.map(item => {
          const judgmentLabel = getRetestJudgmentLabel(item, taskJudgments[item.kpId]);
          return (
            <div className="train-improvement-task" key={item.taskId}>
              <div className="train-improvement-task-main">
                <span className="train-improvement-task-priority">{item.passed ? '过' : '补'}</span>
                <div>
                  <div className="train-scope-result-kp-name">{item.kpName}</div>
                  <div className="train-scope-result-kp-meta">
                    {item.correctCount}/{item.totalCount} 正确 · 掌握度 {(Number(item.masteryBefore ?? 0) * 100).toFixed(0)}% → {(Number(item.masteryAfter ?? 0) * 100).toFixed(0)}%
                  </div>
                  <div className="train-improvement-task-reason">{item.feedback}</div>
                  {judgmentLabel && (
                    <RetestJudgmentBadge label={judgmentLabel} />
                  )}
                </div>
              </div>
              <div className="train-improvement-task-actions">
                <span className="train-improvement-task-status">
                  {item.passed ? '已通过' : '仍需补弱'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="train-footer-actions train-complete-actions">
        {completed && onViewReport && (
          <button type="button" onClick={onViewReport} className="train-primary-button">
            查看提升报告
          </button>
        )}
        {!completed && (
          <button type="button" onClick={onContinueWeak} className="train-primary-button">
            继续补弱
          </button>
        )}
        <button type="button" onClick={onBackToPlan} className={completed && onViewReport ? 'train-ghost-button' : completed ? 'train-primary-button' : 'train-ghost-button'}>
          回到提升路径
        </button>
        <button type="button" onClick={onBackToEntry} className="train-ghost-button">
          回到巩固提升首页
        </button>
      </div>
    </div>
  );
}
