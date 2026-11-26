import { paginateFlow, type FlowUnit } from './printPagination';

const unit = (content: string, height: number, rest = {}): FlowUnit<string> => ({ content, height, ...rest });

test('fills left then right, leaving the header only on the first A4 page', () => {
  expect(paginateFlow([unit('A', 55), unit('B', 55), unit('C', 90), unit('D', 90)], 100, 30))
    .toEqual([[['A'], ['B']], [['C'], ['D']]]);
});

test('uses whole option rows at the bottom of a column and keeps headings with a stem', () => {
  expect(paginateFlow([unit('first', 60), unit('heading', 10, { keepNext: true }), unit('stem+A', 40),
    unit('B', 15), unit('C', 15)], 100, 0)).toEqual([[['first'], ['heading', 'stem+A', 'B', 'C']]]);
  expect(paginateFlow([unit('stem+A', 60), unit('B', 20), unit('C', 20), unit('D', 20)], 100, 0))
    .toEqual([[['stem+A', 'B', 'C'], ['D']]]);
});

test('manual column breaks do not create empty columns at the start', () => {
  expect(paginateFlow([unit('A', 20, { breakBefore: true }), unit('B', 20, { breakBefore: true }),
    unit('C', 20, { breakBefore: true })], 100, 0)).toEqual([[['A'], ['B']], [['C'], []]]);
});

test('an answer area taller than the first page remainder moves intact to the next page', () => {
  expect(paginateFlow([unit('area', 90)], 100, 20)).toEqual([[[], []], [['area'], []]]);
  // Invalid oversized content is returned for an explicit warning, without an infinite pagination loop.
  expect(paginateFlow([unit('oversized', 120)], 100, 20)).toHaveLength(1);
});
