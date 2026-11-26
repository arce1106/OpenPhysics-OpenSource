import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PrintableQuestionSet from './PrintableQuestionSet';
import type { Question } from '../types';

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    stem_text: '观察下图回答问题',
    question_type: 'problem_solving',
    options: [],
    images: [],
    ...overrides,
  };
}

describe('PrintableQuestionSet', () => {
  it('marks single-image and multi-image question blocks for print sizing', () => {
    const { container } = render(
      <PrintableQuestionSet
        title="知识小测"
        questions={[
          makeQuestion({
            id: 'q_single',
            images: [
              { id: 'img1', image_path: '/a.png', image_type: 'stem', description: null },
            ],
          }),
          makeQuestion({
            id: 'q_multi',
            images: [
              { id: 'img2', image_path: '/b.png', image_type: 'stem', description: null },
              { id: 'img3', image_path: '/c.png', image_type: 'stem', description: null },
            ],
          }),
        ]}
      />,
    );

    const imageBlocks = container.querySelectorAll('.print-question-images');

    expect(imageBlocks[0]).toHaveClass('print-question-images-single');
    expect(imageBlocks[1]).toHaveClass('print-question-images-multiple');
  });

  it('uses round option markers for single choice and square markers for multiple choice in print', () => {
    const { container } = render(
      <PrintableQuestionSet
        title="知识小测"
        questions={[
          makeQuestion({
            id: 'q_single_choice',
            question_type: 'single_choice',
            options: [{ label: 'A', text: '选项A' }],
          }),
          makeQuestion({
            id: 'q_multiple_choice',
            question_type: 'multiple_choice',
            options: [{ label: 'B', text: '选项B' }],
          }),
        ]}
      />,
    );

    const optionLabels = container.querySelectorAll('.print-option-label');

    expect(optionLabels[0]).toHaveClass('print-option-label-single');
    expect(optionLabels[1]).toHaveClass('print-option-label-multiple');
  });

  it('marks option placeholder images with a dedicated print sizing class', () => {
    const { container } = render(
      <PrintableQuestionSet
        title="知识小测"
        questions={[
          makeQuestion({
            id: 'q_option_image',
            question_type: 'single_choice',
            stem_text: '选择正确图像',
            options: [{ label: 'A', text: '{{IMG:0}}' }],
            images: [
              { id: 'img_option_a', image_path: '/option-a.png', image_type: 'option', description: null },
            ],
          }),
        ]}
      />,
    );

    const optionImage = container.querySelector('.print-option img');

    expect(optionImage).toHaveClass('print-option-image');
  });

  it('prints stored student answer images instead of an empty answer box', () => {
    const { container } = render(
      <PrintableQuestionSet
        title="错题本"
        questions={[
          makeQuestion({
            id: 'q_with_answer_image',
            stem_text: '解答题题干',
            question_type: 'problem_solving',
            answer_image_paths: ['/uploads/student-answer.png'],
          }),
        ]}
      />,
    );

    const answerImage = container.querySelector('.print-student-answer-image');

    expect(answerImage).toHaveAttribute('src', '/uploads/student-answer.png');
    expect(container.querySelector('.print-answer-box')).not.toBeInTheDocument();
  });

  it('preloads all image assets used by the print sheet', () => {
    const createdImages: Array<{ src: string }> = [];
    const OriginalImage = window.Image;
    vi.stubGlobal('Image', class {
      private _src = '';

      constructor() {
        createdImages.push(this);
      }

      set src(value: string) {
        this._src = value;
      }

      get src() {
        return this._src;
      }
    });

    try {
      render(
        <PrintableQuestionSet
          title="错题本"
          questions={[
            makeQuestion({
              id: 'q_inline_image',
              stem_text: '题干图 {{IMG:0}}',
              images: [
                { id: 'img_inline', image_path: '/static/questions/inline.png', image_type: 'stem', description: null },
              ],
              answer_image_paths: ['/static/uploads/answers/answer-1.png'],
            }),
            makeQuestion({
              id: 'q_attached_image',
              stem_text: '无占位题图',
              images: [
                { id: 'img_attached', image_path: '/static/questions/attached.png', image_type: 'stem', description: null },
              ],
            }),
          ]}
        />,
      );

      expect(createdImages.map(image => image.src)).toEqual([
        '/static/questions/inline.png',
        '/static/uploads/answers/answer-1.png',
        '/static/questions/attached.png',
      ]);
    } finally {
      vi.stubGlobal('Image', OriginalImage);
    }
  });
});
