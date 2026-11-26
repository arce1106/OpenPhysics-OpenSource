import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PaperBatchGradingPanel from './PaperBatchGradingPanel';
import { api } from '../api/client';
import type { Question, SubmitResult } from '../types';
import {PracticeAttemptContext} from './PracticeAttemptContext';
import {flushPracticeDraftWrites, savePracticeDrafts} from '../utils/practicePersistence';

const compressionMocks = vi.hoisted(() => ({
  compressPaperImageFile: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: {
    correctAnswer: vi.fn(),
    submitAnswer: vi.fn(),
    submitPaperBatch: vi.fn(),
    submitSelfReview: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
}));

vi.mock('../utils/imageCompression', () => ({
  ANSWER_IMAGE_MAX_SOURCE_BYTES: 20 * 1024 * 1024,
  PAPER_BATCH_MAX_TOTAL_BYTES: 10 * 1024 * 1024,
  PAPER_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  compressPaperImageFile: compressionMocks.compressPaperImageFile,
}));

const question: Question = {
  id: 'q1',
  stem_text: '计算小球落地速度',
  question_type: 'problem_solving',
  target_knowledge_point_id: 'kp-critical',
  options: [],
};

const aiResult: SubmitResult = {
  answer_id: 101,
  is_correct: false,
  correct_answer: 'v=gt',
  explanation: '自由落体末速度由 v=gt 得到。',
  mastery_update: {},
  extracted_answer: 'v=g',
  process_grading: {
    answer_image_path: '/static/uploads/answers/student/paper-crop-q1.jpg',
  },
};

const correctedResult: SubmitResult = {
  ...aiResult,
  is_correct: true,
  extracted_answer: 'v=gt',
};

describe('PaperBatchGradingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compressionMocks.compressPaperImageFile.mockImplementation(async (file: File) => (
      new File(['compressed'], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
    ));
    vi.mocked(api.submitPaperBatch).mockResolvedValue({
      results: { q1: aiResult },
      errors: {},
      solutions: {},
    });
    vi.mocked(api.correctAnswer).mockResolvedValue(correctedResult);
    vi.mocked(api.submitSelfReview).mockResolvedValue({
      ...correctedResult,
      answer_id: 102,
      is_correct: false,
      extracted_answer: '自评：(1)完全正确；(2)部分正确',
    });
  });

  it('collects worksheet photos before grading and lets students manually correct one result', async () => {
    const onGraded = vi.fn();
    render(<PaperBatchGradingPanel questions={[question]} onGraded={onGraded} />);

    expect(screen.getByText('上传整套题单')).toBeInTheDocument();
    expect(screen.queryByText('计算小球落地速度')).not.toBeInTheDocument();

    await userEvent.upload(
      screen.getByLabelText('上传整套纸面答案'),
      new File(['worksheet answer'], 'worksheet.png', { type: 'image/png' }),
    );

    expect(api.submitPaperBatch).not.toHaveBeenCalled();
    expect(await screen.findByText('已添加 1 张')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始批改整套题' }));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));

    await waitFor(() => {
      expect(api.submitPaperBatch).toHaveBeenCalledWith(
        [expect.any(File)],
        ['q1'],
        0,
        { q1: 'kp-critical' },
      );
    });
    expect(compressionMocks.compressPaperImageFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'worksheet.png' }),
    );
    expect(vi.mocked(api.submitPaperBatch).mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ name: 'worksheet.jpg', type: 'image/jpeg' }),
    );
    expect(await screen.findByText('整套题批改结果')).toBeInTheDocument();
    expect(onGraded).toHaveBeenCalledWith({ q1: aiResult });
    expect(await screen.findByText('AI 识别：')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大查看：学生作答图片' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('v=g');
    expect(document.body).toHaveTextContent('自由落体末速度由');
    expect(document.body).toHaveTextContent('v=gt');

    await userEvent.type(screen.getByPlaceholderText('如果 AI 识别不准，在这里输入订正答案'), 'v=gt');
    await userEvent.click(screen.getByRole('button', { name: '提交订正' }));

    await waitFor(() => {
      expect(api.correctAnswer).toHaveBeenCalledWith(101, {
        corrected_answer: 'v=gt',
        is_correct: true,
        correction_reason: '学生手动纠正 AI 批改结果',
      });
    });
    expect(await screen.findByText('订正后：正确')).toBeInTheDocument();
  });

  it('restores queued photos and preserves original question order for server-side partial retry', async () => {
    const renderPaper = () => render(<PracticeAttemptContext.Provider value="student:paper-attempt">
      <PaperBatchGradingPanel questions={[question, {...question,id:'q2'}]} />
    </PracticeAttemptContext.Provider>);
    const first = renderPaper();
    await userEvent.upload(await screen.findByLabelText('上传整套纸面答案'), new File(['paper'], 'paper.png', {type:'image/png'}));
    await screen.findByText('已添加 1 张');
    first.unmount();
    await flushPracticeDraftWrites();
    renderPaper();
    expect(await screen.findByText('已添加 1 张')).toBeInTheDocument();
    vi.mocked(api.submitPaperBatch).mockResolvedValueOnce({results:{q1:aiResult},errors:{q2:'暂不可用'},solutions:{}});
    await userEvent.click(screen.getByRole('button',{name:'开始批改整套题'}));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));
    await screen.findByText('暂不可用');
    await userEvent.click(screen.getByRole('button',{name:'重试未完成题目'}));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));
    expect(vi.mocked(api.submitPaperBatch).mock.calls[1][1]).toEqual(['q1', 'q2']);
  });

  it('does not restore a transient correction loading flag after its request was interrupted', async () => {
    await savePracticeDrafts('student:interrupted:paper',{answers:{},photos:{},handwriting:{},selfReviews:{},backgrounds:{},
      metadata:{items:{q1:{result:aiResult,correction:'v=gt',correctionLoading:true}}}});
    render(<PracticeAttemptContext.Provider value="student:interrupted"><PaperBatchGradingPanel questions={[question]} /></PracticeAttemptContext.Provider>);
    expect(await screen.findByRole('button',{name:'提交订正'})).toBeEnabled();
  });

  it('lets students self-review a long answer when AI cannot recognize it', async () => {
    vi.mocked(api.submitPaperBatch).mockResolvedValueOnce({
      results: {},
      errors: { q1: 'AI 未能识别这道题的答案' },
      solutions: {
        q1: {
          correct_answer: '(1)6 s　(2)60 m/s',
          explanation: '先由 h=1/2gt^2 求时间，再由 v=gt 求速度。',
        },
      },
    });

    render(<PaperBatchGradingPanel questions={[{
      ...question,
      stem_text: '计算：(1)落地时间；(2)落地速度',
    }]} />);

    await userEvent.upload(
      screen.getByLabelText('上传整套纸面答案'),
      new File(['worksheet answer'], 'worksheet.png', { type: 'image/png' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '开始批改整套题' }));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));

    await userEvent.click(await screen.findByRole('button', { name: '对照解析自评' }));

    expect(screen.getByText(/60 m\/s/)).toBeInTheDocument();
    expect(document.body).toHaveTextContent('先由');
    expect(document.body).toHaveTextContent('h=1/2gt^{2}');
    expect(document.body).toHaveTextContent('v=gt');

    await userEvent.click(screen.getAllByRole('button', { name: '全对' })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: '半对' })[1]);
    await userEvent.click(screen.getByRole('button', { name: '提交自评' }));

    await waitFor(() => {
      expect(api.submitSelfReview).toHaveBeenCalledWith({
        question_id: 'q1',
        items: [
          { label: '(1)', status: 'correct' },
          { label: '(2)', status: 'partial' },
        ],
        time_spent_ms: 0,
        target_knowledge_point_id: 'kp-critical',
      });
    });
    expect(await screen.findByText('订正后：仍需修改')).toBeInTheDocument();
  });

  it('does not create a plain no-image answer when a paper result lacks answer id', async () => {
    vi.mocked(api.submitPaperBatch).mockResolvedValueOnce({
      results: {
        q1: {
          ...aiResult,
          answer_id: null,
        },
      },
      errors: {},
      solutions: {},
    });

    render(<PaperBatchGradingPanel questions={[question]} />);

    await userEvent.upload(
      screen.getByLabelText('上传整套纸面答案'),
      new File(['worksheet answer'], 'worksheet.png', { type: 'image/png' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '开始批改整套题' }));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));

    await userEvent.type(
      await screen.findByPlaceholderText('如果 AI 识别不准，在这里输入订正答案'),
      'v=gt',
    );
    await userEvent.click(screen.getByRole('button', { name: '提交订正' }));

    expect(api.submitAnswer).not.toHaveBeenCalled();
    expect(await screen.findByText('这条纸笔批改记录缺少记录编号，请重新上传后再订正')).toBeInTheDocument();
  });

  it('allows adding multiple worksheet pages before one batch grading request', async () => {
    render(<PaperBatchGradingPanel questions={[question]} />);

    await userEvent.upload(
      screen.getByLabelText('上传整套纸面答案'),
      new File(['page one'], 'page-1.png', { type: 'image/png' }),
    );
    await userEvent.upload(
      screen.getByLabelText('继续添加纸面答案照片'),
      new File(['page two'], 'page-2.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('已添加 2 张')).toBeInTheDocument();
    expect(api.submitPaperBatch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '开始批改整套题' }));
    await userEvent.click(screen.getByRole('button', { name: '确认整套批改' }));

    await waitFor(() => {
      expect(api.submitPaperBatch).toHaveBeenCalledWith(
        [expect.any(File), expect.any(File)],
        ['q1'],
        0,
        { q1: 'kp-critical' },
      );
    });
    expect(compressionMocks.compressPaperImageFile).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized source page before compression or upload', async () => {
    render(<PaperBatchGradingPanel questions={[question]} />);
    const oversized = new File(['large'], 'oversized.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });

    await userEvent.upload(screen.getByLabelText('上传整套纸面答案'), oversized);

    expect(await screen.findByText('单张原图不能超过 20MB')).toBeInTheDocument();
    expect(compressionMocks.compressPaperImageFile).not.toHaveBeenCalled();
    expect(api.submitPaperBatch).not.toHaveBeenCalled();
  });
});
