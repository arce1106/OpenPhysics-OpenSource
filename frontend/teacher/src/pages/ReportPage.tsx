import { Navigate, useParams } from 'react-router-dom';

/** Keep old report links opening the unified assignment workspace. */
export default function ReportPage() {
  const { assignmentId = '' } = useParams();
  return <Navigate to={`/assignments/${assignmentId}?tab=overview`} replace />;
}
