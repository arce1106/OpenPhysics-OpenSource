import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import type { ScopeDiagnosticResult } from '../types';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe('student api client diagnostic attempts', () => {
  it('keeps one paper receipt identity across photo retakes within an attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({results:{},errors:{q2:'请补拍'},solutions:{}}));
    vi.stubGlobal('fetch', fetchMock);
    await api.submitPaperBatch([new File(['first'], 'paper.png', {type:'image/png'})], ['q1','q2'], 0, undefined, 'paper-retake');
    const first = (fetchMock.mock.calls.at(-1)![1].body as FormData).get('submission_id');
    await api.submitPaperBatch([new File(['clearer'], 'paper.png', {type:'image/png'})], ['q1','q2'], 0, undefined, 'paper-retake');
    expect((fetchMock.mock.calls.at(-1)![1].body as FormData).get('submission_id')).toBe(first);
    await api.submitPaperBatch([new File(['clearer'], 'paper.png', {type:'image/png'})], ['q1','q2'], 0, undefined, 'new-paper-attempt');
    expect((fetchMock.mock.calls.at(-1)![1].body as FormData).get('submission_id')).not.toBe(first);
  });

  it('preserves topic context through text, photo, batch and self-review submissions', async () => {
    const topic = { catalog_code: 'gaokao_review' as const, node_id: 'topic-1', layer: 'transfer' as const };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ answer_id: 99, results: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await api.submitAnswer('student-1', { question_id: 'scope-text', given_answer: 'A', time_spent_ms: 0, topic_context: topic });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).topic_context).toEqual(topic);
    await api.submitPhoto('student-1', new File(['photo'], 'answer.png', { type: 'image/png' }), 'scope-photo', 0, undefined, 'scope', undefined, topic);
    expect(JSON.parse((fetchMock.mock.calls.at(-1)![1].body as FormData).get('topic_context') as string)).toEqual(topic);
    await api.submitPaperBatch([new File(['paper'], 'answer.png', { type: 'image/png' })], ['scope-paper'], 0, undefined, 'scope', undefined, topic);
    expect(JSON.parse((fetchMock.mock.calls.at(-1)![1].body as FormData).get('topic_context') as string)).toEqual(topic);
    await api.submitSelfReview({ question_id: 'scope-self', items: [{ label: '整题', status: 'partial' }], topic_context: topic }, 'scope');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).topic_context).toEqual(topic);
  });

  it.each(['account-credentials'] as const)('authenticates %s with the current account token', async path => {
    window.localStorage.setItem('openphysics.student_token', 'school-token');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sent: true, changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = { username: 'new_account', renew_session: true };
    await api.securityRequest(path, payload);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/auth/${path}`);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer school-token' });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body)).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    window.localStorage.setItem('openphysics.student_id', 'student-1');
  });

  it('refreshes the current student from the authenticated server session', async () => {
    window.localStorage.setItem('openphysics.student_token', 'fresh-token');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'student-1',
      username: 'learner',
      display_name: '学习者',
      status: 'active',


    }));
    vi.stubGlobal('fetch', fetchMock);

    const student = await api.getCurrentStudent();

    expect(student.status).toBe('active');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/me');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer fresh-token',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('maps improvement plan diagnostic attempt id and preserves source result attempt id', async () => {
    const diagnosticResult: ScopeDiagnosticResult = {
      diagnostic_attempt_id: 'attempt-1',
      scope_type: 'chapter',
      scope_id: 'unit-1',
      scope_name: '第一单元',
      correct_count: 1,
      total_count: 2,
      weak_kp_ids: ['kp-1'],
      recommendation: 'study',
      feedback: '检测反馈',
      kp_results: [
        {
          kp_id: 'kp-1',
          kp_name: '质点',
          correct_count: 0,
          total_count: 1,
          mastery_before: 0.1,
          mastery_after: 0.2,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'plan-1',
      student_id: 'student-1',
      diagnostic_attempt_id: 'attempt-1',
      scope_type: 'chapter',
      scope_id: 'unit-1',
      scope_name: '第一单元',
      created_at: '2026-06-27T00:00:00Z',
      updated_at: '2026-06-27T00:00:00Z',
      completed_at: null,
      correct_count: 1,
      total_count: 2,
      weak_count: 1,
      status: 'diagnosed',
      current_task_id: null,
      source_result: diagnosticResult,
      tasks: [],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const plan = await api.createImprovementPlanFromScopeResult(diagnosticResult, 'student-1');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      diagnostic_result: diagnosticResult,
    });
    expect(plan.diagnosticAttemptId).toBe('attempt-1');
    expect(plan.sourceResult?.diagnostic_attempt_id).toBe('attempt-1');
  });

  it('retries transient failed fetches for cached GET requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ kps: [], graph: [], stats: { total: 0, mastered: 0 } }));
    vi.stubGlobal('fetch', fetchMock);

    const request = api.getDirectory('student-1');
    await vi.runAllTimersAsync();
    const directory = await request;

    expect(directory.kps).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('maps scope diagnostic attempt list and detail responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        total: 2,
        limit: 2,
        offset: 0,
        items: [
          {
            attempt_id: 'attempt-2',
            scope_type: 'chapter',
            scope_id: 'unit-2',
            scope_name: '第二单元',
            diagnostic_type: 'scope',
            created_at: '2026-06-27T01:00:00Z',
            submitted_at: '2026-06-27T01:00:00Z',
            correct_count: 0,
            total_count: 2,
            weak_count: 2,
            recommendation: 'study',
            feedback: '第二单元反馈',
            linked_plan_id: 'plan-2',
            linked_plan_status: 'in_progress',
            linked_report_available: false,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        attempt_id: 'attempt-2',
        student_id: 'student-1',
        scope_type: 'chapter',
        scope_id: 'unit-2',
        scope_name: '第二单元',
        diagnostic_type: 'scope',
        status: 'submitted',
        created_at: '2026-06-27T01:00:00Z',
        submitted_at: '2026-06-27T01:00:00Z',
        question_ids: ['q-1'],
        answer_ids: [101],
        result: { correct_count: 0, weak_kp_ids: ['kp-1'] },
        correct_count: 0,
        total_count: 2,
        weak_count: 1,
        weak_kp_ids: ['kp-1'],
        recommendation: 'study',
        feedback: '详情反馈',
        kp_results: [
          {
            id: 'kp-result-1',
            kp_id: 'kp-1',
            kp_name: '质点',
            group_id: 'unit-2||section-1',
            group_name: 'section-1',
            correct_count: 0,
            total_count: 1,
            mastery_before: 0.1,
            mastery_after: 0.2,
            is_weak: true,
          },
        ],
        linked_plan_id: 'plan-2',
        linked_plan_status: 'completed',
        linked_report_available: true,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const list = await api.listScopeDiagnosticAttempts('student-1', {
      limit: 2,
      scopeType: 'chapter',
      scopeId: 'unit-2',
    });
    const detail = await api.getScopeDiagnosticAttempt('attempt-2', 'student-1');

    expect(list.items[0]).toMatchObject({
      attemptId: 'attempt-2',
      scopeType: 'chapter',
      linkedPlanId: 'plan-2',
      linkedReportAvailable: false,
    });
    expect(detail).toMatchObject({
      attemptId: 'attempt-2',
      studentId: 'student-1',
      linkedReportAvailable: true,
      weakKpIds: ['kp-1'],
    });
    expect(detail.kpResults[0]).toMatchObject({
      id: 'kp-result-1',
      kpId: 'kp-1',
      isWeak: true,
    });
  });

  it('starts independent practice session requests so a slow pending request does not block a fresh load', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        student_id: 'student-1',
        session_type: 'practice',
        strategy: 'balanced',
        session_objective: '练习',
        questions: [{ id: 'q-1' }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        student_id: 'student-1',
        session_type: 'practice',
        strategy: 'balanced',
        session_objective: '练习',
        questions: [{ id: 'q-2' }],
      }))
      .mockResolvedValue(jsonResponse({
        student_id: 'student-1',
        session_type: 'practice',
        strategy: 'balanced',
        session_objective: '练习',
        questions: [{ id: 'q-3' }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      api.getPracticeSession('student-1', 'kp-1', 5),
      api.getPracticeSession('student-1', 'kp-1', 5),
    ]);
    const third = await api.getPracticeSession('student-1', 'kp-1', 5);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(first.questions[0].id).toBe('q-1');
    expect(second.questions[0].id).toBe('q-2');
    expect(third.questions[0].id).toBe('q-3');
  });

  it('loads a Gaokao topic overview and starts the selected review layer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        catalog_code: 'gaokao_review',
        node_id: 'gaokao_topic_01',
        topic_code: '01',
        title: '运动描述、运动图像与追及相遇',
        status: 'not_started',
        status_label: '尚未摸底',
        recommended_layer: 'diagnostic',
        recommended_layer_name: '专题摸底',
        next_action: '先完成专题摸底',
        core_knowledge_point_count: 25,
        attempted_knowledge_point_count: 0,
        mastered_knowledge_point_count: 0,
        needs_review_knowledge_point_count: 0,
        average_mastery: 0,
        last_practiced: null,
      }))
      .mockResolvedValueOnce(jsonResponse({
        student_id: 'student-1',
        session_type: 'gaokao_review_breakthrough',
        strategy: 'gaokao_review_breakthrough',
        session_objective: '典型突破',
        session_structure: {
          phases: [{ phase: 'breakthrough', question_indices: [0] }],
          total: 1,
        },
        questions: [{ id: 'q-gaokao', stem_text: '专题题目', options: [] }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        catalog_code: 'gaokao_review',
        node_id: 'gaokao_topic_01',
        topic_code: '01',
        title: '运动描述、运动图像与追及相遇',
        status: 'needs_review',
        status_label: '需要巩固',
        recommended_layer: 'foundation',
        recommended_layer_name: '基础巩固',
        next_action: '建议先完成基础巩固',
        core_knowledge_point_count: 25,
        attempted_knowledge_point_count: 1,
        mastered_knowledge_point_count: 0,
        needs_review_knowledge_point_count: 1,
        average_mastery: 0.018,
        last_practiced: '2026-08-07T00:00:00Z',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const overview = await api.getLearningCatalogTopicOverview(
      'gaokao_review',
      'gaokao_topic_01',
    );
    const session = await api.startLearningCatalogTopicSession(
      'gaokao_review',
      'gaokao_topic_01',
      'breakthrough',
      5,
    );
    const updatedOverview = await api.recordLearningCatalogTopicEvidence(
      'gaokao_review',
      'gaokao_topic_01',
      'breakthrough',
      42,
    );

    expect(overview.core_knowledge_point_count).toBe(25);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/learning-catalogs/gaokao_review/nodes/gaokao_topic_01/overview',
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/learning-catalogs/gaokao_review/nodes/gaokao_topic_01/session',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      layer: 'breakthrough',
      question_count: 5,
    });
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/learning-catalogs/gaokao_review/nodes/gaokao_topic_01/evidence',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      layer: 'breakthrough',
      answer_id: 42,
    });
    expect(session.questions[0].id).toBe('q-gaokao');
    expect(updatedOverview.attempted_knowledge_point_count).toBe(1);
  });

  it('loads the latest Gaokao review topic for resume', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      catalog_code: 'gaokao_review',
      node_id: 'gaokao_topic_06',
      last_practiced: '2026-08-25T10:00:00Z',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const resume = await api.getLearningCatalogResume('gaokao_review');

    expect(resume.node_id).toBe('gaokao_topic_06');
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/learning-catalogs/gaokao_review/resume',
    );
  });

  it('does not request pre-rendered rich content from the web client by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      student_id: 'student-1',
      session_type: 'practice',
      strategy: 'balanced',
      session_objective: '练习',
      questions: [{ id: 'q-1' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.getPracticeSession('student-1', 'kp-1', 5);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/practice/session');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('include_rendered=1');
  });

  it('deduplicates answer history loads during route switches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await api.getAnswerHistory({ limit: 50 });
    await api.getAnswerHistory({ limit: 50 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/history/answers');
  });

  it('submits process evidence as an image-only payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      answer_id: 42,
      question_id: 'q-choice',
      process_grading: {
        process_evidence_kind: 'scratch_image',
        process_evidence_image_path: '/static/uploads/answers/student/evidence.png',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.submitProcessEvidence(
      42,
      'q-choice',
      new File(['image'], 'scratch.png', { type: 'image/png' }),
      1200,
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('image')).toBeInstanceOf(File);
    expect(body.get('question_id')).toBe('q-choice');
    expect(body.get('answer_id')).toBe('42');
    expect(body.get('time_spent_ms')).toBe('1200');
    expect(body.has('strokes_json')).toBe(false);
    expect(body.has('client_platform')).toBe(false);
    expect(body.has('source_kind')).toBe(false);
  });

  it('reuses the answer submission id after an uncertain network failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ answer_id: 10, is_correct: true }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = { question_id: 'q-idempotent', given_answer: 'A', time_spent_ms: 1000 };

    await expect(api.submitAnswer('student-1', payload)).rejects.toThrow('Failed to fetch');
    await api.submitAnswer('student-1', payload);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.submission_id).toBeTruthy();
    expect(secondBody.submission_id).toBe(firstBody.submission_id);
  });

  it('does not clear a newer login when an old request returns 401', async () => {
    window.localStorage.setItem('openphysics.student_token', 'old-token');
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const pending = api.getCurrentStudent();
    window.localStorage.setItem('openphysics.student_token', 'new-token');
    respond({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) } as Response);
    await expect(pending).rejects.toThrow();
    expect(window.localStorage.getItem('openphysics.student_token')).toBe('new-token');
  });

  it('reuses photo retry identity for identical regenerated images with different timestamps', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({answer_id: 3}));
    vi.stubGlobal('fetch', fetchMock);
    const first = new File(['same-image'], 'handwriting.jpg', {type:'image/jpeg',lastModified:1000});
    const retry = new File(['same-image'], 'handwriting.jpg', {type:'image/jpeg',lastModified:2000});
    await expect(api.submitPhoto('student-1', first, 'retry-image')).rejects.toThrow();
    await api.submitPhoto('student-1', retry, 'retry-image');
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get('submission_id'))
      .toBe((fetchMock.mock.calls[1][1]?.body as FormData).get('submission_id'));
  });

  it('does not send a photo under a login that changed while its fingerprint was being read', async () => {
    localStorage.setItem('openphysics.student_token', 'old-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.submitPhoto('student-old',new File(['photo'],'answer.png',{type:'image/png'}),'q1');
    localStorage.setItem('openphysics.student_token', 'new-token');
    await expect(pending).rejects.toThrow('登录状态已改变');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the target knowledge point through every mastery-updating contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: {}, errors: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await api.submitAnswer('student-1', {
      question_id: 'q-answer',
      given_answer: 'A',
      time_spent_ms: 100,
      target_knowledge_point_id: 'kp-critical',
    });
    await api.submitPhoto(
      'student-1',
      new File(['photo'], 'answer.png', { type: 'image/png' }),
      'q-photo',
      200,
      'kp-critical',
    );
    await api.submitPaperBatch(
      [new File(['paper'], 'paper.png', { type: 'image/png' })],
      ['q-paper'],
      300,
      { 'q-paper': 'kp-critical' },
    );
    await api.submitSelfReview({
      question_id: 'q-review',
      items: [{ label: '整题', status: 'partial' }],
      time_spent_ms: 400,
      target_knowledge_point_id: 'kp-critical',
    });

    const answerBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const photoBody = fetchMock.mock.calls[1][1]?.body as FormData;
    const paperBody = fetchMock.mock.calls[2][1]?.body as FormData;
    const reviewBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(answerBody.target_knowledge_point_id).toBe('kp-critical');
    expect(photoBody.get('target_knowledge_point_id')).toBe('kp-critical');
    expect(paperBody.get('target_knowledge_point_ids')).toBe('{"q-paper":"kp-critical"}');
    expect(reviewBody.target_knowledge_point_id).toBe('kp-critical');
  });
});
