import type { ImprovementReport } from '../../types';

interface TrainImprovementReportPanelProps {
  report: ImprovementReport;
  onBackToEntry: () => void;
  onBackToPlan?: () => void;
  onBackToDiagnosticAttempt?: () => void;
  onStartNewDiagnostic?: () => void;
  onPrint?: () => void;
  onCopySummary?: () => void;
  copyStatus?: string | null;
  className?: string;
}

function percent(value?: number | null): string {
  if (value === null || value === undefined) return '未完成';
  return `${Math.round(value * 100)}%`;
}

function score(correct?: number | null, total?: number | null): string {
  if (correct === null || correct === undefined || total === null || total === undefined) {
    return '未复测';
  }
  return `${correct}/${total}`;
}

function dateLabel(value?: string | null): string {
  if (!value) return '未提交';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function TrainImprovementReportPanel({
  report,
  onBackToEntry,
  onBackToPlan,
  onBackToDiagnosticAttempt,
  onStartNewDiagnostic,
  onPrint,
  onCopySummary,
  copyStatus,
  className = '',
}: TrainImprovementReportPanelProps) {
  const { summary } = report;
  const diagnosticFeedback = report.diagnosticResult?.feedback;
  const subtitle = summary.completed
    ? `「${summary.scopeName}」本轮提升已完成`
    : `「${summary.scopeName}」提升仍在进行`;

  return (
    <div className={['card train-complete-card train-improvement-report-panel train-printable-report', className].filter(Boolean).join(' ')}>
      <div className="train-complete-title">提升报告</div>
      <div className="train-complete-score">{subtitle}</div>

      <div className="train-report-overview" aria-label="提升报告概览">
        <div className="train-report-metric">
          <span>检测正确率</span>
          <strong>{summary.diagnosticCorrectCount}/{summary.diagnosticTotalCount}</strong>
          <em>{percent(summary.diagnosticAccuracy)}</em>
        </div>
        <div className="train-report-metric">
          <span>提升任务</span>
          <strong>{summary.taskCount}</strong>
          <em>薄弱 {summary.weakTaskCount}</em>
        </div>
        <div className="train-report-metric">
          <span>已通过</span>
          <strong>{summary.passedTaskCount}</strong>
          <em>仍需 {summary.needsRetestTaskCount}</em>
        </div>
        <div className="train-report-metric">
          <span>阶段复测</span>
          <strong>{percent(summary.latestRetestAccuracy)}</strong>
          <em>{summary.retestAttemptCount} 次记录</em>
        </div>
      </div>

      <div className="train-complete-next-step train-report-diagnostic">
        <div className="train-complete-next-title">检测总结</div>
        <div className="train-complete-next-text">
          {diagnosticFeedback || '本轮检测结果已生成提升路径。'}
        </div>
        <div className="train-scope-result-kp-meta">
          初始薄弱点 {summary.weakTaskCount} 个
        </div>
      </div>

      <div className="train-scope-result-section-title">任务明细</div>
      <div className="train-improvement-path">
        {report.tasks.map(task => (
          <div className="train-improvement-task" key={task.taskId}>
            <div className="train-improvement-task-main">
              <span className="train-improvement-task-priority">{task.priority}</span>
              <div>
                <div className="train-scope-result-kp-name">{task.kpName}</div>
                <div className="train-scope-result-kp-meta">
                  检测：{task.diagnosticCorrectCount}/{task.diagnosticTotalCount} ·
                  掌握度：{percent(task.masteryBefore)} → {percent(task.masteryAfterDiagnostic)} ·
                  复测：{score(task.latestRetestCorrectCount, task.latestRetestTotalCount)}
                </div>
                <div className="train-improvement-task-reason">{task.reason}</div>
              </div>
            </div>
            <div className="train-improvement-task-actions">
              <span className="train-improvement-task-status">{task.finalLabel}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="train-scope-result-section-title">复测记录</div>
      <div className="train-report-attempts">
        {report.retestAttempts.length > 0 ? report.retestAttempts.map(attempt => (
          <div className="train-report-attempt" key={attempt.attemptId}>
            <span>{dateLabel(attempt.submittedAt || attempt.createdAt)}</span>
            <strong>{attempt.correctCount}/{attempt.totalCount}</strong>
            <em>通过 {attempt.passedCount} · 补弱 {attempt.needsRetestCount} · {attempt.status}</em>
          </div>
        )) : (
          <div className="train-report-empty-line">暂无复测记录</div>
        )}
      </div>

      <div className="train-report-lists">
        <div>
          <div className="train-scope-result-section-title">优势</div>
          <ul className="train-report-list">
            {(report.strengths.length ? report.strengths : ['本轮提升数据已记录。']).map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="train-scope-result-section-title">仍需关注</div>
          <ul className="train-report-list">
            {(report.remainingWeaknesses.length ? report.remainingWeaknesses : ['暂无需要继续补弱的知识点。']).map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="train-scope-result-section-title">下一步建议</div>
          <ul className="train-report-list">
            {report.nextActions.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="train-footer-actions train-complete-actions train-report-screen-actions">
        <button type="button" onClick={onBackToEntry} className="train-primary-button">
          回到巩固提升首页
        </button>
        {onPrint && (
          <button type="button" onClick={onPrint} className="train-ghost-button">
            打印报告
          </button>
        )}
        {onCopySummary && (
          <button type="button" onClick={onCopySummary} className="train-ghost-button">
            复制摘要
          </button>
        )}
        {onBackToPlan && (
          <button type="button" onClick={onBackToPlan} className="train-ghost-button">
            回到提升路径
          </button>
        )}
        {onBackToDiagnosticAttempt && (
          <button type="button" onClick={onBackToDiagnosticAttempt} className="train-ghost-button">
            回到检测结果
          </button>
        )}
        {onStartNewDiagnostic && (
          <button type="button" onClick={onStartNewDiagnostic} className="train-ghost-button">
            重新检测
          </button>
        )}
        {copyStatus && (
          <span className="train-report-copy-status" role="status">
            {copyStatus}
          </span>
        )}
      </div>
    </div>
  );
}
