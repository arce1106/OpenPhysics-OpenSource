import { useEffect, useMemo } from 'react';
import LatexSpan, { StemContent } from './LatexSpan';
import { getImageScaleStyle } from '../../../shared/questionImageDisplay';
import { resolveAssetUrl } from '../api/baseUrl';
import { collectQuestionImageUrls, preloadImageUrls } from '../utils/questionImages';
import type { Question } from '../types';

const SHORT_ANSWER_QUESTION_TYPES = new Set([
  'fill_in_blank',
  'knowledge_fill_in_blank',
]);

const LONG_ANSWER_QUESTION_TYPES = new Set([
  'problem_solving',
  'comprehensive',
  'experiment',
  'graph_construction',
]);

interface PrintableQuestionSetProps {
  title: string;
  subtitle?: string;
  questions: Question[];
}

export default function PrintableQuestionSet({ title, subtitle, questions }: PrintableQuestionSetProps) {
  const printImageUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    const add = (url?: string | null) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    };

    questions.forEach(question => {
      collectQuestionImageUrls(question).forEach(add);
      question.answer_image_paths?.forEach(path => add(resolveAssetUrl(path)));
    });
    return urls;
  }, [questions]);

  useEffect(() => {
    preloadImageUrls(printImageUrls, undefined, printImageUrls.length);
  }, [printImageUrls]);

  const getAnswerBoxClass = (question: Question) => {
    if (question.options && question.options.length > 0) return null;
    if (SHORT_ANSWER_QUESTION_TYPES.has(question.question_type || '')) {
      return 'print-answer-box print-answer-box-short';
    }
    if (LONG_ANSWER_QUESTION_TYPES.has(question.question_type || '')) {
      return 'print-answer-box print-answer-box-large';
    }
    return 'print-answer-box print-answer-box-large';
  };

  const getImageBlockClass = (imageCount: number) => {
    const densityClass = imageCount > 1 ? 'print-question-images-multiple' : 'print-question-images-single';
    return `print-question-images ${densityClass}`;
  };

  const getOptionLabelClass = (question: Question) => {
    const shapeClass = question.question_type === 'multiple_choice'
      ? 'print-option-label-multiple'
      : 'print-option-label-single';
    return `print-option-label ${shapeClass}`;
  };

  const isImagePlaceholderAnswer = (answer: string | null | undefined) => (
    /^\s*\[(图片|手写图片|手写过程|整套纸笔照片)\]\s*$/.test(answer || '')
  );

  return (
    <section className="print-only print-sheet" aria-hidden="true">
      <header className="print-sheet-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="print-meta">
          <span>姓名：__________</span>
          <span>日期：__________</span>
        </div>
      </header>

      <div className="print-questions">
        {questions.map((question, index) => {
          const answerBoxClass = getAnswerBoxClass(question);
          const promptImages = question.images?.filter(
            img => img.image_type !== 'explanation' && img.image_type !== 'option',
          ) || [];
          const imageScaleStyles = question.images?.map(img => getImageScaleStyle(img));

          return (
            <article className="print-question" key={question.id}>
              <div className="print-question-title">
                <span>第 {index + 1} 题</span>
                <span className="print-question-code">Q:{question.id}</span>
              </div>
              <div className="print-question-stem">
                <StemContent
                  text={question.stem_text}
                  imagePaths={question.images?.map(img => img.image_path)}
                  imageScaleStyles={imageScaleStyles}
                />
              </div>

              {promptImages.length > 0 && !question.stem_text.includes('{{IMG:') && (
                <div className={getImageBlockClass(promptImages.length)}>
                  {promptImages.map(img => (
                    <img
                      key={img.id}
                      src={resolveAssetUrl(img.image_path)}
                      alt={img.description || '题目附图'}
                      className="question-image"
                      loading="lazy"
                      decoding="async"
                      style={getImageScaleStyle(img)}
                    />
                  ))}
                </div>
              )}

              {question.options && question.options.length > 0 && (
                <div className="print-options">
                  {question.options.map(option => (
                    <div className="print-option" key={option.label}>
                      <span className={getOptionLabelClass(question)}>{option.label}</span>
                      <span>
                        <LatexSpan
                          text={option.text}
                          imagePaths={question.images?.map(img => img.image_path)}
                          imageScaleStyles={imageScaleStyles}
                          imageClassName="print-option-image"
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {question.answer_image_paths && question.answer_image_paths.length > 0 ? (
                <div className="print-student-answer">
                  <div className="print-student-answer-title">学生作答</div>
                  {question.given_answer && !isImagePlaceholderAnswer(question.given_answer) && (
                    <div className="print-student-answer-text">
                      <LatexSpan text={question.given_answer} />
                    </div>
                  )}
                  <div className="print-student-answer-images">
                    {question.answer_image_paths.map((imagePath, imageIndex) => (
                      <img
                        key={`${question.id}-answer-${imageIndex}-${imagePath}`}
                        src={resolveAssetUrl(imagePath)}
                        alt={`学生作答 ${imageIndex + 1}`}
                        className="print-student-answer-image"
                        loading="lazy"
                        decoding="async"
                      />
                    ))}
                  </div>
                </div>
              ) : answerBoxClass && (
                <div className={answerBoxClass}>
                  <span>作答区</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
