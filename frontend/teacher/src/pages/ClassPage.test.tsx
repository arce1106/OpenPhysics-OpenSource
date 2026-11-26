import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import ClassPage from './ClassPage';
import StudentLearningPage from './StudentLearningPage';
import type { ClassDashboard, ClassPracticeRecord, ClassStatistics, TeacherClassDetail } from '../types';

const CLASS: TeacherClassDetail = { id: 'c_1', name: '高三7班', grade: '高三', level: 'standard', archived: false, member_count: 2, members: [] };
const STATS: ClassStatistics = {
  summary: { data_students: 1, practice_count: 4, released_assignments: 1, active_students: 1, recent_practice_count: 4, recent_days: 7 },
  students: [
    { student_id: 's_a', display_name: 'Alice', student_number: '1', practice_count: 4, practice_graded: 4, practice_correct_rate: 0, homework_expected: 2, homework_submitted: 1, homework_scored: 1, homework_rate: 0.5, latest_activity_at: '2026-10-24T10:00:00Z', mastery: 0.2, knowledge_count: 1,
      recent_practice_count: 4, homework_missed: 0, evidence: 5, score: 0.1, level: 'weak', weak_points: [{ kp_id: 'kp_1', kp_name: '受力分析', score: 0.1 }], strong_points: [],
      attention: [{ code: 'low', text: '整体得分率 10%' }, { code: 'weak', text: '薄弱：受力分析' }] },
    { student_id: 's_b', display_name: 'Bob', student_number: '2', practice_count: 0, practice_graded: 0, practice_correct_rate: null, homework_expected: 1, homework_submitted: 0, homework_scored: 0, homework_rate: null, latest_activity_at: null, mastery: null, knowledge_count: 0,
      recent_practice_count: 0, homework_missed: 1, evidence: 0, score: null, level: 'insufficient', weak_points: [], strong_points: [],
      attention: [{ code: 'inactive', text: '入班后还没有学习记录' }] },
  ],
  knowledge_points: [{ kp_id: 'kp_1', kp_name: '受力分析', chapter: '相互作用', section: '重力', student_count: 1, practice_count: 4, practice_correct_rate: 0, homework_rate: 0.5,
    evidence: 5, score: 0.1, level: 'weak', weak_students: 1, developing_students: 0,
    students: [{ student_id: 's_a', practice_count: 4, practice_graded: 4, practice_correct: 0, homework_earned: 2, homework_full: 4, mastery: 0.2, evidence: 5, score: 0.1, level: 'weak' }] }],
};
const DASH: ClassDashboard = { statistics: STATS, summary: { student_count: 2, active_student_count: 2, pending_mistake_count: 3, avg_mastery: .2 }, students: [], weak_points: [], hot_mistakes: [] };
const RECORD: ClassPracticeRecord = { id: 1, student_id: 's_a', display_name: 'Alice', created_at: null, given_answer: 'B', is_correct: false, image_url: null, feedback: '注意方向', error_type_name: '受力分析错误', question: { id: 'q_1', question_type: 'single_choice', difficulty_tier: 'medium', stem_text: '物体受到的合力为 $F=ma$', options: [{ label: 'A', text: '1' }], image_paths: [], answer: 'A', primary_kp: { id: 'kp_1', name: '受力分析', chapter: '相互作用' }, default_points: 4, default_box: null, class_attempted: 0, class_correct_rate: null } };

// A record's summary: on a student's own page it no longer repeats the student's name.
const recordSummary = (_: string, el: Element | null) => el?.tagName === 'SPAN' && el.parentElement?.tagName === 'SUMMARY'
  && /^(Alice · )?受力分析/.test(el.textContent ?? '');

beforeEach(() => {
  vi.spyOn(api, 'classDetail').mockResolvedValue(CLASS);
  vi.spyOn(api, 'classDashboard').mockResolvedValue(DASH);
  // The student page asks for that student's statistics only; tests keep one source of truth.
  vi.spyOn(api, 'studentStatistics').mockImplementation(async () => (await api.classDashboard('c_1')).statistics!);
  vi.spyOn(api, 'classRecords').mockResolvedValue({ items: [RECORD], has_more: false });
  vi.spyOn(api, 'classHomework').mockResolvedValue({ assignments: [], students: [] });
});

