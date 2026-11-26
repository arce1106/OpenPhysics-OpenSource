import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { Question } from '../types';
import WorkspacePage from './WorkspacePage';

function question(id: string, extra: Partial<Question> = {}): Question {
  return {
    id, stem_text: `题干内容 ${id.length}`, answer: 'A', explanation: '解析', question_type: 'single_choice',
    difficulty: 2, difficulty_tier: 'medium', source: 'human', quality_status: 'draft', created_at: '',
    options: [], labels: [], formulas: [], images: [], ...extra,
  };
}

function renderWorkspace(initialEntry = '/resources?tab=questions', scope: Partial<{ selectedVolumeKey: string | null; selectedKpId: string | null }> = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspacePage kps={[]} selectedVolumeKey={scope.selectedVolumeKey ?? null} selectedKpId={scope.selectedKpId ?? 'all'}
        selectedChapterKey={null} selectedSectionKey={null} allQuestionsId="all" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('WorkspacePage', () => {
  it('only marks questions the server actually approved and lists the ones it rejected', async () => {
    vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({
      items: [question('q_ok'), question('q_no_answer', { answer: undefined })], total: 2, page: 1, page_size: 20,
    });
    vi.spyOn(api, 'batchReview').mockResolvedValue({
      updated: 1, errors: [{ id: 'q_no_answer', error: '缺少标准答案' }],
    });
    renderWorkspace();
    await screen.findAllByText('q_ok');

    fireEvent.click(screen.getByRole('button', { name: '本页通过' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '通过' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已通过 1 道，1 道未通过（q_no_answer：缺少标准答案）');
    expect(api.batchReview).toHaveBeenCalledWith(['q_ok', 'q_no_answer'], 'approved');
    // 一道变为“已通过”，被拒绝的那道仍是“草稿”。
    const badges = (label: string) => screen.getAllByText(label).filter(node => node.tagName !== 'OPTION');
    expect(badges('已通过')).toHaveLength(1);
    expect(badges('草稿')).toHaveLength(1);
  });

  it('scrolls the question list back to the top when turning pages', async () => {
    const list = vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({
      items: [question('q_page')], total: 45, page: 1, page_size: 20,
    });
    renderWorkspace();
    await screen.findAllByText('q_page');
    const scroller = screen.getByTestId('question-list');
    scroller.scrollTop = 900;

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    expect(scroller.scrollTop).toBe(0);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: '2' })));
  });

  it('keeps the stem draft open and explains why when saving fails', async () => {
    vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({
      items: [question('q_stem')], total: 1, page: 1, page_size: 20,
    });
    vi.spyOn(api, 'updateQuestion').mockRejectedValue(new Error('管理员登录已失效'));
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑题干' }));
    const textarea = screen.getByDisplayValue('题干内容 6');
    fireEvent.change(textarea, { target: { value: '改过的题干' } });
    fireEvent.click(screen.getByRole('button', { name: '保存题干' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('题干保存失败：管理员登录已失效');
    expect(screen.getByDisplayValue('改过的题干')).toBeInTheDocument();
  });

  it('searches the whole bank from a ?q= link, ignoring the selected scope', async () => {
    const list = vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({
      items: [question('q_0173')], total: 1, page: 1, page_size: 20,
    });
    renderWorkspace('/resources?tab=questions&q=q_0173', { selectedVolumeKey: '必修 第一册', selectedKpId: null });

    expect(await screen.findByText(/全库搜索：/)).toHaveTextContent('q_0173');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'q_0173' })));
    expect(list.mock.lastCall?.[0]).not.toHaveProperty('volume');
  });

  it('keeps a ?q= link when the default volume is selected after loading, and clears it when the user changes scope', async () => {
    vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    // StrictMode 与 main.tsx 一致：开发模式下 effect 会重复执行。
    const workspace = (volume: string | null) => (
      <StrictMode>
        <MemoryRouter initialEntries={['/resources?tab=questions&q=电场']}>
          <WorkspacePage kps={[]} selectedVolumeKey={volume} selectedKpId={null}
            selectedChapterKey={null} selectedSectionKey={null} allQuestionsId="all" />
        </MemoryRouter>
      </StrictMode>
    );
    // 直接打开链接：页面先在没有范围时挂载，题库目录加载后才选中默认分册。
    const { rerender } = render(workspace(null));
    rerender(workspace('必修 第一册'));
    expect(await screen.findByText(/全库搜索：/)).toHaveTextContent('电场');

    rerender(workspace('必修 第二册'));
    await waitFor(() => expect(screen.queryByText(/全库搜索：/)).not.toBeInTheDocument());
  });

  it('waits for typing to pause before searching', async () => {
    const list = vi.spyOn(api, 'listQuestionsPaged').mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
    renderWorkspace();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText('搜索题目');
    fireEvent.change(input, { target: { value: '斜' } });
    fireEvent.change(input, { target: { value: '斜面' } });
    fireEvent.change(input, { target: { value: '斜面摩擦' } });

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '斜面摩擦' })));
    expect(list.mock.calls.filter(([params]) => params?.search).length).toBe(1);
  });
});
