import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { getStudentProfile, getStudentToken } from './studentIdentity';

describe('web login ticket exchange', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('exchanges a one-time ticket for the normal student session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'web-token',
        token_type: 'bearer',
        student: {
          id: 'student-1',
          username: 'android_user',
          display_name: '安卓学生',
          status: 'active',

        },
      }),
    }));

    await api.exchangeWebLoginTicket('ticket-123');

    expect(fetch).toHaveBeenCalledWith(
      '/api/student/auth/web-login-ticket/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ticket: 'ticket-123' }),
      }),
    );
    expect(getStudentToken()).toBe('web-token');
    expect(getStudentProfile()?.id).toBe('student-1');
  });
});