test('learning evidence distinguishes App practice from final teacher work and shows the estimate basis', async () => {
  const statistics = { ...STATS, knowledge_points: STATS.knowledge_points.map((p) => ({ ...p,
    students: p.students.map((e) => ({ ...e, mastery_attempts: 7, mastery_updated_at: '2026-10-26T02:00:00Z' })),
  })) };
  vi.mocked(api.classDashboard).mockResolvedValue({ ...DASH, statistics });
  vi.mocked(api.classRecords).mockResolvedValue({ items: [{ ...RECORD, id: 'teacher:1', source: 'teacher_app',
    assignment_title: '单元测验', score: 2, max_score: 4, first_error: '受力分析遗漏摩擦力' }], has_more: false });
  show('/classes/c_1/students/s_a');
  expect(await screen.findByText(/7 次有效证据/)).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('table', { name: '学生知识点明细' })).getByRole('button', { name: '受力分析' }));
  expect(await screen.findByRole('heading', { name: '学习证据' })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('学习证据来源'), 'homework');
  await waitFor(() => expect(api.classRecords).toHaveBeenLastCalledWith('c_1', {
    student_id: 's_a', kp_id: 'kp_1', wrong_only: false, source: 'homework',
  }));
  await userEvent.click(await screen.findByText(recordSummary));
  expect(screen.getByText(/App 老师作业 · 教师已发布/)).toHaveTextContent('单元测验 · 2 / 4 分');
  expect(screen.getByText('受力分析遗漏摩擦力')).toBeInTheDocument();
});
function show(path = '/classes/c_1') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/classes/:classId" element={<ClassPage />} /><Route path="/classes/:classId/students/:studentId" element={<StudentLearningPage />} /></Routes></MemoryRouter>);
}

test('the overview is the default: who needs attention, what to go over, how the class stands', async () => {
  show();
  const attention = await screen.findByRole('heading', { name: '需要关注的学生' });
  const card = attention.closest('.card') as HTMLElement;
  // Two reasons for Alice put her above Bob.
  const names = within(card).getAllByRole('link').map((link) => link.textContent);
  expect(names).toEqual(['1 Alice', '2 Bob']);
  expect(within(card).getByText('整体得分率 10%')).toBeInTheDocument();
  expect(within(card).getByText('入班后还没有学习记录')).toBeInTheDocument();
  const points = screen.getByRole('heading', { name: '值得讲评的知识点' }).closest('.card') as HTMLElement;
  expect(within(points).getByRole('button', { name: '受力分析' })).toBeInTheDocument();
  expect(within(points).getByText('薄弱 1 人')).toBeInTheDocument();
  expect(within(points).getByRole('link', { name: '出个性化作业' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_a&kp=kp_1');
  expect(screen.getByRole('img', { name: /薄弱 1 人.*数据不足 1 人/ })).toBeInTheDocument();
  expect(screen.getByLabelText('数据覆盖')).toHaveTextContent('近 7 天在学 1 / 2 人');
  expect(api.classHomework).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '名单与学号' })).toHaveAttribute('href', '/classes/c_1/roster');
});

test('the student table shows one performance figure with its basis, and never a percentage for no data', async () => {
  show('/classes/c_1?view=students');
  const table = await screen.findByRole('table', { name: '班级学生统计' });
  const rows = within(table).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Alice');
  expect(within(rows[1]).getByText('10%')).toBeInTheDocument();
  expect(within(rows[1]).getByText('依据 5 题')).toBeInTheDocument();
  expect(within(rows[1]).getByText('薄弱')).toBeInTheDocument();
  expect(rows[2]).toHaveTextContent('Bob暂无数据');
  expect(rows[2]).toHaveTextContent('缺交 1 份');
  expect(within(rows[2]).getByText('数据不足')).toBeInTheDocument();
  expect(within(rows[2]).queryByText(/%/)).toBeNull();
});

