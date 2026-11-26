import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuestionSessionRunner from './QuestionSessionRunner';
import type { Question, SubmitResult } from '../types';
import {flushPracticeDraftWrites} from '../utils/practicePersistence';

const apiMocks = vi.hoisted(() => ({
  submitPhoto: vi.fn(),
  submitProcessEvidence: vi.fn(),
  submitSelfReview: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: apiMocks,
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
}));

vi.mock('../utils/handwritingExport', () => ({
  HANDWRITING_BACKGROUND_IMAGE_ERROR: '题图加载失败，无法生成完整作答图片，请检查网络后重试',
  handwritingSnapshotToFile: vi.fn(async () => new File(['handwriting'], 'handwriting.png', { type: 'image/png' })),
}));

vi.mock('./PrintableQuestionSet', () => ({
  default: () => null,
}));

vi.mock('./PrintButton', () => ({
  default: () => <button type="button">打印</button>,
}));

vi.mock('./PaperBatchGradingPanel', () => ({
  default: () => null,
}));

vi.mock('./HandwritingPad', () => ({
  default: ({
    onSnapshotChange,
    submitEnabled = true,
    footerLeadingActions,
    footerActions,
  }: {
    onSnapshotChange?: (snapshot: any) => void;
    submitEnabled?: boolean;
    footerLeadingActions?: ReactNode;
    footerActions?: ReactNode;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onSnapshotChange?.({
          version: 1,
          width: 640,
          height: 360,
          strokes: [
            {
              tool: 'pen',
              color: '#1f2933',
              width: 2.5,
              points: [
                { x: 10, y: 10, t: 1000, pressure: 0.5, toolType: 2 },
                { x: 30, y: 30, t: 1100, pressure: 0.5, toolType: 2 },
              ],
            },
          ],
        })}
      >
        手写答题区
      </button>
      {submitEnabled && (
        <button type="button">
          提交手写答案
        </button>
      )}
      {footerLeadingActions}
      {footerActions}
    </div>
  ),
}));

vi.mock('./PhotoUpload', () => ({
  default: ({ draft, onDraftChange }: {
    draft?: { file: File; previewUrl: string } | null;
    onDraftChange?: (draft: { file: File; previewUrl: string } | null) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onDraftChange?.({
          file: new File(['photo'], 'solution.png', { type: 'image/png' }),
          previewUrl: 'blob:solution-q1',
        })}
      >
        选择解答照片
      </button>
      {draft && <span>已保留解答照片</span>}
    </div>
  ),
}));

function makeChoiceQuestion(id: string, stem: string): Question {
  return {
    id,
    stem_text: stem,
    question_type: 'single_choice',
    target_knowledge_point_id: 'kp-target',
    options: [
      { label: 'A', text: `${stem} 选项A` },
      { label: 'B', text: `${stem} 选项B` },
    ],
    images: [],
  };
}

function makeProblemQuestion(id: string, stem: string): Question {
  return {
    id,
    stem_text: stem,
    question_type: 'problem_solving',
    target_knowledge_point_id: 'kp-target',
    options: [],
    images: [],
    answer: '规范答案',
    explanation: '标准解析',
  };
}

function makeProblemQuestionWithImage(id: string, stem: string): Question {
  return {
    ...makeProblemQuestion(id, stem),
    images: [
      { id: `${id}-diagram`, image_path: `/${id}.png`, image_type: 'diagram', description: '题图' },
    ],
  };
}

function RunnerHarness() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const questions = [
    makeChoiceQuestion('q1', '第一题'),
    makeChoiceQuestion('q2', '第二题'),
    makeChoiceQuestion('q3', '第三题'),
  ];

  return (
    <QuestionSessionRunner
      title="知识小测"
      subtitle="三题"
      printTitle="知识小测"
      questions={questions}
      currentIndex={currentIndex}
      answeredCount={0}
      progressForQuestion={() => ({ answered: false })}
      onBack={vi.fn()}
      onGoToQuestion={setCurrentIndex}
      showPaperBatch={false}
      onTogglePaperBatch={vi.fn()}
      onBatchGraded={vi.fn()}
      onAnswer={async (): Promise<SubmitResult> => ({
        is_correct: true,
        correct_answer: 'B',
        explanation: null,
        mastery_update: {},
      })}
      lastAction={<button type="button">完成</button>}
    />
  );
}

async function goToQuestion(number: number) {
  await userEvent.click(screen.getByRole('button', { name: String(number) }));
}

