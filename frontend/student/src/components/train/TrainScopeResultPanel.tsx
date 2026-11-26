import type { ImprovementPlan, ImprovementTask, KnowledgeMasteryJudgment, ScopeDiagnosticResult } from '../../types';
import { getNextActionableImprovementTask, pickNextKpFromImprovementPlan } from '../../utils/improvementPlan';
import { pickNextKpFromScopeResult } from '../../utils/trainScope';

interface ScopeResultColors {
  bg: string;
  border: string;
  text: string;
  label: string;
}

interface TrainScopeResultPanelProps {
  result: ScopeDiagnosticResult;
  plan?: ImprovementPlan | null;
  colors: ScopeResultColors;
  onLearnWeak: (kpId: string) => void;
  onPractice: (kpId: string) => void;
  onStartTask?: (taskId: string) => void;
  onStartRetest?: () => void;
  onViewReport?: () => void;
  retestLoading?: boolean;
  taskJudgments?: Record<string, KnowledgeMasteryJudgment | undefined>;
  onBack: () => void;
  onGoSync: () => void;
  className?: string;
}

function groupTasks(tasks: ImprovementTask[]) {
  const groups = new Map<string, ImprovementTask[]>();
  tasks.forEach(task => {
    const key = task.groupName || '未分组知识点';
    groups.set(key, [...(groups.get(key) || []), task]);
  });
  return Array.from(groups.entries());
}

function taskPracticeAction(
  task: ImprovementTask,
  planStatus: ImprovementPlan['status'],
): { label: string; disabled: boolean } {
  if (task.status === 'passed') {
    return { label: '已通过', disabled: true };
  }
  if (planStatus === 'completed') {
    return { label: '本轮已完成', disabled: true };
  }
  if (task.status === 'practiced' && planStatus === 'ready_for_retest') {
    return { label: '待复测', disabled: true };
  }
  return { label: '专项练', disabled: false };
}

