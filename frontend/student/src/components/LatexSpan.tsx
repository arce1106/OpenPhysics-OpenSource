import { Fragment, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './math.css';
import ZoomableImage from './ZoomableImage';
import {
  type ImageRef,
  type RenderedLatexPart,
  createLatexRenderer,
  normalizeMathText,
} from '../../../shared/math/renderLatex';

const { renderLatexBlock, renderLatexInline } = createLatexRenderer(
  (latex, displayMode) => katex.renderToString(latex, { throwOnError: false, displayMode }),
);

export { normalizeMathText, renderLatexBlock, renderLatexInline };

interface LatexSpanProps {
  text: string;
  /** Image URLs indexed by placeholder number ({{IMG:0}} → imagePaths[0]). */
  imagePaths?: string[];
  imageScaleStyles?: Array<Record<string, string> | undefined>;
  imageClassName?: string;
}

export default function LatexSpan({ text, imagePaths, imageScaleStyles, imageClassName }: LatexSpanProps) {
  const rendered = useMemo(() => renderLatexInline(text, imagePaths), [text, imagePaths]);

  const renderPart = (part: RenderedLatexPart, key: string, inlineImageRow = false) => {
    if (typeof part === 'string') {
      return <Fragment key={key}>{part}</Fragment>;
    }
    if ('isImage' in part && part.isImage) {
      const imgPart = part as ImageRef;
      if (!imgPart.src) return <Fragment key={key} />;
      const image = (
        <ZoomableImage
          src={imgPart.src}
          alt="题目附图"
          className={`question-image question-image-inline${imageClassName ? ` ${imageClassName}` : ''}`}
          style={{ marginBottom: 4, ...imageScaleStyles?.[imgPart.index] }}
        />
      );
      if (inlineImageRow) {
        return (
          <span key={key} className="math-image-row-item">
            {image}
          </span>
        );
      }
      return (
        <span key={key} className="math-image-block">
          {image}
        </span>
      );
    }
    return (
      <span
        key={key}
        className={part.displayMode ? 'math-block' : 'math-inline'}
        dangerouslySetInnerHTML={{ __html: part.__html }}
      />
    );
  };

  const lines = splitRenderedLines(rendered);

  return (
    <span className="math-text">
      {lines.map((line, lineIndex) => {
        const inlineImageRow = countImages(line) > 1;
        const imageOnlyLine = isImageOnlyLine(line);
        const nextImageOnlyLine = lineIndex < lines.length - 1 && isImageOnlyLine(lines[lineIndex + 1]);
        const content = inlineImageRow ? (
          <span className="math-image-row">
            {line.map((part, partIndex) => renderPart(part, `${lineIndex}-${partIndex}`, true))}
          </span>
        ) : (
          line.map((part, partIndex) => renderPart(part, `${lineIndex}-${partIndex}`))
        );
        return (
          <Fragment key={lineIndex}>
            {content}
            {lineIndex < lines.length - 1 && !imageOnlyLine && !nextImageOnlyLine ? '\n' : null}
          </Fragment>
        );
      })}
    </span>
  );
}

function splitRenderedLines(parts: RenderedLatexPart[]): RenderedLatexPart[][] {
  const lines: RenderedLatexPart[][] = [[]];
  for (const part of parts) {
    if (typeof part !== 'string') {
      lines[lines.length - 1].push(part);
      continue;
    }
    const pieces = part.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push(piece);
    });
  }
  return lines;
}

function countImages(parts: RenderedLatexPart[]): number {
  return parts.filter(part => typeof part !== 'string' && 'isImage' in part && part.isImage).length;
}

function isImageOnlyLine(parts: RenderedLatexPart[]): boolean {
  return parts.length > 0 && parts.every(part => {
    if (typeof part === 'string') return part.trim() === '';
    return 'isImage' in part && part.isImage;
  });
}

// ── Markdown table detection and rendering ─────────────────────────────────

const MD_TABLE_RE = /(?:^|\n)([ \t]*\|[^\n]+\|?[ \t]*\n[ \t]*\|[ \t\-:|]+\|?[ \t]*\n(?:[ \t]*\|[^\n]+\|?[ \t]*\n?)+)/gm;

export function MarkdownTable({ md }: { md: string }) {
  const lines = md.trim().split('\n');
  if (lines.length < 2) return <LatexSpan text={md} />;

  const parseRow = (line: string) =>
    line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

  const header = parseRow(lines[0]);
  const body = lines.slice(2).map(parseRow);

  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{
        borderCollapse: 'collapse',
        width: 'auto',
        fontSize: 14,
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            {header.map((cell, index) => (
              <th
                key={index}
                style={{
                  padding: '6px 12px',
                  textAlign: 'center',
                  fontWeight: 600,
                  border: '1px solid #d9d9d9',
                  color: '#333',
                  whiteSpace: 'nowrap',
                }}
              >
                <LatexSpan text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ background: rowIndex % 2 === 0 ? '#fff' : '#fafafa' }}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{
                    padding: '5px 12px',
                    border: '1px solid #d9d9d9',
                    color: '#555',
                    textAlign: cellIndex === 0 ? 'left' : 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <LatexSpan text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StemContent({
  text,
  imagePaths,
  imageScaleStyles,
  imageClassName,
}: {
  text: string;
  imagePaths?: string[];
  imageScaleStyles?: Array<Record<string, string> | undefined>;
  imageClassName?: string;
}) {
  const parts = useMemo(() => {
    const result: { type: 'text' | 'table'; content: string }[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(MD_TABLE_RE.source, 'g');

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      result.push({ type: 'table', content: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ type: 'text', content: text.slice(lastIndex) });
    }
    return result.length > 0 ? result : [{ type: 'text' as const, content: text }];
  }, [text]);

  return (
    <>
      {parts.map((part, index) =>
        part.type === 'table' ? (
          <MarkdownTable key={index} md={part.content} />
        ) : (
          <LatexSpan
            key={index}
            text={part.content}
            imagePaths={imagePaths}
            imageScaleStyles={imageScaleStyles}
            imageClassName={imageClassName}
          />
        ),
      )}
    </>
  );
}
