import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {sha256} from './sha256';
import {attemptSubmissionId, blobFingerprint, pendingSubmissionId} from './submissionIdentity';

describe('submission identity', () => {
  it.each(['', 'abc', '学生作答'.repeat(200)])('matches SHA-256 for browser fallback content', value => {
    expect(sha256(value)).toBe(createHash('sha256').update(value).digest('hex'));
  });
  it('keeps a short photo key when subtle is unavailable and ignores export metadata', async () => {
    const first = await blobFingerprint(new File(['same'], 'one.png', {type:'image/png',lastModified:1}));
    const second = await blobFingerprint(new File(['same'], 'two.png', {type:'image/png',lastModified:2}));
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
  it('recreates the same explicit attempt identity without accumulating pending entries', () => {
    const first = attemptSubmissionId('student:session:q1:A');
    expect(pendingSubmissionId('unneeded-key', first)).toBe(first);
    expect(Object.keys(localStorage).some(key => key.includes('unneeded-key'))).toBe(false);
    expect(attemptSubmissionId('student:session:q1:A')).toBe(first);
    expect(attemptSubmissionId('student:new-session:q1:A')).not.toBe(first);
  });
  it('bounds legacy non-session keys and expires only their old pending entries', () => {
    vi.useFakeTimers();
    const key='unscoped:'+ 'x'.repeat(10000);
    const first=pendingSubmissionId(key);
    expect(pendingSubmissionId(key)).toBe(first);
    expect(Object.keys(localStorage).every(item=>item.length<120)).toBe(true);
    vi.advanceTimersByTime(31*24*60*60*1000);
    expect(pendingSubmissionId(key)).not.toBe(first);
    vi.useRealTimers();
  });
});
