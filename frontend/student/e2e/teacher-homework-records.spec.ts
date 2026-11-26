import { expect, test, type Page } from '@playwright/test';

const profile = { id: 'synthetic-homework-test', username: 'student', display_name: '测试学生', status: 'active',
  subscription_active: true, subscription_status: 'active', subscription_plan: 'monthly' };

const homework = (attempt_id: string, title: string, extra: Record<string, unknown> = {}) => ({
  attempt_id, assignment_id: `a_${attempt_id}`, title, class_name: '高三（3）', question_count: 2, graded_count: 2,
  status: 'completed', published_at: '2026-11-01T08:00:00+00:00', delivery: 'app', results_released: false, ...extra,
});
const finished = [
  homework('att_new', '运动学', { score_percent: 85 }),
  homework('att_mid', '测试2', { score_percent: 72, results_released: true }),
  homework('att_old', '测试'),
];

const ring = (key: string, actual: number, target: number, completed = false) => ({ key, label: key, completed, current: actual,
  actual_current: actual, target, overflow: 0, auto_completed: false, evidence: '' });
const dashboard = { diagnosis: { overall_mastery: 0.4, mastered_count: 5, in_progress_count: 3, locked_count: 1, weak_points: [] },
  plan: null, knowledge_map: [],
  motivation: { streak_days: 3, weekly_kps_mastered: 2, mistake_backlog_count: 19, next_milestone: '完成「平均速度与瞬时速度」' } };
const session = { student_id: profile.id, session_type: 'teacher_paper', strategy: 'fixed', session_objective: '老师作业',
  session_structure: { phases: [] }, estimated_minutes: 5,
  questions: [{ id: 'q1', stem_text: '题目一', question_type: 'single_choice', options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }] }],
  answers: { q1: { answer_id: 1, is_correct: true, correct_answer: 'A', extracted_answer: 'A', explanation: '解析', mastery_update: {} } },
  teacher_paper: { id: 'p1', attempt_id: 'att_new', title: '运动学', question_count: 1, has_video: false, status: 'completed',
    score_percent: 85, results_released: false } };

async function prepare(page: Page, list: unknown[] = finished) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(student => {
    localStorage.setItem('openphysics.student_token', 'synthetic-homework-token');
    localStorage.setItem('openphysics.student_profile', JSON.stringify(student));
    localStorage.setItem('openphysics.student_id', student.id);
  }, profile);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: profile });
    if (url.pathname.endsWith('/teacher-homework')) return route.fulfill({ json: list });
    if (url.pathname.endsWith('/teacher-homework/att_new/session')) return route.fulfill({ json: session });
    if (url.pathname.includes('/daily-loop') || url.pathname.includes('daily-learning-loop')) {
      return route.fulfill({ json: { date: '2026-11-06', streak_days: 3, is_effective_day: true, is_high_quality_day: false,
        rings: { practice: ring('practice', 6, 5, true), review: ring('review', 1, 3) }, summary: '', next_action: '' } });
    }
    if (url.pathname.includes('/dashboard')) return route.fulfill({ json: dashboard });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  return errors;
}

test('home keeps one homework, records hold them all, and the score reaches the paper', async ({ page }) => {
  const errors = await prepare(page);
  await page.goto('/');

  const tasks = page.getByRole('list', { name: '老师作业' });
  await expect(tasks.getByText('高三（3） · 2 题 · 85 分')).toBeVisible();
  await expect(tasks.getByRole('link')).toHaveCount(1);
  await expect(page.getByText('测试2')).toHaveCount(0);
  await expect(page.locator('.home-energy-goal-title')).toContainText('今日目标');
  await expect(page.locator('.home-energy-center')).toContainText('1/2');
  await expect(page.locator('.home-entry-section')).toHaveCount(0);

  await page.getByRole('link', { name: '查看历次作业得分' }).click();
  await expect(page).toHaveURL(/\/homework$/);
  await expect(page.getByRole('heading', { name: '作业记录' })).toBeVisible();
  await expect(page.getByRole('link', { name: /运动学/ })).toContainText('85 分');
  await expect(page.getByRole('link', { name: /测试2/ })).toContainText('老师已审核');
  await expect(page.getByRole('link', { name: /测试 / })).toContainText('已完成');
  await expect(page.locator('.homework-record-badges')).toContainText('79');

  await page.getByRole('link', { name: /运动学/ }).click();
  await expect(page.getByText('得分 85/100')).toBeVisible();
  await expect(page.getByText('AI 批改，老师审核后可能调整')).toBeVisible();
  await page.getByRole('button', { name: '返回作业记录' }).click();
  await expect(page).toHaveURL(/\/homework$/);
  expect(errors).toEqual([]);
});

test('unfinished homework leads the home card and the rest fold', async ({ page }) => {
  const errors = await prepare(page, [
    homework('att_a', '力学', { status: 'in_progress', graded_count: 0 }),
    homework('att_b', '电学', { status: 'grading', graded_count: 1 }),
    ...finished,
  ]);
  await page.goto('/');

  const tasks = page.getByRole('list', { name: '老师作业' });
  await expect(tasks.getByRole('link', { name: '去作答' })).toBeVisible();
  await expect(tasks.getByRole('link')).toHaveCount(1);
  await tasks.getByRole('button', { name: '还有 1 份作业待完成' }).click();
  await expect(tasks.getByText('高三（3） · 已批改 1/2')).toBeVisible();
  await expect(page.getByRole('link', { name: '去复盘错题' })).toHaveClass(/home-secondary-action/);
  expect(errors).toEqual([]);
});
