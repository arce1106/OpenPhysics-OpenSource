import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api/client';
import type { Question } from '../types';
import WorkspacePage from './WorkspacePage';

const fixture: Question = {
  id: 'q_answer_edit', stem_text: '质量为 2 kg 的物体，受到 6 N 的合力，求加速度。',
  answer: '$a=2\\,\\mathrm{m/s^2}$', explanation: '原解析', question_type: 'problem_solving',
  difficulty: 2, difficulty_tier: 'medium', source: 'human', quality_status: 'draft', created_at: '',
  options: [], labels: [], formulas: [], images: [],
};
let stored: Question;

function renderWorkspace() {
  return render(<MemoryRouter><WorkspacePage kps={[]} selectedVolumeKey={null} selectedKpId="all"
    selectedChapterKey={null} selectedSectionKey={null} allQuestionsId="all" /></MemoryRouter>);
}

async function openDetail() {
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑答案解析' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  stored = structuredClone(fixture);
  vi.spyOn(api, 'listQuestionsPaged').mockImplementation(async () => ({
    items: [structuredClone(stored)], total: 1, page: 1, page_size: 20,
  }));
  vi.spyOn(api, 'updateQuestion').mockImplementation(async (_id, patch) => {
    stored = { ...stored, ...patch };
    return { id: stored.id, answer: stored.answer ?? null, explanation: stored.explanation ?? null };
  });
});

describe('question answer editing', () => {
  it('edits directly from the list, previews formulas, preserves a collapsed draft and persists on reopening', async () => {
    const host = renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: '答案解析' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑答案解析' }));
    const answer = '$a=3\\,\\mathrm{m/s^2}$';
    const explanation = '根据牛顿第二定律：\n$F=ma$，所以 $a=F/m=3$。';
    fireEvent.change(screen.getByLabelText('答案', { exact: true }), { target: { value: answer } });
    fireEvent.change(screen.getByLabelText('解析', { exact: true }), { target: { value: explanation } });
    fireEvent.click(screen.getByRole('button', { name: '预览效果' }));
    expect(host.container.querySelector('.question-answer-preview .katex')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '答案解析' }));
    fireEvent.click(screen.getByRole('button', { name: '答案解析' }));
    expect(screen.getByLabelText('答案', { exact: true })).toHaveValue(answer);
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    await screen.findByText('答案解析已保存');
    expect(api.updateQuestion).toHaveBeenCalledWith(fixture.id, { answer, explanation });
    expect(screen.queryByRole('button', { name: '← 返回列表' })).not.toBeInTheDocument();
    expect(stored.difficulty).toBe(fixture.difficulty);
    host.unmount();
    renderWorkspace();
    await openDetail();
    expect(screen.getByLabelText('答案', { exact: true })).toHaveValue(answer);
    expect(screen.getByLabelText('解析', { exact: true })).toHaveValue(explanation);
  });

  it('cancels changes without saving and resets the draft when editing again', async () => {
    renderWorkspace();
    await openDetail();
    fireEvent.change(screen.getByLabelText('答案', { exact: true }), { target: { value: '未保存答案' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(api.updateQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '编辑答案解析' }));
    expect(screen.getByLabelText('答案', { exact: true })).toHaveValue(fixture.answer);
    expect(screen.getByRole('button', { name: '保存答案解析' })).toBeDisabled();
  });

  it('retains a failed draft and disables submission during retry', async () => {
    vi.mocked(api.updateQuestion).mockRejectedValueOnce(new Error('连接中断'));
    renderWorkspace();
    await openDetail();
    fireEvent.change(screen.getByLabelText('解析', { exact: true }), { target: { value: '新的解析' } });
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('连接中断');
    expect(screen.getByLabelText('解析', { exact: true })).toHaveValue('新的解析');
    let complete!: (value: { id: string; answer: string | null; explanation: string | null }) => void;
    vi.mocked(api.updateQuestion).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByLabelText('解析', { exact: true })).toBeDisabled();
    complete({ id: fixture.id, answer: fixture.answer!, explanation: '新的解析（服务端返回）' });
    await screen.findByText('答案解析已保存');
    expect(screen.getByText('新的解析（服务端返回）')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.updateQuestion).toHaveBeenCalledTimes(2);
  });

  it('can add missing content, clear it deliberately, and keep unrelated question fields', async () => {
    stored = { ...stored, answer: undefined, explanation: undefined };
    renderWorkspace();
    await openDetail();
    fireEvent.change(screen.getByLabelText('答案', { exact: true }), { target: { value: '3 m/s²' } });
    fireEvent.change(screen.getByLabelText('解析', { exact: true }), { target: { value: '由 F=ma 得到。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    await screen.findByText('答案解析已保存');
    fireEvent.click(screen.getByRole('button', { name: '编辑答案解析' }));
    fireEvent.change(screen.getByLabelText('答案', { exact: true }), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('解析', { exact: true }), { target: { value: '  \n ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    await screen.findByText('暂无答案');
    expect(screen.getByText('暂无解析')).toBeInTheDocument();
    expect(api.updateQuestion).toHaveBeenLastCalledWith(fixture.id, { answer: null, explanation: null });
    expect(stored.stem_text).toBe(fixture.stem_text);
    expect(stored.quality_status).toBe(fixture.quality_status);
  });

  it('does not overwrite a saved answer when a metadata edit was already open', async () => {
    renderWorkspace();
    await openDetail();
    const basics = screen.getByRole('heading', { name: '基础信息' }).parentElement!;
    fireEvent.click(within(basics).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('答案', { exact: true }), { target: { value: '3 m/s²' } });
    fireEvent.click(screen.getByRole('button', { name: '保存答案解析' }));
    await screen.findByText('答案解析已保存');
    fireEvent.click(within(basics).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.updateQuestion).toHaveBeenCalledTimes(2));
    expect(api.updateQuestion).toHaveBeenLastCalledWith(fixture.id, {
      question_type: fixture.question_type, difficulty_tier: fixture.difficulty_tier, difficulty: fixture.difficulty,
    });
    expect(stored.answer).toBe('3 m/s²');
    fireEvent.click(screen.getByRole('button', { name: '编辑答案解析' }));
    expect(screen.getByLabelText('答案', { exact: true })).toHaveValue('3 m/s²');
  });
});
