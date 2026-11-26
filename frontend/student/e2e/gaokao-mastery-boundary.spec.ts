import { expect, test } from '@playwright/test';

test('topic performance shows coverage separately and submits the selected source', async ({ page }, info) => {
  const profile = { id: 'topic-qa', username: '专题验收', display_name: '专题验收', status: 'active', subscription_active: true, subscription_status: 'active', subscription_plan: 'monthly' };
  const topic = { id: 'topic-1', code: '01', node_type: 'topic', title: '运动描述', description: '', sort_order: 1, config: {}, mapping_summary: {}, children: [] };
  const overview = { catalog_code: 'gaokao_review', node_id: topic.id, topic_code: '01', title: topic.title, description: '', status: 'in_progress', status_label: '正在提升', recommended_layer: 'transfer', recommended_layer_name: '综合迁移', next_action: '继续训练', core_knowledge_point_count: 25, attempted_knowledge_point_count: 9, mastered_knowledge_point_count: 0, needs_review_knowledge_point_count: 9, average_mastery: .108, performance_score: .6, evidence_count: 10, untested_knowledge_point_count: 16, coverage_ratio: .36, last_practiced: null, teacher_papers: [] };
  const submissions: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(student => {
    localStorage.setItem('openphysics.student_token', 'synthetic-topic-token');
    localStorage.setItem('openphysics.student_profile', JSON.stringify(student));
  }, profile);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: profile });
    if (path.endsWith('/learning-catalogs/gaokao_review')) return route.fulfill({ json: { id: 'catalog', code: 'gaokao_review', name: '高考复习', enabled: true, version: 1, node_count: 2, topic_count: 1, nodes: [{ ...topic, id: 'block', node_type: 'block', title: '力学', children: [topic] }] } });
    if (path.endsWith('/resume')) return route.fulfill({ json: { catalog_code: 'gaokao_review', node_id: topic.id } });
    if (path.endsWith('/overview') || path.endsWith('/evidence')) return route.fulfill({ json: overview });
    if (path.endsWith('/session')) return route.fulfill({ json: { student_id: profile.id, session_type: 'gaokao_review_transfer', strategy: 'transfer', session_objective: '综合迁移', questions: [{ id: 'topic-q', stem_text: '专题验收题', question_type: 'single_choice', target_knowledge_point_id: 'kp-1', options: [{ label: 'A', text: '选项一' }, { label: 'B', text: '选项二' }], images: [] }] } });
    if (path.endsWith('/practice/submit')) {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ json: { answer_id: 123, is_correct: true, correct_answer: 'A', explanation: '验收解析', mastery_update: {} } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/gaokao');
  await expect(page.getByText('60% 专题作答表现')).toBeVisible();
  await expect(page.getByText('综合掌握', { exact: false })).toHaveCount(0);
  await expect(page.locator('.train-route-stat').filter({ hasText: '待检测' })).toHaveText('待检测16');
  await page.screenshot({ path: info.outputPath('topic-boundary.png'), fullPage: true });
  await page.getByRole('button', { name: '进入综合迁移', exact: true }).click();
  await expect(page.locator('.question-session-workspace').getByText('专题验收题')).toBeVisible();
  await page.locator('.choice-answer-option').first().click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].topic_context).toEqual({ catalog_code: 'gaokao_review', node_id: 'topic-1', layer: 'transfer' });
  expect(errors).toEqual([]);
});
