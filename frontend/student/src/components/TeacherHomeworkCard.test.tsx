import { expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TeacherHomeworkTasks from './TeacherHomeworkCard';
import type { TeacherHomework } from '../types';

const homework = (attempt_id: string, title: string, status: TeacherHomework['status'], extra: Partial<TeacherHomework> = {}): TeacherHomework => ({
  attempt_id, assignment_id: `a_${attempt_id}`, title, class_name: '高一(3)班',
  question_count: 6, graded_count: 0, status, published_at: null, ...extra,
});

const show = (items: TeacherHomework[]) => render(<MemoryRouter><TeacherHomeworkTasks items={items} /></MemoryRouter>);

test('shows the newest unfinished homework and folds the others', () => {
  show([
    homework('att_0', '第四周作业', 'completed'),
    homework('att_1', '第三周作业', 'in_progress'),
    homework('att_2', '第二周作业', 'grading', { graded_count: 4 }),
  ]);
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['去作答']);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/homework/att_1');
  expect(screen.queryByText('第四周作业')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '还有 1 份作业待完成' }));
  expect(screen.getByText('高一(3)班 · 已批改 4/6')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
});

test('with everything finished shows only the newest, with its score', () => {
  show([
    homework('att_0', '运动学', 'completed', { score_percent: 85 }),
    homework('att_1', '测试2', 'completed', { score_percent: 70 }),
    homework('att_2', '测试', 'completed'),
  ]);
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['查看结果']);
  expect(screen.getByText('高一(3)班 · 6 题 · 85 分')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('says finished when a completed homework has no score', () => {
  show([homework('att_0', '测试', 'completed')]);
  expect(screen.getByText('高一(3)班 · 6 题 · 已完成')).toBeInTheDocument();
});

test('shows nothing without homework', () => {
  const { container } = show([]);
  expect(container).toBeEmptyDOMElement();
});
