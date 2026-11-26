import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { buildBlueprint } from '../blueprint';
import RichText from '../components/RichText';
import PrintLayoutPanel from './PrintLayoutPanel';
import PaginatedSheet, { type PaperBlock } from './PaginatedSheet';
import type { FlowUnit } from './printPagination';
import { withUnplacedFigures } from '../questionFigures';
import { printTextBlocks, smallPrintFigure, splitPrintFigure } from './printLayout';
import { formatPoints, typeLabel } from '../labels';
import type { AssignmentDetail, AssignmentItem, BoxSize } from '../types';

const CHOICE_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);
const ANSWER_TABLE_COLUMNS = 15; // Full-width header fits 16 cells of 11 mm (including its label).
const MIN_NUMBER_BOXES = 2;
const BOX_MM: Record<BoxSize, number> = { small: 40, medium: 70, large: 110 };
// Matches the backend's AREA_MM_RANGE: tall enough to scan, short enough for one page column.
const AREA_MIN_MM = 30;
const AREA_MAX_MM = 230;
const AREA_STEP_MM = 5;
const PX_PER_MM = 96 / 25.4;
const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function isChoiceItem(item: AssignmentItem): boolean {
  return CHOICE_TYPES.has(item.question?.question_type ?? '');
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// "（　）" left for a choice answer, and "____" left for a fill-in answer, in the bank's stems.
const CHOICE_SLOT = /[（(][\s\u3000]*(?:答在答题表)?[)）]/g;
const FILL_SLOT = /_{3,}/g;
const MATH = /(\$\$[\s\S]*?\$\$|\$[^$]*\$)/;

/**
 * Choices retain their conventional empty brackets; their answers are collected in the header table.
 * A fill-in stem's blanks
 * are numbered ①②… for the student to answer in order in the area below. Math is left alone.
 */
export function printableStem(text: string, choice: boolean): { text: string; blanks: number } {
  let blanks = 0;
  const parts = text.split(MATH).map((part, index) => {
    if (index % 2 === 1) return part;
    if (choice) return part.replace(CHOICE_SLOT, '（　）');
    return part.replace(FILL_SLOT, () => {
      const mark = CIRCLED[blanks] ?? `(${blanks + 1})`;
      blanks += 1;
      return `（空${mark}）`;
    });
  });
  return { text: parts.join(''), blanks };
}

export function blankMarks(count: number): string {
  return Array.from({ length: count }, (_, index) => CIRCLED[index] ?? `(${index + 1})`).join('');
}

/** Short code printed on the paper so collected scans can be matched to this assignment. */
export function paperCode(assignmentId: string): string {
  return assignmentId.replace(/^a_/, '').slice(0, 8).toUpperCase();
}

/** Spread the full-width answer table evenly, at most fifteen answers per row. */
export function balancedRow(count: number): number {
  return Math.ceil(count / Math.ceil(count / ANSWER_TABLE_COLUMNS));
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

interface PrintSection {
  title: string;
  choice: boolean;
  items: AssignmentItem[];
}

/** Consecutive questions of one kind share a heading; choice types all count as 选择题. */
export function printSections(items: AssignmentItem[]): PrintSection[] {
  const sections: PrintSection[] = [];
  for (const item of items) {
    const choice = isChoiceItem(item);
    const title = choice ? '选择题' : typeLabel(item.question?.question_type ?? null);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.items.push(item);
    else sections.push({ title, choice, items: [item] });
  }
  return sections;
}

/** "1～6 题，每题 4 分" when the points agree, otherwise the section total. */
export function sectionPoints(items: AssignmentItem[]): string {
  const first = items[0].number;
  const last = items[items.length - 1].number;
  const range = first === last ? `第 ${first} 题` : `${first}～${last} 题`;
  const points = items.map((item) => item.points);
  if (points.every((value) => value === points[0])) {
    return items.length === 1 ? `${range}，${formatPoints(points[0])} 分` : `${range}，每题 ${formatPoints(points[0])} 分`;
  }
  return `${range}，共 ${formatPoints(points.reduce((sum, value) => sum + value, 0))} 分`;
}

export function areaHeight(item: AssignmentItem): number {
  return item.area_mm ?? BOX_MM[item.box ?? 'medium'];
}

function clampArea(mm: number): number {
  return Math.min(AREA_MAX_MM, Math.max(AREA_MIN_MM, Math.round(mm / AREA_STEP_MM) * AREA_STEP_MM));
}

/**
 * Pick the widest grid that keeps every option on one line: four in a row, two by two,
 * or one per line. Measured on the page, since LaTeX and figures defeat counting characters.
 */
function fitOptions(list: HTMLElement) {
  // Figures shrink to their cell, so their file width says nothing: keep them two by two.
  if (list.querySelector('img')) return;
  list.classList.add('measuring');
  const widest = Math.max(0, ...Array.from(list.children, (child) => child.getBoundingClientRect().width));
  list.classList.remove('measuring');
  const style = window.getComputedStyle(list);
  const room = list.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  const gap = parseFloat(style.columnGap) || 0;
  if (!widest || room <= 0) return; // Not laid out (tests): keep the guess from text length.
  const fit = ([4, 2] as const).find((per) => widest <= (room - gap * (per - 1)) / per);
  list.classList.remove('four', 'two', 'one');
  list.classList.add(fit === 4 ? 'four' : fit === 2 ? 'two' : 'one');
}

/** Short options sit four to a row, middling ones two, long ones one per line. */
export function optionLayout(options: Array<{ text: string }>): string {
  if (options.some((option) => option.text.includes('{{IMG:'))) return 'two';
  // Count what prints: LaTeX commands and braces take no room on paper.
  const visible = (text: string) => text.replace(/\\[a-zA-Z]+/g, '').replace(/[\s${}^_]/g, '').length;
  const longest = Math.max(...options.map((option) => visible(option.text)));
  if (longest <= 8) return 'four';
  if (longest <= 18) return 'two';
  return 'one';
}

/**
 * Homework that doubles as the answer sheet: one copy for the whole class.
 * Students write their name on the line and their roster number in the boxes
 * after it (scans find the student by the number), put choice answers in the table
 * at the top right, and work every other question in the area printed under it. The
 * questions run in two columns like a workbook, with no score boxes to fill in.
 */
export interface PrintSnapshot {
  detail: AssignmentDetail;
  numberBoxes: number;
  edition?: 'student' | 'teacher';
}

declare global {
  interface Window { __OPENPHYSICS_PRINT__?: PrintSnapshot }
}

export default function PrintPage({ snapshot }: { snapshot?: PrintSnapshot }) {
  const { assignmentId = '' } = useParams();
  const [params] = useSearchParams();
  const teacherEdition = snapshot ? snapshot.edition === 'teacher' : params.get('edition') === 'teacher';
  const [detail, setDetail] = useState<AssignmentDetail | null>(snapshot?.detail ?? null);
  const [numberBoxes, setNumberBoxes] = useState(snapshot?.numberBoxes ?? MIN_NUMBER_BOXES);
  const [rosterReady, setRosterReady] = useState(Boolean(snapshot));
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [pageCounts, setPageCounts] = useState<Record<string, { version: string; count: number; valid: boolean }>>({});
  const version = useMemo(() => JSON.stringify([detail, numberBoxes, teacherEdition]), [detail, numberBoxes, teacherEdition]);

  useEffect(() => {
    if (snapshot) return;
    let active = true;
    api.assignment(assignmentId)
      .then(async (next) => {
        if (!active) return;
        setDetail(next);
        // A paper not yet given to a class may go to any of the teacher's classes: room for the longest number.
        const classIds = next.class_id
          ? [next.class_id]
          : (await api.classes().catch(() => [])).map((item) => item.id);
        const rosters = await Promise.all(classIds.map((id) => api.classDetail(id).catch(() => null)));
        const longest = Math.max(0, ...rosters.flatMap((roster) => roster?.members ?? [])
          .map((member) => member.student_number?.length ?? 0));
        if (active) {
          setNumberBoxes(Math.max(MIN_NUMBER_BOXES, longest));
          setRosterReady(true);
        }
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : '加载失败'));
    return () => {
      active = false;
    };
  }, [assignmentId, snapshot]);

  // Keep the preview and printed document named after the paper.
  useEffect(() => {
    if (!detail) return undefined;
    const previous = document.title;
    document.title = detail.title + (teacherEdition ? '（教师版）' : '');
    return () => {
      document.title = previous;
    };
  }, [detail?.title, teacherEdition]);

  async function updatePrintItem(target: AssignmentItem, patch: Partial<AssignmentItem>, message: string) {
    if (!detail || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    const previous = detail;
    const items = detail.items.map((item) => (item.question_id === target.question_id ? { ...item, ...patch } : item));
    setDetail({ ...detail, items });
    setSaveState('正在保存…');
    try {
      setDetail(await api.updateAssignment(detail.id, {
        items: items.map((item) => ({
          question_id: item.question_id, points: item.points, box: item.box, area_mm: item.area_mm ?? null,
          ...(item.print_layout ? { print_layout: item.print_layout } : {}),
        })),
      }));
      setSaveState(message);
      window.setTimeout(() => setSaveState((current) => (current === message ? '' : current)), 2000);
    } catch (err) {
      setDetail(previous);
      setSaveState(err instanceof Error ? `保存失败：${err.message}` : '保存失败');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function resizeArea(target: AssignmentItem, mm: number | null) {
    void updatePrintItem(target, { area_mm: mm }, '作答区高度已保存');
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!detail) return <p className="muted">正在准备作业…</p>;
  // A personalized homework prints one paper per student who answers on paper, name and number printed in.
  const appOnly = detail.settings?.delivery === 'app' && !(detail.papers ?? []).some((paper) => paper.delivery === 'paper' && !paper.missing);
  const sheets = !teacherEdition && detail.class_id && appOnly ? [] : detail.kind === 'personalized'
    ? (detail.papers ?? []).filter((paper) => !paper.missing && (teacherEdition || paper.delivery === 'paper')).map((paper) => ({
      // A name that is only a masked phone number is left blank for the student to write in; the number identifies the copy.
      key: paper.student_id, items: paper.items as AssignmentItem[], name: /\d{3}\*{4}\d{4}/.test(paper.display_name) ? null : paper.display_name,
      number: paper.student_number,
    }))
    : [{ key: 'class', items: detail.items, name: null, number: null }];
  const paginated = sheets.every((sheet) => pageCounts[sheet.key]?.version === version);
  const ready = paginated && sheets.every((sheet) => pageCounts[sheet.key]?.valid);
  const pageCount = sheets.reduce((sum, sheet) => sum + (pageCounts[sheet.key]?.count ?? 0), 0);

  return (
    <article className={`print-paper${teacherEdition ? ' teacher-edition' : ''}`} data-pdf-ready={ready && rosterReady ? 'true' : undefined}>
      {sheets.length > 0 && <div className="print-page-count no-print" role="status" aria-label="打印页数">
        {paginated && rosterReady ? `A4 · 共 ${pageCount} 页` : '正在分页…'}
      </div>}
      {!snapshot && !teacherEdition && detail.status === 'draft' && detail.kind !== 'personalized' &&
        <PrintLayoutPanel items={detail.items} busy={saving} onChange={(item, layout) => {
          void updatePrintItem(item, { print_layout: layout }, '排版已保存');
        }} />}
      {/* Floats over the page so the preview stays the paper itself. */}
      {saveState && <span className="save-toast no-print" role="status">{saveState}</span>}
      {sheets.length === 0 && <p className="muted">这份作业的学生都在 App 作答，没有需要打印的。</p>}
      {!teacherEdition && detail.kind !== 'personalized' && detail.settings?.delivery === 'app' && !appOnly && (() => {
        const onPaper = (detail.papers ?? []).filter((paper) => paper.delivery === 'paper' && !paper.missing);
        return <p className="workspace-notice no-print" role="note">推送 App 的作业：{onPaper.length} 名学生还没有登录过，请打印 {onPaper.length} 份给他们（{onPaper.slice(0, 8).map((paper) => paper.display_name).join('、')}{onPaper.length > 8 ? ' 等' : ''}）。</p>;
      })()}
      {sheets.map((sheet) => {
        const onReady = (count: number, valid: boolean) => setPageCounts((current) => ({ ...current,
          [sheet.key]: { version, count, valid },
        }));
        return teacherEdition ? <TeacherSheet key={sheet.key + version} detail={detail} items={sheet.items}
          name={sheet.name} number={sheet.number} onReady={onReady} /> : <PaperSheet key={sheet.key + version}
            detail={detail}
            items={sheet.items}
            name={sheet.name}
            number={sheet.number}
            numberBoxes={numberBoxes}
            editable={!snapshot && detail.status === 'draft' && detail.kind !== 'personalized'}
            onResize={resizeArea}
            onReady={onReady}
          />;
      })}
    </article>
  );
}

function TeacherSheet({ detail, items, name, number, onReady }: {
  detail: AssignmentDetail; items: AssignmentItem[]; name: string | null; number: string | null;
  onReady: (count: number, valid: boolean) => void;
}) {
  const blueprint = buildBlueprint(items);
  const header = <header className="print-teacher-header"><h1>{detail.title}（教师版）</h1>
      <p>共 {items.length} 题 · 满分 {formatPoints(blueprint.totalPoints)} 分{name && ` · ${number ?? ''} ${name}`}</p>
    </header>;
  const blocks = printSections(items).flatMap((section, index): PaperBlock[] => [sectionBlock(section, index),
    ...section.items.flatMap((item): PaperBlock[] => [{ key: item.question_id,
      node: <PrintQuestion item={item} />, split: (element) => choiceUnits(item, element),
      breakBefore: item !== section.items[0] && item.print_layout?.break_before === 'column' },
    { key: item.question_id + '-answer', node: <div className="teacher-solution teacher-answer" aria-label={`第 ${item.number} 题参考答案`}>
      <strong>参考答案</strong><RichText text={item.question?.answer?.trim() || '暂无答案'} imagePaths={item.question?.image_paths} />
    </div>, keepNext: true },
    ...printTextBlocks((item.question ? withUnplacedFigures(item.question, 'explanation', item.question.explanation?.trim() ?? '').trim() : '')
      || '暂无解析').map((text, index): PaperBlock => ({
      key: item.question_id + '-explanation-' + index,
      node: <div className={index === 0 ? 'teacher-explanation' : 'teacher-explanation-continuation'}
        aria-label={index === 0 ? `第 ${item.number} 题解析` : undefined}>
        {index === 0 && <strong>解析</strong>}<RichText text={text} imagePaths={item.question?.image_paths} />
      </div>,
    }))]),
  ]);
  return <PaginatedSheet header={header} blocks={blocks} columns={1} name={name ?? undefined}
    prepare={preparePrint} onReady={onReady} />;
}

function PaperSheet({ detail, items, name, number, numberBoxes, editable, onResize, onReady }: {
  detail: AssignmentDetail;
  items: AssignmentItem[];
  name: string | null;
  number: string | null;
  numberBoxes: number;
  editable: boolean;
  onResize: (item: AssignmentItem, mm: number | null) => void;
  onReady: (count: number, valid: boolean) => void;
}) {
  const blueprint = buildBlueprint(items);
  const choices = items.filter(isChoiceItem);
  const sections = printSections(items);
  // Printed digits sit right-aligned in the boxes, as a student would write them.
  const digits = number ? number.padStart(numberBoxes, ' ').slice(-numberBoxes).split('') : [];

  const header = <>
      {/* Above the top rule: name on a line at the left, number at the right in boxes the scan reads. */}
      <div className="identity" aria-label="学生信息">
        <span>姓名 <span className={`write-line${name ? ' printed-name' : ''}`}>{name}</span></span>
        <span aria-label="学号">学号
          <span className="number-boxes">
            {Array.from({ length: numberBoxes }, (_, index) => (
              <span key={index} className="number-box">{digits[index]?.trim()}</span>
            ))}
          </span>
        </span>
      </div>
      {/* Full-width answer table below the title avoids an empty left half of the header. */}
      <header className="print-header">
        <div className="print-head-main">
          <h1>{detail.title}</h1>
          <p>
            共 {blueprint.questionCount} 题 · 满分 {formatPoints(blueprint.totalPoints)} 分
            {/* Only a class's own copy carries a code; a library preview is not collected. */}
            {detail.class_id && <> · <span className="paper-code">作业编号 {paperCode(detail.id)}</span></>}
          </p>
        </div>
        {choices.length > 0 && (
          <section className="answer-table" aria-label="选择题答题表">
            {chunk(choices, balancedRow(choices.length)).map((row) => (
              <table key={row[0].number}>
                <tbody>
                  <tr>
                    <th scope="row">题号</th>
                    {row.map((item) => <td key={item.question_id} className="table-number">{item.number}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">答案</th>
                    {row.map((item) => <td key={item.question_id} className="table-answer" />)}
                  </tr>
                </tbody>
              </table>
            ))}
          </section>
        )}
      </header>

    </>;
  const blocks = sections.flatMap((section, index): PaperBlock[] => [sectionBlock(section, index),
    ...section.items.map((item): PaperBlock => {
      if (section.choice) return { key: item.question_id, node: <PrintQuestion item={item} />,
        split: (element) => choiceUnits(item, element), breakBefore: item !== section.items[0] && item.print_layout?.break_before === 'column' };
      const answer = <div className="answer-area-wrap"><AnswerArea item={item}
        blanks={printableStem(item.question?.stem_text ?? '', false).blanks} editable={editable} onResize={onResize} /></div>;
      return { key: item.question_id, breakBefore: item !== section.items[0] && item.print_layout?.break_before === 'column',
        node: <li className="print-question with-area"><PrintStem item={item} />{answer}</li>,
        split: (element) => {
          if (element.getBoundingClientRect().height <= 277 * PX_PER_MM - 1) return [{ content:
            <li className="print-question with-area"><PrintStem item={item} />{answer}</li>, height: element.getBoundingClientRect().height }];
          // A very tall answer area stays whole; the stem may precede it in the previous column.
          return [{ content: <PrintStem item={item} />, height: element.querySelector('.print-question-stem')!.getBoundingClientRect().height },
            { content: answer, height: element.querySelector('.answer-area-wrap')!.getBoundingClientRect().height }];
        } };
    }),
  ]);
  return <PaginatedSheet header={header} blocks={blocks} name={name ?? undefined} prepare={preparePrint} onReady={onReady} />;
}

function sectionBlock(section: PrintSection, index: number): PaperBlock {
  return { key: section.items[0].question_id + '-section', keepNext: true,
    breakBefore: section.items[0].print_layout?.break_before === 'column',
    node: <h2 className="section-title">{CHINESE_NUMERALS[index] ?? index + 1}、{section.title}
      <span className="section-points">［{sectionPoints(section.items)}］</span></h2> };
}

function preparePrint(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('.print-question-stem img').forEach((image) =>
    image.classList.toggle('wide', image.naturalWidth > image.naturalHeight * 1.8));
  root.querySelectorAll<HTMLElement>('.print-options:not([data-options-fixed])').forEach(fitOptions);
}

/** A stem stays with the first complete option row. The remaining rows can use
 * the bottom of a column without cutting an option or adding question spacing. */
function choiceUnits(item: AssignmentItem, element: HTMLElement): FlowUnit<ReactNode>[] {
  const list = element.querySelector<HTMLElement>('.print-options');
  const options = item.question?.options ?? [];
  if (!list || !element.getBoundingClientRect().height) return [{ content: <PrintQuestion item={item} />,
    height: element.getBoundingClientRect().height }];
  const layout = list.classList.contains('four') ? 'four' : list.classList.contains('one') ? 'one' : 'two';
  const perRow = layout === 'four' ? 4 : layout === 'two' ? 2 : 1;
  return chunk(options, perRow).map((row, index) => {
    const first = list.children[index * perRow].getBoundingClientRect();
    const bottom = Math.max(...Array.from(list.children).slice(index * perRow, (index + 1) * perRow)
      .map((option) => option.getBoundingClientRect().bottom));
    const top = index === 0 ? element.getBoundingClientRect().top : first.top - 1;
    return { content: <PrintQuestion item={item} options={row} showStem={index === 0} optionsLayout={layout} />,
      height: bottom - top };
  });
}

/** Many bank stems already open with "(多选)"; only add the tag when they don't. */
export function questionTag(item: AssignmentItem): string {
  if (!isChoiceItem(item)) return `（${formatPoints(item.points)}分）`;
  const marked = /^\s*[（(]多选[)）]/.test(item.question?.stem_text ?? '');
  return item.question?.question_type === 'multiple_choice' && !marked ? '（多选）' : '';
}

function AnswerArea({ item, blanks, editable, onResize }: {
  item: AssignmentItem;
  blanks: number;
  editable: boolean;
  onResize: (item: AssignmentItem, mm: number | null) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const height = dragging ?? areaHeight(item);
  const preset = BOX_MM[item.box ?? 'medium'];

  function startDrag(event: ReactPointerEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const start = height;
    let latest = start;
    const move = (next: PointerEvent) => {
      latest = clampArea(start + (next.clientY - startY) / PX_PER_MM);
      setDragging(latest);
    };
    const stop = (end: PointerEvent) => {
      move(end);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      setDragging(null);
      if (latest !== start) onResize(item, latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function nudge(event: KeyboardEvent) {
    const step = { ArrowUp: -AREA_STEP_MM, ArrowDown: AREA_STEP_MM }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = clampArea(height + step);
    if (next !== height) onResize(item, next);
  }

  return (
    <>
      <div className={`answer-area ${item.box ?? 'medium'}`} style={{ height: `${height}mm` }}
        aria-label={`第 ${item.number} 题作答区`}>
        <span className="answer-area-label">
          第 {item.number} 题作答区{blanks > 0 && `：按 ${blankMarks(blanks)} 顺序写出各空答案`}
        </span>
        {editable && (
          <span className="area-handle no-print" role="slider" tabIndex={0}
            aria-label={`第 ${item.number} 题作答区高度`} aria-valuemin={AREA_MIN_MM} aria-valuemax={AREA_MAX_MM}
            aria-valuenow={height} onPointerDown={startDrag} onKeyDown={nudge} />
        )}
      </div>
      {editable && (
        <div className="area-tools no-print">
          <button type="button" disabled={height <= AREA_MIN_MM} aria-label={`第 ${item.number} 题作答区减小`}
            onClick={() => onResize(item, clampArea(height - 10))}>－</button>
          <span>{height} mm</span>
          <button type="button" disabled={height >= AREA_MAX_MM} aria-label={`第 ${item.number} 题作答区增大`}
            onClick={() => onResize(item, clampArea(height + 10))}>＋</button>
          {item.area_mm != null && item.area_mm !== preset && (
            <button type="button" className="link-button" onClick={() => onResize(item, null)}>恢复默认 {preset} mm</button>
          )}
        </div>
      )}
    </>
  );
}

function PrintStem({ item }: { item: AssignmentItem }) {
  const question = item.question;
  // Figures the stem never placed (common in imports) still print after it, as on screen.
  const stem = question ? withUnplacedFigures(question, 'stem', printableStem(question.stem_text, isChoiceItem(item)).text) : '';
  const figure = splitPrintFigure(stem);
  const figureRef = useRef<HTMLDivElement>(null);
  const [small, setSmall] = useState(false);
  const imagePaths = item.question?.image_paths;
  const figurePath = figure ? imagePaths?.[Number(figure.token.match(/\d+/)?.[0])] : undefined;
  useEffect(() => {
    const image = figureRef.current?.querySelector('img');
    if (!image) return;
    const measure = () => setSmall(smallPrintFigure(image.naturalWidth, image.naturalHeight));
    if (image.complete) measure();
    else image.addEventListener('load', measure, { once: true });
    return () => image.removeEventListener('load', measure);
  }, [figurePath]);
  const layout = item.print_layout;
  const mode = layout?.figure === 'wrap' ? 'wrap' : layout?.figure === 'block' || (layout?.figure_width_mm ?? 0) > 45
    ? 'block' : small ? 'wrap' : 'block';
  const width = layout?.figure_width_mm;
  const figureNode = figure && <div key="stem-figure" ref={figureRef} className={`print-question-figure ${mode}`}>
    <RichText text={figure.token} imagePaths={imagePaths} />
  </div>;
  return (
    <div className="print-question-stem" data-figure-layout={layout?.figure || (width ? mode : undefined)} data-figure-width={width}
      style={width ? { '--figure-width': `${width}mm` } as CSSProperties : undefined}>
      {mode === 'wrap' && figureNode}
      <span className="print-number">{item.number}．{questionTag(item)}</span>
      {item.question && <RichText text={figure ? figure.text : stem} imagePaths={imagePaths} />}
      {mode === 'block' && figureNode}
    </div>
  );
}

function PrintQuestion({ item, children, options = item.question?.options ?? [], showStem = true, optionsLayout }: {
  item: AssignmentItem; children?: ReactNode; options?: Array<{ label: string; text: string }>; showStem?: boolean; optionsLayout?: string;
}) {
  const question = item.question;
  return (
    <li className={`print-question${isChoiceItem(item) ? ' choice-question' : ''}${!showStem ? ' continued-options' : ''}${children ? ' teacher-question' : ''}`}
      data-break-before={item.print_layout?.break_before}>
      {showStem && <PrintStem item={item} />}
      {question && options.length > 0 && (
        <ol className={`print-options ${optionsLayout ?? optionLayout(options)}`} data-options-fixed={optionsLayout ? 'true' : undefined}>
          {options.map((option) => (
            <li key={option.label}>
              <span>[{option.label}]</span>
              <RichText text={option.text} imagePaths={question.image_paths} className="inline" />
            </li>
          ))}
        </ol>
      )}
      {children}
    </li>
  );
}
