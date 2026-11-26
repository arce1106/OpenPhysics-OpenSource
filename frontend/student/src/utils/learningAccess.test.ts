import { expect, it } from 'vitest';
import { canAccessKp, hasLearningAccess } from './learningAccess';

it('opens every knowledge point for an active account', () => {
  const profile = { id: 'demo', username: 'demo', display_name: '演示', status: 'active' };
  expect(hasLearningAccess(profile)).toBe(true);
  expect(canAccessKp(profile, { volume: '选择性必修 第三册', chapter: '第五章 原子核', section: '5.5 “基本”粒子' })).toBe(true);
});

it('does not grant access to absent or disabled accounts', () => {
  expect(hasLearningAccess(null)).toBe(false);
  expect(hasLearningAccess({ id: 'demo', username: 'demo', display_name: '演示', status: 'disabled' })).toBe(false);
});
