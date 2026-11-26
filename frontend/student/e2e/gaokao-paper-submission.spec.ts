import { expect, test } from '@playwright/test';

for (const viewport of [{width: 1366, height: 900}, {width: 390, height: 844}]) {
  test(`topic paper saves drafts and submits all questions together ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    const profile = {id: 'paper-qa', username: '套卷测试', display_name: '套卷测试', status: 'active', subscription_active: true, subscription_status: 'active'};
    const topic = {id: 'topic-1', code: '01', node_type: 'topic', title: '运动描述', sort_order: 1, config: {}, mapping_summary: {}, children: []};
    const overview = {catalog_code: 'gaokao_review', node_id: topic.id, topic_code: '01', title: topic.title, status: 'not_started', status_label: '尚未摸底', recommended_layer: 'diagnostic', recommended_layer_name: '专题摸底', next_action: '先摸底', core_knowledge_point_count: 3, attempted_knowledge_point_count: 0, mastered_knowledge_point_count: 0, needs_review_knowledge_point_count: 0, average_mastery: 0, teacher_papers: []};
    const questions = [
      {id: 'paper-choice-1', stem_text: '第一题：请选择正确选项。', question_type: 'single_choice', options: [{label:'A', text:'初选'}, {label:'B',text:'修改后的选项'}], images: []},
      {id: 'paper-written', stem_text: '第二题：请写出计算过程。', question_type: 'experiment', options: [], images: [], answer: '2m/s', explanation:'本题计算解析'},
      {id: 'paper-choice-3', stem_text: '第三题：请选择最后一题答案。', question_type: 'single_choice', options: [{label:'A',text:'最后一题选项'}, {label:'B',text:'错误选项'}], images: []},
    ];
    const submissions: {id: string, answer?: string, imageBytes?: number}[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(student => {
      localStorage.setItem('openphysics.student_token', 'synthetic-paper-token');
      localStorage.setItem('openphysics.student_profile', JSON.stringify(student));
    }, profile);
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/auth/me')) return route.fulfill({json: profile});
      if (path.endsWith('/learning-catalogs/gaokao_review')) return route.fulfill({json:{id:'catalog',code:'gaokao_review',name:'高考复习',enabled:true,version:1,node_count:2,topic_count:1,nodes:[{...topic,id:'block',node_type:'block',title:'力学',children:[topic]}]}});
      if (path.endsWith('/resume')) return route.fulfill({json:{catalog_code:'gaokao_review',node_id:topic.id}});
      if (path.endsWith('/overview') || path.endsWith('/evidence')) return route.fulfill({json: overview});
      if (path.endsWith('/session')) return route.fulfill({json:{student_id:profile.id,session_type:'gaokao_topic_paper',strategy:'paper',session_objective:'专题套卷',questions}});
      if (path.endsWith('/practice/submit')) {
        const body = request.postDataJSON();
        submissions.push({id:body.question_id,answer:body.given_answer});
        expect(body.topic_context).toEqual({catalog_code:'gaokao_review',node_id:'topic-1',layer:'paper'});
        return route.fulfill({json:{answer_id:body.question_id.endsWith('1')?91:93,is_correct:true,correct_answer:body.given_answer,extracted_answer:body.given_answer,explanation:'交卷后解析',mastery_update:{}}});
      }
      if (path.endsWith('/practice/submit-photo')) {
        const body = request.postDataBuffer()!;
        const text = body.toString('latin1');
        expect(text).toContain('paper-written');
        expect(text.includes('image/jpeg')).toBe(true);
        expect(body.length).toBeGreaterThan(1000);
        submissions.push({id:'paper-written',imageBytes:body.length});
        await new Promise(resolve => setTimeout(resolve, 700));
        return route.fulfill({json:{answer_id:92,is_correct:true,correct_answer:'2m/s',extracted_answer:'2m/s',explanation:'本题计算解析',mastery_update:{}}});
      }
      return route.fulfill({json:{}});
    });
    await page.goto('/gaokao');
    await page.getByRole('button',{name:'开始专题套卷',exact:true}).click();
    await expect(page.getByRole('heading',{name:'专题套卷',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'提交整卷',exact:true})).toBeVisible();
    await page.locator('.choice-answer-option').first().click();
    await page.getByRole('button',{name:'2',exact:true}).click();
    await expect(page.getByRole('button', {name: '对照解析自评', exact:true})).toBeVisible();
    const canvas = page.locator('canvas.handwriting-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 50, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 170, {steps: 10});
    await page.mouse.move(box.x + 70, box.y + 240, {steps: 10});
    await page.mouse.up();
    await page.getByRole('button',{name:'1',exact:true}).click();
    await page.locator('.choice-answer-option').nth(1).click();
    await expect(page.locator('.question-workspace-count')).toHaveText('2 / 3');
    await page.waitForTimeout(250); // allow the debounced local draft write before a real reload
    await page.reload();
    await expect(page.locator('.question-workspace-count')).toHaveText('2 / 3');
    await expect(page.locator('.choice-answer-option').nth(1)).toHaveClass(/is-selected/);
    expect(submissions).toHaveLength(0);
    await page.getByRole('button',{name:'提交整卷',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('未作答题号：3');
    await page.screenshot({path:`/tmp/openphysics-topic-paper-qa/confirmation-${viewport.width}.png`});
    await page.getByRole('button',{name:'返回检查',exact:true}).click();
    await page.getByRole('button',{name:'3',exact:true}).click();
    await page.locator('.choice-answer-option').first().click();
    await page.getByRole('button',{name:'提交整卷',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText('已作答 3/3');
    await page.getByRole('button',{name:'确认交卷并批改',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'整套批改进度'})).toBeVisible();
    await expect(page.getByText('交卷后解析',{exact:true})).toHaveCount(0);
    await expect(page.getByText('专题套卷结果',{exact:true})).toBeVisible();
    await expect.poll(()=>submissions.length).toBe(3);
    expect(submissions.filter(s=>s.answer)).toEqual(expect.arrayContaining([{id:'paper-choice-1',answer:'B'},{id:'paper-choice-3',answer:'A'}]));
    await page.getByRole('button',{name:'逐题复盘',exact:true}).click();
    await page.getByRole('button',{name:'2',exact:true}).click();
    await expect(page.getByText('本题计算解析',{exact:true})).toBeVisible();
    await page.screenshot({path:`/tmp/openphysics-topic-paper-qa/review-${viewport.width}.png`});
    await page.reload();
    await expect(page.getByText('专题套卷结果',{exact:true})).toBeVisible();
    expect(submissions).toHaveLength(3);
    expect(errors).toEqual([]);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  });
}
