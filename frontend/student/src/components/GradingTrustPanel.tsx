import type { ReactNode } from 'react';
import type { ProcessGrading } from '../types';
import RichContent from './question-workspace/RichContent';

const confidenceCopy: Record<string, { label: string; color: string; bg: string; border: string }> = {
  high: { label: '可信度高', color: '#237804', bg: '#f6ffed', border: '#b7eb8f' },
  medium: { label: '可信度中', color: '#8a5a00', bg: '#fffbe6', border: '#ffe58f' },
  low: { label: '建议人工确认', color: '#a8071a', bg: '#fff1f0', border: '#ffa39e' },
};

export default function GradingTrustPanel({ grading, headerActions }: { grading: ProcessGrading; headerActions?: ReactNode }) {
  const level = grading.confidence_level || (grading.needs_human_review ? 'low' : 'medium');
  const copy = confidenceCopy[level] || confidenceCopy.medium;
  const confidenceText = grading.grading_confidence != null
    ? `${Math.round(grading.grading_confidence * 100)}%`
    : null;
  const displaySteps = (grading.step_scores || []).filter(hasDisplayableStepDetail);
  const hasTrust = grading.grading_basis || displaySteps.length || grading.needs_human_review || confidenceText;
  if (!hasTrust && !headerActions) return null;

  return (
    <div className="grading-trust-panel">
      <div className="grading-trust-head">
        {hasTrust && <span
          className="grading-trust-badge"
          style={{ color: copy.color, background: copy.bg, borderColor: copy.border }}
        >
          {copy.label}{confidenceText ? ` ${confidenceText}` : ''}
        </span>}
        {grading.needs_human_review && (
          <span className="grading-trust-review">建议人工确认后再作为学习结论</span>
        )}
        {headerActions && <div className="grading-trust-actions">{headerActions}</div>}
      </div>
      {grading.grading_basis && (
        <div className="grading-trust-basis">
          <span>判分依据：</span>
          <RichContent text={grading.grading_basis} rendered={grading.grading_basis_rendered} />
        </div>
      )}
      {displaySteps.length > 0 && (
        <div className="grading-step-list">
          {displaySteps.map((step, index) => (
            <div className="grading-step-item" key={`${step.name}-${index}`}>
              <div className="grading-step-title">
                <span>{step.name}</span>
                <span>{step.score}/{step.max_score}</span>
              </div>
              {step.comment && (
                <div className="grading-step-comment">
                  <RichContent text={step.comment} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasDisplayableStepDetail(step: NonNullable<ProcessGrading['step_scores']>[number]) {
  const name = (step.name || '').trim();
  const comment = (step.comment || '').trim();
  const genericName = /^步骤\d+$/.test(name);
  return !!comment || !genericName;
}
