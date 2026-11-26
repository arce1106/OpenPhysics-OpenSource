import { useState } from 'react';
import { api } from '../api';
import Modal from './Modal';

export default function DeleteAssignmentDialog({ assignmentId, title, assignedCount = 0, onClose, onDeleted }: {
  assignmentId: string; title: string; assignedCount?: number; onClose: () => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAssignment(assignmentId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试');
      setBusy(false);
    }
  }

  return <Modal label="删除作业" onClose={() => !busy && onClose()}>
    <h2>删除作业</h2>
    <p>确定删除“{title}”吗？</p>
    {assignedCount > 0 && <p>同时移除 {assignedCount} 个班级的布置，停止学生继续提交。已有作答、成绩和学情数据会保留。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</button>
    </div>
  </Modal>;
}
