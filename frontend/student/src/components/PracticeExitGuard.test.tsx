import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PracticeExitGuard, { usePracticeExitGuard, usePracticeSubmissionActivity } from './PracticeExitGuard';

function setup({ unfinished = true, busy = false, discard = vi.fn(async () => {}), logout = vi.fn() } = {}) {
  let finishSubmission = () => {};
  function Practice() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(busy);
    finishSubmission = () => setSubmitting(false);
    const exit = usePracticeExitGuard({ unfinished, discard });
    usePracticeSubmissionActivity(submitting);
    return <><input aria-label="答案" defaultValue="原答案" />
      <Link to="/home">顶部首页</Link>
      <button onClick={() => exit(() => navigate('/home'))}>页面返回</button>
      <button onClick={() => exit(() => { logout(); navigate('/home'); })}>退出登录</button>
    </>;
  }
  const router = createMemoryRouter([{ element:
    <PracticeExitGuard sessionAvailable={() => true}><Outlet /></PracticeExitGuard>, children: [
      { path: '/home', element: <h1>首页</h1> }, { path: '/practice', element: <Practice /> },
    ],
  }], { initialEntries: ['/home', '/practice'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return { router, discard, logout, finishSubmission: () => finishSubmission(), user: userEvent.setup() };
}

describe('practice exit protection', () => {
  it('cancels navigation without losing answers, then discards exactly once on confirmation', async () => {
    const { user, discard } = setup();
    await user.type(screen.getByLabelText('答案'), '继续写');
    await user.click(screen.getByRole('link', { name: '顶部首页' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续作答' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '继续作答' }));
    expect(screen.getByLabelText('答案')).toHaveValue('原答案继续写');
    expect(discard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '页面返回' }));
    await user.click(screen.getByRole('button', { name: '放弃并退出' }));
    expect(await screen.findByRole('heading', { name: '首页' })).toBeInTheDocument();
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('blocks browser history back and restores the original page when cancelled', async () => {
    const { router, user } = setup();
    await act(() => router.navigate(-1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(router.state.location.pathname).toBe('/practice');
    await act(() => router.navigate(-1));
    await user.click(screen.getByRole('button', { name: '放弃并退出' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'));
  });

  it('asks the browser to confirm refresh only while unfinished', () => {
    setup();
    const event = new Event('beforeunload', { cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not warn or discard completed work', async () => {
    const { user, discard } = setup({ unfinished: false });
    const event = new Event('beforeunload', { cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('link', { name: '顶部首页' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '首页' })).toBeInTheDocument();
  });

  it('does not clear the login session before confirmation', async () => {
    const { user, logout } = setup();
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '继续作答' }));
    expect(logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    await user.click(screen.getByRole('button', { name: '放弃并退出' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it('prevents abandoning an active submission and permits retry after it finishes', async () => {
    const { user, discard, finishSubmission } = setup({ busy: true });
    await user.click(screen.getByRole('button', { name: '页面返回' }));
    expect(screen.getByRole('heading', { name: '正在提交作答' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放弃并退出' })).toBeDisabled();
    expect(discard).not.toHaveBeenCalled();
    act(finishSubmission);
    await user.click(screen.getByRole('button', { name: '放弃并退出' }));
    expect(await screen.findByRole('heading', { name: '首页' })).toBeInTheDocument();
  });

  it('stays on the question if cleanup fails', async () => {
    const { user } = setup({ discard: vi.fn(async () => { throw new Error('storage'); }) });
    await user.click(screen.getByRole('button', { name: '页面返回' }));
    await user.click(screen.getByRole('button', { name: '放弃并退出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未能清理');
    await user.click(screen.getByRole('button', { name: '继续作答' }));
    expect(screen.getByLabelText('答案')).toHaveValue('原答案');
  });
});
