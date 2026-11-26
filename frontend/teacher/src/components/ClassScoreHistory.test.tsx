import { expect, test } from 'vitest';
import { nextScoreSort, sortScoreHistory } from './ClassScoreHistory';
import type { ClassHomework } from '../types';

const student = (id: string, number: string | null, name: string, scores: Record<string, { score: number; full: number | null }>, missing: string[] = []) =>
  ({ student_id: id, student_number: number, display_name: name, scores, missing });

const roster: ClassHomework['students'] = [
  student('s_1', '1', '高欣欣', { t: { score: 40, full: 44 }, p: { score: 9, full: 12 } }),
  student('s_2', '2', '邱译娴', { t: { score: 34, full: 44 } }, ['p']),
  student('s_3', '10', '袁泽宇', { t: { score: 44, full: 44 }, p: { score: 10, full: 10 } }),
  student('s_4', '3', '胡振洋', {}),
];
const ids = (sorted: typeof roster) => sorted.map((s) => s.student_id);

test('scores sort by rate, so different personalized full scores compare fairly', () => {
  // 10/10 beats 9/12 even though 9/12 was out of more points.
  expect(ids(sortScoreHistory(roster, { key: 'p', dir: 'desc' }))).toEqual(['s_3', 's_1', 's_2', 's_4']);
  expect(ids(sortScoreHistory(roster, { key: 't', dir: 'desc' }))).toEqual(['s_3', 's_1', 's_2', 's_4']);
});

test('students without a score stay last in either direction', () => {
  expect(ids(sortScoreHistory(roster, { key: 'p', dir: 'asc' }))).toEqual(['s_1', 's_3', 's_2', 's_4']);
  expect(ids(sortScoreHistory(roster, { key: 't', dir: 'asc' }))).toEqual(['s_2', 's_1', 's_3', 's_4']);
});

test('student numbers sort as numbers and no sort keeps the server order', () => {
  expect(ids(sortScoreHistory(roster, { key: 'number', dir: 'asc' }))).toEqual(['s_1', 's_2', 's_4', 's_3']);
  expect(sortScoreHistory(roster, null)).toBe(roster);
});

test('a header click opens scores highest first, then reverses, then restores', () => {
  expect(nextScoreSort(null, 't')).toEqual({ key: 't', dir: 'desc' });
  expect(nextScoreSort({ key: 't', dir: 'desc' }, 't')).toEqual({ key: 't', dir: 'asc' });
  expect(nextScoreSort({ key: 't', dir: 'asc' }, 't')).toBeNull();
  expect(nextScoreSort({ key: 't', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
});
