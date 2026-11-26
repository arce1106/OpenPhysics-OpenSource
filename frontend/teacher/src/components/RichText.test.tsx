import { render } from '@testing-library/react';
import RichText from './RichText';

test('an inline AI note renders both formula delimiters inside a span', () => {
  const { container } = render(<p><RichText inline text={'写成 \\(\\Delta U=Q+W\\)，应为 $2p_0V_0$'} /></p>);
  const note = container.querySelector('p > span.rich-text.inline');
  expect(note).not.toBeNull();
  expect(note!.querySelectorAll('.katex')).toHaveLength(2);
  expect(note!.textContent).not.toContain('\\(');
});
