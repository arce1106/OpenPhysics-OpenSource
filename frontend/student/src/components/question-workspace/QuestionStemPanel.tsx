import { StemContent } from '../LatexSpan';
import ZoomableImage from '../ZoomableImage';
import type { Question } from '../../types';
import { getImageScaleStyle } from '../../../../shared/questionImageDisplay';

interface QuestionStemPanelProps {
  question: Question;
  className?: string;
}

export default function QuestionStemPanel({ question, className }: QuestionStemPanelProps) {
  const imageScaleStyles = question.images?.map(img => getImageScaleStyle(img));
  const fallbackImages = question.images?.filter(im => im.image_type !== 'explanation' && im.image_type !== 'option') || [];
  const shouldRenderFallbackImages = !question.stem_text.includes('{{IMG:') && fallbackImages.length > 0;

  return (
    <section className={['question-stem-panel', className].filter(Boolean).join(' ')}>
      <div className="question-stem-content">
        <StemContent
          text={question.stem_text}
          imagePaths={question.images?.map(img => img.image_path)}
          imageScaleStyles={imageScaleStyles}
        />
      </div>

      {shouldRenderFallbackImages && (
        <div className="question-stem-images">
          {fallbackImages.map(img => (
            <ZoomableImage
              key={img.id}
              src={img.image_path}
              alt={img.description || '题目附图'}
              className="question-image question-stem-image-item"
              style={getImageScaleStyle(img)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
