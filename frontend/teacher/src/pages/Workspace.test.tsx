import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import AssignmentWorkspace from '../components/AssignmentWorkspace';
import type { AssignmentDetail, Collection, Report, ReviewEntry, ReviewOverview } from '../types';

const DETAIL: AssignmentDetail = { id: 'a_personal', class_id: 'c_1', class_name: '高三7班', title: '定向补练', kind: 'personalized', status: 'published', question_count: 1, total_points: null, created_at: null, published_at: null, results_released_at: '2026-10-24T10:00:00Z', settings: { scope: [], student_ids: ['s_1', 's_2'], choice_count: 1, area_count: 0 }, items: [] };
const COLLECTION: Collection = { assignment_id: DETAIL.id, released: true, collected: 2, total: 3, students: [], batches: [], exceptions: [], ai_usage: { calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: 0 } };
const REPORT: Report = { assignment_id: DETAIL.id, kind: 'personalized', title: DETAIL.title, released_at: DETAIL.results_released_at!, total_points: null, collected: 1, class_size: 3, late: 1, average: 0, average_rate: 0, highest: 0, lowest: 0, bands: [{ label: '60% 以下', count: 1 }], positions: [1], errors: [{ error_type: 'calculation', name: '数学处理错误', count: 1 }], attention: [], questions: [{ number: 7, question_id: 'q_7', kp_id: 'kp_force', kp_name: '牛顿第二定律', question_type: 'single_choice', points: 4, students: 1, answer: 'A', distribution: { B: 1 }, rate: 0, average: 0, parts: [], errors: [] }], students: [
  { student_id: 's_1', display_name: 'Alice', student_number: '1', submitted: true, total: 0, full_points: 4, percent: 0, scores: { '1': 0 }, items: [{ number: 1, analysis_number: 7, question_id: 'q_7', score: 0, max_score: 4, answer: 'B', error_type: 'calculation', error_type_name: '数学处理错误' }] },
  { student_id: 's_2', display_name: 'Bob', student_number: '2', submitted: false },
  { student_id: 's_3', display_name: 'Carol', student_number: '3', submitted: false, late: true },
] };
const ENTRY: ReviewEntry = { item_id: 1, student_id: 's_1', display_name: 'Alice', student_number: '1', ai_authorized: false, image_url: null, answer: 'B', grade_status: 'confirmed', score: 0, max_score: 4, part_scores: null, error_type: null, error_type_name: null, first_error: null, feedback: null, teacher_comment: null, confidence: null, ai_error: null };

function show(tab = 'overview', detail = DETAIL) {
  render(<MemoryRouter initialEntries={[`/assignments/${detail.id}?tab=${tab}`]}><AssignmentWorkspace detail={detail} /></MemoryRouter>);
}
beforeEach(() => {
  vi.spyOn(api, 'collection').mockResolvedValue(COLLECTION);
  vi.spyOn(api, 'report').mockResolvedValue(REPORT);
  vi.spyOn(api, 'reviewQuestion').mockResolvedValue([ENTRY, { ...ENTRY, item_id: 2, student_id: 's_3', display_name: 'Carol' }]);
});

test('before release shows progress and recipient roster, never fetches formal statistics', async () => {
  vi.mocked(api.collection).mockResolvedValue({ ...COLLECTION, released: false, total: 1, collected: 0, students: [{ student_id: 's_1', display_name: 'Alice', student_number: '1', ai_authorized: false, submission: null }] });
  vi.spyOn(api, 'review').mockResolvedValue({ assignment_id: DETAIL.id, released: false, run: null, questions: [], error_types: {} } as ReviewOverview);
  show('overview', { ...DETAIL, results_released_at: null });
  expect(await screen.findByText('应交人数')).toBeInTheDocument();
  expect(api.report).not.toHaveBeenCalled();
  expect(screen.queryByText('平均分')).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: '学生与成绩' }));
  const table = await screen.findByRole('table', { name: '学生收卷情况' });
  expect(within(table).getByText('Alice')).toBeInTheDocument();
  expect(within(table).queryByText('Bob')).toBeNull();
  expect(within(table).getByText('未交')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: '知识点与错因' }));
  expect(screen.getByText(/发布结果后，查看本次作业/)).toBeInTheDocument();
});

