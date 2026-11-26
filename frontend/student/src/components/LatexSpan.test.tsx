import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizeMathText, renderLatexInline, StemContent } from './LatexSpan';

describe('LatexSpan math text normalization', () => {
  it('repairs LaTeX fraction text broken by JSON control escapes', () => {
    const result = normalizeMathText('t_{3}=' + '\f' + 'rac{v_{1}}{a_{2}} = 4s');

    expect(result).toBe(String.raw`$t_{3}=\frac{v_{1}}{a_{2}} = 4s$`);
  });

  it('wraps naked AI-recognized formulas so KaTeX can render them', () => {
    const result = normalizeMathText(String.raw`v=v_0+\frac{1}{2}at^2`);

    expect(result).toBe(String.raw`$v=v_0+\frac{1}{2}at^{2}$`);
    expect(typeof renderLatexInline(result)[0]).toBe('object');
  });

  it('wraps formula fragments inside Chinese feedback', () => {
    const result = normalizeMathText(String.raw`第一问 t_{3}=\frac{v_{1}}{a_{2}} = 4s 正确。`);

    expect(result).toBe(String.raw`第一问 $t_{3}=\frac{v_{1}}{a_{2}} = 4s$ 正确。`);
  });

  it('normalizes bare exponents in mixed Chinese formula feedback', () => {
    const result = normalizeMathText(String.raw`先由 h=1/2gt^2 求时间，再由 v=gt 求速度。`);

    expect(result).toBe(String.raw`先由 $h=1/2gt^{2}$ 求时间，再由 $v=gt$ 求速度。`);
  });

  it('keeps the interval tilde visible inside rendered formulas', () => {
    const [rendered] = renderLatexInline(String.raw`$t_{1}~t_{2}$`);

    expect(typeof rendered).toBe('object');
    expect((rendered as { __html: string }).__html).toContain('∼');
  });

  it('does not corrupt decimal-ended trig constants before Chinese punctuation', () => {
    const text = String.raw`其余电阻不计，$\sin53^\circ=0.8$，$\cos53^\circ=0.6$，$g$取$10\,m/s^{2}$。`;

    expect(normalizeMathText(text)).toBe(text);

    const rendered = renderLatexInline(text);
    const htmlParts = rendered.filter((part): part is { __html: string } => typeof part !== 'string' && '__html' in part);

    expect(htmlParts).toHaveLength(4);
    expect(htmlParts.some(part => part.__html.includes('katex-error'))).toBe(false);
  });

  it('does not treat fill-in blanks with units as formulas', () => {
    const text = '距离是____ cm，时间间隔T=____ s，速度是____ m/s。';

    expect(normalizeMathText(text)).toBe(text);
    expect(renderLatexInline(text).every(part => typeof part === 'string')).toBe(true);
  });

  it('renders naked simple equations outside existing math spans', () => {
    const text = String.raw`捏住位置在刻度尺上的示数x=5 cm，重力加速度g取$10\,m/s^{2}$，解得t=0.1 s。`;
    const normalized = normalizeMathText(text);

    expect(normalized).toBe(String.raw`捏住位置在刻度尺上的示数$x=5 cm$，重力加速度g取$10\,m/s^{2}$，解得$t=0.1 s$。`);

    const htmlParts = renderLatexInline(text).filter((part): part is { __html: string } => typeof part !== 'string' && '__html' in part);
    expect(htmlParts).toHaveLength(3);
    expect(htmlParts.some(part => part.__html.includes('katex-error'))).toBe(false);
  });
});

describe('StemContent markdown tables', () => {
  it('renders question Markdown tables as bordered HTML tables', () => {
    const { container } = render(
      <StemContent
        text={[
          '记录如下：',
          '| 实验序号 | 1 | 2 | 3 | 4 | 5 |',
          '| --- | --- | --- | --- | --- | --- |',
          '| 封闭气柱长度 $L/cm$ | 12.00 | 11.00 | 10.00 | 9.00 | 8.00 |',
          '| 封闭气柱压强 $p/(\\times 10^5 Pa)$ | 1.00 | 1.09 | 1.19 | 1.33 | 1.90 |',
          '求压强变化。',
        ].join('\n')}
      />,
    );

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(table?.textContent).toContain('实验序号');
    expect(table?.textContent).toContain('12.00');
    expect(screen.queryByText('| --- | --- | --- | --- | --- | --- |')).not.toBeInTheDocument();
  });

  it('keeps standalone inline question images tight against surrounding stem lines', () => {
    const { container } = render(
      <StemContent
        text={'题干说明\n{{IMG:0}}\n(1)继续作答'}
        imagePaths={['/diagram.png']}
      />,
    );

    expect(container.querySelector('.math-image-block')).toBeInTheDocument();
    expect(container.textContent).toBe('题干说明(1)继续作答');
  });
});
