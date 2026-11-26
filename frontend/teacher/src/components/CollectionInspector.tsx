import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Collection, CollectionItem, CollectionStudent, ScanBatch, ScanBatchPages } from '../types';
import Modal from './Modal';

type Viewing = { src: string; alt: string } | null;
const SUBMISSION_LABELS: Record<string, string> = { recognized: '已识别', needs_review: '待核对', manual: '待人工录入' };
export type CollectionInspection = { kind: 'student'; studentId: string } | { kind: 'batch'; batch: ScanBatch } | { kind: 'image'; src: string; alt: string };

export default function CollectionInspector({ inspection, collection, locked, onClose, onChoice }: {
  inspection: CollectionInspection; collection: Collection; locked: boolean; onClose: () => void;
  onChoice: (submissionId: string, number: number, answer: string) => Promise<void>;
}) {
  const [image, setImage] = useState<Viewing>(inspection.kind === 'image' ? { src: inspection.src, alt: inspection.alt } : null);
  const [pages, setPages] = useState<ScanBatchPages | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const batch = inspection.kind === 'batch' ? inspection.batch : null;
  const student = inspection.kind === 'student' ? collection.students.find((s) => s.student_id === inspection.studentId) : null;
  useEffect(() => {
    if (!batch) return;
    let active = true;
    setPages(null); setError('');
    api.scanBatchPages(batch.id).then((next) => active && setPages(next))
      .catch((err) => active && setError(err instanceof Error ? err.message : '扫描图像加载失败'));
    return () => { active = false; };
  }, [batch?.id, attempt]);
  useEffect(() => { closeButton.current?.focus(); }, [image]);
  async function saveChoice(number: number, answer: string) {
    if (!student?.submission) return;
    setError('');
    try { await onChoice(student.submission.id, number, answer); }
    catch (err) { setError(err instanceof Error ? err.message : '保存失败'); throw err; }
  }
  const title = image?.alt ?? (student ? `${student.display_name} · 作答核对` : batch ? `${batch.filename} · 扫描图像` : '作答详情');
  return <Modal label={title} onClose={onClose} className="collection-inspector">
    <div className="collection-dialog-head"><h2>{title}</h2><div className="paper-actions">
      {image && inspection.kind !== 'image' && <button onClick={() => setImage(null)}>{student ? '返回作答核对' : '返回图像列表'}</button>}
      {image && <a href={image.src} target="_blank" rel="noreferrer">新窗口查看</a>}
      <button ref={closeButton} onClick={onClose}>关闭</button>
    </div></div>
    {image ? <img className="collection-large-image" src={image.src} alt={image.alt} /> : student ? <>
      <p className="muted small">{locked ? '结果已发布，作答只读。' : student.submission?.source === 'app' ? 'App 作答只读，评分和审核请进入预批与审核。' : '核对选择题：修改字母后按 Tab 自动保存。点击作答区可查看原图。'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="table-scroll"><table aria-label="学生作答核对" className="collect-table"><thead><tr><th>学号</th><th>姓名</th><th>状态</th><th>选择题</th><th>作答区</th></tr></thead><tbody>
        <StudentRow row={student} locked={locked} onView={setImage} onChoice={saveChoice} />
      </tbody></table></div>
    </> : batch && <>
      {error ? <p className="error" role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>重试图像</button></p> : !pages ? <p className="muted" role="status">正在加载扫描图像…</p> : !pages.pages.length ? <p className="muted">{batch.status === 'queued' || batch.status === 'processing' ? '图像正在处理中，请稍后重新查看。' : '暂无可查看的扫描图像。'}</p> : <div className="scan-page-grid">
        {pages.pages.map((page) => <article key={page.id} className="scan-page-tile">
          {page.image_url ? <button aria-label={`查看第 ${page.page_index} 页`} onClick={() => setImage({ src: page.image_url!, alt: `第 ${page.page_index} 页扫描图像` })}><img src={page.image_url} alt={`第 ${page.page_index} 页缩略图`} loading="lazy" /></button> : <div className="scan-page-unavailable">图像暂不可用</div>}
          <strong>第 {page.page_index} 页</strong><span className={page.status === 'exception' ? 'error small' : 'muted small'}>{page.issue_label || (page.status === 'ignored' ? '已忽略' : page.student_name ? `${page.student_number ?? ''} ${page.student_name}` : '未匹配学生')}</span>
        </article>)}
      </div>}
    </>}
  </Modal>;
}

function StudentRow({
  row,
  locked,
  onView,
  onChoice,
}: {
  row: CollectionStudent;
  locked: boolean;
  onView: (viewing: Viewing) => void;
  onChoice: (number: number, answer: string) => Promise<void>;
}) {
  const submission = row.submission;
  const choices = submission?.items.filter((item) => item.kind === 'choice') ?? [];
  const areas = submission?.items.filter((item) => item.kind === 'area') ?? [];
  const fromApp = submission?.source === 'app';
  return (
    <tr>
      <td>{row.student_number ?? '—'}</td>
      <td>
        {row.display_name}
        {!row.ai_authorized && !fromApp && <span className="muted small"> 未授权 AI</span>}
      </td>
      <td className={submission ? '' : 'muted'}>
        {submission ? (fromApp ? 'App 已交' : SUBMISSION_LABELS[submission.status]) : '未收'}
      </td>
      <td>
        <span className="choice-cells">
          {choices.map((item) => <ChoiceCell key={item.number} item={item} student={row.display_name}
            locked={locked || fromApp} onSave={(answer) => onChoice(item.number, answer)} />)}
        </span>
      </td>
      <td>
        {areas.map((item) => item.image_url ? (
          <button key={item.number} type="button" className="link-button area-link"
            onClick={() => onView({ src: item.image_url!, alt: `${row.display_name} 第 ${item.number} 题作答` })}>
            第 {item.number} 题
          </button>
        ) : fromApp && item.status !== 'missing' ? (
          <span key={item.number} className="muted small area-link">第 {item.number} 题（App 文字作答）</span>
        ) : <span key={item.number} className="error small area-link">第 {item.number} 题缺失</span>)}
        {(row.page_urls ?? []).length > 0 && areas.some((item) => !item.image_url) && (
          <button type="button" className="link-button small"
            onClick={() => onView({ src: row.page_urls![0], alt: `${row.display_name} 的卷子` })}>看整页</button>
        )}
      </td>
    </tr>
  );
}

function ChoiceCell({ item, student, locked, onSave }: {
  item: CollectionItem;
  student: string;
  locked: boolean;
  onSave: (answer: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(item.answer ?? '');
  // Take the saved answer, unless the teacher is typing in this cell right now.
  useEffect(() => {
    if (document.activeElement !== input.current) setValue(item.answer ?? '');
  }, [item.answer]);
  const flagged = item.status === 'needs_review' || item.status === 'manual' || item.status === 'missing' || item.status === 'pending';
  const mark = item.is_correct === true ? '✓' : item.partial ? '半' : item.is_correct === false ? '✗' : '';
  return (
    <label className={`choice-cell${flagged ? ' flagged' : ''}`} title={item.image_url ? '悬停查看原图' : undefined}>
      <span className="choice-number">{item.number}</span>
      {item.image_url && <img src={item.image_url} alt={`${student} 第 ${item.number} 题手写答案`} className="choice-crop" />}
      <input
        ref={input}
        aria-label={`${student} 第 ${item.number} 题答案`}
        value={value}
        maxLength={6}
        readOnly={locked}
        onChange={(event) => setValue(event.target.value.toUpperCase())}
        onBlur={() => {
          const next = value.trim().toUpperCase();
          // A refused answer goes back to what is saved, so the cell never shows something that was not kept.
          if (!locked && next !== (item.answer ?? '')) onSave(next).catch(() => setValue(item.answer ?? ''));
        }}
      />
      <span className={item.is_correct ? 'correct' : item.partial ? 'partial' : 'wrong'}
        title={item.partial ? '少选：选对但不全，得一半分' : undefined}>{mark}</span>
    </label>
  );
}
