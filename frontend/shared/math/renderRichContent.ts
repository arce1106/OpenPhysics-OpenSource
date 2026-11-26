import katex from 'katex';
import {
  normalizeMathText,
  preserveVisibleMathTildes,
} from './renderLatex';

export type RichContentRenderer = 'katex';

export interface RenderRichContentInput {
  text: string;
  imagePaths?: string[];
  /**
   * @deprecated Renderer version is derived from the installed KaTeX package.
   * This field is ignored to avoid callers stamping content with a fake version.
   */
  rendererVersion?: string;
}

export interface RenderedRichContent {
  html: string;
  plainText: string;
  renderer: RichContentRenderer;
  rendererVersion: string;
  contentHash: string;
  hasMath: boolean;
  hasImage: boolean;
  hasMarkdownTable: boolean;
  errors: RenderedRichContentError[];
}

export interface RenderedRichContentError {
  type: 'katex' | 'parse' | 'unknown';
  message: string;
  latex?: string;
  position?: number;
}

const RICH_CONTENT_RULES_VERSION = 'rich-content-v1';
const RENDERER: RichContentRenderer = 'katex';
const DEFAULT_RENDERER_VERSION = (katex as { version?: string }).version || 'unknown';
const IMG_PLACEHOLDER_RE = /^\{\{IMG:(\d+)\}\}$/;
const RENDER_TOKEN_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$|\{\{IMG:\d+\}\})/g;
const MD_TABLE_RE = /(?:^|\n)([ \t]*\|[^\n]+\|?[ \t]*\n[ \t]*\|[ \t\-:|]+\|?[ \t]*\n(?:[ \t]*\|[^\n]+\|?[ \t]*\n?)+)/gm;

export function renderRichContent(input: RenderRichContentInput): RenderedRichContent {
  return renderRichContentInternal(input, false);
}

export function renderRichContentStrict(input: RenderRichContentInput): RenderedRichContent {
  return renderRichContentInternal(input, true);
}

function renderRichContentInternal(input: RenderRichContentInput, strict: boolean): RenderedRichContent {
  const rendererVersion = DEFAULT_RENDERER_VERSION;
  const errors: RenderedRichContentError[] = [];
  const imagePaths = input.imagePaths || [];
  const tableMatches = Array.from(input.text.matchAll(MD_TABLE_RE));
  const hasMarkdownTable = tableMatches.length > 0;
  const hasImage = /\{\{IMG:\d+\}\}/.test(input.text);
  const hasMath = hasMathContent(input.text);

  const html = renderRichHtml(input.text, imagePaths, strict, errors);
  const plainText = buildPlainText(input.text);

  return {
    html,
    plainText,
    renderer: RENDERER,
    rendererVersion,
    contentHash: stableContentHash({
      text: input.text,
      imagePaths,
      renderer: RENDERER,
      rendererVersion,
      rulesVersion: RICH_CONTENT_RULES_VERSION,
    }),
    hasMath,
    hasImage,
    hasMarkdownTable,
    errors,
  };
}

function renderRichHtml(
  text: string,
  imagePaths: string[],
  strict: boolean,
  errors: RenderedRichContentError[],
): string {
  const chunks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const tableRegex = new RegExp(MD_TABLE_RE.source, 'gm');

  while ((match = tableRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      chunks.push(renderInlineRichHtml(text.slice(lastIndex, match.index), imagePaths, strict, errors, lastIndex));
    }
    chunks.push(renderMarkdownTable(match[0], imagePaths, strict, errors, match.index));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    chunks.push(renderInlineRichHtml(text.slice(lastIndex), imagePaths, strict, errors, lastIndex));
  }

  return chunks.join('');
}

