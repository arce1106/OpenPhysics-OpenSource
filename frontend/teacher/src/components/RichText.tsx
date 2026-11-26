import { useMemo } from 'react';
import { renderRichContent } from '../../../shared/math/renderRichContent';

/** Question text with formulas, figures and tables, rendered by the same code as the student apps. */
export default function RichText({
  text,
  imagePaths,
  className,
  inline = false,
}: {
  text: string;
  imagePaths?: string[];
  className?: string;
  /** A span inside a sentence or label, e.g. an AI note with a formula in it. */
  inline?: boolean;
}) {
  const html = useMemo(() => renderRichContent({ text, imagePaths }).html, [text, imagePaths]);
  const Tag = inline ? 'span' : 'div';
  return <Tag className={['rich-text', inline && 'inline', className].filter(Boolean).join(' ')}
    dangerouslySetInnerHTML={{ __html: html }} />;
}
