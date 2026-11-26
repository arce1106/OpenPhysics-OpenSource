import { StrictMode, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KpCheckPage from './KpCheckPage';
import { api } from '../api/client';
import type { KpDiagnosticResult, LearnBundle, PracticeSession, SubmitResult } from '../types';
import { loadPracticeRecord, newPracticeRecord, savePracticeRecord } from '../utils/practicePersistence';

vi.mock('../api/client', () => ({
  api: {
    getLearnBundle: vi.fn(),
    diagnoseKp: vi.fn(),
    getPracticeSession: vi.fn(),
    getKpSubmittedDiagnosticFeedback: vi.fn(),
    submitAnswer: vi.fn(),
  },
}));

vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'student-1',
  getStudentProfile: () => ({
    id: 'student-1',
    username: 'student',
    display_name: '学生',
    status: 'active',


  }),
}));

const gradedAnswer: SubmitResult = {
  answer_id: 7,
  is_correct: true,
  correct_answer: 'A',
  explanation: null,
  mastery_update: {
    'kp-1': { before: 0.2, after: 0.83, name: '质点' },
  },
};

const wrongGradedAnswer: SubmitResult = {
  ...gradedAnswer,
  answer_id: 8,
  is_correct: false,
};

vi.mock('../components/QuestionSessionRunner', () => ({
  default: (props: any) => {
    const allGraded = props.questions.every((question: { id: string }) => !!props.resultForQuestion(question.id));
    useEffect(() => {
      if (allGraded) props.onAllGraded?.();
    }, [allGraded, props.onAllGraded]);
    return (
      <div>
        <h1>{props.title}</h1>
        <div data-testid="runner-state" data-deferred={props.deferredGrading} data-collect={props.collectMode}>{JSON.stringify({
          ids: props.questions.map((question: { id: string }) => question.id),
          answered: props.answeredCount,
          index: props.currentIndex,
          attempt: props.persistenceKey,
        })}</div>
        <button type="button" onClick={() => props.onAnswered('q-1', gradedAnswer)}>
          mock grade q-1
        </button>
        <button type="button" onClick={() => props.onAnswered('q-1', wrongGradedAnswer)}>
          mock wrong q-1
        </button>
        <button type="button" onClick={() => props.onAnswer('q-1', 'A')}>
          mock submit q-1
        </button>
        {props.lastAction}
      </div>
    );
  },
}));

const bundle: LearnBundle = {
  kp_id: 'kp-1',
  kp_name: '质点',
  card: null,
  slides: null,
  simulations: [],
  examples: [],
  progress: {},
};

const diagnosticSession: PracticeSession = {
  student_id: 'student-1',
  session_type: 'kp_diagnostic',
  strategy: 'kp_diagnostic',
  session_objective: '掌握评估「质点」',
  session_structure: {
    phases: [{ phase: 'diagnostic', question_indices: [0] }],
    total: 1,
  },
  questions: [
    {
      id: 'q-1',
      stem_text: '题干',
      question_type: 'single_choice',
      options: [{ label: 'A', text: '选项' }],
    },
  ],
};

const backendResult: KpDiagnosticResult = {
  kp_id: 'kp-1',
  kp_name: '质点',
  correct_count: 1,
  total_count: 1,
  mastery_before: 0.2,
  mastery_after: 0.83,
  recommendation: 'mastered',
  feedback: '后端评估反馈',
};