test('search, data status and sort update the visible student table', async () => {
  show('/classes/c_1?view=students');
  await screen.findByRole('table', { name: '班级学生统计' });
  await userEvent.type(screen.getByLabelText('搜索班级学生'), 'Alice');
  expect(screen.queryByRole('link', { name: 'Bob' })).toBeNull();
  await userEvent.clear(screen.getByLabelText('搜索班级学生'));
  await userEvent.selectOptions(screen.getByLabelText('学生数据范围'), 'empty');
  expect(screen.getByRole('link', { name: 'Bob' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Alice' })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('学生数据范围'), 'all');
  await userEvent.selectOptions(screen.getByLabelText('学生统计排序'), 'practice');
  const rows = within(screen.getByRole('table', { name: '班级学生统计' })).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Alice');
});

test('student details open as a complete right workspace and practice stays scoped to that student', async () => {
  show('/classes/c_1?view=students');
  await userEvent.click(await screen.findByRole('link', { name: '查看 Alice 的学情' }));
  expect(await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('table', { name: '学生知识点明细' })).toHaveTextContent('受力分析');
  const conclusion = screen.getByLabelText('学情结论');
  expect(conclusion).toHaveTextContent('整体得分率 10%');
  expect(within(conclusion).getByRole('button', { name: '受力分析' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '为该学生补练' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_a&kp=kp_1');
  expect(api.classRecords).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole('table', { name: '学生知识点明细' })).getByRole('button', { name: '受力分析' }));
  await waitFor(() => expect(api.classRecords).toHaveBeenCalledWith('c_1', { student_id: 's_a', kp_id: 'kp_1', wrong_only: false, source: 'all' }));
  await userEvent.click(await screen.findByText(recordSummary));
  expect(screen.getByText('学生作答')).toBeInTheDocument();
  expect(screen.getByText('注意方向')).toBeInTheDocument();
  expect(screen.queryByText('学生未做过')).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('练习记录范围'), 'wrong');
  await waitFor(() => expect(api.classRecords).toHaveBeenLastCalledWith('c_1', { student_id: 's_a', kp_id: 'kp_1', wrong_only: true, source: 'all' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('heading', { name: 'Alice 的学情', level: 1 })).toBeInTheDocument();
});

test('knowledge statistics show coverage and drill down to the students of that knowledge point', async () => {
  show();
  await screen.findByRole('heading', { name: '需要关注的学生' });
  await userEvent.click(screen.getByRole('button', { name: '知识点' }));
  const table = screen.getByRole('table', { name: '班级知识点统计' });
  expect(within(table).getByText('1 / 2 人')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: '班级学生统计' })).toBeNull();
  await userEvent.type(screen.getByLabelText('搜索知识点'), '不存在');
  expect(screen.getByText('没有符合条件的知识点。')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('搜索知识点'));
  await userEvent.click(screen.getByRole('button', { name: '查看 受力分析 的统计' }));
  const dialog = screen.getByRole('dialog', { name: '受力分析 · 学习明细' });
  expect(within(dialog).getByRole('table', { name: '知识点学生明细' })).toHaveTextContent('Alice');
  expect(within(dialog).queryByText('Bob')).toBeNull();
  expect(within(dialog).getByRole('link', { name: '为 1 名薄弱或待巩固的学生出个性化作业' })).toHaveAttribute('href', '/?mode=personalized&for=c_1&student=s_a&kp=kp_1');
  await userEvent.click(within(dialog).getByRole('link', { name: 'Alice' }));
  expect(await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('link', { name: '← 返回班级统计' }));
  expect(await screen.findByRole('table', { name: '班级知识点统计' })).toBeInTheDocument();

});

test('history loads on demand, preserves empty states, and is reachable from a student detail', async () => {
  show('/classes/c_1?view=students');
  await userEvent.click(await screen.findByRole('link', { name: '查看 Alice 的学情' }));
  await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: '历次成绩' }));
  expect(await screen.findByRole('heading', { name: '暂无已发布成绩' })).toBeInTheDocument();
  expect(api.classHomework).toHaveBeenCalledWith('c_1');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '历次成绩' })).toHaveAttribute('aria-current', 'page');
});

test('empty classes show an informative empty state instead of zero-valued performance cards', async () => {
  vi.mocked(api.classDetail).mockResolvedValue({ ...CLASS, member_count: 0 });
  vi.mocked(api.classDashboard).mockResolvedValue({ ...DASH, statistics: { students: [], knowledge_points: [], summary: { data_students: 0, practice_count: 0, released_assignments: 0 } } });
  show();
  expect(await screen.findByRole('heading', { name: '这个班级还没有学生' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('0%')).toBeNull();
});


test('a direct student URL can reload and return to its class without opening a modal', async () => {
  show('/classes/c_1/students/s_a?view=practice');
  expect(await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText(recordSummary)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: '← 返回班级统计' }));
  expect(await screen.findByRole('table', { name: '班级学生统计' })).toBeInTheDocument();
});

