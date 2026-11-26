import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { KpWithStats, TeachingInsights } from '../types';
import TeachingDashboardPage from './TeachingDashboardPage';

const INSIGHTS: TeachingInsights = {
  scope: { class_id: null, include_internal: false, active_days: 7, mistake_days: 30 },
  summary: { student_count: 60, active_students: 41, to_correct: 120, weak_point_count: 1, suspect_questions: 1 },
  weak_points: [{ kp_id: 'kp_ref', kp_name: '参考系', volume: '必修一', chapter: '第一章 运动的描述', section: '1.1 质点 参考系',
    weak_students: 14, evidence_students: 40, avg_mastery: 0.41, wrong_recent: 13, video_count: 0 }],
  hot_mistakes: [{ question_id: 'q_1', stem_preview: '关于参考系，下列说法正确的是', kp_id: 'kp_ref', kp_name: '参考系',
    answers: 12, wrong: 11, wrong_students: 11, wrong_rate: 0.92, main_cause: '概念理解错误', suspect: true }],
  classes: [{ id: 'c_1', name: '高三（3）', teacher_name: '王老师' }],
};

describe('TeachingDashboardPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows weak knowledge points with their content, questions that go wrong, and opens a point in the resources', async () => {
    const load = vi.spyOn(api, 'getTeachingInsights').mockResolvedValue(INSIGHTS);
    const openKp = vi.fn();
    render(<MemoryRouter initialEntries={['/teaching']}><Routes>
      <Route path="/teaching" element={<TeachingDashboardPage kps={[{ id: 'kp_ref', question_count: 6 } as KpWithStats]} onOpenKp={openKp} />} />
      <Route path="/resources" element={<div>教学资源页</div>} />
    </Routes></MemoryRouter>);

    expect(await screen.findByText('参考系')).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ classId: undefined, includeInternal: false });
    expect(screen.getByText('6 道题')).toBeInTheDocument();
    expect(screen.getByText('无视频')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '高频错题' }));
    expect(screen.getByText('错误率异常')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开题目' })).toHaveAttribute('href', '/resources?tab=questions&q=q_1');

    await userEvent.selectOptions(screen.getByLabelText('统计范围'), 'c_1');
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ classId: 'c_1', includeInternal: false }));

    await userEvent.click(screen.getByRole('tab', { name: '薄弱知识点' }));
    await userEvent.click(screen.getByRole('button', { name: '补讲解' }));
    expect(openKp).toHaveBeenCalledWith('kp_ref');
    expect(await screen.findByText('教学资源页')).toBeInTheDocument();
  });
});
