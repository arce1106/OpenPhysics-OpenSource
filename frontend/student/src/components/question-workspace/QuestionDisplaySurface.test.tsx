import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QuestionDisplaySurface from './QuestionDisplaySurface';
import type { Question } from '../../types';

const question: Question = {
  id: 'q-web-surface',
  stem_text: '如图，速度满足 $v=at$。{{IMG:0}}',
  question_type: 'multiple_choice',
  options: [
    { label: 'A', text: '$v$ 变大' },
    { label: 'B', text: '$v$ 不变' },
  ],
  images: [
    {
      id: 'img-1',
      image_path: '/static/questions/demo.png',
      image_type: 'stem',
      description: '速度图像',
    },
  ],
};

describe('QuestionDisplaySurface', () => {
  it('renders a complete question through the shared workspace surface', () => {
    render(
      <QuestionDisplaySurface
        question={question}
        selected="A"
        isDone={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/如图/)).toBeInTheDocument();
    expect(screen.getByAltText('题目附图')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('keeps history and review question display read-only', async () => {
    const onSelect = vi.fn();

    render(
      <QuestionDisplaySurface
        question={question}
        selected="A"
        isDone
        readOnly
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交答案' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('B'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
