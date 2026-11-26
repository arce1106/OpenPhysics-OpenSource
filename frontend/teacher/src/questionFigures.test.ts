import { withUnplacedFigures } from './questionFigures';

const base = { answer: '2 m/s²', options: [] as Array<{ label: string; text: string }> };

test('unplaced diagrams follow the stem and explanation figures follow the explanation', () => {
  const question = {
    ...base, stem_text: '如图所示，求加速度。', explanation: '由图读出斜率。',
    image_paths: ['/q_diagram_0.png', '/q_expl_0.png', '/q_diagram_1.png'],
    image_types: ['diagram', 'explanation', 'diagram'],
  };
  expect(withUnplacedFigures(question, 'stem')).toBe('如图所示，求加速度。\n{{IMG:0}}\n{{IMG:2}}');
  expect(withUnplacedFigures(question, 'explanation')).toBe('由图读出斜率。\n{{IMG:1}}');
});

test('a choice question with figure options still gets its unplaced stem diagram', () => {
  // q_4157-like: four option images placed in the options, the stem's own graph placed nowhere.
  const question = {
    ...base, stem_text: '功率P随时间t的变化如图所示。下列图像可能正确的是（　）', explanation: '',
    options: ['A', 'B', 'C', 'D'].map((label, index) => ({ label, text: `{{IMG:${index + 1}}}` })),
    image_paths: ['/q_diagram_1.png', '/q_option_a.png', '/q_option_b.png', '/q_option_c.png', '/q_option_d.png'],
  };
  expect(withUnplacedFigures(question, 'stem', '功率P随时间t的变化如图所示。下列图像可能正确的是（　）'))
    .toBe('功率P随时间t的变化如图所示。下列图像可能正确的是（　）\n{{IMG:0}}');
  expect(withUnplacedFigures(question, 'explanation')).toBe('');
});

test('figures a text already places, and option figures, are not added again', () => {
  const question = {
    ...base, stem_text: '如图 {{IMG:0}} 所示', explanation: '见图 {{IMG:2}}',
    options: [{ label: 'A', text: '{{IMG:1}}' }],
    image_paths: ['/q_diagram_0.png', '/q_option_A.png', '/q_expl_0.png', '/q_option_B.png'],
  };
  expect(withUnplacedFigures(question, 'stem')).toBe('如图 {{IMG:0}} 所示');
  expect(withUnplacedFigures(question, 'explanation')).toBe('见图 {{IMG:2}}');
});
