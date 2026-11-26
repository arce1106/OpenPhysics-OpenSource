import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import Modal from '../components/Modal';
import CollectionInspector, { type CollectionInspection } from '../components/CollectionInspector';
import ScannerControl from '../components/ScannerControl';
import type { AssignmentDetail, Collection, CollectionStudent, ScanBatch, ScanException } from '../types';

const POLL_MS = 2000;
type View = 'received' | 'missing' | 'issues' | 'records';
type Viewing = { src: string; alt: string } | null;
const SUBMISSION_LABELS: Record<string, string> = { recognized: '已识别', needs_review: '待核对', manual: '待人工录入' };

function batchLabel(batch: ScanBatch): string {
  if (batch.status === 'queued') return '排队中';
  if (batch.status === 'processing') return batch.page_count ? `处理中 ${batch.processed_pages} / ${batch.page_count} 页` : '处理中';
  if (batch.status === 'failed') return `失败：${batch.error ?? '请重新处理'}`;
  return `完成，共 ${batch.page_count} 页${batch.copies ? `，${batch.copies} 份卷子` : ''}`;
}

function needsReview(row: CollectionStudent): boolean {
  const submission = row.submission;
  if (!submission) return false;
  return submission.status !== 'recognized' || submission.items.some((item) =>
    ['missing', 'needs_review', 'manual', 'pending'].includes(item.status)
      || (item.kind === 'area' && !item.image_url && submission.source !== 'app'));
}

