import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { GradingMetrics, KpWithStats, QualityReport } from '../types';
import { LatexSpan } from '../common/LatexSpan';
import {
  LABEL_TYPE_LABELS,
  STATUS_LABELS,
  TIER_LABELS,
  TYPE_LABELS,
  chapterLabel,
} from '../common/labels';

const panelStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #e8e0d2',
  borderRadius: 8,
  boxShadow: '0 1px 3px rgba(36, 30, 18, 0.04)',
};

const issueLabelMap: Record<string, string> = {
  missing_labels: '缺少标签',
  missing_answer: '缺少答案',
  missing_explanation: '缺少解析',
  missing_difficulty_tier: '缺少难度',
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function optionalPct(value: number | null | undefined): string {
  return typeof value === 'number' ? pct(value) : '—';
}

function GradingMetricsPanel({ metrics }: { metrics: GradingMetrics }) {
  return (
    <div style={{ ...panelStyle, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1f2933' }}>AI 批改质量</div>
        <div style={{ fontSize: 12, color: '#8a7458' }}>近 {metrics.window_days} 天 · 全站</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard
          label="纠错率"
          value={optionalPct(metrics.correction_rate)}
          hint={`学生纠正 ${metrics.correction_count} / AI 批改 ${metrics.ai_graded_count}`}
        />
        <MetricCard
          label="需人工确认率"
          value={optionalPct(metrics.needs_review_rate)}
          hint={`待确认 ${metrics.needs_review_count}，其中对错与过程分冲突 ${metrics.process_conflict_count}`}
        />
        <MetricCard
          label="识别失败率"
          value={optionalPct(metrics.unrecognized_rate)}
          hint={`未识别 ${metrics.unrecognized_count} / 拍照题 ${metrics.photo_item_count}${metrics.no_answer_key_count ? `，缺标准答案 ${metrics.no_answer_key_count}` : ''}`}
        />
        <MetricCard
          label="批改失败率"
          value={optionalPct(metrics.ai_failure_rate ?? null)}
          hint={`两个模型都没批完 ${metrics.ai_failure_count ?? 0} / 批改请求 ${metrics.ai_task_count ?? 0}`}
        />
        <MetricCard
          label="老师改分率"
          value={optionalPct(metrics.teacher_change_rate ?? null)}
          hint={`老师改了 AI 分数 ${metrics.teacher_change_count ?? 0} / 老师确认 ${metrics.teacher_review_count ?? 0}`}
        />
      </div>
      {!!metrics.by_model?.length && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2933', marginBottom: 8 }}>按批改模型</div>
          <table aria-label="按批改模型" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#7b8794', textAlign: 'left' }}>
                {['模型', 'AI 批改', '需人工确认率', '纠错率', '老师确认', '老师改分率'].map((h) => (
                  <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid #e8e0d2', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.by_model.map((row) => (
                <tr key={row.model}>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{row.model}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{row.ai_graded_count}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{optionalPct(row.needs_review_rate)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{optionalPct(row.correction_rate)}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{row.teacher_review_count}</td>
                  <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1ece2' }}>{optionalPct(row.teacher_change_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: '#8a7458', marginTop: 6 }}>切换主批改模型后，对比各模型的确认率、纠错率和老师改分率。</div>
        </div>
      )}
    </div>
  );
}

function riskText(risk: string): string {
  if (risk === 'empty') return '空白';
  if (risk === 'thin') return '偏少';
  if (risk === 'unknown_model') return '未归类';
  return '正常';
}

function riskColor(risk: string): string {
  if (risk === 'empty') return '#c2410c';
  if (risk === 'thin') return '#b7791f';
  if (risk === 'unknown_model') return '#7c3aed';
  return '#2f7d4f';
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ ...panelStyle, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#7b8794', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#1f2933', lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#8a7458', marginTop: 8 }}>{hint}</div>}
    </div>
  );
}

function TierLine({ counts }: { counts: Record<string, number> }) {
  const items = Object.entries(counts).filter(([, count]) => count > 0);
  if (items.length === 0) return <span style={{ color: '#b8b8b8' }}>无难度分布</span>;
  return (
    <span>
      {items.map(([tier, count]) => (
        <span key={tier} style={{ marginRight: 8 }}>
          {TIER_LABELS[tier] || tier}: {count}
        </span>
      ))}
    </span>
  );
}

interface QualityPageProps {
  kps: KpWithStats[];
  selectedVolumeKey: string | null;
  selectedKpId: string | null;
  selectedChapterKey: string | null;
  selectedSectionKey: string | null;
  allQuestionsId: string;
}

function splitKey(key: string | null | undefined): string[] {
  return key ? key.split('||') : [];
}

export default function QualityPage({
  kps,
  selectedVolumeKey,
  selectedKpId,
  selectedChapterKey,
  selectedSectionKey,
  allQuestionsId,
}: QualityPageProps) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'issues' | 'chapters' | 'models' | 'errors'>('issues');
  const [expandedChapterKey, setExpandedChapterKey] = useState<string | null>(null);
  const navigate = useNavigate();

  const selectedKp = useMemo(
    () => selectedKpId && selectedKpId !== allQuestionsId
      ? kps.find(kp => kp.id === selectedKpId) || null
      : null,
    [allQuestionsId, kps, selectedKpId],
  );

  const scope = useMemo(() => {
    if (selectedKp) {
      return {
        params: { kp_id: selectedKp.id },
      };
    }
    if (selectedSectionKey) {
      const [volume, chapter, section] = splitKey(selectedSectionKey);
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      if (section) params.section = section;
      return { params };
    }
    if (selectedChapterKey) {
      const [volume, chapter] = splitKey(selectedChapterKey);
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      return { params };
    }
    if (selectedVolumeKey) {
      return { params: { volume: selectedVolumeKey } };
    }
    return {
      params: undefined,
    };
  }, [selectedChapterKey, selectedKp, selectedSectionKey, selectedVolumeKey]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(await api.getQualityReport(scope.params));
    } catch (e: any) {
      setError(e.message || '加载质量报告失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpandedChapterKey(null);
    void load();
  }, [scope.params?.chapter, scope.params?.kp_id, scope.params?.section, scope.params?.volume]);

  const issueTotal = report?.summary.issue_question_count ?? report?.issue_questions.length ?? 0;

  const weakKps = useMemo(
    () => (report?.kp_coverage || []).filter(kp => kp.risk !== 'ok').slice(0, 12),
    [report],
  );
  const weakModels = useMemo(
    () => (report?.model_coverage || []).filter(model => model.risk !== 'ok').slice(0, 12),
    [report],
  );

  if (loading) {
    return <div style={{ padding: 32, color: '#667085' }}>加载质量总览...</div>;
  }
  if (error || !report) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: '#b42318', marginBottom: 12 }}>{error || '暂无报告'}</div>
        <button onClick={load} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff' }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
        <MetricCard label="标签完整度" value={`${report.summary.health_score}%`} hint="必需标签齐全的题目占比" />
        <MetricCard label="题目总数" value={report.summary.question_count} hint={`已通过 ${report.summary.approved_count}`} />
        <MetricCard label="完整标签" value={report.summary.label_complete_count} hint={pct(report.summary.label_complete_rate)} />
        <MetricCard
          label="待处理问题"
          value={issueTotal}
          hint={issueTotal > report.issue_questions.length ? `下方列出前 ${report.issue_questions.length} 道` : '缺答案、缺解析、缺难度或缺标签'}
        />
      </div>

      <div style={{ ...panelStyle, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1f2933', marginBottom: 12 }}>必需标签覆盖</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
          {Object.entries(report.label_coverage).map(([type, item]) => (
            <div key={type}>
              <div style={{ fontSize: 12, color: '#697386', marginBottom: 5 }}>
                {LABEL_TYPE_LABELS[type] || type}
              </div>
              <div style={{ height: 6, background: '#f0ece3', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: pct(item.rate),
                  height: '100%',
                  background: item.rate >= 0.9 ? '#2f7d4f' : item.rate >= 0.6 ? '#b7791f' : '#c2410c',
                }} />
              </div>
              <div style={{ fontSize: 11, color: '#8a7458', marginTop: 4 }}>{pct(Math.min(item.rate, 1))} · {item.count} 题</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([
          ['issues', '问题题目'],
          ['chapters', '章节覆盖'],
          ['models', '模型覆盖'],
          ['errors', '批改质量'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: tab === value ? '1px solid #0d7377' : '1px solid #d9d2c5',
              background: tab === value ? '#e0f5f6' : '#fffdf8',
              color: tab === value ? '#0d7377' : '#52606d',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'issues' && (
        <div style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee4d7', fontWeight: 800 }}>问题题目清单</div>
          {report.issue_questions.length === 0 ? (
            <div style={{ padding: 24, color: '#667085' }}>当前范围内没有发现结构性问题</div>
          ) : report.issue_questions.map(q => (
            <div key={q.id} style={{ padding: '14px 16px', borderBottom: '1px solid #f2eadf' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 7 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#7b8794' }}>{q.id}</span>
                <span style={{ fontSize: 12, color: '#0d7377' }}>{q.question_type ? TYPE_LABELS[q.question_type] || q.question_type : '未设题型'}</span>
                <span style={{ fontSize: 12, color: '#8a7458' }}>{q.difficulty_tier ? TIER_LABELS[q.difficulty_tier] || q.difficulty_tier : '未设难度'}</span>
                <span style={{ fontSize: 12, color: '#667085' }}>{STATUS_LABELS[q.status] || q.status}</span>
                <button
                  onClick={() => navigate(`/resources?tab=questions&q=${encodeURIComponent(q.id)}`)}
                  style={{ marginLeft: 'auto', border: '1px solid #d0d5dd', background: '#fff', borderRadius: 4, padding: '4px 9px', fontSize: 12, cursor: 'pointer' }}
                >
                  打开题目
                </button>
              </div>
              <div style={{ fontSize: 13, color: '#333', lineHeight: 1.7, marginBottom: 8 }}>
                <LatexSpan text={q.stem_preview} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {q.issues.map(issue => (
                  <span key={issue} style={{ background: '#fff1e6', color: '#9a3412', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                    {issueLabelMap[issue] || issue}
                  </span>
                ))}
                {q.missing_labels.map(label => (
                  <span key={label} style={{ background: '#f3e8ff', color: '#6b21a8', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                    缺 {LABEL_TYPE_LABELS[label] || label}
                  </span>
                ))}
                {q.kp_names.map(name => (
                  <span key={name} style={{ background: '#edf7f5', color: '#0d7377', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'chapters' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14 }}>
          <div style={{ ...panelStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee4d7', fontWeight: 800 }}>章节覆盖</div>
            {report.chapter_coverage.length === 0 ? (
              <div style={{ padding: 24, color: '#667085' }}>当前范围没有可展示的章节覆盖数据</div>
            ) : report.chapter_coverage.map(row => {
              const chapterKey = `${row.volume}-${row.chapter}`;
              const isExpanded = expandedChapterKey === chapterKey;
              const emptyPoints = row.empty_knowledge_points || [];
              return (
                <div key={chapterKey} style={{ padding: '12px 16px', borderBottom: '1px solid #f2eadf' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#1f2933' }}>{row.volume} · {chapterLabel(row.chapter)}</div>
                      <div style={{ fontSize: 12, color: '#697386', marginTop: 4 }}>
                        {row.kp_count} 个知识点 · {row.question_count} 题 · 空白知识点 {row.empty_kp_count}
                        {row.empty_kp_count > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedChapterKey(isExpanded ? null : chapterKey)}
                            style={{
                              marginLeft: 8,
                              padding: '2px 7px',
                              borderRadius: 4,
                              border: '1px solid #f3c6a8',
                              background: isExpanded ? '#fff1e6' : '#fffaf5',
                              color: '#9a3412',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {isExpanded ? '收起' : `查看 ${row.empty_kp_count} 个`}
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: row.empty_kp_count > 0 ? '#c2410c' : '#2f7d4f', fontWeight: 800 }}>
                      {row.empty_kp_count > 0 ? '需补题' : '有覆盖'}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#8a7458', marginTop: 7 }}>
                    <TierLine counts={row.tier_counts} />
                  </div>
                  {isExpanded && row.empty_kp_count > 0 && (
                    <div style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: '#fffaf5',
                      border: '1px solid #f2d6c2',
                    }}>
                      {emptyPoints.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#9a3412' }}>
                          后端暂未返回空白知识点明细，请刷新质量报告后再试。
                        </div>
                      ) : emptyPoints.map(point => (
                        <button
                          key={point.kp_id}
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(point.kp_id).catch(() => undefined)}
                          title="点击复制知识点 ID"
                          style={{
                            width: '100%',
                            display: 'grid',
                            gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, 0.9fr) auto',
                            gap: 10,
                            alignItems: 'center',
                            textAlign: 'left',
                            padding: '7px 0',
                            border: 0,
                            borderBottom: '1px solid #f2eadf',
                            background: 'transparent',
                            cursor: 'pointer',
                            color: '#1f2933',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 800 }}>{point.kp_name}</span>
                          <span style={{ fontSize: 12, color: '#697386' }}>{point.section || '未分节'}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9a3412' }}>{point.kp_id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ ...panelStyle, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>薄弱知识点</div>
            {weakKps.map(kp => (
              <div key={kp.kp_id} style={{ padding: '9px 0', borderTop: '1px solid #f2eadf' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{kp.kp_name}</span>
                  <span style={{ fontSize: 12, color: riskColor(kp.risk), fontWeight: 800 }}>{riskText(kp.risk)}</span>
                </div>
                <div style={{ fontSize: 12, color: '#697386', marginTop: 4 }}>{kp.volume} · {kp.chapter} · {kp.question_count} 题</div>
              </div>
            ))}
            {weakKps.length === 0 && (
              <div style={{ padding: '12px 0', color: '#667085', fontSize: 13 }}>当前范围内暂无空白或偏少知识点</div>
            )}
          </div>
        </div>
      )}

      {tab === 'models' && (
        <div style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee4d7', fontWeight: 800 }}>物理模型覆盖</div>
          {weakModels.length === 0 ? (
            <div style={{ padding: 24, color: '#667085' }}>当前范围内暂无模型覆盖风险</div>
          ) : weakModels.map(model => (
            <div key={model.model_id} style={{ padding: '13px 16px', borderBottom: '1px solid #f2eadf' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#1f2933' }}>{model.model_name}</div>
                  <div style={{ fontSize: 12, color: '#697386', marginTop: 4 }}>{model.domain} · {model.layer} · {model.question_count} 题</div>
                </div>
                <span style={{ fontSize: 12, color: riskColor(model.risk), fontWeight: 800 }}>{riskText(model.risk)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#8a7458', marginTop: 7 }}>
                <TierLine counts={model.tier_counts} />
              </div>
              {model.chapter_counts.length > 0 && (
                <div style={{
                  marginTop: 10,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 8,
                }}>
                  {model.chapter_counts.map(chapter => (
                    <div
                      key={`${model.model_id}-${chapter.volume}-${chapter.chapter}`}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid #eee4d7',
                        background: '#fffaf5',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#1f2933' }}>
                        {chapter.volume} · {chapterLabel(chapter.chapter)}
                      </div>
                      <div style={{ fontSize: 12, color: '#697386', marginTop: 5 }}>
                        {chapter.question_count} 题 · <TierLine counts={chapter.tier_counts} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'errors' && report.grading_metrics && <GradingMetricsPanel metrics={report.grading_metrics} />}
      {tab === 'errors' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 14 }}>
          <div style={{ ...panelStyle, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>近期错因分布</div>
            {report.error_audit.error_counts.length === 0 ? (
              <div style={{ color: '#667085', fontSize: 13 }}>暂无结构化错因样本</div>
            ) : report.error_audit.error_counts.map(item => (
              <div key={item.error_type} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f2eadf', fontSize: 13 }}>
                <span>{item.error_type_name}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
          <div style={{ ...panelStyle, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee4d7', fontWeight: 800 }}>AI 错因审核样本</div>
            {report.error_audit.samples.map(sample => (
              <div key={sample.answer_id} style={{ padding: '12px 16px', borderBottom: '1px solid #f2eadf' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => navigate(`/resources?tab=questions&q=${encodeURIComponent(sample.question_id)}`)}
                    title="打开这道题"
                    style={{ fontFamily: 'monospace', color: '#0d7377', fontSize: 12, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {sample.question_id}
                  </button>
                  <span style={{ color: '#9a3412', background: '#fff1e6', padding: '2px 7px', borderRadius: 4, fontSize: 12 }}>
                    {sample.error_type_name}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#98a2b3' }}>
                    {sample.created_at ? new Date(sample.created_at).toLocaleString('zh-CN') : ''}
                  </span>
                </div>
                {sample.first_error && <div style={{ fontSize: 13, color: '#333', marginBottom: 4 }}>第一处问题：{sample.first_error}</div>}
                {sample.feedback && <div style={{ fontSize: 12, color: '#697386' }}>反馈：{sample.feedback}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
