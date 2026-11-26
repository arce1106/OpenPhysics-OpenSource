import LatexSpan from '../LatexSpan';
import ZoomableImage from '../ZoomableImage';
import type { ReviewMistake } from '../../types';
import { getProcessAnswerImagePaths } from '../../utils/answerImages';

export function getReviewAnswerImagePaths(mistake: ReviewMistake) {
  return getProcessAnswerImagePaths(mistake.process_grading);
}

export default function StudentAnswerDisplay({ mistake }: { mistake: ReviewMistake }) {
  const imagePaths = getReviewAnswerImagePaths(mistake);
  const answerText = mistake.given_answer || '';
  const isImagePlaceholder = /^\s*\[(图片|手写图片|手写过程|整套纸笔照片)\]\s*$/.test(answerText);

  if (imagePaths.length > 0) {
    return (
      <div className="review-student-answer">
        {!isImagePlaceholder && answerText && (
          <div className="review-student-answer-text">
            <LatexSpan text={answerText} />
          </div>
        )}
        <div className="review-answer-image-grid">
          {imagePaths.map((imagePath, index) => (
            <ZoomableImage
              key={imagePath}
              src={imagePath}
              alt={imagePaths.length > 1 ? `学生作答图片 ${index + 1}` : '学生作答图片'}
              className="review-answer-image"
            />
          ))}
        </div>
      </div>
    );
  }

  return answerText ? <LatexSpan text={answerText} /> : <>（空）</>;
}