/** A compact intake workbench: scan batches, turn-in progress, and exceptions. */
export default function CollectPage() {
  const { assignmentId = '' } = useParams();
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [view, setView] = useState<View>('records');
  const [search, setSearch] = useState('');
  const [issueBatch, setIssueBatch] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [inspection, setInspection] = useState<CollectionInspection | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = generation.current;
    const next = await api.collection(assignmentId);
    if (generation.current === current) setCollection(next);
    return next;
  }, [assignmentId]);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    setDetail(null); setCollection(null); setError(''); setNotice(''); setView('records');
    setSearch(''); setIssueBatch(null); setInspection(null); setUploadOpen(false); setFiles([]); setConfirmDelete(null);
    // Both endpoints may import completed App papers; load them in sequence.
    api.assignment(assignmentId).then(async (nextDetail) => {
      if (!active) return;
      const next = await api.collection(assignmentId);
      if (active) {
        setDetail(nextDetail); setCollection(next);
        // Nothing scanned yet: start from who is still to hand in, not an empty scan list.
        if (!next.batches.length) setView(next.students.some((row) => row.submission) ? 'received' : 'missing');
      }
    }).catch((err) => active && setError(err instanceof Error ? err.message : '加载失败'));
    return () => { active = false; generation.current += 1; };
  }, [assignmentId]);

  const working = collection?.batches.some((batch) => batch.status === 'queued' || batch.status === 'processing');
  useEffect(() => {
    if (!working || busy) return;
    const timer = window.setInterval(() => void reload().catch((err) => setError(err instanceof Error ? err.message : '加载失败')), POLL_MS);
    return () => window.clearInterval(timer);
  }, [working, busy, reload]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await reload(); return true; }
    catch (err) { setError(err instanceof Error ? err.message : '操作失败'); return false; }
    finally { setBusy(false); }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!files.length || busy || collection?.released) return;
    const repeated: string[] = [];
    const count = files.length;
    const done = await act(async () => {
      for (const file of files) {
        const result = await api.uploadScan(assignmentId, file);
        if (!result.created) repeated.push(file.name);
      }
    });
    if (done) {
      setFiles([]); setUploadOpen(false); setView('records');
      if (fileInput.current) fileInput.current.value = '';
      setNotice(repeated.length ? `${repeated.join('、')} 已经上传过，没有重复处理。` : `已导入 ${count} 个文件，识别进度请查看扫描记录。`);
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragOver(false);
    if (!busy) setFiles(Array.from(event.dataTransfer.files));
  }
  async function saveChoice(submissionId: string, number: number, answer: string) {
    setError('');
    try { await api.setChoice(submissionId, number, answer); await reload(); }
    catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      await reload(); throw err;
    }
  }
  function changeView(next: View) { setView(next); setSearch(''); setIssueBatch(null); }

  if (!collection || !detail) return error ? <section><p className="error" role="alert">{error}</p><Link to="/papers">返回作业管理</Link></section> : <p className="muted">正在加载收卷情况…</p>;
  const appStudents = new Set((detail.papers ?? []).filter((p) => p.delivery === 'app').map((p) => p.student_id));
  // App first, but students who never signed in answer on paper: their copies are scanned here.
  const appDelivery = (detail.settings?.delivery === 'app' || detail.kind === 'personalized')
    && !(detail.papers ?? []).some((p) => p.delivery === 'paper' && !p.missing);
  const locked = Boolean(collection.released) || appDelivery;
  const missing = collection.students.filter((row) => !row.submission);
  const received = collection.students.filter((row) => row.submission);
  const paperCollected = received.filter((row) => row.submission?.source !== 'app');
  const flagged = received.filter(needsReview);
  const pendingCount = collection.exceptions.length + flagged.length;
  const exceptions = issueBatch ? collection.exceptions.filter((e) => e.batch_id === issueBatch) : collection.exceptions;
  const shownStudents = (view === 'missing' ? missing : received).filter((s) =>
    `${s.student_number ?? ''} ${s.display_name}`.includes(search.trim()) && (view !== 'received' || !onlyOpen || needsReview(s)));
  const deleting = collection.batches.find((b) => b.id === confirmDelete);
  const tabs: Array<{ key: View; label: string; count: number }> = [
    { key: 'received', label: '已收学生', count: received.length },
    { key: 'missing', label: '未收学生', count: missing.length },
    { key: 'issues', label: '待处理', count: pendingCount },
    { key: 'records', label: '扫描记录', count: collection.batches.length },
  ];
  const inspectImage = (image: Viewing) => image && setInspection({ kind: 'image', ...image });

  return <section className="collection-workbench">
    <Link to={`/assignments/${assignmentId}`} className="back-link">← {detail.title}</Link>
    <header className="collection-page-head"><div><h1>{appDelivery ? '学生作答' : '扫描收卷'}</h1><p className="muted">{detail.title} · {detail.class_name}{working ? ' · 识别处理中' : ''}</p></div>
      <div className="paper-actions">
        {received.length > 0 && <Link to={`/assignments/${assignmentId}/review`} className="secondary-link">{locked ? '查看审核' : '预批与审核'}</Link>}
        {!locked && <button type="button" disabled={busy} onClick={() => { setError(''); setUploadOpen(true); }}>导入扫描件</button>}
        {!appDelivery && <ScannerControl key={assignmentId} assignmentId={assignmentId} locked={locked} onImported={reload} />}
      </div>
    </header>
    {error && !uploadOpen && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {locked && <p className="workspace-notice">{appDelivery ? '本次作业通过 App 作答，提交后自动汇总。' : '结果已发布，收卷已锁定，可查看扫描记录与原卷。'}</p>}
    <div className="collection-summary" aria-label="收卷进度">
      <button onClick={() => changeView('received')} aria-label="查看已收学生"><span>已收 / 应收</span><strong><em>{collection.collected}</em> / {collection.total}</strong></button>
      <button onClick={() => changeView('missing')} aria-label="查看未收学生"><span>未收学生</span><strong>{missing.length}</strong></button>
      <button onClick={() => changeView('issues')} aria-label="查看待处理异常" className={pendingCount ? 'has-issues' : ''}><span>待处理</span><strong>{pendingCount}</strong></button>
    </div>
    <nav className="tabs collection-tabs" aria-label="收卷视图">{tabs.map((tab) => <button key={tab.key} type="button" onClick={() => changeView(tab.key)} className={view === tab.key ? 'active' : ''} aria-current={view === tab.key ? 'page' : undefined}>{tab.label}<span className={tab.key === 'issues' && tab.count ? 'attention-count' : ''}>{tab.count}</span></button>)}</nav>

    {view === 'records' && <section className="card collection-panel" aria-label="扫描记录"><div className="collection-panel-head"><h2>扫描记录</h2><span className="muted small">{collection.batches.length} 次导入</span></div>
      {!collection.batches.length ? <div className="collection-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M13 22V7h22v15M15 34h18v8H15zM10 35H6V21h36v14h-5M13 17h22M12 27h4" /></svg><h3>还没有扫描记录</h3><p>连接本机扫描工具开始收卷，也可导入已有 PDF 或图片。</p></div> : <div className="table-scroll"><table aria-label="扫描记录表"><thead><tr><th>扫描文件</th><th>导入时间</th><th>图像页数</th><th>识别进度</th><th>待处理页面</th><th>操作</th></tr></thead><tbody>{collection.batches.map((batch) => {
        const count = collection.exceptions.filter((e) => e.batch_id === batch.id).length;
        return <tr key={batch.id}><td className="scan-file-name">{batch.filename}</td><td className="nowrap">{batch.created_at ? new Date(batch.created_at).toLocaleString('zh-CN') : '—'}</td><td>{batch.page_count || '—'}</td><td><span className={`scan-batch-state ${batch.status}`}>{batchLabel(batch)}</span></td><td>{count ? <button className="link-button wrong" onClick={() => { setView('issues'); setIssueBatch(batch.id); }}>{count} 页待处理</button> : '0'}</td><td><div className="collection-row-actions">
          <button className="link-button" onClick={() => setInspection({ kind: 'batch', batch })}>查看图像</button>
          {!locked && batch.status === 'failed' && <button disabled={busy} onClick={() => void act(() => api.retryScanBatch(batch.id))}>重新处理</button>}
          {!locked && <button className="link-button danger" disabled={busy || ['queued', 'processing'].includes(batch.status)} onClick={() => setConfirmDelete(batch.id)}>删除</button>}
        </div></td></tr>;
      })}</tbody></table></div>}
    </section>}

    {(view === 'received' || view === 'missing') && <section className="card collection-panel" aria-label={view === 'missing' ? '未收学生' : '已收学生'}>
      <div className="collection-panel-head"><h2>{view === 'missing' ? '未收学生' : '已收学生'}</h2><span className="muted small">{shownStudents.length} 人</span></div>
      <div className="collection-filters"><input type="search" aria-label="搜索收卷学生" placeholder="姓名或学号" value={search} onChange={(e) => setSearch(e.target.value)} />{view === 'received' && <label className="toggle"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />只看需核对的</label>}</div>
      <StudentList appStudents={appStudents} rows={shownStudents} onInspect={(studentId) => setInspection({ kind: 'student', studentId })} />
      {!shownStudents.length && <p className="collection-empty-note">{search.trim() || (view === 'received' && onlyOpen) ? '没有符合筛选条件的学生。' : view === 'missing' ? '所有参与学生均已收卷。' : '暂未收到学生作答。'}</p>}
    </section>}

    {view === 'issues' && <section className="card collection-panel" aria-label="待处理">
      <div className="collection-panel-head"><h2>{issueBatch ? '本次扫描待处理页面' : '待处理异常'}</h2>{issueBatch && <button onClick={() => setIssueBatch(null)}>查看全部待处理</button>}</div>
      {exceptions.length > 0 && <ul className="rows collection-exceptions">{exceptions.map((item) => <ExceptionRow key={item.page_id} item={item} candidates={missing} collected={paperCollected} busy={busy || locked} onView={inspectImage}
        onAssign={(studentId, replace) => void act(() => api.assignScanPage(item.page_id, studentId, replace))}
        onAttach={(studentId) => void act(async () => { const result = await api.attachScanPage(item.page_id, studentId); setNotice(`已补上 ${result.filled} 道题的作答区。`); })}
        onIgnore={() => void act(() => api.ignoreScanPage(item.page_id))} />)}</ul>}
      {!issueBatch && flagged.length > 0 && <><h3 className="collection-subtitle">已收作答需核对</h3><StudentList appStudents={appStudents} rows={flagged} onInspect={(studentId) => setInspection({ kind: 'student', studentId })} /></>}
      {!exceptions.length && (issueBatch || !flagged.length) && <p className="collection-empty-note">当前没有待处理异常。</p>}
    </section>}

    {!locked && uploadOpen && <Modal label="导入扫描件" onClose={() => !busy && setUploadOpen(false)} className="collection-upload-dialog"><div className="collection-dialog-head"><h2>导入扫描件</h2><button disabled={busy} onClick={() => setUploadOpen(false)}>关闭</button></div>
      <form onSubmit={upload}><div className={`scan-upload-zone${dragOver ? ' over' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={drop}>
        <label htmlFor="scan-file">选择扫描文件</label><input id="scan-file" ref={fileInput} type="file" multiple accept="application/pdf,image/*" disabled={busy} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <p className="muted small">支持 PDF、JPG、PNG，可多选或拖入。建议 300 dpi、灰度、双面扫描。</p>
        {files.length > 0 && <p className="scan-selected-files">已选 {files.length} 个文件：{files.map((f) => f.name).join('、')}</p>}
      </div>
      <details className="scan-recognition-note"><summary>识别说明</summary><p className="muted small">学号和已授权学生的选择题由 AI 识别，只发送切下来的格子；未授权学生的答案需要人工录入。看不清的内容进入待处理列表。本作业已调用 AI {collection.ai_usage.calls} 次。</p></details>
      {error && <p className="error" role="alert">{error} 导入未完成，可重试；已导入的文件不会重复处理。</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setUploadOpen(false)}>取消</button><button type="submit" className="primary" disabled={busy || !files.length}>{busy ? '导入中…' : '导入并识别'}</button></div>
      </form>
    </Modal>}
    {!locked && deleting && <Modal label="删除扫描记录" onClose={() => !busy && setConfirmDelete(null)}><h2>删除扫描记录</h2><p>{deleting.filename}</p><p>{deleting.copies ? `会同时删除其中 ${deleting.copies} 份卷子和已做的批改，确定？` : '确定删除这次扫描记录？'}</p><div className="dialog-actions"><button disabled={busy} onClick={() => setConfirmDelete(null)}>取消</button><button className="danger" disabled={busy} onClick={async () => { if (await act(() => api.deleteScanBatch(deleting.id))) setConfirmDelete(null); }}>确认删除</button></div></Modal>}
    {inspection && <CollectionInspector inspection={inspection} collection={collection} locked={locked} onClose={() => setInspection(null)} onChoice={saveChoice} />}
  </section>;
}

function StudentList({ rows, appStudents, onInspect }: { rows: CollectionStudent[]; appStudents: Set<string>; onInspect: (studentId: string) => void }) {
  return <div className="table-scroll"><table aria-label="收卷学生列表"><thead><tr><th>学号</th><th>姓名</th><th>交付来源</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.student_id}><td>{row.student_number ?? '—'}</td><td>{row.display_name}</td><td>{row.submission?.source === 'app' || appStudents.has(row.student_id) ? 'App' : '纸质'}</td><td>{row.submission ? row.submission.source === 'app' ? 'App 已交' : SUBMISSION_LABELS[row.submission.status] : '未收'}</td><td>{row.submission ? <button className="link-button" aria-label={`查看 ${row.display_name} 的作答`} onClick={() => onInspect(row.student_id)}>{needsReview(row) ? '核对作答' : '查看作答'}</button> : appStudents.has(row.student_id) ? '待 App 提交' : '待收卷'}</td></tr>)}</tbody></table></div>;
}

function ExceptionRow({
  item,
  candidates,
  collected,
  busy,
  onView,
  onAssign,
  onAttach,
  onIgnore,
}: {
  item: ScanException;
  candidates: CollectionStudent[];
  collected: CollectionStudent[];
  busy: boolean;
  onView: (viewing: Viewing) => void;
  onAssign: (studentId: string, replace: boolean) => void;
  onAttach: (studentId: string) => void;
  onIgnore: () => void;
}) {
  const duplicate = item.issue === 'duplicate_copy';
  const orphan = item.kind !== 'first';
  // A doubtful or repeated number is offered as a suggestion; the teacher still decides.
  const [studentId, setStudentId] = useState(item.suggested?.student_id ?? '');
  const options = orphan || duplicate ? collected : candidates;
  const suggestedOutside = item.suggested && !options.some((row) => row.student_id === item.suggested?.student_id);
  return (
    <li>
      <div>
        <strong>{item.issue_label}</strong>
        <span className="muted">
          第 {item.page_index} 页
          {item.recognized_number ? ` · 识别为 ${item.recognized_number}` : ''}
          {item.number_confidence != null && item.issue === 'number_unsure' ? `（把握 ${Math.round(item.number_confidence * 100)}%）` : ''}
          {item.suggested ? ` · 可能是 ${item.suggested.display_name}` : ''}
          {item.page_url && (
            <> · <button type="button" className="link-button"
              onClick={() => onView({ src: item.page_url!, alt: `第 ${item.page_index} 页` })}>查看整页</button></>
          )}
        </span>
        {item.number_url && <img className="number-crop" src={item.number_url} alt={`第 ${item.page_index} 页学号`} />}
        {orphan && <span className="muted small">这页的卷首页不在本次上传里；如果知道是谁的，可以补到他的卷子里，按顺序填入缺少的作答区。</span>}
      </div>
      <span className="item-actions">
        <select disabled={busy} aria-label={`第 ${item.page_index} 页对应的学生`} value={studentId}
          onChange={(event) => setStudentId(event.target.value)}>
          <option value="">选择学生</option>
          {suggestedOutside && item.suggested && (
            <option value={item.suggested.student_id}>{item.suggested.display_name}（已有卷子）</option>
          )}
          {options.map((row) => (
            <option key={row.student_id} value={row.student_id}>
              {row.student_number ? `${row.student_number} ` : ''}{row.display_name}
            </option>
          ))}
        </select>
        {orphan ? (
          <button type="button" disabled={busy || !studentId} onClick={() => onAttach(studentId)}>补到该生卷子</button>
        ) : duplicate ? (
          <button type="button" disabled={busy || !studentId} onClick={() => onAssign(studentId, true)}>用这份替换原卷</button>
        ) : (
          <button type="button" disabled={busy || !studentId} onClick={() => onAssign(studentId, false)}>指定</button>
        )}
        <button type="button" disabled={busy} onClick={onIgnore}>忽略</button>
      </span>
    </li>
  );
}
