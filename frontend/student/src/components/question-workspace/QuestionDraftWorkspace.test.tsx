import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import QuestionDraftWorkspace from './QuestionDraftWorkspace';
import type { Question } from '../../types';

vi.mock('../HandwritingPad', () => ({
  default: ({
    footerLeadingActions,
    footerActions,
  }: {
    footerLeadingActions?: ReactNode;
    footerActions?: ReactNode;
  }) => (
    <div className="handwriting-pad" data-handwriting-engine="shared-web">
      <div className="handwriting-pad__footer">
        {footerLeadingActions && (
          <div className="handwriting-pad__footer-leading">{footerLeadingActions}</div>
        )}
        <div className="handwriting-pad__footer-trailing">
          <button type="button">提交手写答案</button>
          {footerActions}
        </div>
      </div>
    </div>
  ),
}));

vi.mock('../PhotoUpload', () => ({
  default: () => <div>照片上传区</div>,
}));

function makeQuestion(): Question {
  return {
    id: 'q1',
    stem_text: '解答题',
    question_type: 'problem_solving',
    options: [],
    images: [],
  };
}

describe('QuestionDraftWorkspace', () => {
  it('places handwriting submit and paper-photo upload entry in the same action row', () => {
    const { container } = render(
      <QuestionDraftWorkspace
        question={makeQuestion()}
        disabled={false}
        submitting={false}
        isDone={false}
        showPhotoUpload
        showPhotoFallback={false}
        onTogglePhotoFallback={vi.fn()}
      />,
    );

    const footer = container.querySelector('.handwriting-pad__footer');
    const trailing = container.querySelector('.handwriting-pad__footer-trailing');

    expect(footer).toContainElement(screen.getByRole('button', { name: '提交手写答案' }));
    expect(footer).toContainElement(screen.getByRole('button', { name: '拍照上传纸面解答' }));
    expect(trailing).toContainElement(screen.getByRole('button', { name: '提交手写答案' }));
    expect(trailing).toContainElement(screen.getByRole('button', { name: '拍照上传纸面解答' }));
  });

  it('keeps the shared web handwriting canvas inside the Capacitor shell', () => {
    window.Capacitor = { Plugins: {} };

    try {
      const { container } = render(
        <QuestionDraftWorkspace
          question={makeQuestion()}
          disabled={false}
          submitting={false}
          isDone={false}
          deferredGrading
          showPhotoUpload
          showPhotoFallback={false}
          onTogglePhotoFallback={vi.fn()}
        />,
      );

      expect(container.querySelector('[data-handwriting-engine="shared-web"]')).toBeInTheDocument();
      expect(container.querySelector('.native-handwriting-anchor')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '原生手写' })).not.toBeInTheDocument();
    } finally {
      delete window.Capacitor;
    }
  });
});
