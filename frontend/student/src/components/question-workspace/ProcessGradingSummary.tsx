import type { ProcessGrading } from '../../types';
import RichContent from './RichContent';
import { processScoreLabel } from '../../utils/resultCredit';

interface ProcessGradingSummaryProps {
  grading: ProcessGrading;
}

export default function ProcessGradingSummary({ grading }: ProcessGradingSummaryProps) {
  const checks = [
    ['模型', grading.model_correct],
    ['方程', grading.equation_correct],
    ['计算', grading.calculation_correct],
    ['单位/方向', grading.unit_correct],
  ] as const;

  const renderCheck = (value: boolean | null | undefined) => {
    if (value === true) return <span className="process-grading-check-value is-correct">正确</span>;
    if (value === false) return <span className="process-grading-check-value is-wrong">需修正</span>;
    return <span className="process-grading-check-value">未判断</span>;
  };

  const hasDetails = grading.first_error || grading.next_action || grading.error_type_name || grading.process_score != null;
  if (!hasDetails) return null;

  return (
    <div className="process-grading-summary">
      <div className="process-grading-summary-header">
        <span>过程批改</span>
        {grading.process_score != null && (
          <span className="process-grading-score">{processScoreLabel(grading)}</span>
        )}
      </div>
      <div className={`process-grading-checks${grading.first_error || grading.next_action || grading.error_type_name ? ' has-details' : ''}`}>
        {checks.map(([label, value]) => (
          <div key={label} className="process-grading-check">
            <span className="process-grading-check-label">{label}</span>
            {renderCheck(value)}
          </div>
        ))}
      </div>
      {grading.error_type_name && grading.error_type !== 'none' && (
        <div className="process-grading-detail">
          <span>错因类型：</span>{grading.error_type_name}
        </div>
      )}
      {grading.first_error && (
        <div className="process-grading-detail">
          <span>第一处问题：</span>
          <RichContent text={grading.first_error} rendered={grading.first_error_rendered} />
        </div>
      )}
      {grading.next_action && (
        <div className="process-grading-detail">
          <span>下一步：</span>
          <RichContent text={grading.next_action} rendered={grading.next_action_rendered} />
        </div>
      )}
    </div>
  );
}