test('returning from the student page restores class search and filters', async () => {
  show('/classes/c_1?view=students');
  await screen.findByRole('table', { name: '班级学生统计' });
  await userEvent.type(screen.getByLabelText('搜索班级学生'), 'Alice');
  await userEvent.selectOptions(screen.getByLabelText('学生数据范围'), 'data');
  await userEvent.selectOptions(screen.getByLabelText('学生统计排序'), 'practice');
  await userEvent.click(screen.getByRole('link', { name: '查看 Alice 的学情' }));
  await screen.findByRole('heading', { name: 'Alice 的学情', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: '学习记录' }));
  await screen.findByText(recordSummary);
  await userEvent.click(screen.getByRole('link', { name: '← 返回班级统计' }));
  await screen.findByRole('table', { name: '班级学生统计' });
  expect(screen.getByLabelText('搜索班级学生')).toHaveValue('Alice');
  expect(screen.getByLabelText('学生数据范围')).toHaveValue('data');
  expect(screen.getByLabelText('学生统计排序')).toHaveValue('practice');
  expect(screen.queryByRole('link', { name: 'Bob' })).toBeNull();
});

test('an unrelated student URL cannot render records or personalized actions', async () => {
  show('/classes/c_1/students/not-a-member');
  expect(await screen.findByRole('alert')).toHaveTextContent('该学生不在当前班级');
  expect(screen.queryByRole('link', { name: '为该学生补练' })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(api.classRecords).not.toHaveBeenCalled();
});

test('denied class access does not request any student records', async () => {
  vi.mocked(api.classDetail).mockRejectedValue(new Error('班级不存在'));
  vi.mocked(api.classDashboard).mockRejectedValue(new Error('班级不存在'));
  show('/classes/c_other/students/s_a');
  expect(await screen.findByRole('alert')).toHaveTextContent('班级不存在');
  expect(api.classRecords).not.toHaveBeenCalled();
});


test('unknown knowledge-point filters do not silently broaden student records', async () => {
  show('/classes/c_1/students/s_a?view=practice&kp=not-a-student-point');
  expect(await screen.findByText('该知识点暂无当前学生的学习记录。')).toBeInTheDocument();
  expect(api.classRecords).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '查看该生全部练习' }));
  await screen.findByText(recordSummary);
  expect(api.classRecords).toHaveBeenCalledWith('c_1', { student_id: 's_a', kp_id: undefined, wrong_only: false, source: 'all' });
});

test('student history shows only that student and preserves an actual zero score', async () => {
  vi.mocked(api.classHomework).mockResolvedValue({
    assignments: [{ id: 'a_1', class_id: 'c_1', title: '测验一', kind: 'test', status: 'published', question_count: 1, total_points: 4, created_at: null, published_at: null, results_released_at: '2026-10-25T00:00:00Z', collected: 2, member_count: 2, average: 2, rate: .5 }],
    students: [
      { student_id: 's_a', display_name: 'Alice', student_number: '1', scores: { a_1: { score: 0, full: 4 } } },
      { student_id: 's_b', display_name: 'Bob', student_number: '2', scores: { a_1: { score: 4, full: 4 } } },
    ],
  });
  show('/classes/c_1/students/s_a?view=history');
  const table = await screen.findByRole('table', { name: '成绩表' });
  expect(within(table).getByText('0 / 4')).toBeInTheDocument();
  expect(within(table).getByText('Alice')).toBeInTheDocument();
  expect(within(table).queryByText('Bob')).toBeNull();
  expect(screen.queryByRole('button', { name: '查看全班' })).toBeNull();
});

test('a partly scored answer reads as 部分得分, and older records load on demand', async () => {
  vi.mocked(api.classRecords)
    .mockResolvedValueOnce({ items: [{ ...RECORD, id: 'teacher:9', source: 'teacher_paper', assignment_title: '周测',
      score: 11, max_score: 12, credit: 11 / 12, is_correct: false }], has_more: true })
    .mockResolvedValueOnce({ items: [{ ...RECORD, id: 2 }], has_more: false });
  show('/classes/c_1/students/s_a?view=practice');
  expect(await screen.findByText('部分得分 11/12 分')).toBeInTheDocument();
  expect(screen.getByText(/纸质老师作业 · 周测/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));
  await waitFor(() => expect(api.classRecords).toHaveBeenLastCalledWith('c_1', expect.objectContaining({ offset: 1 })));
  expect(await screen.findByText('错误')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '加载更早的记录' })).toBeNull();
});

test('an archived class shows its released scores instead of current learning', async () => {
  vi.mocked(api.classDetail).mockResolvedValue({ ...CLASS, archived: true });
  show();
  expect(await screen.findByRole('status')).toHaveTextContent('已归档');
  expect(await screen.findByRole('heading', { name: '暂无已发布成绩' })).toBeInTheDocument();
  expect(api.classDashboard).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: '需要关注的学生' })).toBeNull();
});
