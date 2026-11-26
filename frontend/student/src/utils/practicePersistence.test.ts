import {beforeEach, describe, expect, it, vi} from 'vitest';
import {loadPracticeRecord, newPracticeRecord, savePracticeRecord, loadPracticeDrafts, savePracticeDrafts, discardPracticeAttempt} from './practicePersistence';

describe('practice persistence',()=>{
  beforeEach(()=>localStorage.clear());
  it('isolates students and preserves answers, question set and the attempt id until a real restart',()=>{
    const record = newPracticeRecord('A','kp-check',{questions:[{id:'q1'}]});
    record.answers.q1={answer_id:1,is_correct:true,correct_answer:'A',mastery_update:{},explanation:null};
    expect(savePracticeRecord(record)).toBe(true);
    expect(loadPracticeRecord('A','kp-check')).toEqual(record);
    expect(loadPracticeRecord('B','kp-check')).toBeNull();
    expect(newPracticeRecord('A','kp-check',{}).id).not.toBe(record.id);
  });
  it('removes the abandoned session and prevents late state writes without touching another scope', async () => {
    const record = newPracticeRecord('A', 'abandoned', { questions: [{ id: 'q1' }] });
    const other = newPracticeRecord('A', 'completed', {});
    savePracticeRecord(record);
    savePracticeRecord(other);
    await discardPracticeAttempt(`A:${record.id}`);
    expect(loadPracticeRecord('A', 'abandoned')).toBeNull();
    expect(savePracticeRecord(record)).toBe(false);
    expect(loadPracticeRecord('A', 'abandoned')).toBeNull();
    expect(loadPracticeRecord('A', 'completed')).toEqual(other);
  });
  it('allows continued saving when explicit exit cleanup fails', async () => {
    const record = newPracticeRecord('A', 'failed-exit');
    savePracticeRecord(record);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage'); });
    await expect(discardPracticeAttempt(`A:${record.id}`, true)).rejects.toThrow('storage');
    remove.mockRestore();
    expect(savePracticeRecord(record)).toBe(true);
    expect(loadPracticeRecord('A', 'failed-exit')).toEqual(record);
  });
  it('restores photo bytes and cleared choices using the storage fallback',async()=>{
    const file = new File(['answer'],'answer.jpg',{type:'image/jpeg',lastModified:1234});
    await savePracticeDrafts('student-attempt',{answers:{q1:''},photos:{q2:file},handwriting:{},selfReviews:{},backgrounds:{}});
    const restored=await loadPracticeDrafts('student-attempt');
    expect(restored?.answers.q1).toBe('');
    expect(restored?.photos.q2.name).toBe('answer.jpg');
    expect(restored?.photos.q2.size).toBe(file.size);
    expect(restored?.photos.q2.lastModified).toBe(1234);
  });
  it('reports quota failures instead of claiming the draft is saved',()=>{
    const warn=vi.fn(); window.addEventListener('openphysics:save-error',warn);
    const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
    expect(savePracticeRecord(newPracticeRecord('A','kp-check',{}))).toBe(false);
    expect(warn).toHaveBeenCalled();
    write.mockRestore(); window.removeEventListener('openphysics:save-error',warn);
  });
  it('does not resurrect paper photo drafts when an in-flight conversion finishes after explicit restart', async () => {
    const key = 'student:discard-paper';
    const pending = savePracticeDrafts(key + ':paper', {answers:{},photos:{one:new File(['paper'],'paper.png',{type:'image/png'})},handwriting:{},selfReviews:{},backgrounds:{}});
    await discardPracticeAttempt(key);
    await pending;
    expect(await loadPracticeDrafts(key + ':paper')).toBeNull();
    await savePracticeDrafts(key + ':paper', {answers:{},photos:{},handwriting:{},selfReviews:{},backgrounds:{}});
    expect(await loadPracticeDrafts(key + ':paper')).toBeNull();
  });
  it('closes a database connection that arrives after its open request timed out', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const request = {result:{close},onsuccess:null as null | (() => void)};
    vi.stubGlobal('indexedDB',{open:() => request});
    const loading = loadPracticeDrafts('student:timeout');
    const rejected = expect(loading).rejects.toThrow('草稿存储未响应');
    await vi.advanceTimersByTimeAsync(3001);
    await rejected;
    request.onsuccess?.();
    expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
