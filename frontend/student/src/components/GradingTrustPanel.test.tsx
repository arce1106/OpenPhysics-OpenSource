import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GradingTrustPanel from './GradingTrustPanel';
import type { ProcessGrading } from '../types';

describe('GradingTrustPanel', () => {
  it('hides generic empty step rows', () => {
    const grading: ProcessGrading = {
      grading_confidence: 0.9,
      confidence_level: 'high',
      grading_basis: '根据公式运用和计算结果给分，每问3分',
      step_scores: [
        { name: '步骤1', score: 3, max_score: 3, comment: '' },
        { name: '步骤2', score: 3, max_score: 3, comment: '' },
      ],
    };

    render(<GradingTrustPanel grading={grading} />);

    expect(screen.getByText('判分依据：')).toBeInTheDocument();
    expect(screen.queryByText('步骤1')).not.toBeInTheDocument();
    expect(screen.queryByText('步骤2')).not.toBeInTheDocument();
  });

  it('keeps meaningful step rows', () => {
    const grading: ProcessGrading = {
      grading_confidence: 0.9,
      confidence_level: 'high',
      step_scores: [
        { name: '第1问', score: 2, max_score: 2, comment: '列式正确，结果正确。' },
      ],
    };

    render(<GradingTrustPanel grading={grading} />);

    expect(screen.getByText('第1问')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('列式正确，结果正确。')).toBeInTheDocument();
  });

  it('uses rendered rich content for grading basis when available', () => {
    const grading: ProcessGrading = {
      grading_confidence: 0.9,
      confidence_level: 'high',
      grading_basis: 'fallback basis',
      grading_basis_rendered: {
        html: '<span class="katex">F=ma</span>',
        errors: [],
      },
    };

    const { container } = render(<GradingTrustPanel grading={grading} />);

    expect(container.querySelector('.rich-content-rendered .katex')).not.toBeNull();
    expect(screen.queryByText('fallback basis')).not.toBeInTheDocument();
  });
});
