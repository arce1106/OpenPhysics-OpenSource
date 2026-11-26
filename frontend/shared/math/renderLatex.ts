const IMG_RE = /^<img\s+[^>]*\/?>$/i;
const IMG_PLACEHOLDER_RE = /^\{\{IMG:(\d+)\}\}$/;
const TOKEN_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$|<img\s+[^>]*\/?>|\{\{IMG:\d+\}\})/gi;

export type HtmlPart = { __html: string; displayMode?: boolean };
export type ImageRef = { __html: string; displayMode?: boolean; isImage: true; index: number; src?: string };
export type RenderedLatexPart = string | HtmlPart | ImageRef;
export type KatexRenderFn = (latex: string, displayMode: boolean) => string;

const LATEX_CONTROL_ESCAPE_REPAIRS: Array<[string, string]> = [
  ['\f' + 'rac', String.raw`\frac`],
  ['\b' + 'eta', String.raw`\beta`],
  ['\b' + 'ar', String.raw`\bar`],
  ['\b' + 'oldsymbol', String.raw`\boldsymbol`],
  ['\t' + 'heta', String.raw`\theta`],
  ['\t' + 'imes', String.raw`\times`],
  ['\t' + 'ext', String.raw`\text`],
  ['\t' + 'an', String.raw`\tan`],
  ['\r' + 'ight', String.raw`\right`],
  ['\r' + 'ho', String.raw`\rho`],
  ['\n' + 'eq', String.raw`\neq`],
  ['\n' + 'abla', String.raw`\nabla`],
];
const EXISTING_MATH_DELIMITER_RE = /(\$|\\\(|\\\[)/;
const NAKED_MATH_FRAGMENT_RE = /[A-Za-zα-ωΑ-Ω0-9_{}^\\+\-*/=<>≈().,\s]+/g;
const FORMULA_HINT_RE = /(\\[A-Za-z]+|[=<>≈]|[_^]\{?|m\/s|[A-Za-zα-ωΑ-Ω]\s*[+\-*/=<>≈])/;
const LETTER_OR_DIGIT_RE = /[A-Za-zα-ωΑ-Ω0-9]/;

function repairLatexControlEscapes(text: string): string {
  return LATEX_CONTROL_ESCAPE_REPAIRS.reduce(
    (current, [broken, fixed]) => current.split(broken).join(fixed),
    text,
  );
}

function normalizeSuperscripts(text: string): string {
  return text
    .replace(/²/g, '^{2}')
    .replace(/³/g, '^{3}')
    .replace(/\^([A-Za-z0-9])/g, '^{$1}');
}

export function preserveVisibleMathTildes(latex: string): string {
  return latex.replace(/([A-Za-z0-9}\]])~(?=\\?[A-Za-z0-9{])/g, (_, left: string) => `${left}\\sim `);
}

function looksLikeFormulaFragment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !LETTER_OR_DIGIT_RE.test(trimmed) || !FORMULA_HINT_RE.test(trimmed)) return false;
  if (/_{2,}/.test(trimmed)) return false;
  return /[=<>≈]|\\[A-Za-z]+|[_^]\{?/.test(trimmed);
}

function autoDelimitNakedMath(text: string): string {
  if (!text || EXISTING_MATH_DELIMITER_RE.test(text)) return text;
  const normalized = normalizeSuperscripts(text);
  const trimmed = normalized.trim();
  if (looksLikeFormulaFragment(trimmed) && !/[\u4e00-\u9fff]/.test(trimmed)) {
    const leading = normalized.match(/^\s*/)?.[0] || '';
    const trailing = normalized.match(/\s*$/)?.[0] || '';
    return `${leading}$${trimmed}$${trailing}`;
  }
  return normalized.replace(NAKED_MATH_FRAGMENT_RE, (fragment) => {
    if (!looksLikeFormulaFragment(fragment)) return fragment;
    const leading = fragment.match(/^\s*/)?.[0] || '';
    const trailing = fragment.match(/\s*$/)?.[0] || '';
    return `${leading}$${fragment.trim()}$${trailing}`;
  });
}

function isRenderToken(part: string): boolean {
  return (
    (part.startsWith('$$') && part.endsWith('$$')) ||
    (part.startsWith('$') && part.endsWith('$')) ||
    (part.startsWith('\\[') && part.endsWith('\\]')) ||
    (part.startsWith('\\(') && part.endsWith('\\)')) ||
    IMG_RE.test(part) ||
    IMG_PLACEHOLDER_RE.test(part)
  );
}

function autoDelimitPlainTextSegments(text: string): string {
  if (!text || !EXISTING_MATH_DELIMITER_RE.test(text)) return text;
  return text
    .split(TOKEN_RE)
    .filter(Boolean)
    .map((part) => (isRenderToken(part) ? part : autoDelimitNakedMath(part)))
    .join('');
}

export function normalizeMathText(text: string): string {
  if (!text) return text;

  let normalized = autoDelimitNakedMath(repairLatexControlEscapes(text));
  if (!normalized.includes('$')) return normalized;
  let previous = '';
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized
      .replace(/\$([^$]*\d)\$\.(\d+)/g, (_, body: string, frac: string) => `$${body}.${frac}$`)
      .replace(/(^|[^$])(\d+)\.\$([0-9][^$]*)\$/g, (_, prefix: string, whole: string, body: string) => `${prefix}$${whole}.${body}$`)
      .replace(/_\{([^{}]+)\}_\{\.\}_\{([^{}]+)\}/g, '_{$1.$2}')
      .replace(/\$([^$]*=[^$]*\d(?:\.\d+)?)\$([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)/g, (_, body: string, suffix: string) => `$${body}${suffix}$`)
      .replace(/(^|[^A-Za-z0-9_$])([A-Za-zα-ωΑ-ΩΔ][A-Za-z0-9_{}]*)=\$([^$]+)\$/g, (_, prefix: string, lhs: string, body: string) => `${prefix}$${lhs}=${body}$`)
      // Merge granular math blocks: $...$(3$T$)^{2} → $...(3T)^{2}$ (handles shared $ boundary)
      .replace(/\$([^$\n]+)\$\((\d+(?:\.\d+)?)\$([^$\n]+)\$\)(\^\{[^}]+\})?/g,
        (_, body: string, d: string, v: string, sup: string) => '$' + body + '(' + d + v + ')' + (sup || '') + '$')
      // Merge standalone granular math blocks: $(3$T$)^{2} → $(3T)^{2}$
      .replace(/\$\((\d+(?:\.\d+)?)\$([^$\n]+)\$\)(\^\{[^}]+\})?/g,
        (_, d: string, v: string, sup: string) => '$(' + d + v + ')' + (sup || '') + '$')
      // Merge granular math blocks: (2$n$-1) → $(2n-1)$
      .replace(/\((\d+(?:\.\d+)?)\$([^$\n]+)\$([\-+\d]+)\)/g,
        (_, d: string, v: string, rest: string) => '$(' + d + v + rest + ')$')
      // General merge: $...$(...$...$ → $...(...)$ (keep after granular rules)
      .replace(/\$([^$]+)\$\(([^$]*)\$([^$]+)\$/g, (_, left: string, middle: string, right: string) => `$${left}(${middle}${right}$`)
      // Merge adjacent inline blocks: $a$$b$ → $ab$
      .replace(/\$([^$\n]+)\$\$([^$\n]+)\$/g,
        (_, a: string, b: string) => '$' + a + b + '$')
      // Pull leading digits into math: 3$s$ → $3s$ (skip ordinals like 第2)
      .replace(/(^|[^第$])(\d+(?:\.\d+)?)\$([A-Za-zα-ωΑ-Ω\\][^$\n\u4e00-\u9fff，。；、]*)\$/g,
        (_, prefix: string, d: string, v: string) => prefix + '$' + d + v + '$');
  }
  normalized = autoDelimitPlainTextSegments(normalized);
  return normalized;
}

