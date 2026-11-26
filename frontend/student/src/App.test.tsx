import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { setStudentSession, clearStudentSession } from './api/studentIdentity';

vi.mock('./pages/HomePage', () => ({ default: () => <main><h1>学习首页</h1></main> }));
vi.mock('./pages/SyncPage', () => ({ default: () => <main><h1>同步学习内容</h1></main> }));
vi.mock('./pages/LoginPage', () => ({ default: () => <main><h1>账号登录</h1></main> }));
vi.mock('./api/client', () => ({ api: { getCurrentStudent: vi.fn(() => Promise.resolve({
  id: 'demo', username: 'demo', display_name: '演示学生', status: 'active',
})) } }));

beforeEach(() => {
  localStorage.clear();
  clearStudentSession();
  delete window.Capacitor;
  window.history.replaceState({}, '', '/');
});

it('sends anonymous learners directly to login', async () => {
  window.history.replaceState({}, '', '/sync');
  render(<App />);
  expect(await screen.findByRole('heading', { name: '账号登录' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

it('opens learning for an active account without paid account fields', async () => {
  setStudentSession('demo-token', { id: 'demo', username: 'demo', display_name: '演示学生', status: 'active' });
  window.history.replaceState({}, '', '/sync');
  render(<App />);
  expect(await screen.findByRole('heading', { name: '同步学习内容' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'OpenPhysics' })).toHaveAttribute('href', '/');
  expect(screen.queryByText(/会员|套餐|支付|订阅/)).not.toBeInTheDocument();
});

it('has no checkout route and falls back to the learning home', async () => {
  setStudentSession('demo-token', { id: 'demo', username: 'demo', display_name: '演示学生', status: 'active' });
  window.history.replaceState({}, '', '/payment/checkout');
  render(<App />);
  expect(await screen.findByRole('heading', { name: '学习首页' })).toBeInTheDocument();
  await waitFor(() => expect(window.location.pathname).toBe('/'));
});
