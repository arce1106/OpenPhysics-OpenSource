import type { BankQuestion } from './types';

type FigureSource = Pick<BankQuestion, 'stem_text' | 'options' | 'answer' | 'explanation' | 'image_paths' | 'image_types'>;

/** Older paper snapshots carry paths only; the bank names its files by kind. */
function figureKind(question: FigureSource, index: number): string {
  const kind = question.image_types?.[index];
  if (kind) return kind;
  const path = question.image_paths[index] ?? '';
  return /option/i.test(path) ? 'option' : /expl/i.test(path) ? 'explanation' : 'diagram';
}

/**
 * {{IMG:n}} tokens for the bank figures no text places, as the admin bank shows them:
 * diagrams belong after the stem, explanation figures after the explanation.
 */
export function unplacedFigures(question: FigureSource, part: 'stem' | 'explanation'): string[] {
  const everything = [question.stem_text, question.answer, question.explanation, ...question.options.map((o) => o.text)].join('\n');
  const placed = new Set([...everything.matchAll(/\{\{IMG:(\d+)\}\}/g)].map((match) => Number(match[1])));
  return question.image_paths
    .map((_, index) => index)
    .filter((index) => !placed.has(index))
    .filter((index) => {
      const kind = figureKind(question, index);
      return part === 'explanation' ? kind === 'explanation' : kind !== 'explanation' && kind !== 'option';
    })
    .map((index) => `{{IMG:${index}}}`);
}

/** A text followed by the figures that belong after it; `text` defaults to the part itself. */
export function withUnplacedFigures(question: FigureSource, part: 'stem' | 'explanation', text?: string): string {
  const base = text ?? (part === 'stem' ? question.stem_text : question.explanation) ?? '';
  const extra = unplacedFigures(question, part);
  return extra.length ? [base, ...extra].join('\n') : base;
}
