import { useEffect, useRef, useState, type ReactNode } from 'react';
import { paginateFlow, type FlowUnit } from './printPagination';

const PAGE_HEIGHT = 277 * 96 / 25.4 - 1; // A4 minus 8 mm top / 12 mm bottom, with subpixel tolerance.

export interface PaperBlock {
  key: string;
  node: ReactNode;
  keepNext?: boolean;
  breakBefore?: boolean;
  split?: (element: HTMLElement) => FlowUnit<ReactNode>[];
}

async function assetsReady(root: HTMLElement) {
  await Promise.all([document.fonts?.ready, ...Array.from(root.querySelectorAll('img'), (image) => image.complete
    ? Promise.resolve() : new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    }))]);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Measure the live content once at its print width, then render the same React
 * blocks in physical pages. Measurement content is removed, never printed twice. */
export default function PaginatedSheet({ header, blocks, columns = 2, name, prepare, onReady }: {
  header: ReactNode;
  blocks: PaperBlock[];
  columns?: number;
  name?: string;
  prepare: (element: HTMLElement) => void;
  onReady: (count: number, valid: boolean) => void;
}) {
  const source = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [pages, setPages] = useState<ReactNode[][][] | null>(null);
  const [overflow, setOverflow] = useState(false);
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;

  useEffect(() => {
    const root = source.current;
    if (!root) return;
    let active = true;
    void (async () => {
      await assetsReady(root);
      await nextFrame(); // Allow image layout state in PrintStem to settle.
      if (!active) return;
      prepare(root);
      await nextFrame();
      if (!active) return;
      const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-flow-block]'));
      const units = elements.flatMap((element, index) => {
        const block = blocks[index];
        const parts = block.split?.(element) ?? [{ content: block.node, height: element.getBoundingClientRect().height }];
        return parts.map((part, partIndex) => ({ ...part,
          keepNext: part.keepNext || (partIndex === 0 && block.keepNext),
          breakBefore: partIndex === 0 && block.breakBefore,
        }));
      });
      const headerHeight = root.querySelector<HTMLElement>('[data-flow-header]')?.getBoundingClientRect().height ?? 0;
      setOverflow(headerHeight > PAGE_HEIGHT || units.some((unit) => unit.height > PAGE_HEIGHT));
      setPages(paginateFlow(units, PAGE_HEIGHT, headerHeight, columns));
    })();
    return () => { active = false; };
    // The parent keys the sheet by its saved content, so a layout change remounts
    // and measures afresh; callback/React-node identity must not restart this work.
  }, []);

  useEffect(() => {
    if (!pages || !sheet.current) return;
    let active = true;
    void assetsReady(sheet.current).then(nextFrame).then(nextFrame).then(() => {
      if (!active || !sheet.current) return;
      prepare(sheet.current);
      const exceedsColumn = Array.from(sheet.current.querySelectorAll<HTMLElement>('.print-page-columns .print-flow-column'))
        .some((column) => column.lastElementChild && column.lastElementChild.getBoundingClientRect().bottom > column.getBoundingClientRect().bottom + 1);
      if (exceedsColumn) setOverflow(true);
      readyCallback.current(pages.length, !overflow && !exceedsColumn);
    });
    return () => { active = false; };
  }, [pages, overflow]);

  return <section ref={sheet} className="print-sheet" aria-label={name ? `${name} 的作业` : undefined}>
    {!pages && <div ref={source} className="print-measure" aria-hidden="true">
      <div data-flow-header>{header}</div>
      <div className={`print-flow-column${columns === 1 ? ' full-width' : ''}`}>
        {blocks.map((block) => <div key={block.key} data-flow-block>{block.node}</div>)}
      </div>
    </div>}
    {overflow && <p className="error no-print" role="alert">有题目超出一栏，请缩小题图或作答区后再打印。</p>}
    {pages?.map((page, index) => <section className="print-page" key={index} aria-label={`第 ${index + 1} 页`}>
      <div className="print-page-content">
        {index === 0 && <div className="print-page-header">{header}</div>}
        <div className={`print-page-columns${columns === 1 ? ' single-column' : ''}`}>
          {page.map((column, columnIndex) => <div className="print-flow-column" key={columnIndex}>
            {column.map((node, blockIndex) => <div className="print-flow-fragment" key={blockIndex}>{node}</div>)}
          </div>)}
        </div>
      </div>
      <footer className="print-page-number">第 {index + 1} 页 / 共 {pages.length} 页</footer>
    </section>)}
  </section>;
}
