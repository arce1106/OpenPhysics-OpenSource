import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrintButton from './PrintButton';

describe('PrintButton', () => {
  afterEach(() => {
    delete window.OpenPhysicsPrint;
    vi.restoreAllMocks();
  });

  it('uses browser printing by default', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    render(<PrintButton />);
    fireEvent.click(screen.getByRole('button', { name: '打印题单' }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the Android native print bridge when available', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const nativePrint = vi.fn();
    window.OpenPhysicsPrint = { print: nativePrint };

    render(<PrintButton />);
    fireEvent.click(screen.getByRole('button', { name: '打印题单' }));

    expect(nativePrint).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();
  });
});
