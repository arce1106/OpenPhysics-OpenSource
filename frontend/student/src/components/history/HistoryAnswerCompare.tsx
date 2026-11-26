import type { ReactNode } from 'react';
import ZoomableImage from '../ZoomableImage';
import RichContent from '../question-workspace/RichContent';
import type { AnswerHistoryItem } from '../../types';
import { getProcessAnswerImagePaths } from '../../utils/answerImages';

interface HistoryAnswerCompareProps {
  record: AnswerHistoryItem;
  className?: string;
}

export default function HistoryAnswerCompare({ record, className }: HistoryAnswerCompareProps) {
  return (
    <div className={`history-answer-grid history-answer-compare${className ? ` ${className}` : ''}`}>
      <HistoryAnswerCard title="我的答案" tone={record.is_correct ? 'correct' : 'wrong'}>
        <StudentAnswer record={record} />
      </HistoryAnswerCard>
      <HistoryAnswerCard title="正确答案" tone="correct">
        <RichContent text={record.correct_answer || '暂无标准答案'} rendered={record.correct_answer_rendered} />
      </HistoryAnswerCard>
    </div>
  );
}

function HistoryAnswerCard({
  title,
  children,
  tone,
}: {
  title: string;
  children: ReactNode;
  tone?: 'correct' | 'wrong';
}) {
  return (
    <div className={`history-block history-answer-card history-answer-card-${tone || 'default'}`}>
      <div className="history-block-title">{title}</div>
      {children}
    </div>
  );
}

function StudentAnswer({ record }: { record: AnswerHistoryItem }) {
  const primaryImagePaths = getProcessAnswerImagePaths(record.process_grading);
  const answerText = record.given_answer || '';
  const isImagePlaceholder = /^\s*\[(图片|手写图片|手写过程|整套纸笔照片)\]\s*$/.test(answerText);
  return (
    <>
      {!isImagePlaceholder && answerText ? (
        <RichContent text={answerText} />
      ) : primaryImagePaths.length === 0 ? (
        <span>（空）</span>
      ) : null}
      {primaryImagePaths.length > 0 && (
        <div className="history-answer-image-grid">
          {primaryImagePaths.map((imagePath, index) => (
            <ZoomableImage
              key={imagePath}
              src={imagePath}
              alt={primaryImagePaths.length > 1 ? `学生作答图片 ${index + 1}` : '学生作答图片'}
              className="history-answer-image"
            />
          ))}
        </div>
      )}
    </>
  );
}
