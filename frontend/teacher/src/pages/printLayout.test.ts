import { printTextBlocks, smallPrintFigure, splitPrintFigure } from './printLayout';

test('teacher explanations can page between logical lines without breaking math or tables', () => {
  expect(printTextBlocks('第一步\n$$a=\nb$$\n\n|甲|乙|\n|---|---|\n|1|2|\n结束'))
    .toEqual(['第一步', '$$a=\nb$$', '\u3000', '|甲|乙|\n|---|---|\n|1|2|', '结束']);
});

test('only a single stem figure moves around the text, while math and comparison diagrams stay intact', () => {
  expect(splitPrintFigure('如图，$v_0$ 为初速度。{{IMG:0}}')).toEqual({ token: '{{IMG:0}}', text: '如图，$v_0$ 为初速度。' });
  expect(splitPrintFigure('{{IMG:0}}和{{IMG:1}}')).toBeNull();
  expect(splitPrintFigure('|数据|题图|\n|1|{{IMG:0}}|')).toBeNull();
  expect(splitPrintFigure('力的大小为 $|F|$。{{IMG:0}}')?.text).toBe('力的大小为 $|F|$。');
  expect(splitPrintFigure('只有文字')).toBeNull();
  expect(smallPrintFigure(300, 260)).toBe(true);
  expect(smallPrintFigure(1000, 800)).toBe(true);
  expect(smallPrintFigure(3000, 2400)).toBe(true);
  expect(smallPrintFigure(400, 1100)).toBe(false);
  expect(smallPrintFigure(700, 200)).toBe(false);
});
