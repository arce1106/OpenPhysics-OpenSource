import { describe, expect, it } from 'vitest';
import { getPracticeModeCopy, parsePracticeMode } from './practiceModes';

describe('practiceModes', () => {
  it('keeps explicit check mode for post-learning quizzes', () => {
    expect(parsePracticeMode('check')).toBe('check');
    expect(getPracticeModeCopy('check').title).toBe('掌握评估');
    expect(getPracticeModeCopy('check').result).toBe('评估结果');
  });

  it('uses learning-oriented copy for diagnostic mode', () => {
    expect(getPracticeModeCopy('diagnostic').title).toBe('掌握评估');
    expect(getPracticeModeCopy('diagnostic').subtitle).toBe('先判断当前掌握情况');
  });
});
