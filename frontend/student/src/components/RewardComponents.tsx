import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { buildClockwiseArcCaps, buildClockwiseArcSegments } from '../utils/polarArcSegments';
import type { DailyLearningLoop, DailyLearningLoopHistory, DailyLoopRing, GrowthReportData, SubmitResult } from '../types';
import { canonicalKpName, replaceKnownKpIds } from '../utils/knowledgeNames';
import { buildGrowthReportHistoryPath, getGrowthReportAnswerCount } from '../utils/historyRecords';

type GrowthTone = 'steady' | 'correct' | 'repair';

export interface GrowthFeedback {
  title: string;
  summary: string;
  points: string[];
  nextAction: string;
  tone: GrowthTone;
}

function formatPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getMasteryChanges(result: SubmitResult) {
  return Object.entries(result.mastery_update || {})
    .map(([kpId, item]) => ({
      kpId,
      name: canonicalKpName(kpId, item.name),
      before: item.before,
      after: item.after,
      delta: item.after - item.before,
    }))
    .filter(item => Math.abs(item.delta) >= 0.005);
}

function describeProcess(result: SubmitResult) {
  const grading = result.process_grading;
  if (!grading) return null;

  const weakParts = [
    ['模型选择', grading.model_correct],
    ['方程建立', grading.equation_correct],
    ['计算处理', grading.calculation_correct],
    ['单位/方向', grading.unit_correct],
  ]
    .filter(([, ok]) => ok === false)
    .map(([label]) => label);

  if (grading.error_type_name && grading.error_type !== 'none') {
    return `${grading.error_type_name}${weakParts.length ? `，重点检查${weakParts.join('、')}` : ''}`;
  }
  if (weakParts.length) return `重点检查${weakParts.join('、')}`;
  if (grading.process_score != null) return `过程得分 ${grading.process_score}/100`;
  return null;
}

export function buildGrowthFeedback(result: SubmitResult): GrowthFeedback {
  const masteryChanges = getMasteryChanges(result);
  const processPoint = describeProcess(result);
  const points: string[] = [];

  masteryChanges.forEach(item => {
    const direction = item.delta >= 0 ? '提升' : '回落';
    points.push(`${item.name}：${formatPct(item.before)} 到 ${formatPct(item.after)}，掌握度${direction}`);
  });

  if (processPoint) points.push(processPoint);
  if (result.detected_misconception?.name) {
    points.push(`需要澄清的概念：${result.detected_misconception.name}`);
  }
  if (result.process_grading?.first_error) {
    points.push(`第一处问题：${result.process_grading.first_error}`);
  }

  if (result.is_correct) {
    return {
      title: masteryChanges.length ? '这一步有效推进了掌握' : '本题方法基本稳定',
      summary: masteryChanges.length
        ? '答案正确，同时系统记录到相关知识点的掌握变化。'
        : '答案正确，可以把注意力放到表达是否更简洁、模型选择是否更稳。',
      points: points.length ? points : ['本题已经完成“作答、反馈、确认”的学习闭环。'],
      nextAction: '继续做下一题，遇到相似模型时优先复用这次的解题路径。',
      tone: 'correct',
    };
  }

  return {
    title: result.process_grading?.first_error ? '先修正第一处问题' : '把错误转化为下一次会做',
    summary: '本题没有直接判对，但它已经暴露出最值得修正的位置。',
    points: points.length ? points : ['先对照正确答案，找出自己第一步偏离的位置。'],
    nextAction: result.process_grading?.next_action || '先重做关键一步，再完整写一遍解题过程。',
    tone: 'repair',
  };
}

const toneStyle: Record<GrowthTone, { border: string; bg: string; title: string }> = {
  steady: { border: '#d9e7e4', bg: '#fbfdfc', title: '#35544d' },
  correct: { border: '#b7e4d5', bg: '#f4fbf8', title: '#167c61' },
  repair: { border: '#ffd8a8', bg: '#fffaf0', title: '#9a5a00' },
};

