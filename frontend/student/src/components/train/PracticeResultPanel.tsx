import type { ReactNode } from 'react';
import type { MasteryChangeSummary } from '../../utils/practiceSummary';

type PracticeResultTone = 'mastered' | 'practice' | 'study' | 'neutral';

interface PracticeResultPanelProps {
  title: string;
  scoreText: string;
  label: string;
  feedback: string;
  tone?: PracticeResultTone;
  meta?: string;
  masteryChanges?: MasteryChangeSummary[];
  actions: ReactNode;
  className?: string;
}

export default function PracticeResultPanel({
  title,
  scoreText,
  label,
  feedback,
  tone = 'neutral',
  meta,
  masteryChanges = [],
  actions,
  className = '',
}: PracticeResultPanelProps) {
  return (
    <div className={['card train-complete-card practice-result-card', className].filter(Boolean).join(' ')}>
      <div className="train-complete-title">
        {title}
      </div>
      <div className="train-complete-score">
        {scoreText}
      </div>

      <div className={`practice-result-message is-${tone}`}>
        <div className="practice-result-label">
          {label}
        </div>
        <div className="train-complete-next-text">
          {feedback}
        </div>
        {meta && (
          <div className="practice-result-meta">
            {meta}
          </div>
        )}
      </div>

      {masteryChanges.length > 0 && (
        <div className="train-complete-changes">
          <div className="train-complete-section-title">知识点变化</div>
          <div className="train-complete-change-list">
            {masteryChanges.slice(0, 3).map(change => (
              <div key={change.kpId} className="train-complete-change-item">
                <div className="train-complete-change-name">{change.name || change.kpId}</div>
                <div className="train-complete-change-value">
                  {(change.before * 100).toFixed(0)}% → {(change.after * 100).toFixed(0)}%
                </div>
                <div className="train-complete-change-track">
                  <div
                    className="train-complete-change-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, change.after * 100))}%`,
                      background: change.after < 0.5 ? '#ff7a45' : '#14919b',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="train-footer-actions train-complete-actions">
        {actions}
      </div>
    </div>
  );
}
