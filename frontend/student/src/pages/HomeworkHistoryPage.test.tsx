import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import HomeworkHistoryPage from './HomeworkHistoryPage';
import { api } from '../api/client';
import type { TeacherHomework } from '../types';

vi.mock('../api/client', () => ({ api: { listTeacherHomework: vi.fn() } }));

const homework = (attempt_id: string, title: string, extra: Partial<TeacherHomework>): TeacherHomework => ({
  attempt_id, assignment_id: `a_${attempt_id}`, title, class_name: '高三（3）',
  question_count: 7, graded_count: 0, status: 'completed', published_at: '2026-11-01T08:00:00+00:00', ...extra,
});

function Attempt() {
  const location = useLocation();
  return <div>答卷来自 {(location.state as { from?: string }).from}</div>;
}

const show = () => render(
  <MemoryRouter initialEntries={['/homework']}>
    <Routes>
      <Route path="/homework" element={<HomeworkHistoryPage />} />
      <Route path="/homework/:attemptId" element={<Attempt />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => vi.mocked(api.listTeacherHomework).mockReset());

test('lists every homework with its score, standing and the mean', async () => {
  vi.mocked(api.listTeacherHomework).mockResolvedValue([
    homework('a', '运动学', { score_percent: 90, results_released: true }),
    homework('b', '测试2', { score_percent: 75 }),
    homework('c', '纸质卷', { delivery: 'paper', score_percent: null }),
    homework('d', '测试', { status: 'grading', graded_count: 3 }),
    homework('e', '力学', { status: 'in_progress' }),
  ]);
  show();

  expect(await screen.findByText('运动学')).toBeInTheDocument();
  expect(api.listTeacherHomework).toHaveBeenCalledWith({ history: true });
  expect(screen.getByText('90 分')).toHaveClass('is-scored');
  expect(screen.getByText('老师已审核')).toBeInTheDocument();
  expect(screen.getByText('AI 批改，老师审核后可能调整')).toBeInTheDocument();
  expect(screen.getByText('高三（3） · 纸质作业 · 布置于 2026-11-01')).toBeInTheDocument();
  expect(screen.getByText('已完成')).not.toHaveClass('is-scored');
  expect(screen.getByText('已批改 3/7')).toBeInTheDocument();
  expect(screen.getByText('未完成')).toBeInTheDocument();
  expect(screen.getByText('5').parentElement).toHaveTextContent('份作业');
  expect(screen.getByText('83').parentElement).toHaveTextContent('平均分');
});

test('opens a homework remembering it came from the records', async () => {
  vi.mocked(api.listTeacherHomework).mockResolvedValue([homework('a', '运动学', { score_percent: 90 })]);
  show();

  fireEvent.click(await screen.findByRole('link', { name: /运动学/ }));
  expect(await screen.findByText('答卷来自 /homework')).toBeInTheDocument();
});

test('explains an empty list and offers a retry after a failure', async () => {
  vi.mocked(api.listTeacherHomework).mockRejectedValueOnce(new Error('网络异常')).mockResolvedValue([]);
  show();

  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  expect(await screen.findByText('还没有老师作业')).toBeInTheDocument();
  expect(screen.queryByText('平均分')).not.toBeInTheDocument();
});
