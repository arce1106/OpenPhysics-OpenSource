import { describe, expect, it } from 'vitest';
import cases from '../../../shared/username-policy-cases.json';
import { validUsername, usernameLength } from './usernamePolicy';

describe('shared username policy', () => {
  it.each(cases.valid)('accepts %s', value => expect(validUsername(value)).toBe(true));
  it.each(cases.invalid)('rejects %s', value => expect(validUsername(value)).toBe(false));
  it('counts Chinese as two units', () => {
    expect(usernameLength('演示学习者')).toBe(10);
    expect(usernameLength('物理seed_2026')).toBe(13);
  });
});
