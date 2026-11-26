import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProcessGradingSummary from './ProcessGradingSummary';
import type { ProcessGrading } from '../../types';

describe('ProcessGradingSummary', () => {
  it('keeps actual rubric points alongside the percentage', () => {
    render(<ProcessGradingSummary grading={{ score: 8, max_score: 8, process_score: 100 }} />);
    expect(screen.getByText('8/8 分 · 折合 100/100')).toBeInTheDocument();
  });

  it('uses rendered rich content for process feedback fields when available', () => {
    const grading: ProcessGrading = {
      process_score: 60,
      first_error: 'fallback first error',
      first_error_rendered: {
        html: '<span class="katex">v=at</span>',
        errors: [],
      },
    };

    const { container } = render(<ProcessGradingSummary grading={grading} />);

    expect(screen.getByText('第一处问题：')).toBeInTheDocument();
    expect(container.querySelector('.rich-content-rendered .katex')).not.toBeNull();
    expect(screen.queryByText('fallback first error')).not.toBeInTheDocument();
  });
});
