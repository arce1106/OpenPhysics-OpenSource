import { Link, NavLink } from 'react-router-dom';
import { CLASS_LEVEL_LABELS } from '../labels';
import type { TeacherClassDetail } from '../types';

export default function ClassNav({ classId }: { classId: string }) {
  return (
    <nav className="tabs" aria-label="班级">
      <NavLink to={`/classes/${classId}`} end>班级学情</NavLink>
      <NavLink to={`/classes/${classId}/roster`}>名单与学号</NavLink>
    </nav>
  );
}

/** The same head on every class tab, so switching tabs does not move the page. */
export function ClassHeader({ detail, statisticsOnly = false }: { detail: TeacherClassDetail; statisticsOnly?: boolean }) {
  return (
    <>
      <Link to="/classes" className="back-link">← 我的班级</Link>
      <div className="homework-head">
        <h1>{detail.name}</h1>
        {!statisticsOnly && detail.member_count > 0 && (
          <Link to={`/?for=${encodeURIComponent(detail.id)}`} className="primary-link">给本班布置作业</Link>
        )}
      </div>
      <p className="muted">
        {[detail.grade, CLASS_LEVEL_LABELS[detail.level], `${detail.member_count} 名学生`].filter(Boolean).join(' · ')}
      </p>
      <ClassNav classId={detail.id} />
    </>
  );
}
