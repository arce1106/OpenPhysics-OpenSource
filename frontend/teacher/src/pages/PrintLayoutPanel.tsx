import { useState } from 'react';
import type { AssignmentItem, PrintLayout } from '../types';
import { withUnplacedFigures } from '../questionFigures';

export default function PrintLayoutPanel({ items, busy, onChange }: {
  items: AssignmentItem[]; busy: boolean;
  onChange: (item: AssignmentItem, layout: PrintLayout | null) => void;
}) {
  const [selected, setSelected] = useState('');
  const item = items.find((value) => value.question_id === selected) ?? items[0];
  if (!item) return null;
  const layout = item.print_layout ?? {};
  const question = item.question;
  const hasFigure = Boolean(question) && /\{\{IMG:\d+\}\}/.test(withUnplacedFigures(question!, 'stem'));
  const change = (patch: Partial<PrintLayout>) => onChange(item, { ...layout, ...patch });
  return <details className="print-layout-panel no-print">
    <summary>调整排版</summary>
    <label>题目<select aria-label="排版题目" value={item.question_id} onChange={(event) => setSelected(event.target.value)}>
      {items.map((value) => <option key={value.question_id} value={value.question_id}>第 {value.number} 题</option>)}
    </select></label>
    <fieldset disabled={busy}>
      {hasFigure && <>
        <label>题图<select aria-label="题图排布" value={layout.figure ?? 'auto'} onChange={(event) => change({
          figure: event.target.value as PrintLayout['figure'],
          ...(event.target.value === 'wrap' && (layout.figure_width_mm ?? 0) > 45 ? { figure_width_mm: null } : {}),
        })}>
          <option value="auto">自动</option><option value="wrap">右侧环绕</option><option value="block">单独居中</option>
        </select></label>
        <label>图宽<select aria-label="题图宽度" value={layout.figure_width_mm ?? ''} onChange={(event) => change({
          figure_width_mm: event.target.value ? Number(event.target.value) : null,
        })}>
          <option value="">自动</option>
          {[20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75].map((width) => <option key={width} value={width}
            disabled={layout.figure === 'wrap' && width > 45}>{width} 毫米</option>)}
        </select></label>
      </>}
      <label className="print-layout-break"><input type="checkbox" checked={layout.break_before === 'column'}
        onChange={(event) => change({ break_before: event.target.checked ? 'column' : null })} />另起一栏</label>
      <button type="button" disabled={!item.print_layout} onClick={() => onChange(item, null)}>恢复默认排版</button>
    </fieldset>
  </details>;
}
