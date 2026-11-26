import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { DirectoryData, KnowledgeMasteryJudgment, StudentProfile } from '../types';
import SyncPage from './SyncPage';

const authState = vi.hoisted(() => ({
  profile: {
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',


  } as StudentProfile,
}));

vi.mock('../api/client', () => ({
  api: {
    getDirectory: vi.fn(),
    getKnowledgeMasteryJudgments: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  getStudentProfile: () => authState.profile,
}));

vi.mock('../components/learningPath', async () => {
  const actual = await vi.importActual<typeof import('../components/learningPath')>('../components/learningPath');
  return {
    ...actual,
    ChapterKnowledgeGraph: () => <div data-testid="chapter-graph" />,
  };
});

const directory: DirectoryData = {
  kps: [
    {
      id: 'v1-kp',
      name: '质点',
      volume: '必修 第一册',
      chapter: '第一章 运动的描述',
      section: '1.1 质点 参考系',
      mastery: 0.9,
      status: 'mastered',
      learning_state: 'mastered',
      learning_state_label: '已掌握',
      learning_state_tone: 'mastered',
      blocked_by: [],
      last_practiced: '2026-06-01T00:00:00Z',
    },
    {
      id: 'elective-kp',
      name: '安培力作用下导体棒平衡',
      volume: '选择性必修 第二册',
      chapter: '第一章 安培力与洛伦兹力',
      section: '1.1 磁场对通电导线的作用力',
      mastery: 0,
      status: 'needs_learning',
      learning_state: 'to_learn',
      learning_state_label: '未开始',
      learning_state_tone: 'learning',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 1,
    in_progress: 1,
    locked: 0,
    total: 2,
  },
  relations: [],
};

const twoChapterDirectory: DirectoryData = {
  ...directory,
  kps: [
    directory.kps[0],
    {
      id: 'v1-kp-2',
      name: '速度',
      volume: '必修 第一册',
      chapter: '第二章 匀变速直线运动',
      section: '2.1 速度变化规律',
      mastery: 0.12,
      status: 'needs_learning',
      learning_state: 'to_learn',
      learning_state_label: '未开始',
      learning_state_tone: 'learning',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 1,
    in_progress: 1,
    locked: 0,
    total: 2,
  },
};

function makeJudgment(overrides: Partial<KnowledgeMasteryJudgment>): KnowledgeMasteryJudgment {
  return {
    kpId: 'v1-kp',
    kpName: '质点',
    masteryScore: 0.2,
    masteryLevel: 'weak',
    interventionStatus: 'needs_learning',
    confidence: 'high',
    nextAction: 'learn',
    reason: '当前基础证据较弱，建议先学习知识点讲解。',
    evidenceSources: [],
    evidences: [],
    recentCorrectCount: 0,
    recentTotalCount: 0,
    ...overrides,
  };
}

describe('SyncPage restore navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.profile = {
      id: 'student-1',
      username: 'student',
      display_name: '学生',
      status: 'active',


    } as StudentProfile;
    vi.mocked(api.getDirectory).mockResolvedValue(directory);
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({ items: [] });
  });

  it('restores the selected volume, chapter, and knowledge point from return state', async () => {
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'elective-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('安培力作用下导体棒平衡')).toBeInTheDocument();
    expect(screen.getByText('选择性必修 第二册 / 第一章 安培力与洛伦兹力')).toBeInTheDocument();
    expect(screen.queryByText('必修 第一册 / 第一章 运动的描述')).not.toBeInTheDocument();
  });

  it('loads mastery judgments for the selected chapter first and renders weak learning guidance', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'elective-kp',
          kpName: '安培力作用下导体棒平衡',
          masteryScore: 0.18,
          masteryLevel: 'weak',
          interventionStatus: 'needs_learning',
          nextAction: 'learn',
          reason: '当前基础证据较弱，建议先学习知识点讲解。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'elective-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('安培力作用下导体棒平衡')).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(
        ['elective-kp'],
        'student-1',
      );
    });
    expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('薄弱')).toBeInTheDocument();
    expect(screen.getByText('当前基础证据较弱，建议先学习知识点讲解。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始学习' })).toBeInTheDocument();
  });

  it('loads missing judgments when switching chapters and reuses cached chapter judgments', async () => {
    vi.mocked(api.getDirectory).mockResolvedValue(twoChapterDirectory);
    vi.mocked(api.getKnowledgeMasteryJudgments).mockImplementation(async (kpIds: string[]) => ({
      items: kpIds.map(kpId => makeJudgment({
        kpId,
        kpName: kpId === 'v1-kp-2' ? '速度' : '质点',
        masteryScore: kpId === 'v1-kp-2' ? 0.12 : 0.9,
        masteryLevel: kpId === 'v1-kp-2' ? 'weak' : 'mastered',
        interventionStatus: kpId === 'v1-kp-2' ? 'needs_learning' : 'passed_recently',
        nextAction: kpId === 'v1-kp-2' ? 'learn' : 'maintain',
      })),
    }));

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(['v1-kp'], 'student-1');
    });

    const clickChapter = async (chapterName: string) => {
      const chapterButton = screen.getAllByText(chapterName)
        .map(element => element.closest('button'))
        .find((button): button is HTMLButtonElement => Boolean(button));
      if (!chapterButton) throw new Error(`Chapter button not found: ${chapterName}`);
      await userEvent.click(chapterButton);
    };

    await userEvent.click(screen.getByRole('button', { name: '返回目录' }));
    await clickChapter('第二章 匀变速直线运动');
    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(['v1-kp-2'], 'student-1');
    });

    await clickChapter('第一章 运动的描述');
    await waitFor(() => {
      expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledTimes(2);
    });
  });

  it('renders practice guidance from mastery judgment', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'v1-kp',
          masteryScore: 0.52,
          masteryLevel: 'developing',
          interventionStatus: 'needs_practice',
          nextAction: 'practice',
          reason: '已有一定基础，建议练习巩固。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('发展中')).toBeInTheDocument();
    expect(screen.getByText('已有一定基础，建议通过巩固小练继续熟悉。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '巩固小练' })).toBeInTheDocument();
  });

  it('renders in-improvement mastery as display only without replacing the sync practice CTA', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'v1-kp',
          masteryScore: 0.48,
          masteryLevel: 'developing',
          interventionStatus: 'in_improvement',
          nextAction: 'continue_improvement',
          reason: '该知识点已进入巩固提升路径，请继续完成提升任务。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('发展中')).toBeInTheDocument();
    expect(screen.getByText('已有一定基础，建议通过巩固小练继续熟悉。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '巩固小练' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续提升' })).not.toBeInTheDocument();
  });

  it('renders retest mastery as display only without replacing the sync practice CTA', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'v1-kp',
          masteryScore: 0.72,
          masteryLevel: 'stable',
          interventionStatus: 'awaiting_retest',
          nextAction: 'retest',
          reason: '该知识点已完成阶段练习，建议通过复测确认是否掌握。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('较稳定')).toBeInTheDocument();
    expect(screen.getByText('当前掌握较稳定，可以通过巩固小练保持手感。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '巩固小练' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去复测' })).not.toBeInTheDocument();
  });

  it('renders low-confidence weak judgment as limited evidence in the kp panel', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'v1-kp',
          masteryScore: 0.18,
          masteryLevel: 'weak',
          interventionStatus: 'needs_learning',
          confidence: 'low',
          nextAction: 'learn',
          reason: '后端理由不应直接放大薄弱。',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('证据较少')).toBeInTheDocument();
    expect(screen.getByText('当前证据较少，建议先学习或完成掌握评估。')).toBeInTheDocument();
    expect(screen.queryByText('薄弱')).not.toBeInTheDocument();
  });

  it('keeps the original sync entry usable when mastery judgment loading fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.getKnowledgeMasteryJudgments).mockRejectedValue(new Error('judgment api down'));

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();
    expect(screen.getAllByText('已掌握').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '巩固小练' })).toBeInTheDocument();
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
  });

  it('falls back to the original sync labels when a knowledge point has no judgment', async () => {
    vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({
      items: [
        makeJudgment({
          kpId: 'elective-kp',
          kpName: '安培力作用下导体棒平衡',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/sync',
        state: { restoreKpId: 'v1-kp' },
      }]}
      >
        <SyncPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();
    expect(screen.getAllByText('已掌握').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '巩固小练' })).toBeInTheDocument();
  });
});
