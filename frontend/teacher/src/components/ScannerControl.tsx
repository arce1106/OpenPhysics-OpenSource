import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, getAuth } from '../api';
import { scanner, ScannerError, SCANNER_ASSIGNMENT, SCANNER_KEY, type ScannerStatus } from '../scanner';
import Modal from './Modal';

const STATES: Record<string, string> = {
  idle: '就绪', preparing: '准备中，请勿放纸', waiting_for_paper: '可以放纸', scanning: '正在扫描',
  pausing: '正在暂停', paused_by_user: '已暂停', error: '需要检查', stopped: '已结束',
};

export default function ScannerControl({ assignmentId, locked, onImported }: {
  assignmentId: string; locked: boolean; onImported: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => window.sessionStorage.getItem(SCANNER_KEY) ?? '');
  const [draftKey, setDraftKey] = useState('');
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [command, setCommand] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const mounted = useRef(true);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [autoGrade, setAutoGrade] = useState(() => window.sessionStorage.getItem('openphysics:scanner:auto-grade') !== 'false');
  const grading = useRef(autoGrade);
  grading.current = autoGrade;
  const transfer = useRef(window.sessionStorage.getItem(SCANNER_ASSIGNMENT) === assignmentId);
  const armedHere = useRef(transfer.current);
  const commandEpoch = useRef(0);
  const [transferring, setTransferring] = useState(transfer.current);
  const refresh = useRef(onImported);
  refresh.current = onImported;
  const localStatus = useRef(status);
  localStatus.current = status;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [key, open]);

  function allowTransfer(value: boolean) {
    transfer.current = value; setTransferring(value);
    if (value) window.sessionStorage.setItem(SCANNER_ASSIGNMENT, assignmentId);
    else if (window.sessionStorage.getItem(SCANNER_ASSIGNMENT) === assignmentId) window.sessionStorage.removeItem(SCANNER_ASSIGNMENT);
  }
  useEffect(() => {
    if (!key || locked) return;
    let active = true;
    let timer: number;
    const credential = key;
    async function tick() {
      try {
        const epoch = commandEpoch.current;
        const next = await scanner.status(credential);
        if (!active || epoch !== commandEpoch.current) return;
        if (next.protocol_version !== 1 || !next.capabilities?.includes('pdf_stack_export')) throw new ScannerError('请将华高本地扫描更新到 0.5.0 后连接。');
        setStatus(next); setConnected(true);
        if (next.job_id && next.assignment_id === assignmentId) {
          const jobId = next.job_id;
          const batches = await scanner.exports(credential, jobId, assignmentId);
          if (!active) return;
          if (batches.job_id !== jobId || batches.assignment_id !== assignmentId) throw new ScannerError('本机任务与当前作业不一致，已停止上传。');
          const ledgerKey = `openphysics:scanner:uploaded:v1:${getAuth()?.teacher.id}:${assignmentId}:${jobId}`;
          let ledger: Record<string, number> = {};
          try { ledger = JSON.parse(window.localStorage.getItem(ledgerKey) || '{}'); } catch { /* Server also deduplicates by content. */ }
          setUploaded(Object.values(ledger).reduce((sum, pages) => sum + pages, 0));
          if (transfer.current && batches.exports.some((batch) => !ledger[batch.fingerprint])) {
            const intake = await api.collection(assignmentId);
            if (!active) return;
            if (intake.released) throw new Error('成绩已经发布，自动上传已停止。');
            // Complete one cloud intake before sending the next stack, so copy
            // matching cannot race another unfinished batch for this assignment.
            if (intake.batches.some((batch) => ['queued', 'processing'].includes(batch.status))) return;
          }
          for (const batch of batches.exports) {
            if (!active || !transfer.current || ledger[batch.fingerprint]) continue;
            setUploading(true);
            const pdf = await scanner.pdf(credential, jobId, assignmentId, batch.stack);
            if (!active || !transfer.current) break;
            const file = new File([pdf], `扫描_${jobId.slice(0, 8)}_第${batch.stack}叠.pdf`, { type: 'application/pdf' });
            await api.uploadScan(assignmentId, file, grading.current);
            ledger[batch.fingerprint] = batch.page_count;
            window.localStorage.setItem(ledgerKey, JSON.stringify(ledger));
            if (!active) return;
            setUploaded(Object.values(ledger).reduce((sum, pages) => sum + pages, 0));
            await refresh.current();
            break;
          }
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '扫描连接失败');
        allowTransfer(false);
        if (err instanceof ScannerError) {
          setConnected(false);
          if (err.status === 401) { window.sessionStorage.removeItem(SCANNER_KEY); setKey(''); }
        }
      } finally {
        if (active) { setUploading(false); timer = window.setTimeout(tick, 1500); }
      }
    }
    void tick();
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, assignmentId, locked]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (uploading || (status?.active && status.assignment_id === assignmentId)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status?.active, status?.assignment_id, assignmentId, uploading]);
  useEffect(() => () => {
    // Route changes stop feeding this assignment; saved images remain resumable.
    const current = localStatus.current;
    if (armedHere.current && key && current?.active && current.assignment_id === assignmentId) void scanner.pause(key, assignmentId).catch(() => undefined);
  }, [key, assignmentId, locked]);

  async function connect(event: FormEvent) {
    event.preventDefault(); setCommand(true); setError('');
    try {
      const value = draftKey.trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error('请粘贴扫描工具中复制的完整连接码。');
      const next = await scanner.status(value);
      if (next.protocol_version !== 1 || !next.capabilities?.includes('pdf_stack_export')) throw new Error('请将华高本地扫描更新到 0.5.0 后连接。');
      window.sessionStorage.setItem(SCANNER_KEY, value);
      setKey(value); setDraftKey(''); setStatus(next); setConnected(true);
    } catch (err) { setError(err instanceof Error ? err.message : '连接失败'); }
    finally { setCommand(false); }
  }
  async function start() {
    setCommand(true); setError('');
    commandEpoch.current += 1;
    try {
      await scanner.start(key, assignmentId);
      if (!mounted.current) { await scanner.pause(key, assignmentId); return; }
      armedHere.current = true;
      allowTransfer(true);
      setStatus({ protocol_version: 1, state: 'preparing', active: true, assignment_id: assignmentId, job_id: null, pages: 0, sheets: 0 });
    } catch (err) { setError(err instanceof Error ? err.message : '启动失败'); }
    finally { setCommand(false); }
  }
  async function pause() {
    setCommand(true); setError('');
    commandEpoch.current += 1;
    try { await scanner.pause(key, assignmentId); setStatus((previous) => previous && { ...previous, state: 'pausing' }); }
    catch (err) { setError(err instanceof Error ? err.message : '暂停失败'); }
    finally { setCommand(false); }
  }
  if (locked) return null;
  const ours = status?.assignment_id === assignmentId || (armedHere.current && status?.state === 'preparing' && !status.job_id);
  const active = Boolean(status?.active);
  return <>
    <button className="primary" onClick={() => setOpen(true)}>{(active && ours) || uploading || transferring || error ? '扫描控制' : '开始扫描'}</button>
    {error && !open && <span className="error small">扫描上传已暂停，请打开扫描控制查看。</span>}
    {open && <Modal label="本机扫描" className="scanner-dialog" onClose={() => setOpen(false)}>
      <div className="collection-dialog-head"><h2>本机扫描</h2><button ref={closeButton} onClick={() => setOpen(false)}>关闭</button></div>
      {!key ? <form onSubmit={connect}>
        <p className="scanner-connect-hint">华高本地扫描 → 扫描 → 复制网页连接码</p>
        <label>扫描工具连接码<input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} autoComplete="off" /></label>
        <div className="dialog-actions"><button className="primary" disabled={command || !draftKey.trim()}>{command ? '连接中…' : '连接扫描工具'}</button></div>
      </form> : <>
        <div className="scanner-status" role="status"><strong>{connected ? uploading ? '正在上传' : ours ? STATES[status?.state ?? 'idle'] ?? '就绪' : active ? '其他任务扫描中' : '就绪' : '连接中断'}</strong><span>已扫描 {ours ? status?.pages ?? 0 : 0} 面 · 已上传 {uploaded} 面</span></div>
        {active && !ours && <p className="error">本机正在扫描其他任务，请先暂停。</p>}
        {ours && status?.state === 'error' && <p className="error" role="alert">{status.message || '请检查本机扫描工具。'}</p>}
        <div className="scanner-options">
          <label className="toggle"><input type="checkbox" checked={autoGrade} disabled={transferring || uploading} onChange={(event) => { setAutoGrade(event.target.checked); window.sessionStorage.setItem('openphysics:scanner:auto-grade', String(event.target.checked)); }} />上传后自动预批</label>
          {!active && !uploading && <button type="button" className="link-button" onClick={() => { allowTransfer(false); window.sessionStorage.removeItem(SCANNER_KEY); setKey(''); setConnected(false); setStatus(null); setUploaded(0); setError(''); }}>重新连接扫描工具</button>}
        </div>
        <div className="scanner-actions">
          <button className="primary" disabled={!connected || command || active} onClick={() => void start()}>{command ? '处理中…' : '开始扫描并上传'}</button>
          <button disabled={!connected || command || !active || !ours || status?.state === 'pausing'} onClick={() => void pause()}>暂停扫描</button>
          {ours && !transferring && <button disabled={!connected || command} onClick={() => { setError(''); allowTransfer(true); }}>继续上传待传文件</button>}
        </div>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>}
  </>;
}
