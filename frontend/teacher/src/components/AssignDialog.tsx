import { useState } from 'react';
import { api } from '../api';
import Modal from './Modal';
import DeliveryChoice, { AppDeliveryNotice, type DeliveryMode } from './DeliveryChoice';
import StudentRecipients, { selectedRecipients, type StudentSelection } from './StudentRecipients';
import type { AssignmentSummary, ClassAssignment, TeacherClassSummary } from '../types';

export default function AssignDialog({ assignmentId, title, kind, assigned, classes, preselected = [], initialDelivery = 'paper', onClose, onDone }: {
  assignmentId: string; title: string; kind: string; assigned: ClassAssignment[]; classes: TeacherClassSummary[];
  preselected?: string[]; initialDelivery?: DeliveryMode; onClose: () => void; onDone: (created: AssignmentSummary[]) => void;
}) {
  const given = new Set(kind === 'test' ? assigned.map((row) => row.class_id) : []);
  const [picked, setPicked] = useState(() => new Set(preselected.filter((id) => !given.has(id)
    && classes.some((item) => item.id === id && item.member_count > 0))));
  const [busy, setBusy] = useState(false);
  const [studentSelection, setStudentSelection] = useState<StudentSelection>({});
  const [delivery, setDelivery] = useState<DeliveryMode>(initialDelivery);
  const [error, setError] = useState('');
  const chosenClasses = classes.filter((item) => picked.has(item.id));
  const invalid = chosenClasses.some((item) => studentSelection[item.id]?.length === 0);
  async function submit() {
    setBusy(true); setError('');
    try {
      const recipients = selectedRecipients(chosenClasses, studentSelection);
      const result = await api.assignTo(assignmentId, [...picked], Object.keys(recipients).length ? recipients : undefined, delivery);
      onDone(result.assigned);
    } catch (err) { setError(err instanceof Error ? err.message : '布置失败'); setBusy(false); }
  }
  const heading = kind === 'personalized' ? '布置到班级' : '发布到班级';
  return <Modal label={heading} onClose={() => !busy && onClose()}>
    <h2>{heading}</h2><p className="muted small">{title}</p>
    <StudentRecipients classes={classes} chosen={picked} onClassesChange={setPicked} selected={studentSelection}
      onChange={setStudentSelection} unavailable={given} disabled={busy} allowStudents={kind === 'personalized'} />
    <DeliveryChoice value={delivery} onChange={setDelivery} disabled={busy} />
    {delivery === 'app' && <AppDeliveryNotice classIds={[...picked]} />}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={busy || !picked.size || invalid} onClick={() => void submit()}>
        {busy ? '正在布置…' : !picked.size ? '请选择班级' : `${kind === 'personalized' ? '布置给' : '发布给'} ${picked.size} 个班`}
      </button>
    </div>
  </Modal>;
}
