import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PageErrorBoundary, { isStaleChunkError } from './PageErrorBoundary';

function Boom({ error }: { error: Error }): JSX.Element {
  throw error;
}

describe('PageErrorBoundary', () => {
  it('recognises chunks that disappeared after a release', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/admin/assets/a.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('asks to refresh instead of rendering a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <PageErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module')} />
      </PageErrorBoundary>,
    );
    expect(screen.getByText('管理端已更新')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  });
});
