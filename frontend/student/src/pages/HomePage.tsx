import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import HomeEnergyRings from '../components/HomeEnergyRings';
import TeacherHomeworkTasks from '../components/TeacherHomeworkCard';
import { GrowthReportCard, GrowthStatusBadge } from '../components/RewardComponents';
import { AppCard, MetricCard } from '../components/ui';
import { preloadRouteForPath } from '../utils/routePreload';
import { canReadLearningHistory } from '../utils/learningAccess';
import type { DashboardData, TeacherHomework } from '../types';

const HOME_NEW_LEARN_WEEKLY_TARGET = 3;
const HOME_REVIEW_CLEAR_TARGET = 1;

export default function HomePage() {
  const profile = getStudentProfile();
  const canReadHistory = canReadLearningHistory(profile);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(canReadHistory);
  const [error, setError] = useState<string | null>(null);
  const [homework, setHomework] = useState<TeacherHomework[]>([]);
  const studentId = getStudentId();

  // A failed homework lookup does not block the learning dashboard.
  useEffect(() => {
    let active = true;
    api.listTeacherHomework().then((items) => active && setHomework(items)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [studentId]);

  const fetchData = useCallback(async () => {
    if (!canReadHistory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDashboard(await api.getDashboard(studentId));
      api.prefetchDirectory(studentId);
    } catch (e: any) {
      setError(e.message || '首页加载失败');
    } finally {
      setLoading(false);
    }
  }, [canReadHistory, studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return (
    <main className="container home-dashboard">
      <div className="error-banner">{error}</div>
      <button type="button" className="page-back-button" onClick={fetchData}>重试</button>
    </main>
  );

  const task = buildTodayTask(dashboard);
  const studentName = profile?.display_name || profile?.username || '同学';
  const motivation = dashboard?.motivation;
  const energyProgress = buildHomeEnergyProgress(motivation);
  const homeworkPending = homework.some((item) => item.status !== 'completed');

  return (
    <main className="container home-dashboard">
      <header className="home-dashboard-header">
        <div>
          <h1>今天怎么学</h1>
          <p>{studentName}，先完成最值得做的一件事，再选择学习入口。</p>
        </div>
      </header>

      {/* Homework and practice recommendations have independent loading states. */}
      {!canReadHistory && homework.length > 0 && (
        <AppCard as="article" className="home-task-card home-task-card-with-homework" padding="lg">
          <div className="home-section-label">今日推荐任务</div>
          <TeacherHomeworkTasks items={homework} />
        </AppCard>
      )}

      {canReadHistory && (
      <section className="home-hero" aria-label="今日学习中控台">
        <AppCard as="article" className={homework.length > 0 ? 'home-task-card home-task-card-with-homework' : 'home-task-card'} padding="lg">
          <div className="home-section-label">今日推荐任务</div>
          {/* A teacher's homework comes before the system's own recommendation. */}
          <TeacherHomeworkTasks items={homework} />
          <h2>{task.title}</h2>
          <p>{task.reason}</p>
          <Link
            to={task.href}
            className={homeworkPending ? 'home-secondary-action' : 'home-primary-action'}
            onFocus={() => { void preloadRouteForPath(task.href); }}
            onMouseEnter={() => { void preloadRouteForPath(task.href); }}
            onTouchStart={() => { void preloadRouteForPath(task.href); }}
          >
            {task.action}
          </Link>
        </AppCard>

        <aside className="home-side-panel" aria-label="今日学习记录">
          <HomeEnergyRings
            newLearnCurrent={energyProgress.newLearnCurrent}
            newLearnTarget={energyProgress.newLearnTarget}
            reviewCurrent={energyProgress.reviewCurrent}
            reviewTarget={energyProgress.reviewTarget}
          />
          <div className="home-metrics-grid" aria-label="学习状态数据">
            {motivation ? (
              <>
                <MetricCard
                  label="连续学习天数"
                  value={motivation.streak_days}
                  tone="warning"
                  className="home-metric-card home-metric-card-warm"
                />
                <MetricCard
                  label="本周掌握知识点"
                  value={motivation.weekly_kps_mastered}
                  tone="success"
                  className="home-metric-card home-metric-card-success"
                />
                <MetricCard
                  label="待复盘错题"
                  value={motivation.mistake_backlog_count}
                  tone="danger"
                  className="home-metric-card home-metric-card-danger"
                />
              </>
            ) : (
              <div className="home-metric-card home-metric-card-empty">
                <span>学习数据</span>
                <strong>待生成</strong>
              </div>
            )}
          </div>
        </aside>
      </section>
      )}

      <section className="home-growth-section" aria-label="学习成长记录">
        <AppCard className="home-growth-card" padding="lg">
          <div className="home-growth-status">
            <GrowthStatusBadge />
          </div>
          <div className="home-growth-grid">
            <section className="home-growth-panel home-growth-advice" aria-labelledby="growth-advice-title">
              <h3 id="growth-advice-title" className="home-growth-panel-title">下一步建议</h3>
              <p className="home-growth-advice-copy">
                先按今日推荐完成最关键任务，再根据错题、掌握度和知识点状态选择入口。系统会用练习、订正和复盘数据更新下一步建议。
              </p>
              {motivation?.next_milestone && (
                <div className="home-next-milestone">
                  <span>下一目标</span>
                  <strong>{motivation.next_milestone}</strong>
                </div>
              )}
            </section>
            <GrowthReportCard />
          </div>
        </AppCard>
      </section>
    </main>
  );
}

function buildHomeEnergyProgress(motivation: DashboardData['motivation'] | undefined) {
  const weeklyMastered = motivation?.weekly_kps_mastered ?? 0;
  const pendingMistakes = motivation?.mistake_backlog_count ?? 0;

  // Temporary homepage mapping until the dashboard exposes dedicated new-learn and reviewed-mistake counts.
  return {
    newLearnCurrent: weeklyMastered,
    newLearnTarget: HOME_NEW_LEARN_WEEKLY_TARGET,
    reviewCurrent: pendingMistakes > 0 ? 0 : HOME_REVIEW_CLEAR_TARGET,
    reviewTarget: HOME_REVIEW_CLEAR_TARGET,
  };
}

function buildTodayTask(dashboard: DashboardData | null) {
  if (dashboard?.motivation.mistake_backlog_count) {
    return {
      title: `先清除 ${dashboard.motivation.mistake_backlog_count} 道待复盘错题`,
      reason: '先把已经暴露的问题解决，再进入新知识或新题，提分效率最高。',
      href: '/review',
      action: '去复盘错题',
    };
  }
  if (dashboard?.plan) {
    const isLearning = dashboard.plan.mastery < 0.4;
    return {
      title: `推进「${dashboard.plan.kp_name}」`,
      reason: dashboard.plan.reason,
      href: isLearning ? `/learn?kp=${dashboard.plan.kp_id}` : `/train?kp=${dashboard.plan.kp_id}`,
      action: isLearning ? '进入同步学习' : '进入巩固提升',
    };
  }
  return {
    title: '保持节奏，完成一次综合复习',
    reason: dashboard?.motivation.next_milestone || '当前没有明显薄弱点，可以用综合练习保持手感。',
    href: '/train',
    action: '开始巩固提升',
  };
}