function toMasteryPct(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function diagnosticMasteryAfter(correctCount: number, totalCount: number, masteryBefore: number, masteryAfter: number) {
  if (totalCount > 0 && correctCount <= 0 && masteryAfter > masteryBefore) {
    return masteryBefore;
  }
  return masteryAfter;
}

function MasteryProgress({
  kpName,
  correctCount,
  totalCount,
  masteryBefore,
  masteryAfter,
}: {
  kpName: string;
  correctCount: number;
  totalCount: number;
  masteryBefore: number;
  masteryAfter: number;
}) {
  const beforePct = toMasteryPct(masteryBefore);
  const afterPct = toMasteryPct(diagnosticMasteryAfter(correctCount, totalCount, masteryBefore, masteryAfter));

  return (
    <div className="train-mastery-progress">
      <div className="train-mastery-progress-labels">
        <span>{correctCount}/{totalCount} 正确</span>
        <span>掌握度 {afterPct}%</span>
      </div>
      <div
        className="train-mastery-progress-track"
        role="progressbar"
        aria-label={`${kpName} 掌握度 ${afterPct}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={afterPct}
      >
        <span className="train-mastery-progress-fill" style={{ width: `${afterPct}%` }} />
      </div>
      <div className="train-mastery-progress-change">{beforePct}% → {afterPct}%</div>
    </div>
  );
}

export default function TrainScopeResultPanel({
  result,
  plan,
  colors,
  onLearnWeak,
  onPractice,
  onStartTask,
  onStartRetest,
  onViewReport,
  retestLoading = false,
  onBack,
  className = '',
}: TrainScopeResultPanelProps) {
  const hasWeakKps = (plan?.weakCount ?? result.weak_kp_ids.length) > 0;
  const currentTask = plan ? getNextActionableImprovementTask(plan) : null;
  const nextKpId = plan ? pickNextKpFromImprovementPlan(plan) : pickNextKpFromScopeResult(result);
  const canStartRetest = !!plan && !currentTask && plan.status === 'ready_for_retest';
  const planCompleted = !!plan && plan.status === 'completed';
  const emptyPlan = !!plan && !currentTask && !nextKpId && !canStartRetest && !planCompleted;
  const guidanceText = hasWeakKps
    ? '已经找到薄弱点，建议先完成一组针对性训练，再回看知识和复测。'
    : '本轮检测整体较稳定，可以继续做一组提升训练，检查综合应用能力。';

  return (
    <div
      className={['card train-summary-panel train-scope-result-panel train-scope-complete-card', className].filter(Boolean).join(' ')}
      style={{ padding: '28px 30px' }}
    >
      <div className="train-scope-result-header">
        <button type="button" onClick={onBack} className="page-back-button train-scope-result-back">
          返回
        </button>
        <div className="train-scope-result-title">
          {result.scope_type === 'chapter' ? '本章检测完成' : '本节检测完成'}
        </div>
      </div>
      <div className="train-scope-result-score">
        {result.scope_name}：正确 {result.correct_count}/{result.total_count}
      </div>

      <div
        className="train-scope-result-section train-scope-result-recommendation"
      >
        <div className="train-scope-result-label" style={{ color: colors.text }}>
          {colors.label}
        </div>
        <div className="train-scope-result-feedback">
          {result.feedback}
        </div>
        <div className="train-scope-result-guidance">
          {guidanceText}
        </div>
        {currentTask && (
          <div className="train-scope-result-guidance">
            推荐下一步：先处理「{currentTask.kpName}」。
          </div>
        )}
        {plan && (
          <div className="train-scope-result-guidance">
            已生成 {plan.tasks.length} 个提升任务，当前建议先处理「{currentTask?.kpName || '阶段复测'}」。
          </div>
        )}
      </div>

      {plan ? (
        <>
          <section className="train-scope-result-section train-scope-current-task-section">
            <div className="train-scope-result-section-title">当前推荐任务</div>
            {currentTask ? (
              <div className="train-improvement-current-card">
                <div className="train-improvement-task-content">
                  <div className="train-improvement-task-header">
                    <div className="train-improvement-task-title">
                      <span className="train-improvement-task-priority">{currentTask.priority}</span>
                      <div className="train-improvement-current-step">
                        修复「{currentTask.kpName}」
                      </div>
                    </div>
                  </div>
                  <div className="train-improvement-task-body">
                    <div className="train-improvement-current-reason">{currentTask.reason}</div>
                    <MasteryProgress
                      kpName={currentTask.kpName}
                      correctCount={currentTask.correctCount}
                      totalCount={currentTask.totalCount}
                      masteryBefore={currentTask.masteryBefore}
                      masteryAfter={currentTask.masteryAfter}
                    />
                  </div>
                </div>
                <div className="train-improvement-task-actions">
                  <button
                    type="button"
                    onClick={() => onStartTask ? onStartTask(currentTask.id) : onPractice(currentTask.kpId)}
                    className="train-primary-button"
                  >
                    {currentTask.status === 'in_progress' ? '继续本步提升' : '开始本步提升'}
                  </button>
                  <button type="button" onClick={() => onLearnWeak(currentTask.kpId)} className="train-ghost-button">
                    回看知识
                  </button>
                </div>
              </div>
            ) : (
              <div className="train-improvement-current-card">
                <div>
                  <div className="train-improvement-current-step">
                    {planCompleted
                      ? '本轮提升已通过'
                      : emptyPlan
                        ? '暂无可提升任务'
                        : '本轮提升任务已完成，可以进入阶段复测。'}
                  </div>
                  <div className="train-improvement-current-reason">
                    {planCompleted
                      ? '本轮提升报告已生成，可以查看报告，或回到首页选择新的巩固范围。'
                      : emptyPlan
                        ? '本轮检测没有生成可执行任务，可以返回首页重新检测。'
                        : '用一组阶段复测确认刚才补弱是否真正稳定。'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={planCompleted ? onViewReport : onStartRetest}
                  disabled={planCompleted ? !onViewReport : (!canStartRetest || retestLoading || !onStartRetest)}
                  className="train-primary-button"
                >
                  {planCompleted
                    ? '查看提升报告'
                    : emptyPlan
                      ? '暂无可提升任务'
                      : retestLoading
                        ? '启动中...'
                        : '开始阶段复测'}
                </button>
              </div>
            )}
          </section>

          <section className="train-scope-result-section train-scope-path-section">
            <div className="train-scope-result-section-title">提升路径</div>
            <div className="train-improvement-path">
              {groupTasks(plan.tasks).map(([groupName, tasks]) => (
                <div className="train-improvement-group" key={groupName}>
                  <div className="train-improvement-group-title">{groupName}</div>
                  {tasks.map(task => {
                    const action = taskPracticeAction(task, plan.status);
                    return (
                      <div className="train-improvement-task" key={task.id}>
                        <div className="train-improvement-task-content">
                          <div className="train-improvement-task-header">
                            <div className="train-improvement-task-title">
                              <span className="train-improvement-task-priority">{task.priority}</span>
                              <div className="train-scope-result-kp-name">{task.kpName}</div>
                            </div>
                          </div>
                          <div className="train-improvement-task-body">
                            <div className="train-improvement-task-reason">{task.reason}</div>
                            <MasteryProgress
                              kpName={task.kpName}
                              correctCount={task.correctCount}
                              totalCount={task.totalCount}
                              masteryBefore={task.masteryBefore}
                              masteryAfter={task.masteryAfter}
                            />
                          </div>
                        </div>
                        <div className="train-improvement-task-actions">
                          <button type="button" onClick={() => onLearnWeak(task.kpId)} className="train-ghost-button">
                            回看知识
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (action.disabled) return;
                              if (onStartTask) onStartTask(task.id);
                              else onPractice(task.kpId);
                            }}
                            disabled={action.disabled}
                            className="train-primary-button train-mini-button"
                          >
                            {action.label}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="train-scope-result-section train-scope-knowledge-section">
          <div className="train-scope-result-section-title">知识点结果</div>
          <div className="train-scope-result-list">
            {result.kp_results.map(item => {
              const isWeak = result.weak_kp_ids.includes(item.kp_id);
              return (
                <div
                  key={item.kp_id}
                  className="train-scope-result-item"
                >
                  <div className="train-scope-result-item-content">
                    <div className="train-scope-result-item-header">
                      <div className="train-scope-result-kp-name">{item.kp_name}</div>
                    </div>
                    <div className="train-scope-result-item-body">
                      <MasteryProgress
                        kpName={item.kp_name}
                        correctCount={item.correct_count}
                        totalCount={item.total_count}
                        masteryBefore={item.mastery_before}
                        masteryAfter={item.mastery_after}
                      />
                    </div>
                  </div>
                  <div className="train-scope-result-kp-actions">
                    {isWeak && (
                      <button type="button" onClick={() => onLearnWeak(item.kp_id)} className="train-ghost-button">
                        回看知识
                      </button>
                    )}
                    <button type="button" onClick={() => onPractice(item.kp_id)} className="train-primary-button train-mini-button">
                      专项练
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
