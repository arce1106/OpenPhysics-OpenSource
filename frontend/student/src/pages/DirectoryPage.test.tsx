import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DirectoryPage from './DirectoryPage';
import { api } from '../api/client';
import type { DirectoryData } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getDirectory: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
}));

const directoryData: DirectoryData = {
  kps: [
    {
      id: 'v1c1s1k01',
      name: '质点',
      volume: '必修 第一册',
      chapter: '第一章 运动的描述',
      section: '1.1 质点 参考系',
      mastery: 0.2,
      status: 'needs_learning',
      blocked_by: [],
      last_practiced: null,
    },
  ],
  stats: {
    mastered: 0,
    in_progress: 1,
    locked: 0,
    total: 1,
  },
  relations: [],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('DirectoryPage', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.mocked(api.getDirectory).mockResolvedValue(directoryData);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  const mockMobileViewport = () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  };

  it('returns from restored knowledge-point detail to the directory entry page', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/sync', state: { restoreKpId: 'v1c1s1k01' } }]}>
        <DirectoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /继续学习|开始学习|查看学习/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /掌握评估/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /返回/ }));

    expect(screen.getByText('本章推荐学习路径')).toBeInTheDocument();
  });

  it('opens mastery assessment through the unified check route instead of frontend-selected diagnostic mode', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/sync', state: { restoreKpId: 'v1c1s1k01' } }]}>
        <Routes>
          <Route path="/sync" element={<DirectoryPage />} />
          <Route path="/learn/check" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /掌握评估/ }));

    expect(screen.getByTestId('location')).toHaveTextContent('/learn/check?kp=v1c1s1k01&count=3&mode=check');
  });

  it('returns from a restored knowledge-point detail back to its chapter graph when that was the origin', async () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/sync',
          state: {
            restoreKpId: 'v1c1s1k01',
            restoreKpReturnSnapshot: {
              panel: 'scope_detail',
              scope: {
                type: 'chapter',
                id: '第一章 运动的描述',
                name: '第一章 运动的描述',
                kpIds: ['v1c1s1k01'],
              },
              chapterKey: '必修 第一册||第一章 运动的描述',
              sectionKey: null,
            },
          },
        }]}
      >
        <DirectoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('质点')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /继续学习|开始学习|查看学习/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /返回/ }));

    expect(screen.getByText('本章知识图谱')).toBeInTheDocument();
    expect(screen.queryByText('按教材章节选择知识点，先理解，再用小测确认掌握情况。')).not.toBeInTheDocument();
  });

  it('uses mobile browser back to return from chapter graph to the directory page', async () => {
    mockMobileViewport();

    render(
      <MemoryRouter initialEntries={[{ pathname: '/sync' }]}>
        <DirectoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('选择章节、知识图谱或知识点')).toBeInTheDocument();

    await userEvent.click(screen.getAllByText('第一章 运动的描述')[1]);

    expect(screen.getByText('本章知识图谱')).toBeInTheDocument();

    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(screen.getByText('选择章节、知识图谱或知识点')).toBeInTheDocument();
    });
  });
});
