import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DirectoryKpNode } from '../types';
import { api } from '../api/client';
import SyncPage from './SyncPage';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => ({ ...await vi.importActual('react-router-dom'), useNavigate: () => navigate }));
vi.mock('../api/studentIdentity', () => ({ getStudentId: () => 'demo',
  getStudentProfile: () => ({ id: 'demo', username: 'demo', display_name: '学生', status: 'active' }) }));
vi.mock('../api/client', () => ({ api: { getDirectory: vi.fn(), getKnowledgeMasteryJudgments: vi.fn() } }));
vi.mock('../components/learningPath', async () => ({ ...await vi.importActual('../components/learningPath'),
  ChapterKnowledgeGraph: ({ kps, onOpenKp }: { kps: DirectoryKpNode[]; onOpenKp: (id: string) => void }) =>
    <div>{kps.map(kp => <button key={kp.id} onClick={() => onOpenKp(kp.id)}>查看知识点：{kp.name}</button>)}</div> }));

const ready: DirectoryKpNode = { id: 'demo-ready', name: '质点', volume: '必修 第一册',
  chapter: '第一章 运动的描述', section: '1.1 质点 参考系', mastery: 0.8, status: 'mastered',
  learning_state: 'mastered', blocked_by: [], last_practiced: null, content_available: true, practice_available: true };
const pending: DirectoryKpNode = { id: 'demo-empty', name: '原子核组成', volume: '选择性必修 第三册',
  chapter: '第五章 原子核', section: '5.1 原子核的组成', mastery: 0, status: 'pending_content',
  learning_state: 'pending_content', learning_state_label: '内容待补充', learning_state_tone: 'locked',
  blocked_by: [], last_practiced: null, content_available: false, practice_available: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDirectory).mockResolvedValue({ kps: [ready, pending],
    stats: { mastered: 1, in_progress: 0, locked: 0, total: 2, pending_content: 1 }, relations: [] });
  vi.mocked(api.getKnowledgeMasteryJudgments).mockResolvedValue({ items: [] });
});

it('shows an empty textbook chapter without offering practice or requesting mastery judgments', async () => {
  render(<MemoryRouter><SyncPage /></MemoryRouter>);
  await screen.findByRole('button', { name: '必修 第一册' });
  await userEvent.click(screen.getByRole('button', { name: '必修 第一册' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '选择性必修 第三册' }));
  expect(await screen.findByText('本章目录已完整保留，学习内容和题目待补充。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看知识点：原子核组成' }));
  expect(screen.getByRole('heading', { name: '原子核组成' })).toBeInTheDocument();
  expect(screen.getByText('目录已保留，学习卡片和题目待部署者补充。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '开始学习' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '掌握评估' })).not.toBeInTheDocument();
  expect(screen.queryByText('掌握度 0%')).not.toBeInTheDocument();
  await waitFor(() => expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledTimes(1));
  expect(api.getKnowledgeMasteryJudgments).toHaveBeenCalledWith(['demo-ready'], 'demo');
  expect(navigate).not.toHaveBeenCalled();
});

it('keeps a card-only point readable while disabling the unavailable practice action', async () => {
  const cardOnly = { ...ready, mastery: 0, status: 'needs_learning' as const, learning_state: 'to_learn' as const,
    practice_available: false };
  vi.mocked(api.getDirectory).mockResolvedValue({ kps: [cardOnly],
    stats: { mastered: 0, in_progress: 1, locked: 0, total: 1 }, relations: [] });
  render(<MemoryRouter><SyncPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: '查看知识点：质点' }));
  expect(screen.getByRole('button', { name: '开始学习' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '练习待补充' })).toBeDisabled();
});