export function GrowthFeedbackPanel({ result }: { result: SubmitResult }) {
  const feedback = useMemo(() => buildGrowthFeedback(result), [result]);
  const style = toneStyle[feedback.tone];

  return (
    <section style={{
      marginTop: 10,
      padding: '12px 14px',
      borderRadius: 6,
      border: `1px solid ${style.border}`,
      background: style.bg,
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>学习闭环反馈</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: style.title, marginBottom: 6 }}>
        {feedback.title}
      </div>
      <div style={{ fontSize: 13, color: '#3f4a54', lineHeight: 1.7, marginBottom: 8 }}>
        {feedback.summary}
      </div>
      <ul style={{ margin: '0 0 8px 18px', padding: 0, color: '#3f4a54', fontSize: 13, lineHeight: 1.7 }}>
        {feedback.points.map(point => <li key={point}>{point}</li>)}
      </ul>
      <div style={{
        fontSize: 13,
        color: '#263238',
        padding: '8px 10px',
        borderRadius: 4,
        background: 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(0,0,0,0.04)',
      }}>
        <span style={{ fontWeight: 700 }}>下一步：</span>{feedback.nextAction}
      </div>
    </section>
  );
}

export function GrowthStatusBadge({ compact }: { compact?: boolean }) {
  const [loop, setLoop] = useState<DailyLearningLoop | null>(null);

  useEffect(() => {
    api.getDailyLearningLoop().then(setLoop).catch(() => {});
  }, []);

  const streakDays = loop?.streak_days || 0;
  if (!loop && compact) return null;

  if (compact) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 999,
        border: '1px solid #343945',
        color: '#c8ccd4',
        background: '#222733',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}>
        成长记录{streakDays > 0 ? ` · 连续 ${streakDays} 天` : ''}
      </span>
    );
  }

  return (
    <div className="growth-status-header">
      <h2 className="growth-status-title">学习成长记录</h2>
      <div className="growth-status-description">
        {streakDays > 0
          ? `最近连续 ${streakDays} 天有学习记录，系统会根据作答、订正和知识点掌握变化持续更新反馈。`
          : '完成学习、练习或订正后，系统会记录知识点掌握变化，并给出下一步建议。'}
      </div>
    </div>
  );
}

function ringCompletionRatio(ring: DailyLoopRing | null) {
  return Math.min(1, ringRawRatio(ring));
}

function ringOverflowRatio(ring: DailyLoopRing | null) {
  return Math.min(1, Math.max(0, ringRawRatio(ring) - 1));
}

function ringRawRatio(ring: DailyLoopRing | null) {
  if (!ring || ring.target <= 0) return 0;
  return ring.current / ring.target;
}

