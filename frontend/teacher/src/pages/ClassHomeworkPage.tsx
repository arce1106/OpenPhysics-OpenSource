import { Navigate, useParams } from 'react-router-dom';

/** Compatibility for saved links to the former class homework tab. */
export default function ClassHomeworkPage() {
  const { classId = '' } = useParams();
  return <Navigate to={`/papers?class=${encodeURIComponent(classId)}`} replace />;
}
