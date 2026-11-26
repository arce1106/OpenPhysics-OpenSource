import { createHash } from 'node:crypto';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  renderRichContent,
  renderRichContentStrict,
} from './renderRichContent';

describe('renderRichContent', () => {
  it('renders plain text without KaTeX markup', () => {
    const rendered = renderRichContent({ text: '这是一段普通说明' });

    expect(rendered.hasMath).toBe(false);
    expect(rendered.hasImage).toBe(false);
    expect(rendered.hasMarkdownTable).toBe(false);
    expect(rendered.html).toBe('这是一段普通说明');
    expect(rendered.html).not.toContain('katex');
    expect(rendered.plainText).toBe('这是一段普通说明');
    expect(rendered.renderer).toBe('katex');
    expect(rendered.rendererVersion).toBeTruthy();
    expect(rendered.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rendered.errors).toEqual([]);
  });

  it('uses SHA-256 for contentHash', () => {
    const rendered = renderRichContent({
      text: 'hash 校验',
    });
    const expectedPayload = JSON.stringify({
      text: 'hash 校验',
      imagePaths: [],
      renderer: 'katex',
      rendererVersion: (katex as { version?: string }).version,
      rulesVersion: 'rich-content-v1',
    });

    expect(rendered.contentHash).toBe(createHash('sha256').update(expectedPayload).digest('hex'));
  });

  it('renders inline formulas with KaTeX and no scripts', () => {
    const rendered = renderRichContent({ text: String.raw`由 $v=v_0+at$ 可得` });

    expect(rendered.hasMath).toBe(true);
    expect(rendered.html).toContain('katex');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('MathJax');
    expect(rendered.renderer).toBe('katex');
    expect(rendered.plainText).toContain(String.raw`v=v_0+at`);
  });

  it('renders fraction formulas', () => {
    const rendered = renderRichContent({ text: String.raw`动能为 $E_k=\frac{1}{2}mv^2$` });

    expect(rendered.errors).toEqual([]);
    expect(rendered.html).toContain('katex');
    expect(rendered.html).toContain('mfrac');
  });

  it('renders greek letters and subscripts', () => {
    const rendered = renderRichContent({
      text: String.raw`$U_{MN}$、$\Delta x$、$\theta$`,
    });

    expect(rendered.errors).toEqual([]);
    expect(rendered.html).toContain('katex');
    expect(rendered.html).toContain('theta');
  });

  it('renders Chinese text inside LaTeX text commands', () => {
    const rendered = renderRichContent({ text: String.raw`$\text{方向向右}$` });

    expect(rendered.errors).toEqual([]);
    expect(rendered.html).toContain('katex');
    expect(rendered.html).toContain('方向向右');
  });

  it('renders Markdown tables and formulas inside cells', () => {
    const rendered = renderRichContent({
      text: [
        '| 序号 | 1 | 2 |',
        '| --- | --- | --- |',
        String.raw`| 速度 | $v_1$ | $v_2$ |`,
      ].join('\n'),
    });

    expect(rendered.hasMarkdownTable).toBe(true);
    expect(rendered.html).toContain('<table');
    expect(rendered.html).toContain('<thead>');
    expect(rendered.html).toContain('<tbody>');
    expect(rendered.html).toContain('katex');
    expect(rendered.plainText).toContain('速度');
  });

  it('renders image placeholders as identifiable images', () => {
    const rendered = renderRichContent({
      text: '如图所示 {{IMG:0}}',
      imagePaths: ['http://example.test/a.png'],
    });

    expect(rendered.hasImage).toBe(true);
    expect(rendered.html).toContain('http://example.test/a.png');
    expect(rendered.html).toContain('data-openphysics-image-index="0"');
    expect(rendered.errors).toEqual([]);
  });

  it('escapes HTML in text content', () => {
    const rendered = renderRichContent({ text: 'a < b && c > d' });

    expect(rendered.html).toContain('a &lt; b &amp;&amp; c &gt; d');
    expect(rendered.html).not.toContain('< b');
    expect(rendered.html).not.toContain('c > d');
  });

  it('reports KaTeX errors in strict mode without throwing', () => {
    let rendered: ReturnType<typeof renderRichContentStrict> | undefined;

    expect(() => {
      rendered = renderRichContentStrict({
        text: '错误公式 $\\notARealCommand{1}$',
      });
    }).not.toThrow();

    expect(rendered).toBeDefined();
    expect(rendered!.errors.length).toBeGreaterThan(0);
    expect(rendered!.errors[0].type).toBe('katex');
    expect(rendered!.errors[0].latex).toContain('notARealCommand');
    expect(rendered!.html).toContain('错误公式');
  });

  it('keeps content hashes stable for identical input', () => {
    const input = {
      text: String.raw`由 $v=v_0+at$ 可得 {{IMG:0}}`,
      imagePaths: ['http://example.test/a.png'],
    };

    const first = renderRichContent(input);
    const second = renderRichContent(input);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes content hash when text or image paths change', () => {
    const base = renderRichContent({
      text: '如图所示 {{IMG:0}}',
      imagePaths: ['http://example.test/a.png'],
    });
    const textChanged = renderRichContent({
      text: '另如图所示 {{IMG:0}}',
      imagePaths: ['http://example.test/a.png'],
    });
    const imageChanged = renderRichContent({
      text: '如图所示 {{IMG:0}}',
      imagePaths: ['http://example.test/b.png'],
    });

    expect(textChanged.contentHash).not.toBe(base.contentHash);
    expect(imageChanged.contentHash).not.toBe(base.contentHash);
  });

  it('uses the installed KaTeX package version for rendererVersion', () => {
    const rendered = renderRichContent({
      text: '版本测试',
      rendererVersion: 'fake-version',
    });

    expect(rendered.rendererVersion).toBe((katex as { version?: string }).version);
  });

  it('records real offsets for repeated strict formula errors', () => {
    const firstToken = String.raw`$\notARealCommand{1}$`;
    const secondToken = String.raw`$\notARealCommand{1}$`;
    const text = `第一次 ${firstToken} 第二次 ${secondToken}`;

    const rendered = renderRichContentStrict({
      text,
    });

    expect(rendered.errors.length).toBeGreaterThanOrEqual(2);
    expect(rendered.errors[0].position).toBe(text.indexOf(firstToken));
    expect(rendered.errors[1].position).toBe(text.lastIndexOf(secondToken));
    expect(rendered.errors[1].position).not.toBe(rendered.errors[0].position);
  });

  it('records KaTeX errors in display mode while keeping fallback HTML', () => {
    const rendered = renderRichContent({
      text: '错误公式 $\\notARealCommand{1}$',
    });

    expect(rendered.errors.length).toBeGreaterThan(0);
    expect(rendered.errors[0].type).toBe('katex');
    expect(rendered.html).toContain('错误公式');
  });
});