function ringCountLabel(ring: DailyLoopRing) {
  return `${ring.actual_current ?? ring.current}/${ring.target}`;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MINI_PRACTICE_PALETTE = ['#087f87', '#0f9fa9', '#1ec7cc', '#75efe4', '#b9fff2'] as const;
const MINI_REVIEW_PALETTE = ['#6fbd1e', '#91dc2f', '#bdf545', '#e6ff63', '#f2ff8a'] as const;

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMonthSections(history: DailyLearningLoopHistory) {
  const start = parseLocalDate(history.start_date);
  const end = parseLocalDate(history.end_date);
  const dayMap = new Map(history.days.map(day => [day.date, day]));
  const sections = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= lastMonth) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const firstWeekdayOffset = (monthStart.getDay() + 6) % 7;
    const cells: Array<{
      iso: string | null;
      date: Date | null;
      day: DailyLearningLoopHistory['days'][number] | null;
      inHistoryRange: boolean;
      isToday: boolean;
    }> = [];

    for (let index = 0; index < firstWeekdayOffset; index += 1) {
      cells.push({ iso: null, date: null, day: null, inHistoryRange: false, isToday: false });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const iso = toIsoDate(date);
      cells.push({
        iso,
        date,
        day: dayMap.get(iso) ?? null,
        inHistoryRange: iso >= history.start_date && iso <= history.end_date,
        isToday: iso === history.end_date,
      });
    }

    sections.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
      label: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`,
      cells,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return sections.reverse();
}

function miniRingRatio(day: DailyLearningLoopHistory['days'][number] | null, ring: DailyLoopRing | null) {
  if (!day || !day.is_effective_day) return 0;
  return ringCompletionRatio(ring);
}

function miniRingOverflowRatio(day: DailyLearningLoopHistory['days'][number] | null, ring: DailyLoopRing | null) {
  if (!day || !day.is_effective_day) return 0;
  return ringOverflowRatio(ring);
}

function DailyLoopMiniRings({ day }: { day: DailyLearningLoopHistory['days'][number] | null }) {
  const practiceRatio = miniRingRatio(day, day?.rings.practice ?? null);
  const reviewRatio = miniRingRatio(day, day?.rings.review ?? null);
  const practiceOverflowRatio = miniRingOverflowRatio(day, day?.rings.practice ?? null);
  const reviewOverflowRatio = miniRingOverflowRatio(day, day?.rings.review ?? null);
  const practiceRadius = 16;
  const reviewRadius = 10;
  const practiceSegments = buildClockwiseArcSegments({
    center: 20,
    radius: practiceRadius,
    ratio: practiceRatio,
    palette: MINI_PRACTICE_PALETTE,
    segmentCount: 28,
  });
  const practiceOverflowSegments = buildClockwiseArcSegments({
    center: 20,
    radius: practiceRadius,
    ratio: practiceOverflowRatio,
    palette: MINI_PRACTICE_PALETTE,
    segmentCount: 28,
  });
  const reviewSegments = buildClockwiseArcSegments({
    center: 20,
    radius: reviewRadius,
    ratio: reviewRatio,
    palette: MINI_REVIEW_PALETTE,
    segmentCount: 28,
  });
  const reviewOverflowSegments = buildClockwiseArcSegments({
    center: 20,
    radius: reviewRadius,
    ratio: reviewOverflowRatio,
    palette: MINI_REVIEW_PALETTE,
    segmentCount: 28,
  });
  const practiceCaps = buildClockwiseArcCaps({
    center: 20,
    radius: practiceRadius,
    ratio: practiceRatio,
    palette: MINI_PRACTICE_PALETTE,
  });
  const practiceOverflowCaps = buildClockwiseArcCaps({
    center: 20,
    radius: practiceRadius,
    ratio: practiceOverflowRatio,
    palette: MINI_PRACTICE_PALETTE,
  });
  const reviewCaps = buildClockwiseArcCaps({
    center: 20,
    radius: reviewRadius,
    ratio: reviewRatio,
    palette: MINI_REVIEW_PALETTE,
  });
  const reviewOverflowCaps = buildClockwiseArcCaps({
    center: 20,
    radius: reviewRadius,
    ratio: reviewOverflowRatio,
    palette: MINI_REVIEW_PALETTE,
  });
  const capRadius = 3.5;

  return (
    <svg
      className="daily-loop-mini-rings"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="daily-loop-mini-track practice" cx="20" cy="20" r={practiceRadius} />
      {practiceCaps.map(cap => (
        <circle
          key={`practice-cap-${cap.key}`}
          className="daily-loop-mini-cap practice"
          cx={cap.x}
          cy={cap.y}
          r={capRadius}
          fill={cap.fill}
        />
      ))}
      {practiceSegments.map((segment, index) => (
        <path
          key={`practice-${index}`}
          className="daily-loop-mini-progress practice"
          d={segment.d}
          strokeLinecap="butt"
          style={{ stroke: segment.stroke }}
        />
      ))}
      {practiceOverflowCaps.map(cap => (
        <circle
          key={`practice-overflow-cap-${cap.key}`}
          className="daily-loop-mini-cap daily-loop-mini-overflow-cap practice"
          cx={cap.x}
          cy={cap.y}
          r={capRadius}
          fill={cap.fill}
        />
      ))}
      {practiceOverflowSegments.map((segment, index) => (
        <path
          key={`practice-overflow-${index}`}
          className="daily-loop-mini-overflow practice"
          d={segment.d}
          strokeLinecap="butt"
          style={{ stroke: segment.stroke }}
        />
      ))}
      <circle className="daily-loop-mini-track review" cx="20" cy="20" r={reviewRadius} />
      {reviewCaps.map(cap => (
        <circle
          key={`review-cap-${cap.key}`}
          className="daily-loop-mini-cap review"
          cx={cap.x}
          cy={cap.y}
          r={capRadius}
          fill={cap.fill}
        />
      ))}
      {reviewSegments.map((segment, index) => (
        <path
          key={`review-${index}`}
          className="daily-loop-mini-progress review"
          d={segment.d}
          strokeLinecap="butt"
          style={{ stroke: segment.stroke }}
        />
      ))}
      {reviewOverflowCaps.map(cap => (
        <circle
          key={`review-overflow-cap-${cap.key}`}
          className="daily-loop-mini-cap daily-loop-mini-overflow-cap review"
          cx={cap.x}
          cy={cap.y}
          r={capRadius}
          fill={cap.fill}
        />
      ))}
      {reviewOverflowSegments.map((segment, index) => (
        <path
          key={`review-overflow-${index}`}
          className="daily-loop-mini-overflow review"
          d={segment.d}
          strokeLinecap="butt"
          style={{ stroke: segment.stroke }}
        />
      ))}
      <circle className="daily-loop-mini-hole" cx="20" cy="20" r="4.5" />
    </svg>
  );
}

function mergeHistoryWithToday(
  history: DailyLearningLoopHistory,
  todayLoop: DailyLearningLoop,
): DailyLearningLoopHistory {
  if (todayLoop.date < history.start_date || todayLoop.date > history.end_date) return history;

  const days = history.days.map(day => day.date === todayLoop.date ? todayLoop : day);
  if (!days.some(day => day.date === todayLoop.date)) {
    days.push(todayLoop);
    days.sort((left, right) => left.date.localeCompare(right.date));
  }

  return {
    ...history,
    days,
    summary: {
      practice_total: days.reduce((sum, day) => sum + day.rings.practice.actual_current, 0),
      review_total: days.reduce((sum, day) => sum + day.rings.review.actual_current, 0),
      practice_closed_days: days.filter(day => day.rings.practice.completed).length,
      review_closed_days: days.filter(day => day.rings.review.completed).length,
      dual_closed_days: days.filter(day => day.is_high_quality_day).length,
      effective_days: days.filter(day => day.is_effective_day).length,
    },
  };
}

export function DailyLoopHistoryPanel({
  history,
  loading,
  todayLoop,
}: {
  history: DailyLearningLoopHistory | null;
  loading: boolean;
  todayLoop: DailyLearningLoop;
}) {
  const syncedHistory = history ? mergeHistoryWithToday(history, todayLoop) : null;
  const days = syncedHistory?.days ?? [];
  const monthSections = syncedHistory ? buildMonthSections(syncedHistory) : [];

  return (
    <div className="daily-loop-history-panel" role="region" aria-label="学习日历">
      <div className="daily-loop-history-head">
        <strong>学习日历</strong>
        <span>{syncedHistory ? `近${days.length}天` : '加载中'}</span>
      </div>
      <div className="daily-loop-today-row" aria-label="今日数据">
        <strong>今日数据</strong>
        <div className="daily-loop-today-values">
          <span>
            <i className="practice" />
            做题 {ringCountLabel(todayLoop.rings.practice)}
          </span>
          <span>
            <i className="review" />
            复盘 {ringCountLabel(todayLoop.rings.review)}
          </span>
        </div>
      </div>
      {loading && <div className="daily-loop-history-empty">正在同步历史记录</div>}
      {!loading && syncedHistory && (
        <>
          <div className="daily-loop-history-stats">
            <DailyLoopHistoryStat label="做题" value={syncedHistory.summary.practice_total} />
            <DailyLoopHistoryStat label="复盘" value={syncedHistory.summary.review_total} />
            <DailyLoopHistoryStat label="双环" value={syncedHistory.summary.dual_closed_days} />
          </div>
          <div className="daily-loop-weekdays" aria-label="星期">
            {WEEKDAY_LABELS.map(label => <span key={label}>{label}</span>)}
          </div>
          <div className="daily-loop-month-list">
            {monthSections.map(section => (
              <section className="daily-loop-month-section" key={section.key}>
                <div className="daily-loop-calendar-head">
                  <strong>{section.label}</strong>
                </div>
                <div className="daily-loop-calendar-grid" role="grid" aria-label={`${section.label}学习日历`}>
                  {section.cells.map((cell, index) => (
                    <div
                      key={cell.iso ?? `blank-${index}`}
                      className={[
                        'daily-loop-calendar-day',
                        !cell.iso ? 'is-placeholder' : '',
                        cell.inHistoryRange ? '' : 'outside-history',
                        cell.isToday ? 'is-today' : '',
                        cell.day?.is_effective_day ? 'has-record' : '',
                        cell.day?.rings.practice.completed ? 'practice-done' : '',
                        cell.day?.rings.review.completed ? 'review-done' : '',
                        cell.day?.is_high_quality_day ? 'dual-done' : '',
                      ].filter(Boolean).join(' ')}
                      role="gridcell"
                      title={cell.iso
                        ? cell.day
                          ? `${cell.iso} 做题 ${ringCountLabel(cell.day.rings.practice)} / 复盘 ${ringCountLabel(cell.day.rings.review)}`
                          : `${cell.iso} 暂无学习记录`
                        : ''}
                    >
                      {cell.date && (
                        <>
                          <span>{cell.date.getDate()}</span>
                          <DailyLoopMiniRings day={cell.day} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {!loading && !history && (
        <div className="daily-loop-history-empty">暂时无法获取历史记录</div>
      )}
    </div>
  );
}

function DailyLoopHistoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div aria-label={`${label} ${value}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function GrowthRecordLink({ to, label, title }: { to: string; label: string; title: string }) {
  return (
    <Link to={to} className="growth-report-history-link" aria-label={title}>
      <span className="growth-report-history-copy">
        <small>{label}</small>
        <strong>{title}</strong>
      </span>
      <span aria-hidden="true" className="growth-report-history-arrow">›</span>
    </Link>
  );
}

export function GrowthReportCard() {
  const [report, setReport] = useState<GrowthReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const answerCount = getGrowthReportAnswerCount(report);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const existing = await api.getGrowthReport();
      if (existing.report) {
        setReport(existing.report);
        return;
      }
      const generated = await api.generateGrowthReport();
      setReport(generated.report);
    } catch {
      // The report is supportive context, so page learning should not fail when it is unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  const historyPath = report && answerCount > 0
    ? buildGrowthReportHistoryPath(report)
    : '/history';
  const historyLabel = report && answerCount > 0
    ? `查看这 ${answerCount} 题记录`
    : '查看练习记录';

  return (
    <section className="growth-report-card" aria-labelledby="growth-report-title">
      <div className="growth-report-header">
        <h3 id="growth-report-title" className="growth-report-title">成长回顾</h3>
        <button
          type="button"
          className="growth-report-refresh"
          onClick={loadReport}
          disabled={loading}
          aria-label={loading ? '正在整理成长回顾' : '刷新成长回顾'}
          title={loading ? '正在整理' : '刷新成长回顾'}
        >
          <span
            aria-hidden="true"
            className={`growth-report-refresh-icon${loading ? ' is-loading' : ''}`}
          >
            ↻
          </span>
        </button>
      </div>
      {report ? (
        <div className="growth-report-summary">
          {replaceKnownKpIds(report.summary)}
        </div>
      ) : (
        <div className="growth-report-empty">
          完成一段连续学习后，这里会整理近期掌握提升、错因变化和下一步复习重点。
        </div>
      )}
      {report?.start_date && report?.end_date && (
        <div className="growth-report-date">
          {report.start_date} ~ {report.end_date}
        </div>
      )}
      <div className="growth-report-links">
        <GrowthRecordLink to={historyPath} label="练习记录" title={historyLabel} />
        <GrowthRecordLink to="/homework" label="作业记录" title="查看历次作业得分" />
      </div>
    </section>
  );
}
