import { buildBlueprint } from './blueprint';
import type { AssignmentItem, BankQuestion } from './types';

function item(number: number, type: string, tier: string, kp: string, points: number): AssignmentItem {
  const question: BankQuestion = {
    id: `q${number}`,
    question_type: type,
    difficulty_tier: tier,
    stem_text: '',
    options: [],
    image_paths: [],
    answer: null,
    primary_kp: { id: kp, name: kp, chapter: null },
    default_points: points,
    default_box: null,
    class_attempted: 0,
    class_correct_rate: null,
  };
  return { number, question_id: question.id, points, box: null, question };
}

test('summarises points, time and coverage', () => {
  const blueprint = buildBlueprint([
    item(1, 'single_choice', 'easy', '质点', 4),
    item(2, 'single_choice', 'medium', '加速度', 4),
    item(3, 'problem_solving', 'medium', '加速度', 12),
  ]);
  expect(blueprint.questionCount).toBe(3);
  expect(blueprint.totalPoints).toBe(20);
  expect(blueprint.minutes).toBe(16);
  expect(blueprint.byType).toEqual([
    { label: '单选题', count: 2, points: 8 },
    { label: '计算题', count: 1, points: 12 },
  ]);
  expect(blueprint.byDifficulty.map((row) => row.label)).toEqual(['易', '中等']);
  expect(blueprint.byKnowledgePoint[0]).toEqual({ label: '加速度', count: 2, points: 16 });
});

test('a question that left the bank still counts toward the total', () => {
  const blueprint = buildBlueprint([{ number: 1, question_id: 'gone', points: 5, box: null, question: null }]);
  expect(blueprint.totalPoints).toBe(5);
  expect(blueprint.byKnowledgePoint[0].label).toBe('未标注知识点');
});
