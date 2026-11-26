import { balancedRow, optionLayout, printableStem, printSections, questionTag, sectionPoints } from './PrintPage';
import type { AssignmentItem } from '../types';

function item(number: number, type: string, points: number, stem = ''): AssignmentItem {
  return {
    number, question_id: `q_${number}`, points, box: null,
    question: { question_type: type, stem_text: stem } as AssignmentItem['question'],
  };
}

test('multiple choice is tagged once and worked problems show their points', () => {
  expect(questionTag(item(5, 'multiple_choice', 6, '(多选)(2024·太原)关于打点计时器'))).toBe('');
  expect(questionTag(item(5, 'multiple_choice', 6, '关于打点计时器'))).toBe('（多选）');
  expect(questionTag(item(1, 'single_choice', 4))).toBe('');
  expect(questionTag(item(8, 'problem_solving', 12))).toBe('（12分）');
});

test('consecutive questions of one kind share a section', () => {
  const items = [item(1, 'single_choice', 4), item(2, 'multiple_choice', 4), item(3, 'experiment', 8),
    item(4, 'problem_solving', 12), item(5, 'problem_solving', 14)];
  const sections = printSections(items);
  expect(sections.map((section) => [section.title, section.items.length])).toEqual([
    ['选择题', 2], ['实验题', 1], ['计算题', 2],
  ]);
  expect(sectionPoints(sections[0].items)).toBe('1～2 题，每题 4 分');
  expect(sectionPoints(sections[2].items)).toBe('4～5 题，共 26 分');
});

test('options are laid out by printed length', () => {
  expect(optionLayout([{ text: '重力' }, { text: '$\\sqrt{3}$倍' }])).toBe('four');
  expect(optionLayout([{ text: '小车的动能不变，动量守恒' }])).toBe('two');
  expect(optionLayout([{ text: '水被甩出前在最高点与最低点受到衣物附着力大小相等' }])).toBe('one');
  expect(optionLayout([{ text: '{{IMG:0}}' }])).toBe('two');
});

test('full-width answer table rows are spread evenly, fifteen at most', () => {
  expect([1, 6, 10, 11, 12, 15, 16, 21, 31].map(balancedRow)).toEqual([1, 6, 10, 11, 12, 15, 8, 11, 11]);
});

test('choice brackets stay empty and fill-in answers retain their numbered marks', () => {
  expect(printableStem('下列说法正确的是（　）', true).text).toBe('下列说法正确的是（　）');
  expect(printableStem('下列说法正确的是( )', true).text).toBe('下列说法正确的是（　）');
  expect(printableStem('下列说法正确的是（答在答题表）', true).text).toBe('下列说法正确的是（　）');
  // Fill-in blanks are numbered for the answer area; math such as $v_0$ is left alone.
  expect(printableStem('平均速率为____m/s，$v_{0}$ 为______', false))
    .toEqual({ text: '平均速率为（空①）m/s，$v_{0}$ 为（空②）', blanks: 2 });
  expect(printableStem('求 $f(\\,)$ 的值', true).text).toBe('求 $f(\\,)$ 的值');
});
