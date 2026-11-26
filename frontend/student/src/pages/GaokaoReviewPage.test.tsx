import { act, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { getStudentProfile } from '../api/studentIdentity';
import { newPracticeRecord, savePracticeRecord } from '../utils/practicePersistence';
import type {
  LearningCatalogData,
  LearningCatalogNode,
  LearningCatalogTopicOverview,
  PracticeSession,
} from '../types';
import GaokaoReviewPage from './GaokaoReviewPage';

const render = (ui: ReactElement, entry = '/gaokao') => renderUI(ui, {
  wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

vi.mock('../api/client', () => ({
  api: {
    getLearningCatalog: vi.fn(),
    getLearningCatalogResume: vi.fn(),
    getLearningCatalogTopicOverview: vi.fn(),
    startLearningCatalogTopicSession: vi.fn(),
    recordLearningCatalogTopicEvidence: vi.fn(),
    submitAnswer: vi.fn(),
    getQuestionLessonVideo: vi.fn(),
    submitTeacherPaperAttempt: vi.fn(),
    migrateTeacherPaperAttempt: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  getStudentProfile: vi.fn(),
}));

vi.mock('../components/QuestionSessionRunner', () => ({
  default: ({
    title,
    subtitle,
    onBack,
    onAnswer,
    onAnswered,
    error,
    collectMode,
    deferredGrading,
    supplementaryAction,
    onBeforeDeferredGrading,
    readOnly,
    resultForQuestion,
  }: {
    title: string;
    subtitle: string;
    onBack: () => void;
    onAnswer?: (questionId: string, answer: string) => Promise<any>;
    onAnswered?: (questionId: string, result: any) => void;
    error?: string | null;
    collectMode?: boolean;
    deferredGrading?: boolean;
    supplementaryAction?: ReactNode;
    onBeforeDeferredGrading?: () => Promise<void>;
    readOnly?: boolean;
    resultForQuestion?: (id: string) => any;
  }) => (
    <div data-testid="gaokao-question-session" data-collect={collectMode} data-deferred={deferredGrading}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {supplementaryAction}
      <span data-testid="restored-answer">{resultForQuestion?.('question-1')?.extracted_answer}</span>
      {error ? <div role="alert">{error}</div> : null}
      {!readOnly && <button
        type="button"
        onClick={async () => {
          await onBeforeDeferredGrading?.();
          const result = await onAnswer?.('question-1', 'A');
          if (result) onAnswered?.('question-1', result);
        }}
      >
        模拟提交专题答案
      </button>}
      <button type="button" onClick={onBack}>返回专题路径</button>
    </div>
  ),
}));

function topic(code: string, title: string): LearningCatalogNode {
  return {
    id: `gaokao_topic_${code}`,
    code: `topic_${code}`,
    node_type: 'topic',
    title,
    description: null,
    sort_order: Number(code),
    config: { display_code: code },
    mapping_summary: {
      knowledge_point_count: 2,
      label_rule_count: 1,
      question_override_count: 0,
    },
    children: [],
  };
}

const catalog: LearningCatalogData = {
  id: 'catalog_gaokao_review',
  code: 'gaokao_review',
  name: '高考复习',
  description: '按高考知识板块组织',
  version: 1,
  enabled: true,
  sort_order: 20,
  config: {},
  node_count: 25,
  topic_count: 19,
  nodes: [
    {
      id: 'gaokao_block_01',
      code: 'block_01',
      node_type: 'block',
      title: '一、运动与相互作用',
      description: null,
      sort_order: 1,
      config: {},
      mapping_summary: {
        knowledge_point_count: 0,
        label_rule_count: 0,
        question_override_count: 0,
      },
      children: [
        topic('01', '运动描述、运动图像与追及相遇'),
        topic('02', '受力分析、平衡与临界问题'),
        topic('03', '牛顿运动定律及动力学模型'),
        topic('04', '抛体运动与圆周运动'),
        topic('05', '万有引力与天体运动'),
      ],
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `gaokao_block_0${index + 2}`,
      code: `block_0${index + 2}`,
      node_type: 'block' as const,
      title: index === 0 ? '二、能量与动量' : `知识板块 ${index + 2}`,
      description: null,
      sort_order: index + 2,
      config: {},
      mapping_summary: {
        knowledge_point_count: 0,
        label_rule_count: 0,
        question_override_count: 0,
      },
      children: index === 0
        ? [
            topic('06', '功、机械能与功能关系'),
            topic('07', '动量、碰撞与全过程问题'),
            topic('08', '力学综合模型'),
          ]
        : [],
    })),
  ],
};

const overview: LearningCatalogTopicOverview = {
  catalog_code: 'gaokao_review',
  node_id: 'gaokao_topic_01',
  topic_code: '01',
  title: '运动描述、运动图像与追及相遇',
  description: null,
  status: 'not_started',
  status_label: '尚未摸底',
  recommended_layer: 'diagnostic',
  recommended_layer_name: '专题摸底',
  next_action: '先完成专题摸底，再进入适合自己的复习层级。',
  core_knowledge_point_count: 2,
  attempted_knowledge_point_count: 0,
  mastered_knowledge_point_count: 0,
  needs_review_knowledge_point_count: 0,
  average_mastery: 0,
  last_practiced: null,
};

const session: PracticeSession = {
  student_id: 'student-1',
  session_type: 'gaokao_topic_diagnostic',
  strategy: 'topic_diagnostic',
  session_objective: '判断当前专题的真实掌握状态',
  session_structure: {
    phases: [{ phase: 'diagnostic', question_indices: [0] }],
    total: 1,
  },
  questions: [{
    id: 'question-1',
    stem_text: '测试题目',
    options: [
      { label: 'A', text: '选项 A' },
      { label: 'B', text: '选项 B' },
    ],
  }],
};

describe('GaokaoReviewPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.mocked(getStudentProfile).mockReturnValue({ id: 'student-1', username: 'test', display_name: '测试', status: 'active', });
    vi.mocked(api.getLearningCatalog).mockResolvedValue(catalog);
    vi.mocked(api.getLearningCatalogResume).mockResolvedValue({
      catalog_code: 'gaokao_review',
      node_id: null,
      last_practiced: null,
    });
    vi.mocked(api.getLearningCatalogTopicOverview).mockResolvedValue(overview);
    vi.mocked(api.startLearningCatalogTopicSession).mockResolvedValue(session);
    vi.mocked(api.submitAnswer).mockResolvedValue({
      answer_id: 42,
      is_correct: true,
      correct_answer: 'A',
      explanation: null,
      mastery_update: {},
    });
    vi.mocked(api.recordLearningCatalogTopicEvidence).mockResolvedValue({
      ...overview,
      status: 'needs_review',
      status_label: '需要巩固',
      recommended_layer: 'foundation',
      recommended_layer_name: '基础巩固',
      attempted_knowledge_point_count: 1,
      needs_review_knowledge_point_count: 1,
      average_mastery: 0.018,
      last_practiced: '2026-08-07T00:00:00Z',
    });
  });

  it('loads the review catalog from the shared backend directory API', async () => {
    render(<GaokaoReviewPage />);

    await waitFor(() => {
      expect(api.getLearningCatalog).toHaveBeenCalledWith('gaokao_review');
    });
    expect(await screen.findByText('6 个知识板块 · 19 个专题')).toBeInTheDocument();
  });

  it('opens the workbench without discarding an unfinished session and resumes it explicitly', async () => {
    savePracticeRecord({ ...newPracticeRecord('student-1', 'gaokao', {
      selectedTopicId: 'gaokao_topic_01', session, sessionLayer: 'foundation',
    }), collectedAnswers: { 'question-1': 'B' } });
    render(<GaokaoReviewPage />);
    expect(await screen.findByRole('region', { name: '专题复习工作台' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '进入基础巩固' }));
    expect(await screen.findByTestId('gaokao-question-session')).toBeInTheDocument();
    expect(api.startLearningCatalogTopicSession).not.toHaveBeenCalled();
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('never shows the old choose-topic prompt while catalog resume or overview is pending', async () => {
    const resume = deferred<Awaited<ReturnType<typeof api.getLearningCatalogResume>>>();
    const path = deferred<LearningCatalogTopicOverview>();
    vi.mocked(api.getLearningCatalogResume).mockReturnValue(resume.promise);
    vi.mocked(api.getLearningCatalogTopicOverview).mockReturnValue(path.promise);
    render(<GaokaoReviewPage />);
    const workbench = within(screen.getByRole('region', { name: '专题复习工作台' }));
    expect(workbench.getByRole('status')).toHaveTextContent('正在恢复最近复习专题');
    await act(async () => { await Promise.resolve(); });
    expect(workbench.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.getLearningCatalogTopicOverview).not.toHaveBeenCalled();
    await act(async () => resume.resolve({ catalog_code: 'gaokao_review', node_id: 'gaokao_topic_06', last_practiced: null }));
    expect(workbench.getByRole('status')).toHaveTextContent('正在加载专题复习路径');
    expect(workbench.queryByText('选择一个专题开始复习')).not.toBeInTheDocument();
    expect(workbench.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => path.resolve({ ...overview, node_id: 'gaokao_topic_06', title: '功、机械能与功能关系' }));
    expect(workbench.getByText('功、机械能与功能关系')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /二、能量与动量/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['missing', 'unavailable'])('falls back to the first topic when resume is %s', async reason => {
    if (reason === 'unavailable') vi.mocked(api.getLearningCatalogResume).mockRejectedValue(new Error('offline'));
    else vi.mocked(api.getLearningCatalogResume).mockResolvedValue({ catalog_code: 'gaokao_review', node_id: 'removed-topic', last_practiced: null });
    render(<GaokaoReviewPage />);
    expect(await screen.findByText('当前专题复习路径')).toBeInTheDocument();
    expect(api.getLearningCatalogTopicOverview).toHaveBeenCalledWith('gaokao_review', 'gaokao_topic_01');
  });

  it('distinguishes an empty catalog from a catalog failure and supports retry', async () => {
    vi.mocked(api.getLearningCatalog).mockRejectedValueOnce(new Error('目录暂时不可用'))
      .mockResolvedValueOnce({ ...catalog, nodes: [], topic_count: 0 });
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);
    const workbench = within(screen.getByRole('region', { name: '专题复习工作台' }));
    expect(await workbench.findByRole('alert')).toHaveTextContent('目录暂时不可用');
    expect(workbench.queryByText('选择一个专题开始复习')).not.toBeInTheDocument();
    await user.click(workbench.getByRole('button', { name: '重新加载' }));
    expect(await workbench.findByText('暂无可用复习专题')).toBeInTheDocument();
    expect(api.getLearningCatalogTopicOverview).not.toHaveBeenCalled();
  });

  it('keeps overview errors inline and can load the same topic again', async () => {
    vi.mocked(api.getLearningCatalogTopicOverview).mockRejectedValueOnce(new Error('专题暂时不可用')).mockResolvedValueOnce(overview);
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);
    const workbench = within(screen.getByRole('region', { name: '专题复习工作台' }));
    expect(await workbench.findByRole('alert')).toHaveTextContent('专题暂时不可用');
    expect(screen.getByRole('list', { name: '一、运动与相互作用专题' })).toBeInTheDocument();
    await user.click(workbench.getByRole('button', { name: '重新加载' }));
    expect(await workbench.findByText('当前专题复习路径')).toBeInTheDocument();
  });

  it('ignores a late overview from the previous topic after a quick switch', async () => {
    const oldPath = deferred<LearningCatalogTopicOverview>();
    vi.mocked(api.getLearningCatalogTopicOverview).mockReturnValueOnce(oldPath.promise)
      .mockResolvedValueOnce({ ...overview, node_id: 'gaokao_topic_06', title: '功、机械能与功能关系' });
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);
    await user.click(await screen.findByRole('button', { name: /二、能量与动量/ }));
    await user.click(screen.getByRole('button', { name: /06.*功、机械能与功能关系/ }));
    const workbench = within(screen.getByRole('region', { name: '专题复习工作台' }));
    expect(await workbench.findByText('功、机械能与功能关系')).toBeInTheDocument();
    await act(async () => oldPath.resolve(overview));
    expect(workbench.getByText('功、机械能与功能关系')).toBeInTheDocument();
    expect(workbench.queryByText(overview.title)).not.toBeInTheDocument();
    expect(workbench.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves an unfinished topic ahead of the latest evidence and expands its block', async () => {
    savePracticeRecord(newPracticeRecord('student-1', 'gaokao', {
      selectedTopicId: 'gaokao_topic_06', session, sessionLayer: 'foundation',
    }));
    vi.mocked(api.getLearningCatalogResume).mockResolvedValue({ catalog_code: 'gaokao_review', node_id: 'gaokao_topic_01', last_practiced: null });
    vi.mocked(api.getLearningCatalogTopicOverview).mockResolvedValue({ ...overview, node_id: 'gaokao_topic_06', title: '功、机械能与功能关系' });
    const user = userEvent.setup();
    render(<GaokaoReviewPage />, '/gaokao?view=practice');
    expect(screen.getByTestId('gaokao-question-session')).toBeInTheDocument();
    await waitFor(() => expect(api.getLearningCatalogTopicOverview).toHaveBeenCalledWith('gaokao_review', 'gaokao_topic_06'));
    await user.click(screen.getByRole('button', { name: '返回专题路径' }));
    expect(screen.getByRole('button', { name: /二、能量与动量/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /06.*功、机械能与功能关系/ })).toHaveAttribute('aria-pressed', 'true');
    expect(api.startLearningCatalogTopicSession).not.toHaveBeenCalled();
  });

  it('restores the latest reviewed topic and expands its knowledge block', async () => {
    const resumedOverview: LearningCatalogTopicOverview = {
      ...overview,
      node_id: 'gaokao_topic_06',
      topic_code: '06',
      title: '功、机械能与功能关系',
      status: 'in_progress',
      status_label: '正在提升',
      attempted_knowledge_point_count: 1,
      last_practiced: '2026-08-25T10:00:00Z',
    };
    vi.mocked(api.getLearningCatalogResume).mockResolvedValue({
      catalog_code: 'gaokao_review',
      node_id: 'gaokao_topic_06',
      last_practiced: '2026-08-25T10:00:00Z',
    });
    vi.mocked(api.getLearningCatalogTopicOverview).mockResolvedValue(resumedOverview);

    render(<GaokaoReviewPage />);

    expect(await screen.findByText('功、机械能与功能关系')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /一、运动与相互作用/ }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /二、能量与动量/ }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /06.*功、机械能与功能关系/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(api.getLearningCatalogTopicOverview).toHaveBeenCalledWith(
      'gaokao_review',
      'gaokao_topic_06',
    );
    expect(screen.getByRole('region', { name: '专题复习工作台' }))
      .toHaveTextContent('功、机械能与功能关系');
  });

  it('starts a diagnostic session from the topic workbench', async () => {
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);

    await screen.findByText('6 个知识板块 · 19 个专题');
    await user.click(await screen.findByRole('button', { name: '进入专题摸底' }));

    await waitFor(() => {
      expect(api.startLearningCatalogTopicSession).toHaveBeenCalledWith(
        'gaokao_review',
        'gaokao_topic_01',
        'diagnostic',
        8,
      );
    });
    expect(await screen.findByTestId('gaokao-question-session')).toHaveTextContent(
      '专题摸底',
    );
    expect(screen.getByText('判断当前专题的真实掌握状态')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '模拟提交专题答案' }));
    await waitFor(() => {
      expect(api.recordLearningCatalogTopicEvidence).toHaveBeenCalledWith(
        'gaokao_review',
        'gaokao_topic_01',
        'diagnostic',
        42,
      );
    });
  });

  it('starts a review layer directly from its entry card', async () => {
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);

    await screen.findByText('6 个知识板块 · 19 个专题');
    await user.click(await screen.findByRole('button', { name: '进入典型突破' }));

    await waitFor(() => {
      expect(api.startLearningCatalogTopicSession).toHaveBeenCalledWith(
        'gaokao_review',
        'gaokao_topic_01',
        'breakthrough',
        4,
      );
    });
    expect(await screen.findByTestId('gaokao-question-session')).toHaveTextContent(
      '典型突破',
    );
  });

  it('starts a ten-question topic paper from the bottom card', async () => {
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);

    await screen.findByText('6 个知识板块 · 19 个专题');
    await user.click(await screen.findByRole('button', { name: '开始专题套卷' }));

    await waitFor(() => {
      expect(api.startLearningCatalogTopicSession).toHaveBeenCalledWith(
        'gaokao_review',
        'gaokao_topic_01',
        'paper',
        10,
      );
    });
    expect(await screen.findByTestId('gaokao-question-session')).toHaveTextContent(
      '专题套卷',
    );
    expect(screen.getByTestId('gaokao-question-session')).toHaveAttribute('data-collect', 'true');
    expect(screen.getByTestId('gaokao-question-session')).toHaveAttribute('data-deferred', 'true');
  });

  it('keeps a submitted answer when topic evidence synchronization fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.recordLearningCatalogTopicEvidence).mockRejectedValueOnce(
      new Error('专题证据同步失败'),
    );
    render(<GaokaoReviewPage />);

    await screen.findByText('6 个知识板块 · 19 个专题');
    await user.click(await screen.findByRole('button', { name: '进入专题摸底' }));
    await user.click(screen.getByRole('button', { name: '模拟提交专题答案' }));

    expect(api.submitAnswer).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('专题证据同步失败')).toBeInTheDocument();
  });

  it('resynchronizes evidence when an existing answer result changes', async () => {
    const user = userEvent.setup();
    render(<GaokaoReviewPage />);

    await screen.findByText('6 个知识板块 · 19 个专题');
    await user.click(await screen.findByRole('button', { name: '进入专题摸底' }));
    const submitButton = screen.getByRole('button', { name: '模拟提交专题答案' });
    await user.click(submitButton);
    await user.click(submitButton);

    await waitFor(() => {
      expect(api.recordLearningCatalogTopicEvidence).toHaveBeenCalledTimes(2);
    });
  });
});
