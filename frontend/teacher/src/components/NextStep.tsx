import { Link } from 'react-router-dom';

/** What a class's homework waits for next, as a link: review a draft, collect, grade, or read the report. */
export default function NextStep({ row }: {
  row: { id: string; status: string; collected: number; delivery?: 'app' | 'paper' | null; paper_students?: number; results_released_at?: string | null };
}) {
  const base = `/assignments/${row.id}`;
  if (row.status === 'draft') return <Link to={base}>审核并发布</Link>;
  if (row.results_released_at) return <Link to={`${base}/report`}>看报告</Link>;
  if (row.collected === 0 && row.delivery === 'app' && !row.paper_students) return <Link to={`${base}?tab=students`}>查看作答</Link>;
  if (row.collected === 0) return <Link to={`${base}/collect`}>收卷</Link>;
  return <Link to={`${base}/review`}>批改审核</Link>;
}
