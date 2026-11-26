import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RichContent from './RichContent';

describe('RichContent', () => {
  it('uses rendered html when the rendered content is valid', () => {
    const { container } = render(
      <RichContent
        text="fallback text"
        rendered={{
          html: '<p><span class="katex">v=at</span></p>',
          renderer: 'katex',
          errors: [],
        }}
      />,
    );

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(screen.queryByText('fallback text')).not.toBeInTheDocument();
  });

  it('falls back to text rendering when rendered html has errors', () => {
    const { container } = render(
      <RichContent
        text="fallback text"
        rendered={{
          html: '<p><span class="katex">broken</span></p>',
          renderer: 'katex',
          errors: [{ message: 'broken formula' }],
        }}
      />,
    );

    expect(screen.getByText('fallback text')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeNull();
  });

  it('renders Markdown tables when pre-rendered content is unavailable', () => {
    const { container } = render(
      <RichContent
        text={[
          '实验数据如下：',
          '| 次数 | 1 | 2 |',
          '| --- | --- | --- |',
          '| 速度 | 2 m/s | 4 m/s |',
        ].join('\n')}
      />,
    );

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('th')?.textContent).toBe('次数');
    expect(screen.queryByText('| --- | --- | --- |')).not.toBeInTheDocument();
  });
});