export function createLatexRenderer(renderKatex: KatexRenderFn) {
  function renderLatexInline(
    text: string,
    imagePaths?: string[],
  ): RenderedLatexPart[] {
    const normalizedText = normalizeMathText(text);
    const parts = normalizedText.split(TOKEN_RE);
    return parts.filter(Boolean).map((part) => {
      const imgMatch = IMG_PLACEHOLDER_RE.exec(part);
      if (imgMatch) {
        const idx = parseInt(imgMatch[1], 10);
        const src = imagePaths?.[idx];
        return { __html: '', isImage: true, index: idx, src } as ImageRef;
      }
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const latex = part.slice(2, -2);
        try {
          return { __html: renderKatex(preserveVisibleMathTildes(latex), true), displayMode: true };
        } catch { return part; }
      }
      if (part.startsWith('\\[') && part.endsWith('\\]')) {
        const latex = part.slice(2, -2);
        try {
          return { __html: renderKatex(preserveVisibleMathTildes(latex), true), displayMode: true };
        } catch { return part; }
      }
      if (part.startsWith('\\(') && part.endsWith('\\)')) {
        const latex = part.slice(2, -2);
        try {
          return { __html: renderKatex(preserveVisibleMathTildes(latex), false) };
        } catch { return part; }
      }
      if (part.startsWith('$') && part.endsWith('$')) {
        const latex = part.slice(1, -1);
        try {
          return { __html: renderKatex(preserveVisibleMathTildes(latex), false) };
        } catch { return part; }
      }
      if (IMG_RE.test(part)) {
        return { __html: part };
      }
      return part;
    });
  }

  function renderLatexBlock(latex: string): string {
    try {
      return renderKatex(preserveVisibleMathTildes(latex), true);
    } catch {
      return latex;
    }
  }

  return {
    renderLatexInline,
    renderLatexBlock,
  };
}
