import DOMPurify from 'dompurify';

const KATEX_SVG_TAGS = ['svg', 'path'];
const KATEX_SVG_ATTRIBUTES = [
  'xmlns',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'd',
];

export function sanitizeRenderedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: KATEX_SVG_TAGS,
    ADD_ATTR: ['target', ...KATEX_SVG_ATTRIBUTES],
  });
}

export function sanitizeKnowledgeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
