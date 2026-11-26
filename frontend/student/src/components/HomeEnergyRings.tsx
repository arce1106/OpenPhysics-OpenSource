import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { DailyLoopHistoryPanel } from './RewardComponents';
import { buildClockwiseArcSegments } from '../utils/polarArcSegments';
import type { DailyLearningLoop, DailyLearningLoopHistory, DailyLoopRing } from '../types';

export type HomeEnergyRingsProps = {
  newLearnCurrent: number;
  newLearnTarget: number;
  reviewCurrent: number;
  reviewTarget: number;
  className?: string;
};

type RingConfig = {
  key: 'new-learn' | 'mistake-review';
  current: number;
  target: number;
  radius: number;
  strokeWidth: number;
  palette: readonly string[];
};

const SVG_CENTER = 100;
const HOME_NEW_LEARN_PALETTE = ['#087f87', '#0fa4ad', '#25c8c7', '#68ddd1', '#0fa4ad', '#087f87'] as const;
const HOME_REVIEW_PALETTE = ['#4d941b', '#69b81f', '#91d632', '#b7e54b', '#69b81f', '#4d941b'] as const;
const HOME_RING_SEGMENT_COUNT = 84;

function normalizeProgress(current: number, target: number) {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, current / target);
}

function formatCount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function ringCountLabel(ring: DailyLoopRing) {
  return `${ring.actual_current ?? ring.current}/${ring.target}`;
}

function buildRing(
  key: DailyLoopRing['key'],
  label: string,
  current: number,
  target: number,
): DailyLoopRing {
  const safeCurrent = formatCount(current);
  const safeTarget = Math.max(0, formatCount(target));
  return {
    key,
    label,
    completed: safeTarget > 0 ? safeCurrent >= safeTarget : false,
    current: Math.min(safeCurrent, safeTarget || safeCurrent),
    actual_current: safeCurrent,
    target: safeTarget,
    overflow: safeTarget > 0 ? Math.max(0, safeCurrent - safeTarget) : 0,
    auto_completed: false,
    evidence: '',
  };
}

function buildFallbackTodayLoop({
  newLearnCurrent,
  newLearnTarget,
  reviewCurrent,
  reviewTarget,
}: Pick<HomeEnergyRingsProps, 'newLearnCurrent' | 'newLearnTarget' | 'reviewCurrent' | 'reviewTarget'>): DailyLearningLoop {
  return {
    date: new Date().toISOString().slice(0, 10),
    is_effective_day: newLearnCurrent > 0 || reviewCurrent > 0,
    is_high_quality_day: newLearnCurrent >= newLearnTarget && reviewCurrent >= reviewTarget,
    rings: {
      practice: buildRing('practice', '做题环', newLearnCurrent, newLearnTarget),
      review: buildRing('review', '错题复盘', reviewCurrent, reviewTarget),
    },
    summary: '',
    next_action: '',
    streak_days: 0,
  };
}

function EnergyRing({ config }: { config: RingConfig }) {
  const rawProgress = normalizeProgress(config.current, config.target);
  const mainProgress = Math.min(1, rawProgress);
  const overflowProgress = Math.min(1, Math.max(0, rawProgress - 1));
  const gradientSegments = useMemo(() => buildClockwiseArcSegments({
    center: SVG_CENTER,
    radius: config.radius,
    ratio: 1,
    palette: config.palette,
    segmentCount: HOME_RING_SEGMENT_COUNT,
  }), [config.palette, config.radius]);
  const gradientId = `home-energy-gradient-${config.key}`;
  const progressMaskId = `home-energy-progress-mask-${config.key}`;
  const overflowMaskId = `home-energy-overflow-mask-${config.key}`;

  return (
    <>
      <defs>
        <g id={gradientId}>
          {gradientSegments.map((segment, index) => (
            <path
              key={`${config.key}-gradient-${index}`}
              className={`home-energy-gradient-segment home-energy-gradient-segment-${config.key}`}
              d={segment.d}
              strokeWidth={config.strokeWidth}
              style={{ stroke: segment.stroke }}
            />
          ))}
        </g>
        <mask
          id={progressMaskId}
          className="home-energy-progress-mask"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="200"
          height="200"
        >
          <circle
            className="home-energy-mask"
            cx={SVG_CENTER}
            cy={SVG_CENTER}
            r={config.radius}
            pathLength="1"
            stroke="white"
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            style={{ strokeDasharray: `${mainProgress} 1` }}
            transform={`rotate(-90 ${SVG_CENTER} ${SVG_CENTER})`}
          />
        </mask>
        <mask
          id={overflowMaskId}
          className="home-energy-overflow-mask"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="200"
          height="200"
        >
          <circle
            className="home-energy-mask home-energy-mask-overflow"
            cx={SVG_CENTER}
            cy={SVG_CENTER}
            r={config.radius}
            pathLength="1"
            stroke="white"
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            style={{ strokeDasharray: `${overflowProgress} 1` }}
            transform={`rotate(-90 ${SVG_CENTER} ${SVG_CENTER})`}
          />
        </mask>
      </defs>
      <circle
        className={`home-energy-track home-energy-track-${config.key}`}
        cx={SVG_CENTER}
        cy={SVG_CENTER}
        r={config.radius}
        strokeWidth={config.strokeWidth}
      />
      {mainProgress > 0 ? (
        <use
          className={`home-energy-progress home-energy-progress-${config.key}`}
          href={`#${gradientId}`}
          mask={`url(#${progressMaskId})`}
        />
      ) : null}
      {overflowProgress > 0 ? (
        <use
          className={`home-energy-overflow home-energy-overflow-${config.key}`}
          href={`#${gradientId}`}
          mask={`url(#${overflowMaskId})`}
        />
      ) : null}
    </>
  );
}

