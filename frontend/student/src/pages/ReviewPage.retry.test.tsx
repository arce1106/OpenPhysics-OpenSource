import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import ReviewPage from './ReviewPage';

const mocks = vi.hoisted(() => ({ getReview: vi.fn(), getVariations: vi.fn(), retrySimilar: vi.fn() }));
vi.mock('../api/client', () => ({api:mocks}));
vi.mock('../api/studentIdentity', () => ({
  getStudentId: () => 'audit-student',
  getStudentProfile: () => ({id:'audit-student', status: 'active', }),
}));
vi.mock('../components/PrintableQuestionSet', () => ({default:()=>null}));

it('does not automatically loop failed variation requests', async () => {
  mocks.getReview.mockResolvedValue({clearance_progress:{reviewed:0,total:1},groups:[{kp_id:'kp',kp_name:'kp',wrong_count:1,mistakes:[{answer_id:1,question_id:'q',stem_text:'audit',given_answer:'A',correct_answer:'B',explanation:null,misconception:null,process_grading:null,created_at:'2026-09-05'}]}]});
  mocks.getVariations.mockRejectedValueOnce(new Error('temporary failure'))
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockImplementation(() => new Promise(() => {}));
  const app = render(<MemoryRouter initialEntries={['/review/mistake/1/variation']}><ReviewPage /></MemoryRouter>);
  await waitFor(() => expect(mocks.getVariations).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(mocks.getVariations).toHaveBeenCalledTimes(1);
  app.unmount();
});
