import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QuestionTutorChat from './QuestionTutorChat';

const apiMocks = vi.hoisted(() => ({
  questionTutorChat: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: apiMocks,
}));

describe('QuestionTutorChat', () => {
  it('summons a floating current-question tutor and sends grading context', async () => {
    apiMocks.questionTutorChat.mockResolvedValueOnce({ text: '先看第一处错误：这里应判断是否为自由落体模型。' });

    render(
      <QuestionTutorChat
        questionId="q1"
        givenAnswer="$2g$"
        processGrading={{
          first_error: '把自由落体加速度误认为 $2g$',
          error_type_name: '模型识别错误',
        }}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'AI助教 · 本题' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));

    const dialog = screen.getByRole('dialog', { name: 'AI助教 · 本题' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI助教' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我第一步错在哪？' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('输入对这道题的追问'), '为什么不是2g？');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(apiMocks.questionTutorChat).toHaveBeenCalledWith({
      question_id: 'q1',
      given_answer: '$2g$',
      message: '为什么不是2g？',
      history: [],
      process_grading: {
        first_error: '把自由落体加速度误认为 $2g$',
        error_type_name: '模型识别错误',
      },
    });
    expect(await screen.findByText('先看第一处错误：这里应判断是否为自由落体模型。')).toBeInTheDocument();
  });

  it('only closes from the close button and can be summoned again', async () => {
    render(
      <QuestionTutorChat
        questionId="q1"
        givenAnswer=""
        processGrading={null}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));
    const dialog = screen.getByRole('dialog', { name: 'AI助教 · 本题' });
    expect(dialog).toBeInTheDocument();

    await userEvent.dblClick(screen.getByRole('heading', { name: 'AI助教' }));
    expect(screen.getByRole('dialog', { name: 'AI助教 · 本题' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));
    expect(screen.getByRole('dialog', { name: 'AI助教 · 本题' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭AI助教' }));
    expect(screen.queryByRole('dialog', { name: 'AI助教 · 本题' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));
    expect(screen.getByRole('dialog', { name: 'AI助教 · 本题' })).toBeInTheDocument();
  });

  it('lets the floating tutor actions be dragged without opening the tutor', () => {
    render(
      <QuestionTutorChat
        questionId="q1"
        givenAnswer=""
        processGrading={null}
        sideActions={<button type="button" className="question-tutor-side-action">变式题</button>}
      />,
    );

    const assistant = screen.getByRole('button', { name: '打开AI助教' }).closest('.question-tutor-assistant');
    expect(assistant).not.toBeNull();
    Object.defineProperty(assistant, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 120,
        top: 180,
        width: 88,
        height: 160,
        right: 208,
        bottom: 340,
        x: 120,
        y: 180,
        toJSON: () => {},
      }),
    });

    fireEvent.pointerDown(assistant!, { pointerId: 7, button: 0, clientX: 150, clientY: 210 });
    fireEvent.pointerMove(assistant!, { pointerId: 7, clientX: 190, clientY: 260 });
    fireEvent.click(screen.getByRole('button', { name: '打开AI助教' }));
    fireEvent.pointerUp(assistant!, { pointerId: 7, clientX: 190, clientY: 260 });

    expect(assistant).toHaveStyle({ left: '160px', top: '230px', right: 'auto' });
    expect(screen.queryByRole('dialog', { name: 'AI助教 · 本题' })).not.toBeInTheDocument();
  });

  it('does not capture ordinary clicks on the floating tutor actions as drags', async () => {
    const setPointerCapture = vi.fn();
    const onVariant = vi.fn();
    render(
      <QuestionTutorChat
        questionId="q1"
        givenAnswer=""
        processGrading={null}
        sideActions={<button type="button" className="question-tutor-side-action" onClick={onVariant}>变式题</button>}
      />,
    );

    const assistant = screen.getByRole('button', { name: '打开AI助教' }).closest('.question-tutor-assistant')!;
    Object.defineProperty(assistant, 'setPointerCapture', { configurable: true, value: setPointerCapture });

    fireEvent.pointerDown(screen.getByRole('button', { name: '打开AI助教' }), { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(screen.getByRole('button', { name: '打开AI助教' }), { pointerId: 2, clientX: 100, clientY: 100 });
    await userEvent.click(screen.getByRole('button', { name: '打开AI助教' }));

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'AI助教 · 本题' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '关闭AI助教' }));

    await userEvent.click(screen.getByRole('button', { name: '变式题' }));
    expect(onVariant).toHaveBeenCalledTimes(1);
  });
});
