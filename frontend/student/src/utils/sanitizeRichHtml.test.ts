import { describe, expect, it } from 'vitest';
import { sanitizeKnowledgeSvg, sanitizeRenderedHtml } from './sanitizeRichHtml';

describe('rich content sanitization', () => {
  it('keeps supported learning markup and removes executable HTML', () => {
    const result = sanitizeRenderedHtml(
      '<table><tbody><tr><td class="katex">v</td></tr></tbody></table>'
      + '<img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(result).toContain('<table>');
    expect(result).toContain('class="katex"');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<script');
  });

  it('keeps diagrams while removing SVG event handlers and scripts', () => {
    const result = sanitizeKnowledgeSvg(
      '<svg onload="alert(1)"><circle cx="5" cy="5" r="4"/><script>alert(2)</script></svg>',
    );

    expect(result).toContain('<circle');
    expect(result).not.toContain('onload');
    expect(result).not.toContain('<script');
  });
});