describe('QuestionSessionRunner', () => {
  beforeEach(() => {
    apiMocks.submitPhoto.mockReset();
    apiMocks.submitProcessEvidence.mockReset();
    apiMocks.submitSelfReview.mockReset();
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }
  });

  it('does not submit any paper answer until the whole attempt is accepted, and permits a safe retry', async () => {
    const beforeSubmit = vi.fn().mockRejectedValueOnce(new Error('整卷提交失败')).mockResolvedValueOnce(undefined);
    const answer = vi.fn().mockResolvedValue({ answer_id: 1, is_correct: false, correct_answer: 'A', explanation: null, mastery_update: {} });
    render(<QuestionSessionRunner title="教师作业" subtitle="" printTitle="套卷"
      questions={[makeChoiceQuestion('q1', '第一题')]} currentIndex={0} answeredCount={0}
      progressForQuestion={() => ({ answered: false })} onBack={vi.fn()} onGoToQuestion={vi.fn()}
      showPaperBatch={false} onTogglePaperBatch={vi.fn()} onBatchGraded={vi.fn()} lastAction={null}
      onAnswer={answer} collectMode deferredGrading teacherPaperAttemptId="cloud-1" onBeforeDeferredGrading={beforeSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));
    expect(await screen.findByText('整卷提交失败')).toBeInTheDocument();
    expect(answer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('q1', ''));
    expect(beforeSubmit).toHaveBeenCalledTimes(2);
  });

  it('reports an all-graded session once without requiring another submit action', async () => {
    const onAllGraded = vi.fn();
    const questions = [makeChoiceQuestion('q1', '第一题'), makeChoiceQuestion('q2', '第二题')];
    const result: SubmitResult = {
      answer_id: 1,
      is_correct: true,
      correct_answer: 'A',
      explanation: null,
      mastery_update: {},
    };
    const runner = (
      <QuestionSessionRunner
        title="掌握评估"
        subtitle="两题"
        printTitle="掌握评估"
        questions={questions}
        currentIndex={1}
        answeredCount={2}
        progressForQuestion={() => ({ answered: true, correct: true })}
        resultForQuestion={() => result}
        onBack={vi.fn()}
        onGoToQuestion={vi.fn()}
        showPaperBatch={false}
        onTogglePaperBatch={vi.fn()}
        onBatchGraded={vi.fn()}
        lastAction={<button type="button">评估结果</button>}
        onAllGraded={onAllGraded}
      />
    );
    const { rerender } = render(runner);

    await waitFor(() => expect(onAllGraded).toHaveBeenCalledTimes(1));
    rerender(runner);
    expect(onAllGraded).toHaveBeenCalledTimes(1);
  });

  it('keeps a clicked choice when navigating away and back before submit', async () => {
    render(<RunnerHarness />);

    await goToQuestion(2);
    await userEvent.click(screen.getByText('第二题 选项B'));
    expect(screen.getByRole('button', { name: '提交答案' })).toBeInTheDocument();

    await goToQuestion(3);
    await goToQuestion(2);

    expect(screen.getByRole('button', { name: '提交答案' })).toBeInTheDocument();
  });

  it('restores an option on remount and persists cancelling it as an empty answer', async () => {
    const mount = () => render(<QuestionSessionRunner persistenceKey="student:persistent-runner" title="恢复测试" subtitle="" printTitle="恢复测试"
      questions={[makeChoiceQuestion('q1','第一题')]} currentIndex={0} answeredCount={0} progressForQuestion={() => ({answered:false})}
      onBack={vi.fn()} onGoToQuestion={vi.fn()} showPaperBatch={false} onTogglePaperBatch={vi.fn()} onBatchGraded={vi.fn()} lastAction={null} />);
    const first = mount();
    await userEvent.click(await screen.findByText('第一题 选项A'));
    first.unmount(); await flushPracticeDraftWrites();
    const second = mount();
    expect((await screen.findByText('第一题 选项A')).closest('.choice-answer-option')).toHaveClass('is-selected');
    await userEvent.click(screen.getByText('第一题 选项A'));
    second.unmount(); await flushPracticeDraftWrites();
    mount();
    expect((await screen.findByText('第一题 选项A')).closest('.choice-answer-option')).not.toHaveClass('is-selected');
  });

  it('keeps the grading lock until all pending work settles and retries only the failed question', async () => {
    let finishSecond!: (result: SubmitResult) => void;
    const graded: SubmitResult = {answer_id:2,is_correct:true,correct_answer:'A',extracted_answer:'A',mastery_update:{},explanation:null};
    const submit = vi.fn().mockRejectedValueOnce(new Error('第一题暂时失败'))
      .mockImplementationOnce(() => new Promise<SubmitResult>(resolve => { finishSecond = resolve; }))
      .mockResolvedValueOnce({...graded,answer_id:3});
    function Batch() {
      const [answers,setAnswers] = useState<Record<string,SubmitResult>>({});
      return <QuestionSessionRunner title="并发测试" subtitle="" printTitle="并发测试"
        questions={[makeChoiceQuestion('q1','第一题'),makeChoiceQuestion('q2','第二题')]} currentIndex={1} answeredCount={Object.keys(answers).length}
        resultForQuestion={id => answers[id]} progressForQuestion={id => ({answered:!!answers[id]})}
        onBack={vi.fn()} onGoToQuestion={vi.fn()} showPaperBatch={false} onTogglePaperBatch={vi.fn()} onBatchGraded={vi.fn()} lastAction={null}
        onAnswer={submit} onAnswered={(id,result) => setAnswers(previous => ({...previous,[id]:result}))} collectMode deferredGrading />;
    }
    render(<Batch />);
    await userEvent.click(screen.getByRole('button',{name:'提交批改'}));
    await userEvent.click(screen.getByRole('button',{name:'开始AI批改'}));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button',{name:'AI 批改中'})).toBeDisabled();
    expect(screen.queryByText('第一题暂时失败')).not.toBeInTheDocument();
    await act(async () => finishSecond(graded));
    await screen.findByText('第一题暂时失败');
    await userEvent.click(screen.getByRole('button',{name:'提交批改'}));
    await userEvent.click(screen.getByRole('button',{name:'开始AI批改'}));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls.map(call => call[0])).toEqual(['q1','q2','q1']);
  });

  it('can hide the question number navigation for a single-question session', () => {
    const { container } = render(
      <QuestionSessionRunner
        title="做变式题"
        subtitle="单题"
        printTitle="错题变式题"
        questions={[makeChoiceQuestion('q_variant', '变式题')]}
        currentIndex={0}
        answeredCount={0}
        progressForQuestion={() => ({ answered: false })}
        onBack={vi.fn()}
        onGoToQuestion={vi.fn()}
        showPaperBatch={false}
        onTogglePaperBatch={vi.fn()}
        onBatchGraded={vi.fn()}
        lastAction={<button type="button">返回错题本</button>}
        showQuestionProgressNav={false}
      />,
    );

    expect(container.querySelector('.question-workspace-progress')).not.toBeInTheDocument();
  });

  it('uses top question numbers for navigation and keeps grading submit in the header actions', async () => {
    function HeaderSubmitHarness() {
      const [currentIndex, setCurrentIndex] = useState(1);
      const questions = [
        makeChoiceQuestion('q_choice', '选择题'),
        makeChoiceQuestion('q_solution', '解答题'),
      ];

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={1}
          progressForQuestion={(questionId) => ({ answered: questionId === 'q_choice' || questionId === 'q_solution' })}
          resultForQuestion={(questionId) => questionId === 'q_choice'
            ? {
              is_correct: true,
              correct_answer: 'B',
              explanation: '已批改',
              mastery_update: {},
              extracted_answer: 'B',
            }
            : undefined}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          onCollect={vi.fn()}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<HeaderSubmitHarness />);

    await userEvent.click(screen.getByText('解答题 选项B'));

    expect(screen.queryByRole('button', { name: '上一题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一题' })).not.toBeInTheDocument();

    const actions = document.querySelector('.question-workspace-actions');
    expect(actions).toHaveTextContent(/工具\s*提交批改/);
    expect(screen.queryByRole('button', { name: /打印/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '纸笔批改' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交批改' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '工具' }));
    expect(screen.getByRole('button', { name: /打印/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '纸笔批改' })).not.toBeInTheDocument();

    await goToQuestion(1);
    expect(screen.getByRole('button', { name: '提交批改' })).toBeEnabled();
  });

  it('summarizes each deferred answer source once and repeats the summary in confirmation', async () => {
    function DeferredSummaryHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const questions = [
        makeChoiceQuestion('q_choice', '选择题'),
        makeProblemQuestion('q_canvas', '画布题'),
        makeProblemQuestion('q_photo', '照片题'),
        makeProblemQuestion('q_review', '自评题'),
        makeProblemQuestion('q_blank', '待作答题'),
      ];

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="五题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={0}
          progressForQuestion={() => ({ answered: false })}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<DeferredSummaryHarness />);

    await userEvent.click(screen.getByText('选择题 选项B'));
    await goToQuestion(2);
    await userEvent.click(screen.getByText('手写答题区'));
    await goToQuestion(3);
    await userEvent.click(screen.getByText('拍照上传纸面解答'));
    await userEvent.click(screen.getByText('选择解答照片'));
    await goToQuestion(4);
    await userEvent.click(screen.getByRole('button', { name: '对照解析自评' }));
    await userEvent.click(screen.getByRole('button', { name: '半对' }));
    await userEvent.click(screen.getByRole('button', { name: '保存自评' }));
    await goToQuestion(5);

    const incompleteText = '已作答 4/5 · 选择 1 · 画布 1 · 照片 1 · 自评 1 · 未作答 1';
    expect(screen.getByRole('status')).toHaveTextContent(incompleteText);
    expect(screen.getByRole('status')).toHaveClass('is-incomplete');

    await userEvent.click(screen.getByText('手写答题区'));

    const completeText = '已作答 5/5 · 选择 1 · 画布 2 · 照片 1 · 自评 1';
    expect(screen.getByRole('status')).toHaveTextContent(completeText);
    expect(screen.getByRole('status')).toHaveClass('is-complete');

    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    const dialog = screen.getByRole('dialog', { name: '开始整套 AI 批改？' });
    expect(within(dialog).getByText(completeText)).toBeInTheDocument();
  });

  it('submits unanswered deferred questions as blank wrong answers', async () => {
    const handleAnswer = vi.fn(async (questionId: string, answer: string): Promise<SubmitResult> => ({
      answer_id: questionId === 'q1' ? 101 : 102,
      is_correct: answer !== '',
      correct_answer: 'B',
      explanation: answer === '' ? '未作答，按错误处理' : '选择题解析',
      mastery_update: {},
      extracted_answer: answer,
    }));

    function BlankAnswerHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      const [collected, setCollected] = useState<Record<string, string>>({});
      const questions = [
        makeChoiceQuestion('q1', '第一题'),
        makeChoiceQuestion('q2', '第二题'),
      ];

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={Object.keys(collected).length}
          progressForQuestion={(questionId) => ({ answered: !!collected[questionId] || !!answers[questionId] })}
          resultForQuestion={(questionId) => answers[questionId]}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          onAnswer={handleAnswer}
          onAnswered={(questionId, result) => setAnswers(prev => ({ ...prev, [questionId]: result }))}
          onCollect={(questionId, answer) => setCollected(prev => ({ ...prev, [questionId]: answer }))}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<BlankAnswerHarness />);

    await userEvent.click(screen.getByText('第一题 选项B'));
    await goToQuestion(2);
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));

    expect(handleAnswer).toHaveBeenCalledWith('q1', 'B');
    expect(handleAnswer).toHaveBeenCalledWith('q2', '');
    expect(await screen.findByText('未作答，按错误处理')).toBeInTheDocument();
  });

  it('keeps the onscreen question workspace free of redundant session subtitles and question-count text', () => {
    const { container } = render(<RunnerHarness />);

    const workspace = container.querySelector('.question-session-workspace');

    expect(workspace).toBeInTheDocument();
    expect(workspace).not.toHaveTextContent('三题');
    expect(workspace).not.toHaveTextContent('第 1 题 / 共 3 题');
  });

  it('uses the shared learning page width for the onscreen question workspace', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const questionWorkspaceRule = css.match(/\.question-session-workspace\s*\{[^}]+\}/);

    expect(questionWorkspaceRule?.[0]).toContain('max-width: var(--learning-page-max-width)');
  });

  it('keeps a selected solution photo when navigating away and back before grading', async () => {
    function PhotoDraftHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const questions = [
        makeProblemQuestion('q1', '解答题'),
        makeChoiceQuestion('q2', '选择题'),
      ];

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={0}
          progressForQuestion={() => ({ answered: false })}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          onCollect={vi.fn()}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<PhotoDraftHarness />);

    await userEvent.click(screen.getByText('拍照上传纸面解答'));
    await userEvent.click(screen.getByText('选择解答照片'));
    expect(screen.getByText('已保留解答照片')).toBeInTheDocument();

    await goToQuestion(2);
    await goToQuestion(1);

    expect(screen.getByText('已保留解答照片')).toBeInTheDocument();
  });

  it('keeps the draft background image selection when navigating away and back', async () => {
    function DraftBackgroundHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const questions = [
        makeProblemQuestionWithImage('q1', '带图解答题'),
        makeChoiceQuestion('q2', '选择题'),
      ];

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={0}
          progressForQuestion={() => ({ answered: false })}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          onCollect={vi.fn()}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<DraftBackgroundHarness />);

    await userEvent.click(screen.getByRole('button', { name: '放入草稿纸' }));
    expect(screen.getByRole('button', { name: '清除背景' })).toBeInTheDocument();

    await goToQuestion(2);
    await goToQuestion(1);

    expect(screen.getByRole('button', { name: '清除背景' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放入草稿纸' })).toHaveClass('is-active');
  });

  it('grades deferred mixed answers before allowing final assessment submission', async () => {
    apiMocks.submitPhoto.mockResolvedValue({
      is_correct: false,
      correct_answer: '规范答案',
      explanation: '解析',
      mastery_update: {},
      extracted_answer: '拍照答案',
    } satisfies SubmitResult);

    function DeferredGradingHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      const [collected, setCollected] = useState<Record<string, string>>({});
      const questions = [
        makeChoiceQuestion('q_choice', '选择题'),
        makeProblemQuestion('q_solution', '解答题'),
      ];

      const handleAnswer = async (questionId: string, answer: string) => {
        const result: SubmitResult = {
          is_correct: true,
          correct_answer: answer,
          explanation: '选择题解析',
          mastery_update: {},
          extracted_answer: answer,
        };
        setAnswers(prev => ({ ...prev, [questionId]: result }));
        return result;
      };

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={Object.keys(collected).length}
          progressForQuestion={(questionId) => ({ answered: !!collected[questionId] || !!answers[questionId] })}
          resultForQuestion={(questionId) => answers[questionId]}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          onAnswer={handleAnswer}
          onAnswered={(questionId, result) => setAnswers(prev => ({ ...prev, [questionId]: result }))}
          onCollect={(questionId, answer) => setCollected(prev => ({ ...prev, [questionId]: answer }))}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<DeferredGradingHarness />);

    await userEvent.click(screen.getByText('选择题 选项B'));
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument();

    await goToQuestion(2);
    expect(screen.getByRole('button', { name: '提交批改' })).toBeEnabled();
    await userEvent.click(screen.getByText('拍照上传纸面解答'));
    await userEvent.click(screen.getByText('选择解答照片'));
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    expect(screen.getByText('开始整套 AI 批改？')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '开始整套 AI 批改？' })).toHaveAttribute('aria-modal', 'true');
    expect(apiMocks.submitPhoto).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));

    expect(apiMocks.submitPhoto).toHaveBeenCalledWith(
      'student-1', expect.any(File), 'q_solution', 0, 'kp-target',
    );
    expect(await screen.findByRole('button', { name: '提交评估' })).toBeInTheDocument();

    await goToQuestion(1);
    expect(screen.getByText('选择题解析')).toBeInTheDocument();
  });

  it('submits deferred handwriting drafts as final images during full-set grading', async () => {
    apiMocks.submitPhoto.mockResolvedValue({
      is_correct: false,
      correct_answer: '规范答案',
      explanation: '图片批改解析',
      mastery_update: {},
      extracted_answer: '手写答案',
      process_grading: {
        answer_source: 'photo',
      },
    } as SubmitResult);

    function DeferredHandwritingHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      const [collected, setCollected] = useState<Record<string, string>>({});
      const questions = [
        makeChoiceQuestion('q_choice', '选择题'),
        makeProblemQuestion('q_solution', '手写题'),
      ];

      const handleAnswer = async (questionId: string, answer: string) => {
        const result: SubmitResult = {
          is_correct: true,
          correct_answer: answer,
          explanation: '选择题解析',
          mastery_update: {},
          extracted_answer: answer,
        };
        setAnswers(prev => ({ ...prev, [questionId]: result }));
        return result;
      };

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={Object.keys(collected).length}
          progressForQuestion={(questionId) => ({ answered: !!collected[questionId] || !!answers[questionId] })}
          resultForQuestion={(questionId) => answers[questionId]}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          onAnswer={handleAnswer}
          onAnswered={(questionId, result) => setAnswers(prev => ({ ...prev, [questionId]: result }))}
          onCollect={(questionId, answer) => setCollected(prev => ({ ...prev, [questionId]: answer }))}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<DeferredHandwritingHarness />);

    await userEvent.click(screen.getByText('选择题 选项B'));
    await goToQuestion(2);
    expect(screen.getByRole('button', { name: '提交批改' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '提交手写答案' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('手写答题区'));
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));

    expect(apiMocks.submitPhoto).toHaveBeenCalledWith(
      'student-1',
      expect.any(File),
      'q_solution',
      0,
      'kp-target',
    );
    expect(await screen.findByRole('button', { name: '提交评估' })).toBeInTheDocument();
  });

  it('offers self-review in both deferred and single-question sessions without opening solutions automatically', () => {
    const props = {title: '掌握评估', subtitle: '', printTitle: '评估', questions: [makeProblemQuestion('q1', '计算题')], currentIndex: 0,
      answeredCount: 0, progressForQuestion: () => ({answered:false}), onBack: vi.fn(), onGoToQuestion: vi.fn(),
      showPaperBatch:false, onTogglePaperBatch:vi.fn(), onBatchGraded:vi.fn(), lastAction:null};
    const {rerender} = render(<QuestionSessionRunner {...props} collectMode deferredGrading />);
    expect(screen.getByRole('button', {name: '对照解析自评'})).toBeInTheDocument();
    expect(screen.queryByText('标准解析')).not.toBeInTheDocument();
    rerender(<QuestionSessionRunner {...props} />);
    expect(screen.getByRole('button', {name: '对照解析自评'})).toBeInTheDocument();
  });

  it.each([false, true])('saves and restores self-review without submitting until the full set is confirmed (wholePaper=%s)', async wholePaper => {
    const questions = [makeChoiceQuestion('q_choice', '选择题'), makeProblemQuestion('q_review', '自评题')];
    const persistenceKey = `student:self-review-set:${wholePaper}`;
    const answer = vi.fn().mockResolvedValue({answer_id: 41, is_correct: true, correct_answer: 'B', explanation: null, mastery_update: {}});
    const completed = vi.fn();
    apiMocks.submitSelfReview.mockResolvedValue({answer_id: 42, is_correct: false, correct_answer: '规范答案',
      extracted_answer: '自评：整题部分正确', explanation: '标准解析', mastery_update: {}} satisfies SubmitResult);
    function SelfReviewSet() {
      const [index, setIndex] = useState(1);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      return <QuestionSessionRunner persistenceKey={persistenceKey} title="自评整套" subtitle="" printTitle="自评整套"
        questions={questions} currentIndex={index} answeredCount={0} onGoToQuestion={setIndex} onBack={vi.fn()}
        progressForQuestion={id => ({answered: !!answers[id]})} resultForQuestion={id => answers[id]}
        showPaperBatch={false} onTogglePaperBatch={vi.fn()} onBatchGraded={vi.fn()} lastAction={null}
        wholePaper={wholePaper} collectMode deferredGrading onAnswer={answer} onAllGraded={completed}
        onAnswered={(id, result) => setAnswers(previous => ({...previous, [id]: result}))} />;
    }
    const first = render(<SelfReviewSet />);
    await userEvent.click(await screen.findByRole('button', {name: '手写答题区'}));
    await userEvent.click(screen.getByRole('button', {name: '对照解析自评'}));
    expect(screen.getByText('标准解析')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: '半对'}));
    await userEvent.click(screen.getByRole('button', {name: '保存自评'}));
    expect(screen.getByRole('status')).toHaveTextContent('自评 1');
    expect(apiMocks.submitSelfReview).not.toHaveBeenCalled();
    expect(apiMocks.submitPhoto).not.toHaveBeenCalled();
    await goToQuestion(1);
    await userEvent.click(screen.getByText('选择题 选项B'));
    first.unmount();
    await flushPracticeDraftWrites();

    render(<SelfReviewSet />);
    await userEvent.click(await screen.findByRole('button', {name: '对照解析自评'}));
    expect(screen.getByRole('button', {name: '半对'})).toHaveClass('active');
    expect(screen.getByRole('status')).toHaveTextContent('已作答 2/2 · 选择 1 · 自评 1');
    const submitLabel = wholePaper ? '提交整卷' : '提交批改';
    await userEvent.click(screen.getByRole('button', {name: submitLabel}));
    expect(screen.getByRole('dialog')).toHaveTextContent('自评 1');
    await userEvent.click(screen.getByRole('button', {name: wholePaper ? '返回检查' : '暂不提交'}));
    expect(answer).not.toHaveBeenCalled();
    expect(apiMocks.submitSelfReview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', {name: submitLabel}));
    await userEvent.click(screen.getByRole('button', {name: wholePaper ? '确认交卷并批改' : '开始AI批改'}));
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(answer).toHaveBeenCalledExactlyOnceWith('q_choice', 'B');
    expect(apiMocks.submitSelfReview).toHaveBeenCalledExactlyOnceWith({question_id: 'q_review',
      items: [{label: '整题', status: 'partial'}], time_spent_ms: 0, target_knowledge_point_id: 'kp-target'}, persistenceKey);
    expect(apiMocks.submitPhoto).not.toHaveBeenCalled();
  });

  it('attaches deferred choice-question handwriting drafts as process evidence during full-set grading', async () => {
    apiMocks.submitPhoto.mockResolvedValue({
      is_correct: true,
      correct_answer: '规范答案',
      explanation: '解析',
      mastery_update: {},
      extracted_answer: '拍照答案',
    } satisfies SubmitResult);
    apiMocks.submitProcessEvidence.mockResolvedValue({
      answer_id: 77,
      question_id: 'q_choice',
      process_grading: {
        final_answer: 'B',
        answer_source: 'choice',
        process_evidence_kind: 'scratch_image',
      },
    });

    function DeferredChoiceEvidenceHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      const [collected, setCollected] = useState<Record<string, string>>({});
      const questions = [
        makeChoiceQuestion('q_choice', '选择题'),
        makeProblemQuestion('q_solution', '解答题'),
      ];

      const handleAnswer = async (questionId: string, answer: string) => {
        const result: SubmitResult = {
          answer_id: 77,
          is_correct: true,
          correct_answer: answer,
          explanation: '选择题解析',
          mastery_update: {},
          extracted_answer: answer,
        };
        setAnswers(prev => ({ ...prev, [questionId]: result }));
        return result;
      };

      return (
        <QuestionSessionRunner
          title="掌握评估"
          subtitle="两题"
          printTitle="掌握评估"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={Object.keys(collected).length}
          progressForQuestion={(questionId) => ({ answered: !!collected[questionId] || !!answers[questionId] })}
          resultForQuestion={(questionId) => answers[questionId]}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          collectMode
          deferredGrading
          onAnswer={handleAnswer}
          onAnswered={(questionId, result) => setAnswers(prev => ({ ...prev, [questionId]: result }))}
          onCollect={(questionId, answer) => setCollected(prev => ({ ...prev, [questionId]: answer }))}
          lastAction={<button type="button">提交评估</button>}
        />
      );
    }

    render(<DeferredChoiceEvidenceHarness />);

    await userEvent.click(screen.getByText('手写答题区'));
    await userEvent.click(screen.getByText('选择题 选项B'));
    await goToQuestion(2);
    await userEvent.click(screen.getByText('拍照上传纸面解答'));
    await userEvent.click(screen.getByText('选择解答照片'));
    await userEvent.click(screen.getByRole('button', { name: '提交批改' }));
    await userEvent.click(screen.getByRole('button', { name: '开始AI批改' }));

    expect(apiMocks.submitProcessEvidence).not.toHaveBeenCalled();
    expect(apiMocks.submitPhoto).toHaveBeenCalledWith(
      'student-1', expect.any(File), 'q_solution', 0, 'kp-target',
    );
  });

  it('does not attach choice-question handwriting drafts when the selected answer is correct', async () => {
    function CorrectChoiceEvidenceHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const questions = [makeChoiceQuestion('q1', '选择题')];

      return (
        <QuestionSessionRunner
          title="知识小测"
          subtitle="一题"
          printTitle="知识小测"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={0}
          progressForQuestion={() => ({ answered: false })}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          onAnswer={async (_questionId, answer): Promise<SubmitResult> => ({
            answer_id: 42,
            is_correct: true,
            correct_answer: 'B',
            explanation: '选择题解析',
            mastery_update: {},
            extracted_answer: answer,
          })}
          lastAction={<button type="button">完成</button>}
        />
      );
    }

    render(<CorrectChoiceEvidenceHarness />);

    await userEvent.click(screen.getByText('手写答题区'));
    await userEvent.click(screen.getByText('选择题 选项B'));
    await userEvent.click(screen.getByRole('button', { name: '提交答案' }));

    expect(apiMocks.submitProcessEvidence).not.toHaveBeenCalled();
    expect(screen.getByText('选择题解析')).toBeInTheDocument();
  });

  it('attaches final draft image for wrong choice answers', async () => {
    apiMocks.submitProcessEvidence.mockResolvedValue({
      answer_id: 42,
      question_id: 'q1',
      process_grading: {
        final_answer: 'B',
        answer_source: 'choice',
        process_evidence_kind: 'scratch_image',
      },
    });

    function ChoiceEvidenceHarness() {
      const [currentIndex, setCurrentIndex] = useState(0);
      const questions = [makeChoiceQuestion('q1', '选择题')];

      return (
        <QuestionSessionRunner
          title="知识小测"
          subtitle="一题"
          printTitle="知识小测"
          questions={questions}
          currentIndex={currentIndex}
          answeredCount={0}
          progressForQuestion={() => ({ answered: false })}
          onBack={vi.fn()}
          onGoToQuestion={setCurrentIndex}
          showPaperBatch={false}
          onTogglePaperBatch={vi.fn()}
          onBatchGraded={vi.fn()}
          onAnswer={async (_questionId, answer): Promise<SubmitResult> => ({
            answer_id: 42,
            is_correct: false,
            correct_answer: 'A',
            explanation: '选择题解析',
            mastery_update: {},
            extracted_answer: answer,
          })}
          lastAction={<button type="button">完成</button>}
        />
      );
    }

    render(<ChoiceEvidenceHarness />);

    await userEvent.click(screen.getByText('手写答题区'));
    await userEvent.click(screen.getByText('选择题 选项B'));
    await userEvent.click(screen.getByRole('button', { name: '提交答案' }));

    expect(apiMocks.submitProcessEvidence).toHaveBeenCalledWith(
      42,
      'q1',
      expect.any(File),
      0,
    );
    expect(screen.getByText('选择题解析')).toBeInTheDocument();
  });
  it('collects an editable topic paper, warns about blank questions and grades all sources only on hand-in', async () => {
    const answer = vi.fn().mockResolvedValue({ answer_id: 81, is_correct: true, correct_answer: 'B', explanation: null, mastery_update: {} });
    apiMocks.submitPhoto.mockResolvedValue({ answer_id: 82, is_correct: true, correct_answer: '规范答案', explanation: null, mastery_update: {} });
    const completed = vi.fn();
    function Paper() {
      const [index, setIndex] = useState(0);
      const [answers, setAnswers] = useState<Record<string, SubmitResult>>({});
      return <QuestionSessionRunner title="专题套卷" subtitle="" printTitle="套卷" wholePaper collectMode deferredGrading
        questions={[makeChoiceQuestion('q1', '第一题'), makeProblemQuestion('q2', '第二题'), makeChoiceQuestion('q3', '第三题')]}
        currentIndex={index} answeredCount={0} onGoToQuestion={setIndex} onBack={vi.fn()}
        progressForQuestion={id => ({answered: !!answers[id]})} resultForQuestion={id => answers[id]}
        showPaperBatch={false} onTogglePaperBatch={vi.fn()} onBatchGraded={vi.fn()} lastAction={null}
        onAnswer={answer} onAnswered={(id, result) => setAnswers(previous => ({...previous, [id]: result}))} onAllGraded={completed} />;
    }
    render(<Paper />);
    expect(screen.getByRole('button', {name: '提交整卷'})).toBeEnabled();
    await userEvent.click(screen.getByText('第一题 选项A'));
    await goToQuestion(2);
    expect(screen.getByRole('button', {name: '对照解析自评'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: '手写答题区'}));
    await goToQuestion(1);
    await userEvent.click(screen.getByText('第一题 选项B'));
    expect(document.querySelector('.question-workspace-count')).toHaveTextContent('2 / 3');
    expect(answer).not.toHaveBeenCalled();
    expect(apiMocks.submitPhoto).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', {name: '提交整卷'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('未作答题号：3');
    await userEvent.click(screen.getByRole('button', {name: '返回检查'}));
    expect(answer).not.toHaveBeenCalled();
    await goToQuestion(3);
    await userEvent.click(screen.getByText('第三题 选项A'));
    await userEvent.click(screen.getByRole('button', {name: '提交整卷'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('已作答 3/3');
    await userEvent.click(screen.getByRole('button', {name: '确认交卷并批改'}));
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls).toEqual([['q1', 'B'], ['q3', 'A']]);
    expect(apiMocks.submitPhoto).toHaveBeenCalledWith('student-1', expect.any(File), 'q2', 0, 'kp-target');
    expect(apiMocks.submitSelfReview).not.toHaveBeenCalled();
  });

});
