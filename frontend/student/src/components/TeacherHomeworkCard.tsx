import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TeacherHomework } from '../types';
import { homeTeacherHomework, homeworkDetail } from '../utils/teacherHomework';

const ACTION: Record<TeacherHomework['status'], string> = {
  in_progress: '去作答',
  grading: '继续批改',
  completed: '查看结果',
};

/** The latest teacher homework, first inside 今日推荐任务. */
export default function TeacherHomeworkTasks({ items }: { items: TeacherHomework[] }) {
  const [expanded, setExpanded] = useState(false);
  const { primary, otherPending } = homeTeacherHomework(items);
  if (!primary) return null;
  return (
    <ul className="teacher-homework-tasks" aria-label="老师作业">
      {[primary, ...(expanded ? otherPending : [])].map((item) => (
        <li key={item.attempt_id}>
          <div>
            <small>{item.delivery === 'paper' ? '纸质作业 · 已出成绩' : '老师作业'}</small>
            <strong>{item.title}</strong>
            <span>{homeworkDetail(item)}</span>
          </div>
          <Link className={item.status === 'completed' ? 'home-secondary-action' : 'home-primary-action'}
            to={`/homework/${encodeURIComponent(item.attempt_id)}`}>
            {ACTION[item.status]}
          </Link>
        </li>
      ))}
      {otherPending.length > 0 && (
        <li>
          <button type="button" className="teacher-homework-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : `还有 ${otherPending.length} 份作业待完成`}
          </button>
        </li>
      )}
    </ul>
  );
}
