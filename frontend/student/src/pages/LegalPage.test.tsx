import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegalPage from './LegalPage';

describe('LegalPage', () => {
  it('publishes self-hosted operator and data-processing boundaries', () => {
    render(
      <MemoryRouter>
        <LegalPage document="privacy" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '隐私政策', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/这是自部署版本的说明模板/)).toBeInTheDocument();
    expect(screen.getByText(/数据存储地域、服务器、备份及外部服务由本部署管理员选择并告知/)).toBeInTheDocument();
    expect(screen.getByText(/AI 服务由本部署管理员自行配置/)).toBeInTheDocument();
    expect(screen.queryByText(/智谱/)).not.toBeInTheDocument();
    expect(screen.getByText(/最有利于未成年人的原则/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看用户协议' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: '查看未成年人保护规则' })).toHaveAttribute('href', '/legal/minors');
    expect(screen.getByRole('link', { name: 'maintainer@openphysics.example' })).toHaveAttribute(
      'href',
      'mailto:maintainer@openphysics.example',
    );
  });

  it('publishes special protections for high-school minors and children', () => {
    render(
      <MemoryRouter>
        <LegalPage document="minors" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '未成年人个人信息保护规则', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/这是自部署版本的说明模板/)).toBeInTheDocument();
    expect(screen.getByText(/未成年人上传答题图片前/)).toBeInTheDocument();
    expect(screen.getByText(/由学校或监护人协助落实适龄使用与个人信息保护/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看用户协议' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: '查看隐私政策' })).toHaveAttribute('href', '/legal/privacy');
  });
});
