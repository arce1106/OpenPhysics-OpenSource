import { expect, test, type Page } from '@playwright/test';

const profile = { id: 'rounds-qa', username: '练习验收', display_name: '练习验收', status: 'active',
  subscription_active: true, subscription_status: 'active', subscription_plan: 'monthly' };
const kp = { id: 'rounds-kp', name: '连接体问题', volume: '必修 第一册', chapter: '第四章 运动和力的关系',
  section: '4.5 牛顿运动定律的应用', mastery: 0.73, status: 'locked', learning_state: 'practice',
  learning_state_label: '待巩固', learning_state_tone: 'practice', blocked_by: ['prerequisite'], last_practiced: '2026-09-11T12:00:00Z' };
const question = (id: string) => ({ id, stem_text: `验收题目 ${id}`, question_type: 'single_choice',
  target_knowledge_point_id: kp.id, options: [{ label: 'A', text: '选项一' }, { label: 'B', text: '选项二' }], images: [] });
const bundle = { kp_id: kp.id, kp_name: kp.name, card: null, slides: null, simulations: [], examples: [], progress: {} };
const session = (id: string) => ({ student_id: profile.id, session_type: 'practice', strategy: 'practice',
  session_objective: '巩固练习', questions: [question(id)], session_structure: { phases: [], total: 1 } });

async function prepare(page: Page) {
  const errors: string[] = [];
  const requests: string[] = [];
  const submissions: Record<string, unknown>[] = [];
  const mistake = { answer_id: 33, question_id: 'original', stem_text: '原错题', question_type: 'single_choice',
    options: question('original').options, images: [], given_answer: 'A', correct_answer: 'B',
    explanation: '原题解析', misconception: null, process_grading: null, created_at: '2026-09-11T12:00:00Z' };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(student => {
    localStorage.setItem('openphysics.student_token', 'synthetic-rounds-token');
    localStorage.setItem('openphysics.student_profile', JSON.stringify(student));
  }, profile);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: profile });
    if (url.pathname.endsWith('/directory')) return route.fulfill({ json: { kps: [kp], relations: [], stats: { total: 1, mastered: 0, in_progress: 1, locked: 0 } } });
    if (url.pathname.endsWith('/mastery-judgments/kps')) return route.fulfill({ json: { items: [] } });
    if (url.pathname.endsWith(`/learn/${kp.id}`)) return route.fulfill({ json: bundle });
    if (url.pathname.endsWith('/practice/session')) return route.fulfill({ json: session('fresh-practice') });
    if (url.pathname.endsWith('/review')) return route.fulfill({ json: { groups: [{ kp_id: kp.id, kp_name: kp.name, wrong_count: 1, mistakes: [mistake] }], clearance_progress: { reviewed: 0, total: 1 } } });
    if (url.pathname.endsWith('/review/variations/33')) {
      const next = url.searchParams.get('exclude_question_ids')?.includes('variant-one') ? 'variant-two' : 'variant-one';
      return route.fulfill({ json: { variations: [{ variation_type: 'foundation', title: '做变式题', reason: '同类练习', question: question(next) }] } });
    }
    if (url.pathname.endsWith('/practice/submit')) {
      const body = route.request().postDataJSON();
      submissions.push(body);
      return route.fulfill({ json: { answer_id: submissions.length + 100, is_correct: body.question_id === 'variant-two',
        correct_answer: 'B', extracted_answer: body.given_answer, explanation: '验收解析', mastery_update: {} } });
    }
    if (url.pathname.endsWith('/review/33/complete')) return route.fulfill({ json: { cleared: true } });
    return route.fulfill({ json: {} });
  });
  return { errors, requests, submissions };
}

test('completed assessment flows through sync into fresh consolidation on tablet', async ({ page }, info) => {
  const { errors, requests } = await prepare(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  const scope = `kp-check:kp=${kp.id}&count=3&mode=check`;
  await page.addInitScript(({ studentId, scope, bundle, previous }) => {
    localStorage.setItem('openphysics:practice:v1:' + JSON.stringify([studentId, scope]), JSON.stringify({
      version: 1, id: 'completed-assessment', studentId, scope, currentIdx: 0,
      payload: { bundle, session: previous, diagnosticResult: { recommendation: 'practice' } },
      answers: { old: { answer_id: 99, is_correct: false, correct_answer: 'B', mastery_update: {} } }, collectedAnswers: { old: 'A' },
    }));
  }, { studentId: profile.id, scope, bundle, previous: session('old') });
  await page.goto('/sync');
  await expect(page).toHaveTitle(/OpenPhysics/);
  await page.getByRole('button', { name: /73% 连接体问题/ }).click();
  await page.getByRole('button', { name: '巩固小练', exact: true }).click();
  await expect(page.getByRole('heading', { name: '巩固小练', exact: true })).toBeVisible();
  await expect(page.locator('.question-card-stem-region').getByText('验收题目 fresh-practice', { exact: true })).toBeVisible();
  await page.goto(`/learn/check?kp=${kp.id}&count=3&mode=check`);
  await expect(page).toHaveURL(/mode=practice/);
  await expect(page.locator('.question-card-stem-region').getByText('验收题目 fresh-practice', { exact: true })).toBeVisible();
  await expect(page.locator('.choice-answer-option.is-disabled')).toHaveCount(0);
  expect(requests.some(path => path.includes('/diagnose/'))).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('assessment-to-practice.png'), fullPage: false });
});

test('wrong variation can continue to a new question, survive reload and clear after a correct answer', async ({ page }, info) => {
  const { errors, requests, submissions } = await prepare(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/review/mistake/33');
  await page.getByRole('button', { name: '做变式题' }).click();
  await expect(page.locator('.question-card-stem-region').getByText('验收题目 variant-one', { exact: true })).toBeVisible();
  await page.locator('.choice-answer-option').first().click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await page.getByRole('button', { name: '再练一道', exact: true }).click();
  await expect(page.locator('.question-card-stem-region').getByText('验收题目 variant-two', { exact: true })).toBeVisible();
  await expect(page.locator('.choice-answer-option.is-disabled')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.question-card-stem-region').getByText('验收题目 variant-two', { exact: true })).toBeVisible();
  await expect(page.locator('.choice-answer-option.is-disabled')).toHaveCount(0);
  await page.locator('.choice-answer-option').nth(1).click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect.poll(() => requests.some(path => path.endsWith('/review/33/complete'))).toBe(true);
  expect(submissions).toHaveLength(2);
  expect(submissions[0].submission_id).not.toEqual(submissions[1].submission_id);
  expect(requests.filter(path => path.includes('/review/variations/'))).toHaveLength(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('review-new-round.png'), fullPage: false });
});