describe('KpCheckPage', () => {
  const mockedApi = api as unknown as {
    getLearnBundle: ReturnType<typeof vi.fn>;
    diagnoseKp: ReturnType<typeof vi.fn>;
    getPracticeSession: ReturnType<typeof vi.fn>;
    getKpSubmittedDiagnosticFeedback: ReturnType<typeof vi.fn>;
    submitAnswer: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getLearnBundle.mockResolvedValue(bundle);
    mockedApi.diagnoseKp.mockResolvedValue(diagnosticSession);
    mockedApi.getPracticeSession.mockResolvedValue(diagnosticSession);
    mockedApi.getKpSubmittedDiagnosticFeedback.mockResolvedValue(backendResult);
    mockedApi.submitAnswer.mockResolvedValue(gradedAnswer);
  });

  function saveSession(mode: 'check' | 'practice', completed: boolean, withFeedback = true) {
    const query = `kp=kp-1&count=${mode === 'check' ? 3 : 5}&mode=${mode}`;
    const record = newPracticeRecord('student-1', `kp-check:${query}`, {
      bundle, session: diagnosticSession,
      ...(mode === 'check' && completed && withFeedback && { diagnosticResult: backendResult }),
    });
    if (completed) record.answers['q-1'] = wrongGradedAnswer;
    record.collectedAnswers['q-1'] = 'B';
    savePracticeRecord(record);
    return { query, record };
  }

  function openSession(query: string) {
    return render(<MemoryRouter initialEntries={[`/learn/check?${query}`]}>
      <Routes><Route path="/learn/check" element={<KpCheckPage />} /></Routes>
    </MemoryRouter>);
  }

  it('continues into practice when a completed assessment is reopened, preserving its result', async () => {
    const { query, record } = saveSession('check', true);
    openSession(query);
    await screen.findByRole('heading', { name: '巩固小练' });
    expect(mockedApi.diagnoseKp).not.toHaveBeenCalled();
    expect(mockedApi.getKpSubmittedDiagnosticFeedback).not.toHaveBeenCalled();
    expect(mockedApi.getPracticeSession).toHaveBeenCalledWith('student-1', 'kp-1', 5);
    expect(loadPracticeRecord('student-1', record.scope)?.payload.diagnosticResult).toEqual(backendResult);
  });

  it('starts a fresh round when a completed consolidation set is reopened', async () => {
    const { query, record } = saveSession('practice', true);
    openSession(query);
    await screen.findByRole('heading', { name: '巩固小练' });
    expect(mockedApi.getPracticeSession).toHaveBeenCalledOnce();
    const state = JSON.parse(screen.getByTestId('runner-state').textContent!);
    expect(state.answered).toBe(0);
    expect(state.attempt).not.toContain(record.id);
  });

  it.each(['check', 'practice'] as const)('preserves an unfinished %s session without replacing its questions', async mode => {
    const { query, record } = saveSession(mode, false);
    openSession(query);
    await screen.findByTestId('runner-state');
    expect(mockedApi.getPracticeSession).not.toHaveBeenCalled();
    expect(mockedApi.diagnoseKp).not.toHaveBeenCalled();
    expect(screen.getByTestId('runner-state')).toHaveTextContent(record.id);
    expect(loadPracticeRecord('student-1', record.scope)?.collectedAnswers['q-1']).toBe('B');
  });

  it('finishes a graded assessment with missing feedback without submitting its answers again', async () => {
    const { query } = saveSession('check', true, false);
    openSession(query);
    await screen.findByRole('dialog', { name: '评估结果' });
    expect(mockedApi.getKpSubmittedDiagnosticFeedback).toHaveBeenCalledOnce();
    expect(mockedApi.submitAnswer).not.toHaveBeenCalled();
    expect(mockedApi.diagnoseKp).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '做巩固小练' })).toBeInTheDocument();
  });

  it('can finish restored assessment feedback after StrictMode remount effects', async () => {
    const { query } = saveSession('check', true, false);
    render(<StrictMode><MemoryRouter initialEntries={[`/learn/check?${query}`]}>
      <Routes><Route path="/learn/check" element={<KpCheckPage />} /></Routes>
    </MemoryRouter></StrictMode>);
    await screen.findByRole('dialog', { name: '评估结果' });
    expect(mockedApi.submitAnswer).not.toHaveBeenCalled();
    expect(mockedApi.diagnoseKp).not.toHaveBeenCalled();
  });

  it('binds every direct knowledge point answer to the requested target', async () => {
    render(
      <MemoryRouter initialEntries={['/learn/check?kp=kp-1&count=3&mode=check']}>
        <Routes>
          <Route path="/learn/check" element={<KpCheckPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '掌握评估' });
    await userEvent.click(screen.getByRole('button', { name: 'mock submit q-1' }));

    expect(mockedApi.submitAnswer).toHaveBeenCalledWith('student-1', {
      question_id: 'q-1',
      given_answer: 'A',
      time_spent_ms: expect.any(Number),
      target_knowledge_point_id: 'kp-1',
      submission_id: expect.any(String),
    });
  });

  it('submits already graded check answers to backend for the mastery decision', async () => {
    render(
      <MemoryRouter initialEntries={['/learn/check?kp=kp-1&count=3&mode=check']}>
        <Routes>
          <Route path="/learn/check" element={<KpCheckPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '掌握评估' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'mock grade q-1' }));

    await waitFor(() => {
      expect(mockedApi.getKpSubmittedDiagnosticFeedback).toHaveBeenCalledWith(
        'kp-1',
        [{ answer_id: 7, mastery_update: gradedAnswer.mastery_update }],
        'student-1',
      );
    });
    expect(await screen.findByText('后端评估反馈')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '评估结果' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭结果' }));
    expect(screen.queryByRole('dialog', { name: '评估结果' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '评估结果' }));
    expect(screen.getByRole('dialog', { name: '评估结果' })).toBeInTheDocument();
  });

  it('keeps continuing consolidation inside the direct practice flow', async () => {
    render(
      <MemoryRouter initialEntries={['/learn/check?kp=kp-1&count=5&mode=practice']}>
        <Routes>
          <Route path="/learn/check" element={<KpCheckPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固小练' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'mock wrong q-1' }));

    expect(await screen.findByRole('dialog', { name: '练习结果' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '继续巩固' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '继续巩固' }));

    await waitFor(() => {
      expect(mockedApi.getPracticeSession).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('heading', { name: '巩固小练' })).toBeInTheDocument();
  });

  it('uses shared pill action classes for the consolidation summary button', async () => {
    render(
      <MemoryRouter initialEntries={['/learn/check?kp=kp-1&count=5&mode=practice']}>
        <Routes>
          <Route path="/learn/check" element={<KpCheckPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '巩固小练' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'mock grade q-1' }));
    await userEvent.click(await screen.findByRole('button', { name: '关闭结果' }));

    const summaryButton = screen.getByRole('button', { name: '练习结果' });
    expect(summaryButton).toHaveClass('question-workspace-nav-button');
    expect(summaryButton).toHaveClass('question-workspace-nav-button-primary');
    expect(summaryButton).toHaveClass('question-workspace-header-submit');
  });

  it('keeps the sync page as return target when assessment result sends student to learn', async () => {
    mockedApi.getKpSubmittedDiagnosticFeedback.mockResolvedValueOnce({
      ...backendResult,
      recommendation: 'study',
    });

    function LearnStateProbe() {
      const location = useLocation();
      const state = location.state as { from?: string; restoreKpId?: string } | null;
      return (
        <div>
          <div data-testid="learn-return-from">{state?.from || ''}</div>
          <div data-testid="learn-restore-kp">{state?.restoreKpId || ''}</div>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/learn/check?kp=kp-1&count=3&mode=check']}>
        <Routes>
          <Route path="/learn/check" element={<KpCheckPage />} />
          <Route path="/learn" element={<LearnStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '掌握评估' });
    await userEvent.click(screen.getByRole('button', { name: 'mock wrong q-1' }));
    await userEvent.click(await screen.findByRole('link', { name: '去同步学习' }));

    expect(screen.getByTestId('learn-return-from')).toHaveTextContent('/sync');
    expect(screen.getByTestId('learn-restore-kp')).toHaveTextContent('kp-1');
  });
  it.each(['diagnostic', 'check', 'practice'])('uses whole-set grading in knowledge-point mode %s', async mode => {
    render(<MemoryRouter initialEntries={[`/learn/check?kp=kp-1&mode=${mode}`]}><Routes>
      <Route path="/learn/check" element={<KpCheckPage />} />
    </Routes></MemoryRouter>);
    const runner = await screen.findByTestId('runner-state');
    expect(runner).toHaveAttribute('data-deferred', 'true');
    expect(runner).toHaveAttribute('data-collect', 'true');
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

});