function goalLabel(ring: DailyLoopRing) {
  return `${ringCountLabel(ring)}${ring.auto_completed ? ' · 已清空' : ''}`;
}

function GoalLegend({ label, ring, className }: { label: string; ring: DailyLoopRing; className: string }) {
  return (
    <span className={`home-energy-legend ${className}`}>
      <i className={ring.completed ? 'is-done' : undefined} />
      <span>{label}</span>
      <b>{goalLabel(ring)}</b>
    </span>
  );
}

export default function HomeEnergyRings({
  newLearnCurrent,
  newLearnTarget,
  reviewCurrent,
  reviewTarget,
  className = '',
}: HomeEnergyRingsProps) {
  const [history, setHistory] = useState<DailyLearningLoopHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fallbackTodayLoop = useMemo(
    () => buildFallbackTodayLoop({ newLearnCurrent, newLearnTarget, reviewCurrent, reviewTarget }),
    [newLearnCurrent, newLearnTarget, reviewCurrent, reviewTarget],
  );
  const [todayLoop, setTodayLoop] = useState<DailyLearningLoop>(fallbackTodayLoop);

  useEffect(() => {
    let ignore = false;

    api.getDailyLearningLoop()
      .then((data) => {
        if (!ignore) setTodayLoop(data);
      })
      .catch(() => {
        if (!ignore) setTodayLoop(fallbackTodayLoop);
      });

    return () => {
      ignore = true;
    };
  }, [fallbackTodayLoop]);

  const toggleHistory = useCallback(async () => {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (!nextOpen || history || historyLoading) return;
    setHistoryLoading(true);
    try {
      const data = await api.getDailyLearningLoopHistory(undefined, 35);
      setHistory(data);
    } catch {
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [history, historyLoading, historyOpen]);

  const rings: RingConfig[] = [
    {
      key: 'new-learn',
      current: todayLoop.rings.practice.actual_current ?? todayLoop.rings.practice.current,
      target: todayLoop.rings.practice.target || newLearnTarget,
      radius: 84,
      strokeWidth: 24,
      palette: HOME_NEW_LEARN_PALETTE,
    },
    {
      key: 'mistake-review',
      current: todayLoop.rings.review.actual_current ?? todayLoop.rings.review.current,
      target: todayLoop.rings.review.target || reviewTarget,
      radius: 58,
      strokeWidth: 20,
      palette: HOME_REVIEW_PALETTE,
    },
  ];

  const { practice, review } = todayLoop.rings;
  const closedCount = [practice, review].filter(ring => ring.completed).length;

  return (
    <figure className={`home-energy-rings ${className}`.trim()}>
      <button
        type="button"
        className="home-energy-trigger"
        aria-expanded={historyOpen}
        aria-label={`展开学习日历：今日目标已完成 ${closedCount} 项，做题 ${goalLabel(practice)}，复盘 ${goalLabel(review)}`}
        onClick={toggleHistory}
        onPointerUp={(event) => event.currentTarget.blur()}
      >
        <span className="home-energy-dial">
          <svg className="home-energy-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            {rings.map(ring => (
              <EnergyRing key={ring.key} config={ring} />
            ))}
          </svg>
          <span className="home-energy-center" aria-hidden="true">
            <strong>{closedCount}/2</strong>
            <small>项达标</small>
          </span>
        </span>
        <span className="home-energy-goal" aria-hidden="true">
          <span className="home-energy-goal-title">今日目标<i>›</i></span>
          <GoalLegend label="做题" ring={practice} className="is-practice" />
          <GoalLegend label="复盘" ring={review} className="is-review" />
        </span>
      </button>
      {historyOpen && (
        <DailyLoopHistoryPanel
          history={history}
          loading={historyLoading}
          todayLoop={todayLoop}
        />
      )}
    </figure>
  );
}
