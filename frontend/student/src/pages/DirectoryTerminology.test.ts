import { describe, expect, it } from 'vitest';
import { DIRECTORY_ASSESSMENT_COPY } from './DirectoryPage';

describe('DirectoryPage student-facing terminology', () => {
  it('uses mastery assessment wording instead of legacy diagnostic/test labels', () => {
    const copy = Object.values(DIRECTORY_ASSESSMENT_COPY).join('\n');

    expect(copy).toContain('掌握评估');
    expect(copy).not.toMatch(/快速诊断|范围诊断|提交诊断|诊断结果|本章测试|本节测试|参与诊断/);
  });
});
