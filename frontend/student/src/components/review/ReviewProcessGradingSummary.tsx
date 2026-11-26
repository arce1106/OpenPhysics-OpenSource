import GradingTrustPanel from '../GradingTrustPanel';
import RichContent from '../question-workspace/RichContent';
import type { ProcessGrading } from '../../types';
import { processScoreLabel } from '../../utils/resultCredit';

export default function ReviewProcessGradingSummary({ grading }: { grading: ProcessGrading }) {
  const rows = [
    ['模型', grading.model_correct],
    ['方程', grading.equation_correct],
    ['计算', grading.calculation_correct],
    ['单位/方向', grading.unit_correct],
  ] as const;
  const mark = (value: boolean | null | undefined) => {
    if (value === true) return <span className="review-process-value is-correct">正确</span>;
    if (value === false) return <span className="review-process-value is-wrong">需修正</span>;
    return <span className="review-process-value">未判断</span>;
  };

  return (
    <>
      <GradingTrustPanel grading={grading} />
      <div className="review-process-grading-summary">
        <div className="review-process-grading-header">
          <span>过程批改</span>
          {grading.process_score != null && <span>{processScoreLabel(grading)}</span>}
        </div>
        <div
          className={[
            'review-process-grading-checks',
            grading.error_type_name || grading.first_error || grading.next_action ? 'has-details' : '',
          ].filter(Boolean).join(' ')}
        >
          {rows.map(([label, value]) => (
            <div key={label} className="review-process-grading-check">
              <span className="review-process-label">{label}</span>
              {mark(value)}
            </div>
          ))}
        </div>
        {grading.error_type_name && grading.error_type !== 'none' && (
          <div className="review-process-detail">错因类型：{grading.error_type_name}</div>
        )}
        {grading.first_error && (
          <div className="review-process-detail">第一处问题：<RichContent text={grading.first_error} rendered={grading.first_error_rendered} /></div>
        )}
        {grading.next_action && (
          <div className="review-process-detail">下一步：<RichContent text={grading.next_action} rendered={grading.next_action_rendered} /></div>
        )}
      </div>
    </>
  );
}