test('personalized score cells open the actual question, preserve zero scores and exclude late answers', async () => {
  show('students');
  expect(await screen.findByText('缺交')).toBeInTheDocument();
  expect(screen.getByText('迟交 · 未计入')).toBeInTheDocument();
  const score = screen.getByRole('button', { name: 'Alice 第 1 题 0 分' });
  expect(score).toHaveTextContent('0 / 4');
  await userEvent.click(score);
  const dialog = await screen.findByRole('dialog', { name: '第 7 题分析' });
  await waitFor(() => expect(api.reviewQuestion).toHaveBeenCalledWith('a_personal', 7));
  expect(await within(dialog).findByText('1 · Alice')).toBeInTheDocument();
  expect(within(dialog).queryByText('Carol')).toBeNull();
  expect(within(dialog).getByRole('link', { name: '给这 1 名失分学生补练' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_1&kp=kp_force');
  expect(within(dialog).getByRole('link', { name: '查看审核记录' })).toHaveAttribute('href', '/assignments/a_personal/review?question=7&student=s_1&filter=all');
});

test('question option distribution filters answers and supports returning to all answers', async () => {
  show('questions');
  await userEvent.click(await screen.findByRole('button', { name: 'B · 1 人' }));
  const dialog = screen.getByRole('dialog', { name: '第 7 题分析' });
  expect(within(dialog).getByLabelText('按作答选项筛选')).toHaveValue('B');
  expect(await within(dialog).findByText('1 · Alice')).toBeInTheDocument();
  await userEvent.selectOptions(within(dialog).getByLabelText('按得分与错因筛选'), 'lost');
  expect(within(dialog).getByText('1 名学生')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('knowledge point aggregates use actual earned and possible marks and target only affected students', async () => {
  show('knowledge');
  const table = await screen.findByRole('table', { name: '知识点表现' });
  expect(within(table).getByText('0%')).toBeInTheDocument();
  expect(within(table).queryByText('关联分析题号')).toBeNull();
  await userEvent.click(within(table).getByRole('button', { name: '1 人 · 查看' }));
  const cohort = screen.getByRole('region', { name: '关联学生' });
  expect(within(cohort).getByRole('button', { name: 'Alice' })).toBeInTheDocument();
  expect(within(cohort).queryByText('Bob')).toBeNull();
  expect(within(cohort).getByRole('link', { name: '为这 1 名学生补练' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_1&kp=kp_force');
});

test('clicking a score band lists exactly the released students in it and leads to their follow-up', async () => {
  vi.mocked(api.report).mockResolvedValueOnce({ ...REPORT, bands: [{ label: '90–100%', count: 0 }, { label: '60% 以下', count: 1 }] });
  show();
  const band = await screen.findByRole('button', { name: /60% 以下/ });
  expect(screen.getByRole('button', { name: /90–100%/ })).toBeDisabled();
  await userEvent.click(band);
  expect(band).toHaveAttribute('aria-pressed', 'true');
  const list = screen.getByRole('region', { name: '60% 以下 的学生' });
  expect(within(list).getByRole('button', { name: /Alice/ })).toHaveTextContent('0%');
  expect(within(list).queryByText(/Bob|Carol/)).toBeNull();
  expect(within(list).getByRole('link', { name: '为这 1 名学生补练' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_1&kp=kp_force');
  await userEvent.click(within(list).getByRole('button', { name: '加入补练选择' }));
  expect(screen.getByRole('region', { name: '补练对象' })).toHaveTextContent('已选 1 名学生');
  await userEvent.click(within(list).getByRole('button', { name: /Alice/ }));
  expect(screen.getByRole('dialog', { name: 'Alice 的作业' })).toBeInTheDocument();
});

test('student filters and selections carry only the chosen recipients into personalized composing', async () => {
  show('students');
  await screen.findByRole('table', { name: '学生成绩' });
  await userEvent.type(screen.getByLabelText('搜索学生'), 'Alice');
  await userEvent.click(screen.getByRole('button', { name: '选择筛选结果' }));
  expect(screen.getByRole('link', { name: '为所选学生出个性化作业' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_1&kp=kp_force');
  await userEvent.click(screen.getByRole('button', { name: 'Alice' }));
  const dialog = screen.getByRole('dialog', { name: 'Alice 的作业' });
  expect(within(dialog).getByRole('table', { name: '学生逐题成绩' })).toHaveTextContent('数学处理错误');
});

test('a failed report remains an error, retries without fabricating zero statistics', async () => {
  vi.mocked(api.report).mockRejectedValueOnce(new Error('暂时无法读取报告'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取报告');
  expect(screen.queryByText('平均得分率')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByText('平均得分率')).toBeInTheDocument();
});

test('a removed assignment keeps its released analysis available without collection actions', async () => {
  show('students', { ...DETAIL, removed_at: '2026-10-25T10:00:00Z' });
  expect(await screen.findByRole('table', { name: '学生成绩' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('保留成绩与学情');
  expect(screen.queryByRole('button', { name: '删除作业' })).toBeNull();
  expect(screen.queryByRole('link', { name: '查看收卷' })).toBeNull();
});

test('personalized collection finishes before review to avoid importing an App paper concurrently', async () => {
  let resolveCollection!: (value: Collection) => void;
  vi.mocked(api.collection).mockImplementation(() => new Promise((resolve) => { resolveCollection = resolve; }));
  const review = vi.spyOn(api, 'review').mockResolvedValue({ assignment_id: DETAIL.id, released: false, run: null, questions: [], error_types: {} });
  show('overview', { ...DETAIL, results_released_at: null });
  expect(api.collection).toHaveBeenCalled();
  expect(review).not.toHaveBeenCalled();
  resolveCollection(COLLECTION);
  await waitFor(() => expect(review).toHaveBeenCalledWith(DETAIL.id));
});
