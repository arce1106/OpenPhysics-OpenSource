import { Fragment, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './math.css';
import {
  type ImageRef,
  type RenderedLatexPart,
  createLatexRenderer,
  normalizeMathText,
} from '../../../shared/math/renderLatex';

// ── Inline LaTeX rendering ─────────────────────────────────────────────────

const { renderLatexBlock, renderLatexInline } = createLatexRenderer(
  (latex, displayMode) => katex.renderToString(latex, { throwOnError: false, displayMode }),
);

export { normalizeMathText, renderLatexBlock, renderLatexInline };

// ── Components ──────────────────────────────────────────────────────────────

export function LatexSpan({
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
  const rendered = useMemo(() => renderLatexInline(text, imagePaths), [text, imagePaths]);

  const renderPart = (part: RenderedLatexPart, key: string, inlineImageRow = false) => {
    if (typeof part === 'string') {
      return <Fragment key={key}>{part}</Fragment>;
    }
    if ('isImage' in part && part.isImage) {
      const imgPart = part as ImageRef;
      if (!imgPart.src) return <Fragment key={key} />;
      const scaleStyle = imageScaleStyles?.[imgPart.index] || {};
      const image = (
        <img
          src={imgPart.src}
          alt="题目附图"
          className={imageClassName}
          style={{
            ...scaleStyle,
            maxWidth: imageClassName === 'admin-option-image'
              ? 'calc(62mm * var(--question-image-scale, 1))'
              : 'calc(70mm * var(--question-image-scale, 1))',
            maxHeight: imageClassName === 'admin-option-image' ? '34mm' : '38mm',
            borderRadius: 6,
            border: '1px solid #e8e8e8',
          }}
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
    line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const header = parseRow(lines[0]);
  const body = lines.slice(2).map(parseRow);

  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{
        borderCollapse: 'collapse', width: 'auto', fontSize: 13,
        border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden',
      }}>
        <thead>
          <tr style={{ background: '#fafafa' }}>
            {header.map((h, i) => (
              <th key={i} style={{
                padding: '6px 12px', textAlign: 'center', fontWeight: 600,
                border: '1px solid #d9d9d9', color: '#333', whiteSpace: 'nowrap',
              }}>
                <LatexSpan text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '5px 12px', border: '1px solid #d9d9d9',
                  color: '#555', textAlign: ci === 0 ? 'left' : 'center',
                }}>
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
}: {
  text: string;
  imagePaths?: string[];
  imageScaleStyles?: Array<Record<string, string> | undefined>;
}) {
  const parts = useMemo(() => {
    const result: { type: 'text' | 'table'; content: string }[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    const re = new RegExp(MD_TABLE_RE.source, 'g');

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIdx) {
        result.push({ type: 'text', content: text.slice(lastIdx, match.index) });
      }
      result.push({ type: 'table', content: match[0] });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) {
      result.push({ type: 'text', content: text.slice(lastIdx) });
    }
    return result.length > 0 ? result : [{ type: 'text' as const, content: text }];
  }, [text]);

  return (
    <>
      {parts.map((part, i) =>
        part.type === 'table' ? (
          <MarkdownTable key={i} md={part.content} />
        ) : (
          <LatexSpan key={i} text={part.content} imagePaths={imagePaths} imageScaleStyles={imageScaleStyles} />
        ),
      )}
    </>
  );
}
