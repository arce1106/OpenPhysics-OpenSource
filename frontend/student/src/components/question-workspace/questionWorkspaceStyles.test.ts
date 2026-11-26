import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function cssBlock(selector: string) {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || '';
}

describe('question workspace shared styles', () => {
  it('keeps header action buttons compact like the print and paper buttons', () => {
    const block = cssBlock('.question-workspace-nav-button');

    expect(block).toContain('font-size: 13px;');
    expect(block).toContain('min-height: 34px;');
    expect(block).toContain('padding: 0 18px;');
  });
});
