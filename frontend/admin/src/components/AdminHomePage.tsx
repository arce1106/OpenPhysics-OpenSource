import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { KpWithStats, LearningResourceReport, QualityReport, TeachingInsights } from '../types';
import { MetricCard, MetricGrid, PageHeader, PageShell, panelStyle } from './AdminUi';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const DASH = '—';

export default function AdminHomePage({ kps }: { kps: KpWithStats[] }) {
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [resources, setResources] = useState<LearningResourceReport | null>(null);
  const [teaching, setTeaching] = useState<TeachingInsights | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrors([]);
      // 三份报告分别加载：任意一份失败，其余照常显示，失败的那部分显示“—”而不是 0。
      const [qualityResult, resourceResult, teachingResult] = await Promise.allSettled([
        api.getQualityReport(),
        api.getLearningResources(),
        api.getTeachingInsights(),
      ]);
      if (cancelled) return;
      const failed: string[] = [];
      if (qualityResult.status === 'fulfilled') setQuality(qualityResult.value);
      else failed.push(`题库质量：${qualityResult.reason?.message || '加载失败'}`);
      if (resourceResult.status === 'fulfilled') setResources(resourceResult.value);
      else failed.push(`学习资源：${resourceResult.reason?.message || '加载失败'}`);
      if (teachingResult.status === 'fulfilled') setTeaching(teachingResult.value);
      else failed.push(`教学数据：${teachingResult.reason?.message || '加载失败'}`);
      setErrors(failed);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const qs = quality?.summary;
  const rs = resources?.summary;
  const ts = teaching?.summary;
  const pendingQuestions = qs ? qs.pending_count + qs.draft_count : DASH;
  const reviewHint = qs ? `草稿 ${qs.draft_count}，待审核 ${qs.pending_count}` : (loading ? '加载中…' : '未加载');
  const resourceGap = rs
    ? rs.missing_card_count + rs.missing_video_count + rs.missing_simulation_count
    : DASH;
  const resourceHint = rs
    ? `卡片 ${rs.missing_card_count}，讲解 ${rs.missing_video_count}，模拟 ${rs.missing_simulation_count}`
    : (loading ? '加载中…' : '未加载');
  const issueCount = quality ? (qs?.issue_question_count ?? quality.issue_questions.length) : DASH;

  const waiting = loading ? '加载中…' : '未加载';
  const suspect = ts ? ts.suspect_questions : DASH;

  return (
    <PageShell>
      <PageHeader title="首页" description="题库、学习资源和教学数据里需要处理的事，点卡片进入对应页面。" />

      {errors.length > 0 && (
        <div role="alert" style={{ ...panelStyle, padding: 12, color: '#b42318', marginBottom: 14, fontSize: 13, lineHeight: 1.7 }}>
          部分数据没有加载成功，对应指标显示“—”：{errors.join('；')}
        </div>
      )}

      <MetricGrid>
        <MetricCard label="题库待审核" value={pendingQuestions} hint={reviewHint} to="/resources?tab=questions"
          warn={typeof pendingQuestions === 'number' && pendingQuestions > 0} />
        <MetricCard label="结构问题" value={issueCount} hint={qs ? '缺答案、缺解析、缺难度或缺标签的题' : waiting} to="/resources?tab=quality" />
        <MetricCard label="资源缺口" value={resourceGap} hint={resourceHint} to="/resources?tab=learning" />
        <MetricCard label="错误率异常的题" value={suspect} to="/teaching" warn={typeof suspect === 'number' && suspect > 0}
          hint={ts ? `几乎人人做错，先核对答案；需要补强的知识点 ${ts.weak_point_count} 个` : waiting} />
      </MetricGrid>

      <section aria-label="题库概况" style={{ ...panelStyle, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px 28px', fontSize: 13, color: '#52606d' }}>
        <strong style={{ color: '#1f2933' }}>题库概况</strong>
        <span>题目总数 <b data-testid="question-count" style={{ color: '#1f2933' }}>{qs ? qs.question_count : DASH}</b>{qs ? `（已通过 ${qs.approved_count}）` : ''}</span>
        <span>标签完整率 <b style={{ color: '#1f2933' }}>{qs ? pct(qs.label_complete_rate) : DASH}</b></span>
        <span>知识点 <b style={{ color: '#1f2933' }}>{loading && !kps.length ? DASH : kps.length}</b> 个</span>
      </section>
    </PageShell>
  );
}
