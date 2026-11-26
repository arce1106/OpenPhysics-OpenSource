import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { LearningContentPane } from './LearningContentPane';

describe('LearningContentPane', () => {
  it('shows original rubric points together with their percentage', async () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'review_mistake_detail',
      mistake: { answer_id: 1, question_id: 'qa-score', stem_text: '热学计算题',
        question_type: 'problem_solving', given_answer: '答案', correct_answer: '答案',
        process_grading: { score: 8, max_score: 8, process_score: 100 } },
    }));
    expect(await screen.findByText('8/8 分 · 折合 100/100')).toBeInTheDocument();
  });

  const onOpenImage = vi.fn();
  const onPaneReady = vi.fn();
  const onPayloadRendered = vi.fn();
  const onHeightChanged = vi.fn();
  const onOpenReview = vi.fn();
  const onOpenLessonVideo = vi.fn();
  const onOptionSelected = vi.fn();
  const onCorrectGrading = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.OpenPhysicsBridge = {
      onOpenImage,
      onPaneReady,
      onPayloadRendered,
      onHeightChanged,
      onOpenReview,
      onOpenLessonVideo,
      onOptionSelected,
      onCorrectGrading,
    };
  });

  it('renders native tutor replies with inline formulas as streaming text changes', async () => {
    render(<LearningContentPane />);
    const reply = (text: string) => ({
      mode: 'knowledge_card', presentation: 'phone', textScale: 1,
      sections: [{ type: 'text', text }],
    });
    act(() => window.OpenPhysicsPane?.setPayload(reply(String.raw`先回忆 $x=v_0t+\frac{1}{2}at^2$。`)));
    expect(document.querySelectorAll('.katex')).toHaveLength(1);
    act(() => window.OpenPhysicsPane?.setPayload(reply(String.raw`先回忆公式：$x=v_0t+\frac{1}{2}at^2$。
题目给出 $x=4t-2t^2$，所以 $\frac{1}{2}a=-2$。`)));
    expect(document.querySelectorAll('.katex')).toHaveLength(3);
    expect(document.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(document.querySelector('.op-pane-rich')?.textContent).toContain('题目给出');
    await waitFor(() => expect(onHeightChanged).toHaveBeenCalled());
  });

  it.each([
    { interactionLocked: true },
    { learningState: { submissionStatus: 'submitting' } },
  ])('locks selections while submitting without revealing the solution (%j)', (lock) => {
    render(<StrictMode><LearningContentPane /></StrictMode>);
    const payload = {
      mode: 'question_interactive',
      question: {
        id: 'q-submitting', question_type: 'single_choice', stem_text: '选择正确选项',
        correct_answer: 'PRIVATE_ANSWER', explanation: 'PRIVATE_EXPLANATION',
        options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }],
      },
      selectedOptions: ['A'],
    };
    act(() => window.OpenPhysicsPane?.setPayload({ ...payload, ...lock }));
    const optionB = screen.getByRole('button', { name: /B\s*乙/ });
    expect(optionB).toBeDisabled();
    fireEvent.click(optionB);
    expect(onOptionSelected).not.toHaveBeenCalled();
    expect(screen.queryByText('PRIVATE_ANSWER')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE_EXPLANATION')).not.toBeInTheDocument();

    act(() => window.OpenPhysicsPane?.setPayload(payload));
    fireEvent.click(screen.getByRole('button', { name: /B\s*乙/ }));
    expect(onOptionSelected).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onOptionSelected.mock.calls[0][0])).toMatchObject({ questionId: 'q-submitting', answer: 'B' });
  });

  it('phone question uses one native counter and retains choice events, lock and legacy reset', () => {
    render(<LearningContentPane />);
    const question = {
      id: 'phone-choice', question_type: 'single_choice', stem_text: '选择正确选项',
      correct_answer: 'PRIVATE_ANSWER', explanation: 'PRIVATE_EXPLANATION',
      options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }],
    };
    const payload = { mode: 'question_interactive', question, index: 1, total: 2, selectedOptions: [] };
    act(() => window.OpenPhysicsPane?.setPayload({ ...payload, presentation: 'phone', textScale: 1.3 }));
    expect(screen.queryByText('第 2/2 题')).not.toBeInTheDocument();
    expect(document.querySelector('.op-pane-question-header')).not.toBeInTheDocument();
    expect(document.querySelector('main')).toHaveClass('op-pane-phone');
    fireEvent.click(screen.getByRole('button', { name: /B\s*乙/ }));
    expect(JSON.parse(onOptionSelected.mock.calls[0][0])).toMatchObject({ questionId: 'phone-choice', answer: 'B' });
    expect(screen.queryByText('PRIVATE_ANSWER')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE_EXPLANATION')).not.toBeInTheDocument();
    act(() => window.OpenPhysicsPane?.setPayload({ ...payload, presentation: 'phone', interactionLocked: true }));
    expect(screen.getByRole('button', { name: /B\s*乙/ })).toBeDisabled();
    act(() => window.OpenPhysicsPane?.setPayload(payload));
    expect(screen.getByText('第 2/2 题')).toBeInTheDocument();
    expect(document.querySelector('.op-pane-question-header')).toBeInTheDocument();
    expect(document.querySelector('main')).not.toHaveClass('op-pane-phone');
  });

  it('clears the previous choice button focus when the phone switches questions', () => {
    render(<LearningContentPane />);
    const question = (id: string) => ({
      id, question_type: 'single_choice', stem_text: `题目 ${id}`,
      options: [
        { label: 'A', text: '甲' },
        { label: 'B', text: '乙' },
        { label: 'C', text: '丙' },
      ],
    });
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'question_interactive', question: question('first'),
      index: 0, total: 2, selectedOptions: [], presentation: 'phone',
    }));
    const firstC = screen.getByRole('button', { name: /C\s*丙/ });
    fireEvent.click(firstC);
    firstC.focus();
    expect(firstC).toHaveClass('selected');
    expect(firstC).toHaveFocus();

    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'question_interactive', question: question('second'),
      index: 1, total: 2, selectedOptions: [], presentation: 'phone',
    }));
    const secondC = screen.getByRole('button', { name: /C\s*丙/ });
    expect(secondC).not.toBe(firstC);
    expect(secondC).not.toHaveClass('selected');
    expect(secondC).not.toHaveFocus();
    expect(secondC).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens phone question images by tap or keyboard without changing tablet image behavior', () => {
    render(<LearningContentPane />);
    const payload = { mode: 'question_interactive', question: {
      id: 'diagram', question_type: 'problem_solving', stem_text: '根据图像作答',
      images: [{ id: 1, image_path: 'https://example.com/diagram.png', image_type: 'stem', description: '运动图像' }],
    } };
    act(() => window.OpenPhysicsPane?.setPayload({ ...payload, presentation: 'phone' }));
    const image = screen.getByRole('button', { name: '运动图像，查看大图' });
    fireEvent.click(image);
    expect(JSON.parse(onOpenImage.mock.calls[0][0])).toEqual({ src: 'https://example.com/diagram.png', questionId: 'diagram' });
    fireEvent.keyDown(image, { key: 'Enter' });
    expect(onOpenImage).toHaveBeenCalledTimes(2);
    act(() => window.OpenPhysicsPane?.setPayload(payload));
    expect(screen.getByAltText('运动图像')).not.toHaveAttribute('tabindex');
    fireEvent.click(screen.getByAltText('运动图像'));
    expect(onOpenImage).toHaveBeenCalledTimes(2);
  });

  it('stays visually empty before payload and announces runtime readiness', async () => {
    render(<LearningContentPane />);

    expect(screen.queryByText('OpenPhysics Learning Content Pane')).not.toBeInTheDocument();
    expect(document.querySelector('.op-pane-root')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(onPaneReady).toHaveBeenCalledTimes(1));
    expect(onPayloadRendered).not.toHaveBeenCalled();
    expect(JSON.parse(onPaneReady.mock.calls[0][0])).toMatchObject({
      ready: true,
      pane: 'learning-content',
    });
  });

  it('announces only after an injected payload has rendered', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'review_notebook',
        groups: [],
      });
    });

    await waitFor(() => expect(onPayloadRendered).toHaveBeenCalled());
    expect(JSON.parse(onPayloadRendered.mock.calls[0][0])).toMatchObject({
      pane: 'learning-content',
      mode: 'review_notebook',
    });
    expect(document.querySelector('.op-pane-root')).toHaveAttribute('aria-busy', 'false');
  });

  it('reports content height after render', async () => {
    render(<LearningContentPane />);

    await waitFor(() => expect(onHeightChanged).toHaveBeenCalled());
    expect(JSON.parse(onHeightChanged.mock.calls[0][0])).toHaveProperty('height');
  });

  it('renders a readonly question from setPayload', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_readonly',
        question: {
          id: 'q-speed',
          stem_text: '关于速度和速率，下列说法正确的是（ ）',
          options: [
            { label: 'A', text: '速度和速率都是矢量' },
            { label: 'B', text: '速率是标量，速度是矢量' },
          ],
          explanation: '速率只有大小，是标量；速度既有大小又有方向，是矢量。',
        },
        selectedOptions: ['B'],
        answerState: {
          submitted: true,
          correct: true,
          correctAnswer: 'B',
          explanation: '速率只有大小，是标量；速度既有大小又有方向，是矢量。',
        },
      });
    });

    expect(await screen.findByText('关于速度和速率，下列说法正确的是（ ）')).toBeInTheDocument();
    expect(screen.getAllByText('B').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('速率是标量，速度是矢量')).toBeInTheDocument();
    expect(screen.getByText('我的答案')).toBeInTheDocument();
    expect(screen.getByText('正确答案')).toBeInTheDocument();
    expect(screen.getByText('解析')).toBeInTheDocument();
  });

  it('can render a readonly question without duplicating answer summary cards', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_readonly',
        showAnswerSummary: false,
        question: {
          id: 'q-review-only',
          stem_text: '错题复盘只读题干',
          options: [
            { label: 'A', text: '选项 A' },
            { label: 'B', text: '选项 B' },
          ],
        },
        selectedOptions: ['B'],
      });
    });

    expect(await screen.findByText('错题复盘只读题干')).toBeInTheDocument();
    expect(screen.getByText('选项 B')).toBeInTheDocument();
    expect(screen.queryByText('我的答案')).not.toBeInTheDocument();
    expect(screen.queryByText('正确答案')).not.toBeInTheDocument();
  });

  it('renders the complete native practice result with rich feedback in one H5 surface', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'practice_result',
        question: {
          id: 'q-practice-result',
          stem_text: '一辆汽车做匀减速运动，判断下列说法。',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '速度逐渐增大' },
            { label: 'B', text: '速度逐渐减小' },
          ],
          images: [
            {
              id: 8,
              image_path: 'https://example.com/explanation.jpg',
              image_type: 'explanation',
              description: '解析附图',
            },
          ],
        },
        index: 1,
        total: 3,
        givenAnswer: 'A',
        selectedOptions: ['A'],
        canCorrectGrading: true,
        answerState: {
          submitted: true,
          correct: false,
          correctAnswer: 'B',
          explanation: '由 $v=v_0-at$ 可知速度逐渐减小。',
          explanation_rendered: {
            html: '<span>由 <span class="katex">v=v₀-at</span> 可知速度逐渐减小。</span>',
            errors: [],
          },
          aiFeedback: '先判断加速度与速度方向的关系。',
          aiFeedbackRendered: {
            html: '<span>先判断 <strong>加速度方向</strong>。</span>',
            errors: [],
          },
          detectedMisconception: {
            name: '速度与加速度方向混淆',
          },
          masteryUpdate: {
            'kp-motion': {
              before: 0.42,
              after: 0.51,
              name: '匀变速直线运动',
            },
          },
          processGrading: {
            process_score: 0,
            model_correct: false,
            first_error: '把减速误认为速度方向改变。',
            first_error_rendered: {
              html: '<span>把 <strong>减速</strong> 误认为速度方向改变。</span>',
              errors: [],
            },
            next_action: '重新判断速度和加速度的方向。',
            step_scores: [{ name: '求加速度', score: 0, max_score: 3, comment: '应得 $a=5\\,\\mathrm{m/s^2}$。' }],
            answer_image_paths: ['https://example.com/answer.jpg'],
          },
        },
      });
    });

    expect(await screen.findByText('✗ 需订正')).toBeInTheDocument();
    expect(screen.getByText('第 2/3 题')).toBeInTheDocument();
    expect(screen.getByText('我的选择')).toBeInTheDocument();
    expect(screen.getByText('速度逐渐增大').closest('.op-pane-option')).toHaveClass('is-wrong');
    expect(screen.getByText('速度逐渐减小').closest('.op-pane-option')).toHaveClass('is-correct');
    expect(document.querySelector('.op-pane-result-status')).not.toBeInTheDocument();
    expect(document.querySelector('.op-pane-grading-result')).toHaveClass('wrong');
    expect(screen.getByText('v=v₀-at')).toBeInTheDocument();
    expect(screen.getByText('加速度方向')).toBeInTheDocument();
    expect(screen.getByText('速度与加速度方向混淆')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '学生作答图片 1' })).toHaveAttribute(
      'src',
      'https://example.com/answer.jpg',
    );
    expect(screen.getByRole('img', { name: '解析附图' })).toHaveAttribute(
      'src',
      'https://example.com/explanation.jpg',
    );
    expect(screen.queryByText('把减速误认为速度方向改变。')).not.toBeInTheDocument();
    expect(screen.queryByText('重新判断速度和加速度的方向。')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看详细批改'));
    expect(
      Array.from(document.querySelectorAll('.op-pane-process-detail'))
        .some(element => {
          const text = element.textContent?.replace(/\s+/g, '') ?? '';
          return text.includes('把减速误认为速度方向改变。');
        }),
    ).toBe(true);
    expect(screen.getAllByText('重新判断速度和加速度的方向。').length).toBeGreaterThanOrEqual(1);
    const stepComment = document.querySelector('.op-pane-process-step small');
    expect(stepComment?.querySelector('.katex')).toBeInTheDocument();
    expect(stepComment?.textContent).not.toContain('$');
    expect(screen.getByText('学习闭环反馈')).toBeInTheDocument();
    expect(screen.getByText('重点检查模型选择')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('可填写正确识别的答案')).toBeInTheDocument();
    expect(screen.getByText('改为正确')).toBeInTheDocument();
    expect(screen.queryByText('我的答案')).not.toBeInTheDocument();
  });

  it('matches the web partial-credit result status', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'practice_result',
        question: {
          id: 'q-partial-result',
          stem_text: '写出两个必要步骤。',
          question_type: 'problem_solving',
          options: [],
        },
        givenAnswer: '完成第一步',
        answerState: {
          submitted: true,
          correct: false,
          correctAnswer: '完成第一步和第二步',
          explanation: '两步都需要写出。',
          processGrading: {
            process_score: 50,
          },
        },
      });
    });

    expect(await screen.findByText('△ 部分正确')).toBeInTheDocument();
    expect(document.querySelector('.op-pane-grading-result')).toHaveClass('partial');
  });

  it('sends manual grading correction from the H5 result surface', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'practice_result',
        question: {
          id: 'q-correction',
          stem_text: '写出物体的加速度。',
          question_type: 'problem_solving',
          options: [],
        },
        givenAnswer: 'a=2m/s²',
        canCorrectGrading: true,
        answerState: {
          submitted: true,
          correct: false,
          correctAnswer: 'a=2m/s²',
          explanation: '计算过程正确。',
          processGrading: {
            process_score: 0,
          },
        },
      });
    });

    fireEvent.click(await screen.findByText('查看详细批改'));
    fireEvent.change(screen.getByPlaceholderText('可填写正确识别的答案'), {
      target: { value: 'a=2m/s²' },
    });
    fireEvent.click(screen.getByText('改为正确'));

    expect(onCorrectGrading).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onCorrectGrading.mock.calls[0][0])).toEqual({
      questionId: 'q-correction',
      correct: true,
      correctedAnswer: 'a=2m/s²',
    });
  });

  it('renders self review solution as a pane without repeating the full question prompt', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'self_review_solution',
        question: {
          id: 'q-self-review',
          stem_text: '这段完整题干不应该出现在自评解析面板里',
          correct_answer: '平均速度为 $5\\,\\mathrm{m/s}$',
          explanation: '先求总路程，再除以总时间。',
          correct_answer_rendered: {
            html: '<span>渲染后的标准答案</span>',
            errors: [],
          },
          explanation_rendered: {
            html: '<span>渲染后的解析</span>',
            errors: [],
          },
        },
      });
    });

    expect(await screen.findByText('标准答案')).toBeInTheDocument();
    expect(screen.getByText('渲染后的标准答案')).toBeInTheDocument();
    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.getByText('渲染后的解析')).toBeInTheDocument();
    expect(screen.queryByText('这段完整题干不应该出现在自评解析面板里')).not.toBeInTheDocument();
    expect(screen.queryByText('问答题')).not.toBeInTheDocument();
  });

  it('emits option selection from an interactive question pane', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-interactive',
          stem_text: '选择正确说法（ ）',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '速度是标量' },
            { label: 'B', text: '速度是矢量' },
          ],
        },
        selectedOptions: [],
      });
    });

    fireEvent.click(await screen.findByText('速度是矢量'));

    expect(onOptionSelected).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onOptionSelected.mock.calls[0][0])).toMatchObject({
      questionId: 'q-interactive',
      selectedOptions: ['B'],
      answer: 'B',
    });
    expect(screen.getByText('速度是矢量').closest('.op-pane-option')).toHaveClass('selected');
    expect(screen.getByText('B')).not.toHaveClass('is-multiple');
  });

  it('does not preselect an interactive choice from extracted answer state', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-interactive-draft-owner',
          stem_text: '进入题目时不应自动选择（ ）',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '选项 A' },
            { label: 'C', text: '选项 C' },
          ],
        },
        answerState: {
          submitted: true,
          correct: false,
          extractedAnswer: 'C',
          correctAnswer: 'A',
        },
      });
    });

    expect(await screen.findByText('进入题目时不应自动选择（ ）')).toBeInTheDocument();
    expect(screen.getByText('选项 C').closest('.op-pane-option')).not.toHaveClass('selected');
  });

  it('allows clearing the last selected option for an interactive multiple-choice question', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-multi-clear',
          stem_text: '多选题',
          question_type: 'multiple_choice',
          options: [
            { label: 'A', text: '选项 A' },
            { label: 'B', text: '选项 B' },
          ],
        },
        selectedOptions: ['A'],
      });
    });

    fireEvent.click(await screen.findByText('选项 A'));

    expect(onOptionSelected).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A')).toHaveClass('is-multiple');
    expect(JSON.parse(onOptionSelected.mock.calls[0][0])).toMatchObject({
      questionId: 'q-multi-clear',
      selectedOptions: [],
      answer: '',
    });
  });

  it('does not reveal answer or analysis before an interactive question is submitted', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-unit-diagnostic',
          stem_text: '打点计时器实验题',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '交流电源' },
            { label: 'B', text: '直流电源' },
          ],
          correct_answer: 'A',
          explanation: '打点计时器应使用电压合适的交流电源。',
        },
        selectedOptions: [],
      });
    });

    expect(await screen.findByText('打点计时器实验题')).toBeInTheDocument();
    expect(screen.queryByText('我的答案')).not.toBeInTheDocument();
    expect(screen.queryByText('正确答案')).not.toBeInTheDocument();
    expect(screen.queryByText('解析')).not.toBeInTheDocument();
    expect(screen.queryByText('打点计时器应使用电压合适的交流电源。')).not.toBeInTheDocument();
  });

  it('shows answer and analysis after an interactive question is submitted', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-submitted',
          stem_text: '提交后的题目',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '交流电源' },
            { label: 'B', text: '直流电源' },
          ],
          correct_answer: 'A',
          explanation: '提交后展示解析。',
        },
        selectedOptions: ['B'],
        answerState: {
          submitted: true,
          correct: false,
          correctAnswer: 'A',
          explanation: '提交后展示解析。',
        },
      });
    });

    expect(await screen.findByText('提交后的题目')).toBeInTheDocument();
    expect(screen.getByText('我的答案')).toBeInTheDocument();
    expect(screen.getByText('正确答案')).toBeInTheDocument();
    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.getByText('提交后展示解析。')).toBeInTheDocument();
  });

  it('keeps Android learning state data out of the visible question pane', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-native-state',
          stem_text: '解答题需要在右侧完成作答',
          question_type: 'problem_solving',
          options: [],
        },
        learningState: {
          draftKinds: ['handwriting'],
          selfReviewStatus: 'in_progress',
          submissionStatus: 'submitting',
          completed: 1,
          total: 3,
        },
      });
    });

    expect(await screen.findByText('解答题需要在右侧完成作答')).toBeInTheDocument();
    expect(screen.queryByText('学习状态')).not.toBeInTheDocument();
    expect(screen.queryByText('手写作答已保存')).not.toBeInTheDocument();
    expect(screen.queryByText('自评进行中')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 正在批改 1/3')).not.toBeInTheDocument();
  });

  it('renders latex fallback with KaTeX instead of exposing raw formula syntax', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_readonly',
        question: {
          id: 'q-latex',
          stem_text: '先向东行驶 $80\\,\\mathrm{m}$，再向西行驶 $30\\,\\mathrm{m}$。',
          options: [],
          correct_answer: '$50\\,\\mathrm{m}$',
          explanation: '位移为 $80-30=50\\,\\mathrm{m}$。',
        },
        answerState: {
          submitted: true,
          correct: true,
          correctAnswer: '$50\\,\\mathrm{m}$',
          explanation: '位移为 $80-30=50\\,\\mathrm{m}$。',
        },
      });
    });

    await waitFor(() => expect(container.textContent).toContain('先向东行驶'));
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.op-pane-stem')?.textContent).not.toContain('$80');
  });

  it('renders fallback markdown tables with the same structured table path as the web student page', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_readonly',
        question: {
          id: 'q-table-fallback',
          stem_text: [
            '将各个速度值填入表格：',
            '| 位置 | B | C | D | E | F |',
            '| --- | --- | --- | --- | --- | --- |',
            String.raw`| 速度/$(\mathrm{m\cdot s^{-1}})$ | ___ | ___ | ___ | 0.640 | 0.721 |`,
          ].join('\n'),
          options: [],
        },
      });
    });

    expect(await screen.findByText('将各个速度值填入表格：')).toBeInTheDocument();
    const table = container.querySelector('.openphysics-rich-table');
    expect(table).toBeInTheDocument();
    expect(table?.textContent).toContain('位置');
    expect(table?.textContent).toContain('0.721');
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.op-pane-stem')?.textContent).not.toContain('| 位置 |');
  });

  it('does not duplicate question images already embedded in rendered stem html', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-inline-image',
          stem_text: '用如图甲所示的实验装置探究小车的加速度关系。{{IMG:0}}',
          stem_rendered: {
            html: '用如图甲所示的实验装置探究小车的加速度关系。<img src="https://example.test/q.png" data-openphysics-image-index="0" />',
            errors: [],
          },
          images: [
            {
              id: 1,
              image_path: 'https://example.test/q.png',
              description: '题图',
            },
          ],
        },
        selectedOptions: [],
      });
    });

    expect(await screen.findByText(/用如图甲所示/)).toBeInTheDocument();
    expect(container.querySelectorAll('img[src="https://example.test/q.png"]')).toHaveLength(1);
    expect(container.querySelector('.op-pane-images')).not.toBeInTheDocument();
  });

  it('keeps explanation and option images out of the question image gallery', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'question_interactive',
        question: {
          id: 'q-prompt-images',
          stem_text: '如图所示，下列说法正确的是（ ）',
          images: [
            {
              id: 1,
              image_path: 'https://example.test/stem.png',
              image_type: 'stem',
              description: '题图',
            },
            {
              id: 2,
              image_path: 'https://example.test/explanation.png',
              image_type: 'explanation',
              description: '解析图',
            },
            {
              id: 3,
              image_path: 'https://example.test/option.png',
              image_type: 'option',
              description: '选项图',
            },
          ],
        },
        selectedOptions: [],
      });
    });

    expect(await screen.findByText('如图所示，下列说法正确的是（ ）')).toBeInTheDocument();
    expect(container.querySelectorAll('.op-pane-images img')).toHaveLength(1);
    expect(container.querySelector('img[src="https://example.test/stem.png"]')).toBeInTheDocument();
    expect(container.querySelector('img[src="https://example.test/explanation.png"]')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://example.test/option.png"]')).not.toBeInTheDocument();
  });

  it('opts into phone knowledge layout explicitly and restores tablet title and scale on reuse', () => {
    const { container } = render(<LearningContentPane />);
    const card = { mode: 'knowledge_card', title: '加速度', sections: [{ title: '定义', type: 'concept', text: '速度变化的快慢' }] };
    act(() => window.OpenPhysicsPane?.setPayload({ ...card, presentation: 'phone', textScale: 1.3 }));
    expect(container.querySelector('.op-pane-phone')).toHaveStyle({ fontSize: '1.3rem' });
    expect(screen.queryByRole('heading', { name: '加速度' })).not.toBeInTheDocument();
    expect(screen.getByText('速度变化的快慢')).toBeInTheDocument();
    act(() => window.OpenPhysicsPane?.setPayload(card));
    expect(container.querySelector('.op-pane-phone')).not.toBeInTheDocument();
    expect(container.querySelector('.op-pane-root')).toHaveStyle({ fontSize: '1rem' });
    expect(screen.getByRole('heading', { name: '加速度' })).toBeInTheDocument();
  });

  it('renders knowledge card sections through the pane without exposing raw formula syntax', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'knowledge_card',
        title: '路程与位移',
        sections: [
          {
            title: '关键公式',
            type: 'formula',
            text: '$\\Delta x=x_2-x_1$',
          },
        ],
      });
    });

    expect(await screen.findByText('路程与位移')).toBeInTheDocument();
    expect(screen.getByText('关键公式')).toBeInTheDocument();
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toContain('$\\Delta');
  });

  it('renders formula knowledge card sections even when latex is not dollar wrapped', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'knowledge_card',
        title: '同绳约束',
        sections: [
          {
            title: '关键公式/规律',
            type: 'formula',
            text: 'a_1=a_2\\quad(\\text{同绳约束常见情形})',
          },
        ],
      });
    });

    expect(await screen.findByText('同绳约束')).toBeInTheDocument();
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
    const rich = container.querySelector('.op-pane-knowledge-section.formula .op-pane-rich');
    const nonMathText = Array.from(rich?.childNodes || [])
      .filter(node => !(node.nodeType === 1 && (node as Element).classList.contains('op-pane-inline-math')))
      .map(node => node.textContent || '')
      .join('');
    expect(nonMathText).not.toContain('\\quad');
    expect(nonMathText).not.toContain('\\text');
  });

  it('keeps structured knowledge card formula example and summary aligned with web', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'knowledge_card',
        title: '重力：地球吸引产生的力',
        sections: [
          {
            title: '关键公式/规律',
            type: 'formula',
            text: 'G=mg',
            content: {
              latex: 'G=mg',
              variable_table: [
                { symbol: 'G', name: '重力', unit: 'N' },
                { symbol: 'm', name: '质量', unit: 'kg' },
              ],
            },
          },
          {
            title: '常见错误',
            type: 'concept',
            text: '不要把重力方向画成垂直接触面。',
            content: { html: '不要把重力方向画成垂直接触面。' },
          },
          {
            title: '典型小例子',
            type: 'example',
            text: '',
            content: {
              stem: '质量 $2\\,\\mathrm{kg}$ 的物体重力多大？',
              solution: '$G=mg=20\\,\\mathrm{N}$。',
              key_takeaway: '重力方向永远竖直向下。',
            },
          },
          {
            title: '一句话总结',
            type: 'summary',
            text: '',
            content: { items: ['重力来自地球吸引。', '大小 $G=mg$。'] },
          },
        ],
      });
    });

    expect(await screen.findByText('重力：地球吸引产生的力')).toBeInTheDocument();
    expect(container.querySelector('.op-pane-knowledge-formula .katex-display')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '符号' })).toBeInTheDocument();
    expect(container.querySelector('.op-pane-knowledge-variable-table')?.textContent).toContain('质量');
    expect(container.querySelector('.op-pane-knowledge-section.concept')).toHaveTextContent('常见错误');
    expect(container.querySelector('.op-pane-knowledge-section.summary')).toHaveTextContent('重力来自地球吸引');
    expect(screen.queryByText('重力方向永远竖直向下。')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看解答' }));

    expect(screen.getByText('重力方向永远竖直向下。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起解答' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows a complete paper in saved order with independent details and exact video and tutor targets', () => {
    const onOpenTutor = vi.fn();
    window.OpenPhysicsBridge!.onOpenTutor = onOpenTutor;
    render(<LearningContentPane />);
    const paperItems = Array.from({ length: 10 }, (_, index) => ({
      question: { id: `paper-${index}`, stem_text: `题干 ${index + 1}`, correct_answer: 'B', explanation: '解析' },
      answerId: 200 + index, givenAnswer: 'A', answerState: { submitted: true, correct: false },
      lessonVideo: index === 9 ? null : { id: `video-${index}`, title: '讲解', duration_seconds: 100, available: true },
    }));
    act(() => window.OpenPhysicsPane?.setPayload({ mode: 'teacher_paper_review', paperItems }));
    expect(screen.getAllByRole('heading').map(node => node.textContent)).toEqual(paperItems.map((_, i) => `第 ${i + 1} 题`));
    expect(screen.getAllByRole('button', { name: '视频讲解' })).toHaveLength(9);
    expect(screen.getAllByRole('button', { name: 'AI 答疑' })).toHaveLength(10);
    const sixth = within(screen.getByRole('article', { name: '第 6 题' }));
    fireEvent.click(sixth.getByRole('button', { name: '查看详细批改' }));
    expect(screen.getAllByRole('button', { name: '收起详细批改' })).toHaveLength(1);
    fireEvent.click(sixth.getByRole('button', { name: '视频讲解' }));
    expect(JSON.parse(onOpenLessonVideo.mock.calls[0][0])).toEqual({ answerId: 205, questionId: 'paper-5' });
    fireEvent.click(sixth.getByRole('button', { name: 'AI 答疑' }));
    expect(JSON.parse(onOpenTutor.mock.calls[0][0])).toEqual({ answerId: 205, questionId: 'paper-5' });
    expect(onOptionSelected).not.toHaveBeenCalled();
    expect(onCorrectGrading).not.toHaveBeenCalled();
  });

  it.each([true, false])('places history video in the trust header without inventing confidence (%s)', hasGrading => {
    const { container } = render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({ mode: 'history_records', records: [{
      id: 501, question_id: 'history-video', stem_text: '历史视频位置', is_correct: false,
      correct_answer: '答案', explanation: '解析内容',
      process_grading: hasGrading ? { needs_human_review: true, grading_confidence: 0.4 } : null,
      lesson_video: { id: 'v', available: true, title: '讲解', duration_seconds: 10 },
    }] }));
    fireEvent.click(screen.getByText('历史视频位置'));
    const button = screen.getByRole('button', { name: '视频讲解' });
    expect(button.closest('.op-pane-grading-trust-head')).not.toBeNull();
    expect(container.querySelector('.op-pane-grading-trust-badge') !== null).toBe(hasGrading);
    expect(button.compareDocumentPosition(screen.getByText('解析内容')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([true, false])('shows lesson video tag and gates history playback by eligibility (%s)', async available => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'history_records',
      records: [{ id: 21, question_id: 'q-video', stem_text: '带讲解的题目', is_correct: true,
        lesson_video: { id: 'lesson-1', title: '题目讲解', duration_seconds: 111, available, locked_reason: '整套批改后开放' } }],
    }));
    expect(await screen.findByText('有视频讲解')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视频讲解' })).not.toBeInTheDocument();
    expect(onOpenLessonVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('带讲解的题目'));
    if (available) {
      fireEvent.click(await screen.findByRole('button', { name: '视频讲解' }));
      expect(JSON.parse(onOpenLessonVideo.mock.calls[0][0])).toEqual({ answerId: 21, questionId: 'q-video' });
    } else {
      expect(await screen.findByText('整套批改后开放')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '视频讲解' })).not.toBeInTheDocument();
      expect(onOpenLessonVideo).not.toHaveBeenCalled();
    }
  });

  it('renders history records inline and emits review navigation only for wrong records', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'history_records',
        records: [
          {
            id: 11,
            question_id: 'q-correct',
            stem_text: '关于速度和速率，下列说法正确的是（ ）',
            question_type: 'single_choice',
            options: [{ label: 'A', text: '速率是标量，速度是矢量' }],
            given_answer: 'A',
            correct_answer: 'A',
            explanation: '速度有方向，速率无方向。',
            is_correct: true,
            knowledge_points: [{ name: '速度与速率的区别' }],
            created_at: '2026-07-03T12:07:00Z',
          },
          {
            id: 12,
            question_id: 'q-wrong',
            stem_text: '某同学绕操场跑一圈回到出发点，速度为 $0\\,\\mathrm{m/s}$。{{IMG:0}} 下列说法正确的是（ ）',
            question_type: 'multiple_choice',
            options: [
              { label: 'A', text: '位移等于路程' },
              { label: 'B', text: '平均速度为零' },
            ],
            given_answer: 'A',
            correct_answer: 'B',
            explanation: '回到出发点时位移为零，因此平均速度为零。',
            is_correct: false,
            knowledge_points: [{ name: '速率与速度的区别' }],
            process_grading: { needs_human_review: true },
            created_at: '2026-07-03T12:08:00Z',
          },
        ],
      });
    });

    expect(await screen.findByText('关于速度和速率，下列说法正确的是（ ）')).toBeInTheDocument();
    expect(screen.getByText('单选题')).toBeInTheDocument();
    expect(screen.getByText('速度与速率的区别')).toBeInTheDocument();
    expect(screen.getByText('多选题')).toBeInTheDocument();
    expect(screen.getByText('建议确认')).toBeInTheDocument();
    expect(container.querySelectorAll('.op-pane-history-record.wrong')).toHaveLength(0);
    expect(container.querySelectorAll('.op-pane-history-summary.wrong')).toHaveLength(1);
    expect(container.querySelector('.op-pane-history-title')?.textContent).not.toContain('{{IMG');
    expect(screen.queryByText('速度有方向，速率无方向。')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/某同学绕操场跑一圈回到出发点/));

    expect(await screen.findByText('回到出发点时位移为零，因此平均速度为零。')).toBeInTheDocument();
    const reviewButton = screen.getByText('去错题复盘');
    expect(screen.getByText('过程批改')).toBeInTheDocument();
    expect(screen.getByText('建议人工确认')).toBeInTheDocument();
    fireEvent.click(reviewButton);

    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onOpenReview.mock.calls[0][0])).toMatchObject({
      answerId: 12,
      questionId: 'q-wrong',
    });
  });

  it('reports height again after a history record expands', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'history_records',
        records: [
          {
            id: 12,
            question_id: 'q-wrong',
            stem_text: '某同学绕操场跑一圈回到出发点，下列说法正确的是（ ）',
            question_type: 'multiple_choice',
            options: [{ label: 'B', text: '平均速度为零' }],
            given_answer: 'A',
            correct_answer: 'B',
            explanation: '回到出发点时位移为零，因此平均速度为零。',
            is_correct: false,
            created_at: '2026-07-03T12:08:00Z',
          },
        ],
      });
    });

    await waitFor(() => expect(onHeightChanged).toHaveBeenCalled());
    onHeightChanged.mockClear();

    fireEvent.click(await screen.findByText('某同学绕操场跑一圈回到出发点，下列说法正确的是（ ）'));

    await waitFor(() => expect(onHeightChanged).toHaveBeenCalled());
  });

  it('keeps reviewed wrong records readable without reopening the wrong notebook', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'history_records',
        records: [
          {
            id: 13,
            question_id: 'q-reviewed',
            stem_text: '这是一道已经完成复盘的历史错题。',
            question_type: 'single_choice',
            options: [{ label: 'A', text: '选项' }],
            given_answer: 'B',
            correct_answer: 'A',
            explanation: '历史解析仍然可以查看。',
            is_correct: false,
            reviewed_at: '2026-07-04T08:00:00Z',
            created_at: '2026-07-03T12:08:00Z',
          },
        ],
      });
    });

    fireEvent.click(await screen.findByText('这是一道已经完成复盘的历史错题。'));

    expect(await screen.findByText('历史解析仍然可以查看。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去错题复盘' })).not.toBeInTheDocument();
  });

  it('renders review notebook groups and emits row actions from the pane', async () => {
    const onOpenMistake = vi.fn();
    const onToggleMistakeSelection = vi.fn();
    window.OpenPhysicsBridge = {
      onPaneReady,
      onHeightChanged,
      onOpenReview,
      onOpenMistake,
      onToggleMistakeSelection,
    };
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'review_notebook',
        selectedAnswerIds: [31],
        maxMistakesPerGroup: 2,
        groups: [
          {
            kp_id: 'kp-friction',
            kp_name: '静摩擦力',
            mistakes: [
              {
                answer_id: 31,
                question_id: 'q-31',
                stem_text: '物体受力满足 $f=\\mu N$，下列说法正确的是（ ）',
                question_type: 'single_choice',
                misconception_name: '受力分析',
                process_grading: { needs_human_review: true },
                created_at: '2026-07-03T06:53:00Z',
              },
              {
                answer_id: 32,
                question_id: 'q-32',
                stem_text: '如图所示，木箱保持静止。{{IMG:0}} 下列说法正确的是（ ）',
                question_type: 'experiment',
                misconception_name: '静摩擦方向',
                created_at: '2026-07-03T06:54:00Z',
              },
            ],
          },
        ],
      });
    });

    expect(await screen.findByText('静摩擦力')).toBeInTheDocument();
    expect(screen.getByText('2 题')).toBeInTheDocument();
    expect(screen.getByText('单选题')).toBeInTheDocument();
    expect(screen.getByText('受力分析')).toBeInTheDocument();
    expect(screen.getByText('建议确认')).toBeInTheDocument();
    expect(screen.getByText(/物体受力满足/).textContent).not.toContain('$f=');
    expect(screen.getByText(/如图所示/).textContent).not.toContain('{{IMG');

    fireEvent.click(screen.getByLabelText(/切换选择：物体受力满足/));
    expect(onToggleMistakeSelection).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onToggleMistakeSelection.mock.calls[0][0])).toMatchObject({
      answerId: 31,
      questionId: 'q-31',
    });

    fireEvent.click(screen.getByText(/如图所示/));
    expect(onOpenMistake).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onOpenMistake.mock.calls[0][0])).toMatchObject({
      answerId: 32,
      questionId: 'q-32',
    });
  });

  it('mounts review notebook knowledge point groups in small batches', async () => {
    render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'review_notebook',
        reviewGroupBatchSize: 1,
        groups: ['运动', '受力', '能量'].map((kpName, index) => ({
          kp_id: `kp-${index}`,
          kp_name: kpName,
          mistakes: [{
            answer_id: 50 + index,
            question_id: `q-${50 + index}`,
            stem_text: `${kpName}错题`,
          }],
        })),
      });
    });

    expect(await screen.findByText('运动')).toBeInTheDocument();
    expect(screen.queryByText('受力')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示更多知识点（剩余 2 组）' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示更多知识点（剩余 2 组）' }));

    expect(await screen.findByText('受力')).toBeInTheDocument();
    expect(screen.queryByText('能量')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '显示更多知识点（剩余 1 组）' })).toBeInTheDocument();
  });

  it('renders a complete review mistake detail without native answer or analysis sections', async () => {
    const { container } = render(<LearningContentPane />);

    act(() => {
      window.OpenPhysicsPane?.setPayload({
        mode: 'review_mistake_detail',
        mistake: {
          answer_id: 41,
          question_id: 'q-review-detail',
          stem_text: '纸带实验下列说法正确的是（ ）',
          question_type: 'single_choice',
          options: [
            { label: 'A', text: '先释放小车，再接通电源' },
            { label: 'B', text: '先接通电源，再释放小车' },
          ],
          given_answer: 'A',
          correct_answer: 'B',
          explanation: '为减小实验误差，应先接通电源，再释放小车。',
          misconception_name: '实验顺序',
          process_grading: {
            needs_human_review: true,
            process_score: 62,
            model_correct: false,
            equation_correct: true,
            calculation_correct: null,
            unit_correct: null,
            first_error: '忽略了打点计时器需要先稳定工作。',
            next_action: '先判断实验操作顺序，再判断数据处理。',
          },
        },
      });
    });

    expect(await screen.findByText('纸带实验下列说法正确的是（ ）')).toBeInTheDocument();
    expect(screen.getByText('你的答案')).toBeInTheDocument();
    expect(screen.getByText('正确答案')).toBeInTheDocument();
    expect(screen.getByText('实验顺序')).toBeInTheDocument();
    expect(screen.getByText('过程批改')).toBeInTheDocument();
    expect(screen.getByText('62/100')).toBeInTheDocument();
    expect(screen.getByText(/忽略了打点计时器/)).toBeInTheDocument();
    expect(screen.getByText('解析')).toBeInTheDocument();
    expect(screen.getByText('为减小实验误差，应先接通电源，再释放小车。')).toBeInTheDocument();
    expect(container.querySelectorAll('.op-pane-question')).toHaveLength(1);
    expect(container.querySelectorAll('.op-pane-answer-grid')).toHaveLength(1);
  });
  it('phone result preserves original answer, image preview and manual correction when switching questions', async () => {
    const onOpenImage = vi.fn();
    const onCorrectGrading = vi.fn();
    window.OpenPhysicsBridge = { onOpenImage, onCorrectGrading };
    render(<LearningContentPane />);
    const setResult = (id: string, phone = true) => act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'practice_result', presentation: phone ? 'phone' : undefined, canCorrectGrading: true,
      index: 1, total: 3,
      question: { id, stem_text: '求加速度', question_type: 'problem_solving', options: [] },
      givenAnswer: '(1)2；(2)24',
      answerState: { correct: false, correctAnswer: '2m/s²', processGrading: {
        first_error: '漏写单位', next_action: '补充加速度单位', process_score: 60,
        answer_image_paths: ['/answer.png'],
      } },
    }));
    setResult('first');
    expect(await screen.findByText('(1)2；(2)24')).toBeInTheDocument();
    expect(screen.getByText('第一处问题')).toBeInTheDocument();
    // The question is open (no 查看原题与选项 to tap), after the first problem and next step.
    expect(screen.queryByText('查看原题与选项')).not.toBeInTheDocument();
    const stem = screen.getByText('求加速度');
    expect(stem.closest('details')).toBeNull();
    expect(screen.getByText('部分正确').compareDocumentPosition(screen.getByText('第一处问题')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('第一处问题').compareDocumentPosition(screen.getByText('下一步')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('下一步').compareDocumentPosition(stem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('完整解析').closest('details')).toHaveAttribute('open');
    expect(screen.queryByText('第 2/3 题')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /学生作答图片.*查看大图/ }));
    expect(JSON.parse(onOpenImage.mock.calls[0][0])).toMatchObject({ questionId: 'first' });
    fireEvent.click(screen.getByRole('button', { name: '查看详细批改' }));
    fireEvent.change(screen.getByPlaceholderText('可填写正确识别的答案'), { target: { value: '2m/s²' } });
    fireEvent.click(screen.getByRole('button', { name: '改为正确' }));
    expect(JSON.parse(onCorrectGrading.mock.calls[0][0])).toMatchObject({ questionId: 'first', correctedAnswer: '2m/s²', correct: true });
    setResult('second');
    expect(screen.getByText('求加速度').closest('details')).toBeNull();
    expect(screen.queryByPlaceholderText('可填写正确识别的答案')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /学生作答图片.*查看大图/ }), { key: 'Enter' });
    expect(JSON.parse(onOpenImage.mock.calls[1][0])).toMatchObject({ questionId: 'second' });
    setResult('tablet', false);
    expect(screen.queryByRole('button', { name: /查看大图/ })).not.toBeInTheDocument();
    expect(screen.queryByText('第一处问题')).not.toBeInTheDocument();
  });

  it('shows a phone choice result with the marked options open right after the verdict', () => {
    render(<LearningContentPane />);
    act(() => window.OpenPhysicsPane?.setPayload({
      mode: 'practice_result', presentation: 'phone', index: 0, total: 2,
      question: {
        id: 'q-choice-result', stem_text: '选择正确说法', question_type: 'single_choice',
        options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }], correct_answer: 'B',
      },
      selectedOptions: ['A'], givenAnswer: 'A', answerState: { correct: false },
    }));
    const verdict = screen.getByText('需要订正');
    // The options carry 我的选择 / 正确答案, so the separate comparison row is gone.
    expect(document.querySelector('.op-pane-phone-choice-comparison')).not.toBeInTheDocument();
    expect(screen.queryByText('查看原题与选项')).not.toBeInTheDocument();
    const stem = screen.getByText('选择正确说法');
    expect(stem.closest('details')).toBeNull();
    expect(verdict.compareDocumentPosition(stem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('我的选择')).toBeInTheDocument();
    expect(screen.getByText('正确答案')).toBeInTheDocument();
    expect(screen.queryByText('第 1/2 题')).not.toBeInTheDocument();
    expect(document.querySelector('.op-pane-question-header')).not.toBeInTheDocument();
  });

});
