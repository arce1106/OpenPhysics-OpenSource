import { useLayoutEffect } from 'react';
import type { Question, SubmitResult } from '../types';
import QuestionCard from './QuestionCard';
import PrintableQuestionSet from './PrintableQuestionSet';
import PrintButton from './PrintButton';
import TeacherPaperVideo from './TeacherPaperVideo';
import type { HomeworkScore } from '../utils/teacherHomework';
import './TeacherPaperReview.css';

interface TeacherPaperReviewProps {
  title: string;
  questions: Question[];
  answers: Record<string, SubmitResult>;
  videoEnabled: boolean;
  error?: string | null;
  onAnswered: (questionId: string, result: SubmitResult) => void;
  onBack: () => void;
  /** Without it there is no restart, as for a teacher's homework. */
  onRestart?: () => void;
  heading?: string;
  backLabel?: string;
  /** A finished homework's score, shown in the header. */
  score?: HomeworkScore | null;
}

export default function TeacherPaperReview({ title, questions, answers, videoEnabled, error, onAnswered, onBack, onRestart,
  heading = '教师作业 · 答卷复盘', backLabel = '返回专题路径', score }: TeacherPaperReviewProps) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  return <>
    <PrintableQuestionSet title={title} questions={questions} />
    <main className="container teacher-paper-review no-print" aria-label="套卷答卷">
      <header className="teacher-paper-review-header">
        <button type="button" className="page-back-button" onClick={onBack}>返回</button>
        <h1>{heading}</h1>
        {score && <p className="teacher-paper-review-score">
          <strong>得分 {score.percent}/100</strong>
          <span>{score.note}</span>
        </p>}
      </header>
      {error ? <div role="alert">{error}</div> : null}
      <div className="teacher-paper-review-list">
        {questions.map((question, index) => {
          const answer = answers[question.id];
          const lesson = answer?.lesson_video || question.lesson_video;
          return <article key={question.id} aria-label={`第 ${index + 1} 题`}>
            <h2 className="teacher-paper-review-number">第 {index + 1} 题</h2>
            <QuestionCard question={question} disabled reviewMode tutorPlacement="inline"
              externalResult={answer} initialAnswer={answer?.extracted_answer || ''}
              onAnswered={onAnswered}
              resultActions={videoEnabled && lesson ? <TeacherPaperVideo
                lesson={lesson}
                questionId={question.id} answerId={answer?.answer_id}
                buttonClassName="grading-result-action-button" /> : null} />
          </article>;
        })}
      </div>
      <footer className="teacher-paper-review-footer">
        <button type="button" className="page-back-button" onClick={onBack}>{backLabel}</button>
        <PrintButton />
        {onRestart && <button type="button" className="train-ghost-button" onClick={onRestart}>重新作答</button>}
      </footer>
    </main>
  </>;
}
