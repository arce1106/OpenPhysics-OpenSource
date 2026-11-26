import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuestionSessionState } from './useQuestionSessionState';
import type { SubmitResult } from '../types';

const gradedResult: SubmitResult = {
  answer_id: 1,
  is_correct: true,
  correct_answer: 'A',
  explanation: '解析',
  mastery_update: {},
  extracted_answer: 'A',
};

describe('useQuestionSessionState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits an answer with elapsed time and stores the result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const submitAnswer = vi.fn().mockResolvedValue(gradedResult);

    const { result } = renderHook(() => useQuestionSessionState({ submitAnswer }));
    vi.setSystemTime(1750);

    await act(async () => {
      await result.current.handleAnswer('q-1', 'A');
    });

    expect(submitAnswer).toHaveBeenCalledWith('q-1', 'A', 750);
    expect(result.current.answers['q-1']).toEqual(gradedResult);
  });

  it('stores extracted answers when batch grading is collected for deferred sessions', () => {
    const submitAnswer = vi.fn();
    const { result } = renderHook(() => useQuestionSessionState({ submitAnswer }));

    act(() => {
      result.current.handleBatchGraded({
        'q-1': gradedResult,
        'q-2': { ...gradedResult, answer_id: 2, extracted_answer: '' },
      }, true);
    });

    expect(result.current.answers['q-1']).toEqual(gradedResult);
    expect(result.current.answers['q-2']?.answer_id).toBe(2);
    expect(result.current.collectedAnswers).toEqual({ 'q-1': 'A' });
  });

  it('restores completed results and cleared selections without resubmitting, but a new attempt is blank', async () => {
    const submitAnswer = vi.fn().mockResolvedValue(gradedResult);
    const useSession = () => useQuestionSessionState({submitAnswer, studentId:'student-A', persistenceScope:'test'});
    const first = renderHook(useSession);
    const id = first.result.current.attemptId;
    act(() => {
      first.result.current.persistSessionPayload({questions:['q1', 'q2']});
      first.result.current.handleCollectAnswer('q2', '');
      first.result.current.goToQuestion(1);
    });
    await act(async () => { await first.result.current.handleAnswer('q1', 'A'); });
    first.unmount();
    const second = renderHook(useSession);
    expect(second.result.current.attemptId).toBe(id);
    expect(second.result.current.currentIdx).toBe(1);
    expect(second.result.current.collectedAnswers.q2).toBe('');
    await act(async () => { await second.result.current.handleAnswer('q1', 'A'); });
    expect(submitAnswer).toHaveBeenCalledTimes(1);
    const other = renderHook(() => useQuestionSessionState({submitAnswer,studentId:'student-B',persistenceScope:'test'}));
    expect(other.result.current.answers).toEqual({});
    act(() => second.result.current.resetSessionState());
    expect(second.result.current.attemptId).not.toBe(id);
    expect(second.result.current.answers).toEqual({});
  });

  it('does not apply an old batch callback to an explicitly new attempt', () => {
    const {result} = renderHook(() => useQuestionSessionState({submitAnswer:vi.fn(),studentId:'A',persistenceScope:'test'}));
    const oldBatch = result.current.handleBatchGraded;
    const oldCollect = result.current.handleCollectAnswer;
    act(() => result.current.resetSessionState());
    act(() => { oldBatch({'q1':gradedResult}, true); oldCollect('q1','A'); });
    expect(result.current.answers).toEqual({});
    expect(result.current.collectedAnswers).toEqual({});
  });
});
