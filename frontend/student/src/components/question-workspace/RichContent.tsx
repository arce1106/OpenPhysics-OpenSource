import { StemContent } from '../LatexSpan';
import type { RenderedRichContent } from '../../types';
import { sanitizeRenderedHtml } from '../../utils/sanitizeRichHtml';

type ImageScaleStyle = Record<string, string> | undefined;

interface RichContentProps {
  text: string | null | undefined;
  rendered?: RenderedRichContent | null;
  imagePaths?: string[];
  imageScaleStyles?: ImageScaleStyle[];
  imageClassName?: string;
  className?: string;
}

function canUseRenderedContent(rendered?: RenderedRichContent | null) {
  return Boolean(rendered?.html?.trim()) && !rendered?.errors?.length;
}

export default function RichContent({
  text,
  rendered,
  imagePaths,
  imageScaleStyles,
  imageClassName,
  className,
}: RichContentProps) {
  if (canUseRenderedContent(rendered)) {
    return (
      <span
        className={['rich-content rich-content-rendered', className].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={{ __html: sanitizeRenderedHtml(rendered!.html) }}
      />
    );
  }

  return (
    <span className={['rich-content', className].filter(Boolean).join(' ')}>
      <StemContent
        text={text || ''}
        imagePaths={imagePaths}
        imageScaleStyles={imageScaleStyles}
        imageClassName={imageClassName}
      />
    </span>
  );
}