function renderMarkdownTable(
  markdown: string,
  imagePaths: string[],
  strict: boolean,
  errors: RenderedRichContentError[],
  baseOffset = 0,
): string {
  const trimmed = markdown.trim();
  const trimOffset = markdown.indexOf(trimmed);
  const lines = trimmed.split('\n');
  if (lines.length < 2) {
    return renderInlineRichHtml(markdown, imagePaths, strict, errors, baseOffset);
  }

  const parseRow = (line: string, lineOffset: number) => {
    const leadingWhitespace = line.search(/\S|$/);
    let row = line.trim();
    let rowStart = lineOffset + leadingWhitespace;

    if (row.startsWith('|')) {
      row = row.slice(1);
      rowStart += 1;
    }
    if (row.endsWith('|')) {
      row = row.slice(0, -1);
    }

    const cells: Array<{ value: string; start: number }> = [];
    let cursor = 0;
    for (const rawCell of row.split('|')) {
      const cellLeadingWhitespace = rawCell.search(/\S|$/);
      cells.push({
        value: rawCell.trim(),
        start: rowStart + cursor + cellLeadingWhitespace,
      });
      cursor += rawCell.length + 1;
    }
    return cells;
  };

  const lineOffsets: number[] = [];
  let lineOffset = baseOffset + Math.max(trimOffset, 0);
  for (const line of lines) {
    lineOffsets.push(lineOffset);
    lineOffset += line.length + 1;
  }

  const header = parseRow(lines[0], lineOffsets[0]);
  const body = lines.slice(2).map((line, index) => parseRow(line, lineOffsets[index + 2]));
  const renderCell = (cell: { value: string; start: number }) =>
    renderInlineRichHtml(cell.value, imagePaths, strict, errors, cell.start);

  return [
    '<div class="openphysics-table-wrap"><table class="openphysics-rich-table">',
    '<thead><tr>',
    ...header.map(cell => `<th>${renderCell(cell)}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...body.map(row => `<tr>${row.map(cell => `<td>${renderCell(cell)}</td>`).join('')}</tr>`),
    '</tbody></table></div>',
  ].join('');
}

function renderInlineRichHtml(
  text: string,
  imagePaths: string[],
  strict: boolean,
  errors: RenderedRichContentError[],
  baseOffset = 0,
): string {
  const normalizedText = normalizeMathText(text);
  const parts = tokenizeRichContent(normalizedText);
  return parts.map((part) => renderInlinePart(
    part.value,
    imagePaths,
    strict,
    errors,
    baseOffset + part.start,
  )).join('');
}

function tokenizeRichContent(text: string): Array<{ value: string; start: number }> {
  const tokens: Array<{ value: string; start: number }> = [];
  const tokenRegex = new RegExp(RENDER_TOKEN_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        value: text.slice(lastIndex, match.index),
        start: lastIndex,
      });
    }
    tokens.push({
      value: match[0],
      start: match.index,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      value: text.slice(lastIndex),
      start: lastIndex,
    });
  }

  return tokens.filter(token => token.value.length > 0);
}

function renderInlinePart(
  part: string,
  imagePaths: string[],
  strict: boolean,
  errors: RenderedRichContentError[],
  position: number,
): string {
  const imageMatch = IMG_PLACEHOLDER_RE.exec(part);
  if (imageMatch) {
    const index = Number.parseInt(imageMatch[1], 10);
    const src = imagePaths[index];
    if (!src) {
      return `<span class="openphysics-image-placeholder" data-openphysics-image-index="${index}">[图片${index + 1}]</span>`;
    }
    return [
      '<img',
      ' class="openphysics-rich-image"',
      ` data-openphysics-image-index="${index}"`,
      ` src="${escapeHtmlAttribute(src)}"`,
      ' alt="题目附图"',
      ' />',
    ].join('');
  }

  const mathToken = parseMathToken(part);
  if (mathToken) {
    if (!strict) {
      try {
        katex.renderToString(preserveVisibleMathTildes(mathToken.latex), {
          throwOnError: true,
          displayMode: mathToken.displayMode,
        });
      } catch (error) {
        errors.push({
          type: 'katex',
          message: error instanceof Error ? error.message : String(error),
          latex: mathToken.latex,
          position,
        });
      }
    }
    try {
      return katex.renderToString(preserveVisibleMathTildes(mathToken.latex), {
        throwOnError: strict,
        displayMode: mathToken.displayMode,
      });
    } catch (error) {
      errors.push({
        type: 'katex',
        message: error instanceof Error ? error.message : String(error),
        latex: mathToken.latex,
        position,
      });
      return escapeHtml(part);
    }
  }

  return escapeHtml(part).replace(/\n/g, '<br />');
}

function parseMathToken(part: string): { latex: string; displayMode: boolean } | null {
  if (part.startsWith('$$') && part.endsWith('$$')) {
    return { latex: part.slice(2, -2), displayMode: true };
  }
  if (part.startsWith('\\[') && part.endsWith('\\]')) {
    return { latex: part.slice(2, -2), displayMode: true };
  }
  if (part.startsWith('\\(') && part.endsWith('\\)')) {
    return { latex: part.slice(2, -2), displayMode: false };
  }
  if (part.startsWith('$') && part.endsWith('$')) {
    return { latex: part.slice(1, -1), displayMode: false };
  }
  return null;
}

function hasMathContent(text: string): boolean {
  if (/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/.test(text)) {
    return true;
  }
  return normalizeMathText(text) !== text;
}

function buildPlainText(text: string): string {
  return normalizeMathText(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, '$1')
    .replace(/\\\[([\s\S]+?)\\\]/g, '$1')
    .replace(/\\\(([\s\S]+?)\\\)/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\{\{IMG:(\d+)\}\}/g, (_, index: string) => `[图片${Number.parseInt(index, 10) + 1}]`)
    .replace(/\|[ \t\-:|]+\|?/g, '')
    .replace(/[ \t]*\|[ \t]*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function stableContentHash(value: unknown): string {
  const payload = JSON.stringify(value);
  return sha256Hex(payload);
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 1 + 8) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map(part => part.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}
