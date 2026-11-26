import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LearningContentPane } from './LearningContentPane';

const answer = '(1)0.26；0.34；(2)0.16；(3)偏大，不变';
const imagePath = '/api/student/answer-images/test/answer.jpg?expires=2000000000&signature=test-signature';
const image = { id: 1, image_path: imagePath, description: '学生手写原图' };

describe('written answer review regressions', () => {
  it.each(['experiment', 'calculation', 'fill_blank'])('keeps %s history answer intact and shows its handwriting', (questionType) => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'history_records', records: [{
        id: 1, question_id: 'q-written', stem_text: '核对手写答案', question_type: questionType,
        given_answer: answer, is_correct: true, correct_answer: '标准答案',
        answer_images: [image], process_grading: { answer_image_paths: [imagePath] },
      }],
    }));
    fireEvent.click(screen.getByRole('button', { name: /核对手写答案/ }));
    const answerCard = screen.getByText('我的答案').closest('section')!;
    expect(within(answerCard).getByText(answer)).toBeInTheDocument();
    expect(within(answerCard).getByRole('img')).toHaveAttribute('src', imagePath);
    expect(within(answerCard).getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByText('().012346不偏变大；')).not.toBeInTheDocument();
  });

  it('keeps the original readonly text despite legacy selectedOptions and uses grading images', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'question_readonly',
      question: { id: 'q-written', question_type: 'experiment', stem_text: '只读复盘' },
      givenAnswer: answer, selectedOptions: ['(', ')', '.', '0', '1', '2', '3', '4', '6'],
      answerState: { submitted: true, correct: true, processGrading: { answer_image_paths: [imagePath] } },
    }));
    const answerCard = screen.getByText('我的答案').closest('section')!;
    expect(within(answerCard).getByText(answer)).toBeInTheDocument();
    expect(within(answerCard).getByRole('img')).toHaveAttribute('src', imagePath);
  });

  it('preserves written mistake answers and supports grading-only image evidence', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'review_mistake_detail', mistake: {
        answer_id: 1, question_id: 'q-written', question_type: 'experiment', stem_text: '错题复盘',
        given_answer: answer, correct_answer: '标准答案',
        process_grading: { answer_image_paths: [imagePath] },
      },
    }));
    const answerCard = screen.getByText('你的答案').closest('section')!;
    expect(within(answerCard).getByText(answer)).toBeInTheDocument();
    expect(within(answerCard).getByRole('img')).toHaveAttribute('src', imagePath);
  });

  it('uses recognized text instead of the native handwriting placeholder in readonly review', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'question_readonly',
      question: { id: 'q-handwriting', question_type: 'experiment', stem_text: '手写复盘' },
      givenAnswer: '[手写作答]',
      answerState: { submitted: true, correct: true, extractedAnswer: answer, processGrading: { answer_image_path: imagePath } },
    }));
    const answerCard = screen.getByText('我的答案').closest('section')!;
    expect(within(answerCard).getByText(answer)).toBeInTheDocument();
    expect(within(answerCard).getByRole('img')).toHaveAttribute('src', imagePath);
    expect(within(answerCard).queryByText('[手写作答]')).not.toBeInTheDocument();
  });

  it('shows an image-only history answer without claiming it is unanswered', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'history_records', records: [{
        id: 2, question_id: 'q-photo', question_type: 'calculation', stem_text: '图片作答',
        given_answer: '[手写作答]', is_correct: false,
        process_grading: { answer_crop_image_path: imagePath },
      }],
    }));
    fireEvent.click(screen.getByRole('button', { name: /图片作答/ }));
    const answerCard = screen.getByText('我的答案').closest('section')!;
    expect(within(answerCard).getByRole('img')).toHaveAttribute('src', imagePath);
    expect(within(answerCard).queryByText('未作答')).not.toBeInTheDocument();
    expect(within(answerCard).queryByText('[手写作答]')).not.toBeInTheDocument();
  });

  it('shows legacy page images on the practice result without stripping signed query parameters', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'practice_result',
      question: { id: 'q-written', question_type: 'experiment', stem_text: '本次结果' },
      givenAnswer: answer,
      answerState: { correct: true, extractedAnswer: answer, processGrading: { answer_page_image_paths: [imagePath, imagePath] } },
    }));
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('src', imagePath);
    expect(screen.getByText(answer)).toBeInTheDocument();
  });

  it('continues to normalize multiple-choice letters', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'history_records', records: [{
        id: 3, question_id: 'q-choice', question_type: 'multiple_choice', stem_text: '选择题复盘',
        options: [{ label: 'A', text: '甲' }, { label: 'C', text: '丙' }],
        given_answer: 'C,A,A', correct_answer: 'AC', is_correct: true,
      }],
    }));
    fireEvent.click(screen.getByRole('button', { name: /选择题复盘/ }));
    const answerCard = screen.getByText('我的答案').closest('section')!;
    expect(within(answerCard).getByText('AC')).toBeInTheDocument();
  });
});
