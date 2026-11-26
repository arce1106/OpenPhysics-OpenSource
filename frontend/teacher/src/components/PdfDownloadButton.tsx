import { useState } from 'react';
import { api } from '../api';

export default function PdfDownloadButton({ assignmentId, title, className = 'secondary', edition = 'student' }: {
  assignmentId: string; title: string; className?: string; edition?: 'student' | 'teacher';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    setBusy(true);
    setError('');
    try {
      const blob = await api.assignmentPdf(assignmentId, edition);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || '作业'}${edition === 'teacher' ? '（教师版）' : ''}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF 下载失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="pdf-download">
      <button type="button" className={className} disabled={busy} onClick={() => void download()}>
        {busy ? '正在生成 PDF…' : edition === 'teacher' ? '下载教师版' : '下载 PDF'}
      </button>
      {error && <span className="error small" role="alert">{error}</span>}
    </span>
  );
}
