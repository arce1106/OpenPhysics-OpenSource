import { Link } from 'react-router-dom';
import { printsForSome } from './DeliveryChoice';
import { KIND_LABELS, classProgress, formatPoints, shortDate } from '../labels';
import type { ClassAssignment, LibraryEntry } from '../types';
import PdfDownloadButton from './PdfDownloadButton';

function paperMeta(entry: LibraryEntry): string {
  if (entry.kind === 'personalized') return `每人 ${entry.question_count} 题`;
  if (entry.question_count === 0) return '还没有题目';
  const saved = entry.status === 'saved' && entry.published_at ? ` · 保存于 ${shortDate(entry.published_at)}` : '';
  return `${entry.question_count} 题 · ${formatPoints(entry.total_points ?? 0)} 分${saved}`;
}

/** Availability is derived only from existing task states; printing has no completion flag. */
export function HomeworkProgress({ row, kind }: { row: ClassAssignment; kind: string }) {
  const base = `/assignments/${row.id}`;
  const draft = row.status === 'draft';
  const released = Boolean(row.results_released_at);
  const received = row.collected > 0;
  const appDelivery = !printsForSome(row);
  const steps = [
    { label: draft ? '审核并发布' : '已发布作业', path: base, enabled: true, current: draft, done: !draft },
    ...(!appDelivery ? [{ label: kind === 'personalized' ? '作业交付' : '打印作业', path: kind === 'personalized' ? base : `${base}/print`,
      enabled: !draft, current: false, done: false, reason: '先审核并发布作业', print: kind !== 'personalized' }] : []),
    { label: appDelivery ? '学生作答' : released ? '收卷情况' : received ? '继续收卷' : '待收卷', path: appDelivery ? `${base}?tab=students` : `${base}/collect`,
      enabled: !draft, current: !draft && !received && !released, done: !draft && row.member_count > 0 && row.collected >= row.member_count,
      reason: '先审核并发布作业' },
    { label: released ? '审核已完成' : '预批与审核', path: `${base}/review`,
      enabled: !draft && (received || released), current: !draft && received && !released, done: released,
      reason: '收到学生作答后进入预批与审核' },
    { label: released ? '查看报告' : '学情报告', path: `${base}?tab=overview`,
      enabled: released, current: released, done: false, reason: '在预批与审核中发布结果后查看报告' },
  ];

  return (
    <ol className="homework-progress" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={`${row.class_name}作业流程`}>
      {steps.map((step, index) => (
        <li key={step.path + index} className={`${step.current ? 'current' : ''} ${step.done ? 'done' : ''}`}>
          {step.enabled ? (
            <Link to={step.path} target={step.print ? '_blank' : undefined} aria-current={step.current ? 'step' : undefined}>
              <span className="progress-mark" aria-hidden="true">{step.done ? '✓' : index + 1}</span>{step.label}
            </Link>
          ) : (
            <button type="button" disabled title={step.reason}>
              <span className="progress-mark" aria-hidden="true">{index + 1}</span>{step.label}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function HomeworkCard({ entry, classFilter, onAssign, onCopy, onDelete }: {
  entry: LibraryEntry; classFilter: string; onAssign: () => void; onCopy: () => void; onDelete: () => void;
}) {
  const rows = classFilter ? entry.classes.filter((row) => row.class_id === classFilter) : entry.classes;
  const execution = rows.find((row) => row.status === 'published') ?? rows[0];
  const titlePath = execution ? `/assignments/${execution.id}` : `/assignments/${entry.id}`;
  const unsaved = entry.is_paper && entry.kind === 'test' && entry.status === 'draft';

  return (
    <li className="card homework-card" aria-label={entry.title}>
      <div className="homework-card-head">
        <div className="homework-card-title">
          <span className={`kind-tag ${entry.kind}`}>{KIND_LABELS[entry.kind] ?? entry.kind}</span>
          <h2>{<Link to={titlePath}>{entry.title}</Link>}</h2>
          {unsaved && <span className="kind-tag unsaved">未保存</span>}
        </div>
        <div className="homework-card-actions">
          {entry.kind === 'personalized' ? (
            <button type="button" onClick={onAssign}>按同样设置再布置</button>
          ) : unsaved ? (
            <Link to={`/assignments/${entry.id}`} className="secondary-link">继续组卷</Link>
          ) : (
            <><Link to={`/assignments/${entry.id}`} className="secondary-link">查看试卷</Link><PdfDownloadButton assignmentId={entry.id} title={entry.title} />
              <button type="button" onClick={onAssign}>发布到班级</button></>
          )}
          {entry.kind === 'test' && <button type="button" onClick={onCopy}>复制</button>}
          <button type="button" className="danger" onClick={onDelete}>删除</button>
        </div>
      </div>
      <div className="homework-card-meta">
        <span>物理</span><span>{paperMeta(entry)}</span>
        {entry.created_at && <span>创建于 {shortDate(entry.created_at)}</span>}
      </div>
      {rows.length > 0 ? (
        <div className="homework-class-table">
          <div className="homework-table-head" aria-hidden="true"><span>班级 / 布置对象</span><span>收卷进度</span><span>流程管理</span></div>
          <ul className="homework-class-rows">
            {rows.map((row) => (
              <li key={row.id} className="homework-class-row">
                <div className="homework-class-name">
                  <Link to={`/assignments/${row.id}`} aria-label={`${row.class_name} ${classProgress(row)}`}>
                    <strong>{row.class_name}</strong><span className="small muted">{classProgress(row)}</span>
                  </Link>
                  <span className="small muted">{row.member_count} 名学生{shortDate(row.published_at ?? row.created_at) && ` · ${shortDate(row.published_at ?? row.created_at)}`}</span>
                </div>
                <div className="homework-received"><strong>{row.collected}<span> / {row.member_count}</span></strong><span>已收 / 应收</span></div>
                <div className="homework-progress-scroll"><HomeworkProgress row={row} kind={entry.kind} /></div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="homework-unassigned">
          <span className="unassigned-mark" aria-hidden="true">○</span>
          <div><strong>{entry.kind === 'test' ? (entry.status === 'draft' ? '还没保存' : '还没发布到班级') : '还没布置给班级'}</strong>
            <p>布置到班级后，在这里跟进每个班的收卷、审核和报告。</p></div>
        </div>
      )}
    </li>
  );
}
