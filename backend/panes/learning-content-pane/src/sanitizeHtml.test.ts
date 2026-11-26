import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { sanitizeRenderedHtml } from './sanitizeHtml';

describe('sanitizeRenderedHtml', () => {
  it('preserves KaTeX and table markup while removing executable content', () => {
    const result = sanitizeRenderedHtml(
      '<table><tbody><tr><td class="katex">v</td></tr></tbody></table>'
      + '<img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(result).toContain('<table>');
    expect(result).toContain('class="katex"');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<script');
  });

  it('preserves the sanitized svg paths KaTeX uses to draw square roots', () => {
    const rendered = katex.renderToString(
      String.raw`t_{1}:t_{2}:t_{3}=(\sqrt{3}-\sqrt{2}):(\sqrt{2}-1):1`,
      { throwOnError: false },
    );
    const result = sanitizeRenderedHtml(
      `${rendered.replace('<svg ', '<svg onload="alert(1)" ')}<script>alert(2)</script>`,
    );

    expect(result.match(/<svg/g)).toHaveLength(3);
    expect(result.match(/<path/g)).toHaveLength(3);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('<script');
  });
});
