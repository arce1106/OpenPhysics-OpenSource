import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatPoints, percent } from '../labels';
import type { ClassPracticeRecord, ClassStatistics, KnowledgeEvidence } from '../types';
import Modal from './Modal';
import { QuestionBody, QuestionMeta } from './QuestionBrowser';
import RichText from './RichText';
import { practicePath } from './AssignmentAnalysis';
import { studentLearningPath, type StudentNavigationState } from '../classNavigation';
import { LevelTag, Performance, PERFORMANCE_NOTE, levelRank } from './Performance';

const rate = (value: number | null) => value == null ? '—' : percent(value);
export const homeworkRate = (e: KnowledgeEvidence) => e.homework_full ? percent(e.homework_earned / e.homework_full) : '—';

/** A one-line glimpse of the question, so a record can be told apart before opening it. */
export function stemPreview(text: string | undefined | null, length = 36) {
  const plain = (text ?? '').replace(/\$+/g, '').replace(/\\(frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, '$2/$3')
    .replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

export function MasteryEstimate({ evidence }: { evidence: KnowledgeEvidence }) {
  return <>{rate(evidence.mastery)}{evidence.mastery_attempts != null && evidence.mastery_attempts > 0 &&
    <span className="student-no-data">{evidence.mastery_attempts} 次有效证据{evidence.mastery_updated_at && ` · ${new Date(evidence.mastery_updated_at).toLocaleDateString('zh-CN')}`}</span>}</>;
}

export default function ClassLearningDetail({ classId, statistics, kpId, navigationState, onClose }: {
  classId: string; statistics: ClassStatistics; kpId: string;
  navigationState: StudentNavigationState; onClose: () => void;
}) {
  const point = statistics.knowledge_points.find((p) => p.kp_id === kpId);
  const title = `${point?.kp_name ?? '知识点'} · 学习明细`;
  const affected = point?.students.filter((s) => s.level === 'weak' || s.level === 'developing').map((s) => s.student_id) ?? [];
  const rows = [...(point?.students ?? [])].sort((a, b) => levelRank(a.level) - levelRank(b.level) || (a.score ?? 2) - (b.score ?? 2));
  return <Modal label={title} onClose={onClose} className="class-learning-dialog">
    <div className="class-detail-head"><div><h2>{title}</h2><p className="muted small">{[point?.chapter, point?.section].filter(Boolean).join(' / ')}</p></div><button onClick={onClose}>关闭</button></div>
    {point && <>
      <p className="class-detail-summary">班级表现 <Performance score={point.score} evidence={point.evidence} level={point.level} /> <LevelTag level={point.level} /> · 有数据学生 {point.student_count} / {statistics.students.length} 人 · 薄弱 {point.weak_students ?? 0} 人 · 待巩固 {point.developing_students ?? 0} 人</p>
      {affected.length > 0 && <p><Link className="secondary-link" to={practicePath(classId, affected, [point.kp_id])}>为 {affected.length} 名薄弱或待巩固的学生出个性化作业</Link><span className="muted small"> 进入组卷后可再确认名单。</span></p>}
      <div className="table-scroll"><table aria-label="知识点学生明细"><thead><tr><th>学生</th><th>表现</th><th>状态</th><th>练习题次</th><th>作业得分率</th><th>系统掌握度估计</th></tr></thead><tbody>{rows.map((e) => <tr key={e.student_id}><td><Link to={studentLearningPath(classId, e.student_id)} state={navigationState}>{statistics.students.find((s) => s.student_id === e.student_id)?.display_name}</Link></td><td><Performance score={e.score} evidence={e.evidence} level={e.level} /></td><td><LevelTag level={e.level} /></td><td>{e.practice_count || '—'}</td><td>{homeworkRate(e)}</td><td className="muted"><MasteryEstimate evidence={e} /></td></tr>)}</tbody></table></div>
      <p className="class-stat-footnote">{PERFORMANCE_NOTE}系统掌握度估计与学生 App 共用，结合学生账号的全部练习，仅供参考。</p>
    </>}
    <PracticeRecords classId={classId} kpId={point?.kp_id} />
  </Modal>;
}

/** Full marks, part of the marks, none, or still awaiting confirmation. */
export function recordResult(r: ClassPracticeRecord): { label: string; tone: string } {
  const credit = r.credit ?? (r.is_correct == null ? null : r.is_correct ? 1 : 0);
  const points = r.score != null && r.max_score != null ? ` ${formatPoints(r.score)}/${formatPoints(r.max_score)} 分` : '';
  if (credit == null) return { label: '待确认', tone: 'pending' };
  if (credit >= 1) return { label: `正确${points}`, tone: '' };
  if (credit > 0) return { label: `部分得分${points}`, tone: 'partial' };
  return { label: `错误${points}`, tone: 'wrong' };
}

const SOURCE_LABELS: Record<string, string> = { teacher_app: 'App 老师作业', teacher_paper: '纸质老师作业', practice: 'App 自主练习' };

export function PracticeRecords({ classId, studentId, kpId, headingLevel = 3 }: { classId: string; studentId?: string; kpId?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const [records, setRecords] = useState<ClassPracticeRecord[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [source, setSource] = useState<'all' | 'practice' | 'homework'>('all');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const filters = { student_id: studentId, kp_id: kpId, wrong_only: wrongOnly, source };
  useEffect(() => {
    let active = true;
    setRecords(null); setError('');
    api.classRecords(classId, filters).then((next) => {
      if (active) { setRecords(next.items); setHasMore(next.has_more); }
    }).catch((err) => active && setError(err instanceof Error ? err.message : '学习记录加载失败'));
    return () => { active = false; };
  }, [classId, studentId, kpId, wrongOnly, source, attempt]);
  async function loadMore() {
    if (!records) return;
    setLoadingMore(true);
    try {
      const next = await api.classRecords(classId, { ...filters, offset: records.length });
      setRecords([...records, ...next.items]); setHasMore(next.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : '学习记录加载失败');
    } finally {
      setLoadingMore(false);
    }
  }
  return <section className="class-practice-records"><div className="class-stat-card-head class-record-filters"><Heading>学习证据</Heading><div className="class-record-selects"><select aria-label="学习证据来源" value={source} onChange={(e) => setSource(e.target.value as typeof source)}><option value="all">全部学习证据</option><option value="practice">App 自主练习</option><option value="homework">老师已发布作业</option></select><select aria-label="练习记录范围" value={wrongOnly ? 'wrong' : 'all'} onChange={(e) => setWrongOnly(e.target.value === 'wrong')}><option value="all">全部作答</option><option value="wrong">只看失分</option></select></div></div>
    {error && records == null ? <p className="error" role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>重试</button></p> : records == null ? <p className="muted">正在加载学习记录…</p> : !records.length ? <p className="muted">{wrongOnly ? '当前范围暂无已确认的失分记录。' : '当前范围暂无学习证据。未发布的作业批改不进入正式记录。'}</p> : <>
      <p className="muted small">共显示 {records.length} 条，按时间从近到远。学生入班以前的自主练习不在此显示。</p>
      {records.map((r, index) => {
        const result = recordResult(r);
        return <details className="class-practice-record" key={r.id}><summary><span>{!studentId && `${r.display_name} · `}{r.question?.primary_kp?.name ?? '练习记录'}{r.question?.stem_text && <span className="record-stem"> · {stemPreview(r.question.stem_text)}</span>}<span className="muted small"> {SOURCE_LABELS[r.source ?? 'practice']}{r.assignment_title && ` · ${r.assignment_title}`} · {r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''}</span></span><span className={`class-record-result ${result.tone}`}>{result.label}</span></summary>
        <div className="class-record-body"><p className="muted small">{r.source === 'teacher_app' ? 'App 老师作业 · 教师已发布' : r.source === 'teacher_paper' ? '纸质老师作业 · 教师已发布' : 'App 自主练习'}{r.assignment_title && ` · ${r.assignment_title}`}{r.score != null && r.max_score != null && ` · ${formatPoints(r.score)} / ${formatPoints(r.max_score)} 分`}</p>{r.question ? <><QuestionMeta question={r.question} showHistory={false} /><QuestionBody question={r.question} /><div className="answer">参考答案：<RichText text={r.question.answer ?? '未提供'} imagePaths={r.question.image_paths} /></div></> : <p className="muted">题目暂不可用。</p>}
          <h4>学生作答</h4>{r.image_url ? <a href={r.image_url} target="_blank" rel="noreferrer"><img className="class-record-image" src={r.image_url} alt={`${r.display_name} 的第 ${index + 1} 条作答`} /></a> : r.given_answer ? <RichText text={r.given_answer} /> : <p className="muted">未提供文本作答。</p>}
          {r.first_error && <div>第一处关键错误：<RichText text={r.first_error} /></div>}{result.tone !== '' && r.error_type_name && <p>记录错因：{r.error_type_name}</p>}{r.feedback && <RichText text={r.feedback} />}
        </div></details>;
      })}
      {error && <p className="error" role="alert">{error}</p>}
      {hasMore && <button type="button" className="class-record-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在加载…' : '加载更早的记录'}</button>}
    </>}
  </section>;
}
