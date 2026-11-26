import { Link } from 'react-router-dom';
import type { AssignmentDetail } from '../types';

type Step = 'print' | 'collect' | 'review' | 'report';

const STEPS: Array<{ key: Step; label: string; path: string }> = [
  { key: 'print', label: '打印作业', path: 'print' },
  { key: 'collect', label: '收卷', path: 'collect' },
  { key: 'review', label: '预批与审核', path: 'review' },
  { key: 'report', label: '发布与报告', path: 'report' },
];

/** Where a published homework stands, so only the next action is highlighted. */
export function currentStep(detail: Pick<AssignmentDetail, 'collected' | 'results_released_at'>): Step {
  if (detail.results_released_at) return 'report';
  if (detail.collected) return 'review';
  return 'collect';
}

export default function AssignmentSteps({ detail, active }: { detail: AssignmentDetail; active?: Step }) {
  const next = currentStep(detail);
  // App first still prints and collects for students on paper; only an all-App homework skips those steps.
  const appDelivery = detail.settings?.delivery === 'app' && !(detail.papers ?? []).some((p) => p.delivery === 'paper' && !p.missing);
  const steps = appDelivery ? STEPS.filter((step) => step.key !== 'print').map((step) => step.key === 'collect'
    ? { ...step, label: '学生作答', path: '?tab=students' } : step) : STEPS;
  return (
    <ol className="steps" aria-label="作业进度">
      {steps.map((step, index) => {
        // On a step's own page only that step is lit; elsewhere the next thing to do is.
        const classes = ['step', !active && step.key === next ? 'next' : '', step.key === active ? 'active' : ''].join(' ');
        return (
          <li key={step.key} className={classes}>
            <Link to={step.key === 'report' ? `/assignments/${detail.id}${detail.results_released_at ? '?tab=overview' : '/review'}` : `/assignments/${detail.id}${appDelivery && step.key === 'collect' ? '' : '/'}${step.path}`} target={step.key === 'print' ? '_blank' : undefined}>
              <span className="step-index">{index + 1}</span>{step.label}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
