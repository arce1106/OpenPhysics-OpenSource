import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ACCENT, MetricCard, MetricGrid, PageHeader, PageShell, panelStyle as basePanel, secondaryButton } from './AdminUi';
import type { KpWithStats, TeachingInsightPoint, TeachingInsightQuestion, TeachingInsights } from '../types';

type Tab = 'points' | 'questions';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * 教学工作台: where students on the platform learn badly, read for content work — knowledge points
 * that need more questions or a better explanation, and questions that go wrong unusually often.
 * Each student's own learning is on the teachers' class pages; accounts are in 学生管理.
 */
export default function TeachingDashboardPage({ kps = [], onOpenKp }: {
  kps?: KpWithStats[];
  /** Opens a knowledge point in 教学资源 (its question bank or its learning resources). */
  onOpenKp?: (kpId: string) => void;
}) {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<TeachingInsights | null>(null);
  const [classId, setClassId] = useState('');
  const [includeInternal, setIncludeInternal] = useState(false);
  const [tab, setTab] = useState<Tab>('points');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const questionCounts = useMemo(() => new Map(kps.map(kp => [kp.id, kp.question_count])), [kps]);

  // Switching scope quickly: only the last request's answer is shown.
  const latest = useRef(0);
  const load = async (nextClass = classId, nextInternal = includeInternal) => {
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getTeachingInsights({ classId: nextClass || undefined, includeInternal: nextInternal });
      if (request === latest.current) setInsights(result);
    } catch (e: any) {
      if (request === latest.current) setError(e.message || '加载失败');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  };
  useEffect(() => { void load('', false); }, []);

  const openKp = (kpId: string, resourceTab: 'questions' | 'learning') => {
    onOpenKp?.(kpId);
    navigate(`/resources?tab=${resourceTab}`);
  };
  const summary = insights?.summary;
  const days = insights?.scope;

  return (
    <PageShell>
        <PageHeader title="教学工作台"
          description="学生在哪些知识点、哪些题上学得差：据此补题、改题、补讲解。每个学生的学情请到教师端班级页查看。"
          actions={<>
            <select aria-label="统计范围" value={classId} style={selectStyle}
              onChange={e => { setClassId(e.target.value); void load(e.target.value, includeInternal); }}>
              <option value="">全部学生</option>
              {(insights?.classes ?? []).map(item => <option key={item.id} value={item.id}>{item.name} · {item.teacher_name}</option>)}
            </select>
            {!classId && (
              <label style={{ fontSize: 13, color: '#52606d', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includeInternal}
                  onChange={e => { setIncludeInternal(e.target.checked); void load(classId, e.target.checked); }} />
                包含测试与审核账号
              </label>
            )}
            <button onClick={() => load()} style={secondaryButton}>刷新</button>
          </>} />

        {error && <div style={errorBox}>{error}</div>}

        {loading && !insights ? (
          <div style={{ padding: 32, color: '#667085' }}>正在加载…</div>
        ) : !insights || !summary ? null : (
          <>
            <MetricGrid>
              <MetricCard label="学生" value={summary.student_count} hint={`近 ${days?.active_days ?? 7} 天作答 ${summary.active_students} 人`} />
              <MetricCard label="需要补强的知识点" value={summary.weak_point_count} hint="至少 20% 的学生掌握度低于 50%" />
              <MetricCard label="错误率异常的题" value={summary.suspect_questions}
                hint={summary.suspect_questions ? '建议先核对答案和解析' : `近 ${days?.mistake_days ?? 30} 天没有发现`} warn={summary.suspect_questions > 0} />
            </MetricGrid>

            <div role="tablist" aria-label="工作台视图" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {([['points', '薄弱知识点'], ['questions', '高频错题']] as const).map(([value, label]) => (
                <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                  style={tab === value ? activeTab : tabButton}>{label}</button>
              ))}
              {loading && <span style={{ alignSelf: 'center', fontSize: 12, color: '#98a2b3' }}>正在更新…</span>}
            </div>

            {tab === 'points' ? (
              <PointsTable points={insights.weak_points} questionCounts={questionCounts} onOpen={openKp} />
            ) : (
              <QuestionsTable questions={insights.hot_mistakes} days={days?.mistake_days ?? 30} />
            )}
          </>
        )}
    </PageShell>
  );
}

function PointsTable({ points, questionCounts, onOpen }: {
  points: TeachingInsightPoint[];
  questionCounts: Map<string, number>;
  onOpen: (kpId: string, tab: 'questions' | 'learning') => void;
}) {
  return (
    <section style={panelStyle} aria-label="薄弱知识点">
      <div style={sectionNote}>至少 20% 的学生掌握度低于 50% 的知识点，按薄弱人数排序。题量少或没有讲解视频的知识点，优先补内容。</div>
      <div style={{ ...gridRow('1.6fr 1fr 0.8fr 0.8fr 1fr 1fr'), ...tableHead }}>
        <span>知识点</span><span>薄弱 / 有数据</span><span>平均掌握度</span><span>近期错题</span><span>现有内容</span><span>操作</span>
      </div>
      {points.length === 0 ? <Empty>暂时没有薄弱的知识点。</Empty> : points.map(point => {
        const count = questionCounts.get(point.kp_id);
        return (
          <div key={point.kp_id} style={{ ...gridRow('1.6fr 1fr 0.8fr 0.8fr 1fr 1fr'), ...tableRow }}>
            <div>
              <div style={{ fontWeight: 800, color: '#1f2933' }}>{point.kp_name}</div>
              <div style={{ color: '#98a2b3', fontSize: 11, marginTop: 3 }}>{[point.chapter, point.section].filter(Boolean).join(' · ') || point.kp_id}</div>
            </div>
            <span><strong style={{ color: '#9a3412' }}>{point.weak_students}</strong> / {point.evidence_students} 人</span>
            <span>{pct(point.avg_mastery)}</span>
            <span>{point.wrong_recent || '—'}</span>
            <span style={{ fontSize: 12 }}>
              <span style={count != null && count < 10 ? warnText : undefined}>{count == null ? '题量未知' : `${count} 道题`}</span>
              {' · '}
              <span style={point.video_count ? undefined : warnText}>{point.video_count ? `${point.video_count} 个视频` : '无视频'}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={linkButton} onClick={() => onOpen(point.kp_id, 'questions')}>看题库</button>
              <button style={linkButton} onClick={() => onOpen(point.kp_id, 'learning')}>补讲解</button>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function QuestionsTable({ questions, days }: { questions: TeachingInsightQuestion[]; days: number }) {
  return (
    <section style={panelStyle} aria-label="高频错题">
      <div style={sectionNote}>近 {days} 天做错人数最多的题。标“错误率异常”的题几乎人人做错，先核对答案和解析是否有误。</div>
      <div style={{ ...gridRow('2.2fr 0.9fr 0.9fr 0.9fr 0.7fr'), ...tableHead }}>
        <span>题目</span><span>做错人数</span><span>错误率</span><span>主要错因</span><span>操作</span>
      </div>
      {questions.length === 0 ? <Empty>近 {days} 天没有错题。</Empty> : questions.map(question => (
        <div key={question.question_id} style={{ ...gridRow('2.2fr 0.9fr 0.9fr 0.9fr 0.7fr'), ...tableRow }}>
          <div>
            <div style={{ color: '#1f2933', lineHeight: 1.6 }}>{question.stem_preview || question.question_id}</div>
            <div style={{ color: '#98a2b3', fontSize: 11, marginTop: 3 }}>
              {question.question_id} · {question.kp_name || '未关联知识点'}
            </div>
          </div>
          <span>{question.wrong_students} 人</span>
          <span>
            {pct(question.wrong_rate)}<span style={{ color: '#98a2b3', fontSize: 11 }}>（{question.wrong}/{question.answers}）</span>
            {question.suspect && <div style={suspectTag}>错误率异常</div>}
          </span>
          <span>{question.main_cause || '—'}</span>
          <Link to={`/resources?tab=questions&q=${encodeURIComponent(question.question_id)}`} style={{ color: ACCENT, fontSize: 13 }}>打开题目</Link>
        </div>
      ))}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 24, textAlign: 'center', color: '#98a2b3', fontSize: 13 }}>{children}</div>;
}

const panelStyle: CSSProperties = { ...basePanel, overflow: 'hidden' };
const gridRow = (columns: string): CSSProperties => ({ display: 'grid', gridTemplateColumns: columns });
const sectionNote: CSSProperties = { padding: '10px 16px', color: '#667085', fontSize: 12, borderBottom: '1px solid #eee4d7' };
const tableHead: CSSProperties = { padding: '9px 16px', background: '#faf4ea', color: '#7b8794', fontSize: 12, fontWeight: 800, gap: 10 };
const tableRow: CSSProperties = { padding: '12px 16px', borderTop: '1px solid #f2eadf', color: '#52606d', fontSize: 13, gap: 10, alignItems: 'center' };
const warnText: CSSProperties = { color: '#b45309' };
const suspectTag: CSSProperties = { display: 'inline-block', marginTop: 4, background: '#fef3f2', color: '#b42318', borderRadius: 4, padding: '1px 6px', fontSize: 11 };
const errorBox: CSSProperties = { padding: '10px 14px', borderRadius: 6, background: '#fff2f0', color: '#cf1322', marginBottom: 12 };
const selectStyle: CSSProperties = { height: 34, borderRadius: 6, border: '1px solid #d0d5dd', padding: '0 10px', fontSize: 13, background: '#fff' };
const tabButton: CSSProperties = { border: '1px solid #d0d5dd', background: '#fff', color: '#344054', borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const activeTab: CSSProperties = { ...tabButton, borderColor: ACCENT, color: ACCENT, background: '#eef8f7', fontWeight: 700 };
const linkButton: CSSProperties = { border: '1px solid #d0d5dd', background: '#fff', color: ACCENT, borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontSize: 12 };
