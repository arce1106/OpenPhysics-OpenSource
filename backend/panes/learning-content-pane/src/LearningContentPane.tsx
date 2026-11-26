import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { sanitizeKnowledgeSvg, sanitizeRenderedHtml } from './sanitizeHtml';
import 'katex/dist/katex.min.css';
import { parseBridgePayload, postBridgeEvent } from './bridge';
import './LearningContentPane.css';

type PaneMode =
  | 'question_interactive'
  | 'question_readonly'
  | 'teacher_paper_review'
  | 'practice_result'
  | 'history_records'
  | 'review_notebook'
  | 'review_mistake_detail'
  | 'self_review_solution'
  | 'knowledge_card';

type RenderedRichContent = {
  html?: string | null;
  plain_text?: string | null;
  has_markdown_table?: boolean | null;
  hasMarkdownTable?: boolean | null;
  errors?: Array<Record<string, unknown>> | null;
};

type QuestionOption = {
  label: string;
  text: string;
  rendered?: RenderedRichContent | null;
  text_rendered?: RenderedRichContent | null;
};

type QuestionImage = {
  id?: string | number;
  image_path?: string | null;
  image_url?: string | null;
  image_type?: string | null;
  description?: string | null;
};

type Question = {
  id: string | number;
  stem_text?: string | null;
  stem?: string | null;
  question_type?: string | null;
  options?: QuestionOption[];
  images?: QuestionImage[];
  correct_answer?: string | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation?: string | null;
  stem_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
};

type AnswerState = {
  submitted?: boolean;
  correct?: boolean;
  correctAnswer?: string | null;
  correct_answer?: string | null;
  correctAnswerRendered?: RenderedRichContent | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation?: string | null;
  explanation_rendered?: RenderedRichContent | null;
  extractedAnswer?: string | null;
  extracted_answer?: string | null;
  extractedAnswerRendered?: RenderedRichContent | null;
  extracted_answer_rendered?: RenderedRichContent | null;
  aiFeedback?: string | null;
  ai_feedback?: string | null;
  aiFeedbackRendered?: RenderedRichContent | null;
  ai_feedback_rendered?: RenderedRichContent | null;
  detectedMisconception?: { name?: string | null } | null;
  detected_misconception?: { name?: string | null } | null;
  masteryUpdate?: Record<string, MasteryUpdateValue> | null;
  mastery_update?: Record<string, MasteryUpdateValue> | null;
  processGrading?: ProcessGrading | null;
  process_grading?: ProcessGrading | null;
};

type MasteryUpdateValue = {
  before?: number | null;
  after?: number | null;
  name?: string | null;
};

type LearningState = {
  answerKind?: string | null;
  draftKinds?: string[] | null;
  selfReviewStatus?: string | null;
  submissionStatus?: string | null;
  completed?: number | null;
  total?: number | null;
  message?: string | null;
};

type LessonVideo = { id: string; title: string; duration_seconds: number; available: boolean; locked_reason?: string | null };

type HistoryRecord = {
  lesson_video?: LessonVideo | null;
  id: number;
  question_id: string;
  stem_text?: string | null;
  question_type?: string | null;
  options?: QuestionOption[];
  images?: QuestionImage[];
  given_answer?: string | null;
  answer_images?: QuestionImage[];
  is_correct: boolean;
  correct_answer?: string | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation?: string | null;
  stem_rendered?: RenderedRichContent | null;
  explanation_rendered?: RenderedRichContent | null;
  knowledge_points?: Array<{ name?: string | null }>;
  process_grading?: ProcessGrading | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

type ProcessGrading = {
  needs_human_review?: boolean | null;
  confidence_level?: string | null;
  grading_confidence?: number | null;
  process_score?: number | null;
  process_score_percent?: number | null;
  score?: number | null;
  max_score?: number | null;
  model_correct?: boolean | null;
  equation_correct?: boolean | null;
  calculation_correct?: boolean | null;
  unit_correct?: boolean | null;
  error_type?: string | null;
  error_type_name?: string | null;
  feedback?: string | null;
  feedback_rendered?: RenderedRichContent | null;
  first_error?: string | null;
  first_error_rendered?: RenderedRichContent | null;
  next_action?: string | null;
  next_action_rendered?: RenderedRichContent | null;
  grading_basis?: string | null;
  grading_basis_rendered?: RenderedRichContent | null;
  answer_image_path?: string | null;
  answer_image_paths?: string[] | null;
  answer_crop_image_path?: string | null;
  answer_page_image_paths?: string[] | null;
  answer_page_image_path?: string | null;
  process_evidence_image_path?: string | null;
  step_scores?: Array<{
    name?: string | null;
    score?: number | null;
    max_score?: number | null;
    comment?: string | null;
  }> | null;
};

type ReviewMistake = {
  lesson_video?: LessonVideo | null;
  answer_id: number;
  question_id: string;
  stem_text?: string | null;
  stem_rendered?: RenderedRichContent | null;
  question_type?: string | null;
  options?: QuestionOption[];
  images?: QuestionImage[];
  given_answer?: string | null;
  correct_answer?: string | null;
  correct_answer_rendered?: RenderedRichContent | null;
  explanation?: string | null;
  explanation_rendered?: RenderedRichContent | null;
  misconception_name?: string | null;
  answer_images?: QuestionImage[];
  process_grading?: ProcessGrading | null;
  created_at?: string | null;
};

type ReviewGroup = {
  kp_id?: string | null;
  kp_name?: string | null;
  mistakes?: ReviewMistake[];
};

type KnowledgeCardSection = {
  title?: string | null;
  text?: string | null;
  type?: string | null;
  rendered?: RenderedRichContent | null;
  content?: {
    html?: string | null;
    latex?: string | null;
    variable_table?: Array<{
      symbol?: string | null;
      name?: string | null;
      unit?: string | null;
    }> | null;
    svg?: string | null;
    stem?: string | null;
    solution?: string | null;
    key_takeaway?: string | null;
    items?: string[] | null;
  } | null;
};

type LearningContentPayload = {
  mode?: PaneMode | 'readonly' | 'interactive';
  // Explicit native phone opt-in; a narrow tablet pane keeps the legacy layout.
  presentation?: 'phone';
  textScale?: number;
  paperItems?: Array<LearningContentPayload & { answerId: number; lessonVideo?: LessonVideo | null }>;
  question?: Question;
  mistake?: ReviewMistake;
  records?: HistoryRecord[];
  groups?: ReviewGroup[];
  content_id?: string | null;
  title?: string | null;
  sections?: KnowledgeCardSection[];
  selectedAnswerIds?: number[];
  maxMistakesPerGroup?: number;
  reviewGroupBatchSize?: number;
  selectedOptions?: string[];
  answerState?: AnswerState | null;
  learningState?: LearningState | null;
  interactionLocked?: boolean;
  showAnswerSummary?: boolean;
  givenAnswer?: string | null;
  canCorrectGrading?: boolean;
  index?: number;
  total?: number;
};

function normalizePaneMode(mode: LearningContentPayload['mode']): PaneMode {
  if (mode === 'teacher_paper_review') return mode;
  if (mode === 'practice_result') return mode;
  if (mode === 'knowledge_card') return mode;
  if (mode === 'self_review_solution') return mode;
  if (mode === 'review_mistake_detail') return mode;
  if (mode === 'review_notebook') return mode;
  if (mode === 'history_records') return mode;
  if (mode === 'question_readonly' || mode === 'readonly') return 'question_readonly';
  return 'question_interactive';
}

function normalizeLabels(labels: string[] | undefined): string[] {
  return Array.from(new Set((labels || []).map(label => label.trim()).filter(Boolean))).sort();
}

function answerToLabels(answer: string | null | undefined): string[] {
  return normalizeLabels((answer || '').replace(/[,，、\s]/g, '').split(''));
}

function labelsToAnswer(labels: string[] | undefined): string {
  return normalizeLabels(labels).join('');
}

function processAnswerImages(grading?: ProcessGrading | null): QuestionImage[] {
  const primary = grading?.answer_image_paths?.length
    ? grading.answer_image_paths
    : grading?.answer_image_path ? [grading.answer_image_path] : [];
  const paths = primary.length ? primary : [
    grading?.answer_crop_image_path,
    ...(grading?.answer_page_image_paths || []),
    grading?.answer_page_image_path,
    grading?.process_evidence_image_path,
  ];
  return Array.from(new Set(paths.filter((path): path is string => Boolean(path?.trim()))))
    .map((path, index) => ({
      id: index,
      image_path: path,
      image_type: 'answer',
      description: `学生作答图片 ${index + 1}`,
    }));
}

function StudentAnswerContent({ answer, images }: { answer: string; images: QuestionImage[] }) {
  const placeholder = /^\s*\[(图片|图片作答|手写作答|手写图片|手写过程|整套纸笔照片)\]\s*$/.test(answer);
  return <>
    {answer && !(placeholder && images.length > 0)
      ? <p><RichContent text={answer} /></p>
      : images.length === 0 ? <p>未作答</p> : null}
    <PaneImages images={images} label="学生作答图片" />
  </>;
}

function isMultipleChoiceQuestion(question: Question): boolean {
  const raw = (question.question_type || '').toLowerCase();
  return raw.includes('multiple') || questionStem(question).includes('多选');
}

function nextSelectedLabels(current: string[], label: string, multiple: boolean): string[] {
  if (multiple) {
    return current.includes(label)
      ? normalizeLabels(current.filter(item => item !== label))
      : normalizeLabels([...current, label]);
  }
  return current.includes(label) ? [] : [label];
}

function canUseRendered(rendered?: RenderedRichContent | null) {
  return Boolean(rendered?.html?.trim()) && !rendered?.errors?.length;
}

function RichContent({ text, rendered }: { text?: string | null; rendered?: RenderedRichContent | null }) {
  if (canUseRendered(rendered)) {
    return <span className="op-pane-rich" dangerouslySetInnerHTML={{ __html: sanitizeRenderedHtml(rendered!.html || '') }} />;
  }
  return <span className="op-pane-rich op-pane-plain">{renderFallbackRichContent(text || '')}</span>;
}

function SummaryRichContent({ text }: { text?: string | null }) {
  return <span className="op-pane-summary-rich">{renderInlineMath(sanitizeSummaryText(text || ''))}</span>;
}

function KnowledgeSectionContent({ section }: { section: KnowledgeCardSection }) {
  const tone = knowledgeSectionTone(section);
  const content = section.content || {};
  if (tone === 'formula') {
    const latex = content.latex?.trim() || normalizeFormulaSectionLatex(section.text || '');
    return (
      <div className="op-pane-knowledge-formula-content">
        {latex && <KnowledgeFormula latex={latex} />}
        {!!content.variable_table?.length && (
          <table className="op-pane-knowledge-variable-table">
            <thead>
              <tr>
                <th>符号</th>
                <th>名称</th>
                <th>单位</th>
              </tr>
            </thead>
            <tbody>
              {content.variable_table.map((variable, index) => (
                <tr key={`${variable.symbol || 'variable'}-${index}`}>
                  <td>{renderInlineMath(`$${variable.symbol || ''}$`)}</td>
                  <td>{variable.name || ''}</td>
                  <td>{variable.unit || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  if (tone === 'diagram' && content.svg?.trim()) {
    return (
      <div
        className="op-pane-knowledge-diagram"
        dangerouslySetInnerHTML={{ __html: sanitizeKnowledgeSvg(content.svg) }}
      />
    );
  }
  if (tone === 'example' && (content.stem || content.solution || content.key_takeaway)) {
    return <KnowledgeExampleContent section={section} />;
  }
  if (tone === 'summary' && content.items?.length) {
    return (
      <ul className="op-pane-knowledge-summary">
        {content.items.map((item, index) => (
          <li key={index}><RichContent text={item} /></li>
        ))}
      </ul>
    );
  }
  return (
    <RichContent
      text={content.html || section.text}
      rendered={section.rendered}
    />
  );
}

function KnowledgeFormula({ latex }: { latex: string }) {
  const html = katex.renderToString(stripFormulaDelimiters(latex), {
    displayMode: true,
    throwOnError: false,
    strict: false,
  });
  return (
    <div
      className="op-pane-knowledge-formula"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function KnowledgeExampleContent({ section }: { section: KnowledgeCardSection }) {
  const [showSolution, setShowSolution] = useState(false);
  const content = section.content || {};
  return (
    <div className="op-pane-knowledge-example">
      {content.stem && <RichContent text={content.stem} />}
      {!!content.solution && (
        <button
          type="button"
          className="op-pane-knowledge-solution-toggle"
          aria-expanded={showSolution}
          onClick={() => setShowSolution(current => !current)}
        >
          {showSolution ? '收起解答' : '查看解答'}
        </button>
      )}
      {showSolution && (
        <div className="op-pane-knowledge-solution">
          <RichContent text={content.solution} />
          {!!content.key_takeaway && (
            <div className="op-pane-knowledge-takeaway">
              <span aria-hidden="true">💡</span>
              <RichContent text={content.key_takeaway} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderInlineMath(text: string) {
  const parts = text.split(/(\$[^$\n]+\$|\\\(.+?\\\))/g).filter(part => part.length > 0);
  return parts.map((part, index) => {
    const dollarMath = part.startsWith('$') && part.endsWith('$');
    const parenMath = part.startsWith('\\(') && part.endsWith('\\)');
    if (!dollarMath && !parenMath) return <span key={index}>{part}</span>;

    const math = dollarMath ? part.slice(1, -1) : part.slice(2, -2);
    const html = katex.renderToString(math, {
      displayMode: false,
      throwOnError: false,
      strict: false,
    });
    return <span key={index} className="op-pane-inline-math" dangerouslySetInnerHTML={{ __html: html }} />;
  });
}

const MD_TABLE_RE = /(?:^|\n)([ \t]*\|[^\n]+\|?[ \t]*\n[ \t]*\|[ \t\-:|]+\|?[ \t]*\n(?:[ \t]*\|[^\n]+\|?[ \t]*\n?)+)/gm;

function renderFallbackRichContent(text: string) {
  const parts: Array<{ type: 'text' | 'table'; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const tableRegex = new RegExp(MD_TABLE_RE.source, 'gm');

  while ((match = tableRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'table', content: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  const renderedParts = parts.length > 0 ? parts : [{ type: 'text' as const, content: text }];
  return renderedParts.map((part, index) => (
    part.type === 'table'
      ? <MarkdownTable key={index} markdown={part.content} />
      : <Fragment key={index}>{renderInlineMath(part.content)}</Fragment>
  ));
}

function MarkdownTable({ markdown }: { markdown: string }) {
  const lines = markdown.trim().split('\n');
  if (lines.length < 2) return <>{renderInlineMath(markdown)}</>;

  const parseRow = (line: string) =>
    line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

  const header = parseRow(lines[0]);
  const body = lines.slice(2).map(parseRow);

  return (
    <div className="openphysics-table-wrap">
      <table className="openphysics-rich-table">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index}>{renderInlineMath(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderInlineMath(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function questionStem(question: Question | HistoryRecord): string {
  return ('stem' in question ? question.stem : undefined) || question.stem_text || '';
}

function questionHasInlineStemImage(question: Question | HistoryRecord | ReviewMistake): boolean {
  const stem = questionStem(question as Question | HistoryRecord);
  if (/\{\{IMG:\d+\}\}/.test(stem)) return true;
  const renderedHtml = 'stem_rendered' in question ? question.stem_rendered?.html || '' : '';
  return /<img\b/i.test(renderedHtml);
}

function isPromptImage(image: QuestionImage): boolean {
  const type = (image.image_type || '').toLowerCase();
  return type !== 'explanation' && type !== 'option';
}

function questionPromptImages(question: Question | HistoryRecord | ReviewMistake): QuestionImage[] {
  return (question.images || []).filter(isPromptImage);
}

function looksLikeLatexFormula(text: string): boolean {
  return /\\[a-zA-Z]+/.test(text) || /[_^]/.test(text) || /[A-Za-z]\s*=\s*/.test(text);
}

function sanitizeSummaryText(text: string): string {
  return text
    .replace(/\{\{IMG:\d+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionCorrectAnswer(question: Question, answerState?: AnswerState | null): string {
  return answerState?.correctAnswer || answerState?.correct_answer || question.correct_answer || '';
}

function questionExplanation(question: Question, answerState?: AnswerState | null): {
  text: string;
  rendered?: RenderedRichContent | null;
} {
  return {
    text: answerState?.explanation || question.explanation || '',
    rendered: answerState?.explanation_rendered || question.explanation_rendered,
  };
}

function QuestionDisplay({
  afterAnswer,
  question,
  selectedOptions,
  givenAnswer,
  answerImages,
  answerState,
  showAnswerSummary = true,
  showAnalysis = true,
  showChoiceResult = false,
  interactive = false,
  interactionLocked = false,
  onSelectionChange,
  phonePresentation = false,
  index,
  total,
}: {
  afterAnswer?: ReactNode;
  question: Question;
  selectedOptions?: string[];
  givenAnswer?: string | null;
  answerImages?: QuestionImage[];
  answerState?: AnswerState | null;
  showAnswerSummary?: boolean;
  showAnalysis?: boolean;
  showChoiceResult?: boolean;
  interactive?: boolean;
  interactionLocked?: boolean;
  onSelectionChange?: (labels: string[]) => void;
  phonePresentation?: boolean;
  index?: number;
  total?: number;
}) {
  const promptRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!phonePresentation) return;
    const images = promptRef.current?.querySelectorAll<HTMLImageElement>('.op-pane-stem img, .op-pane-images img') || [];
    images.forEach(image => {
      image.setAttribute('role', 'button');
      image.setAttribute('tabindex', '0');
      image.setAttribute('aria-label', `${image.alt || '题目图片'}，查看大图`);
    });
    return () => images.forEach(image => {
      image.removeAttribute('role');
      image.removeAttribute('tabindex');
      image.removeAttribute('aria-label');
    });
  }, [phonePresentation, question]);
  const openImage = (target: EventTarget) => {
    if (phonePresentation && target instanceof HTMLImageElement && target.closest('.op-pane-stem, .op-pane-images')) {
      postBridgeEvent('onOpenImage', { src: target.src, questionId: question.id });
      return true;
    }
    return false;
  };
  const isChoice = Boolean(question.options?.length);
  const rawAnswer = answerState?.extractedAnswer || answerState?.extracted_answer || givenAnswer || '';
  const selected = isChoice ? normalizeLabels(
    selectedOptions !== undefined
      ? selectedOptions
      : interactive
        ? []
        : answerToLabels(rawAnswer),
  ) : [];
  const answer = isChoice ? labelsToAnswer(selected) : rawAnswer;
  const images = answerImages?.length ? answerImages : processAnswerImages(answerStateProcessGrading(answerState));
  const correctAnswer = questionCorrectAnswer(question, answerState);
  const correctLabels = answerToLabels(correctAnswer);
  const explanation = questionExplanation(question, answerState);
  const solutionVisible = !interactive || answerState?.submitted === true;
  const promptImages = questionPromptImages(question);
  const showImageGallery = promptImages.length > 0 && !questionHasInlineStemImage(question);
  const multipleChoice = isMultipleChoiceQuestion(question);

  return (
    <section ref={promptRef} className="op-pane-question"
      onClickCapture={event => {
        if (openImage(event.target)) { event.preventDefault(); event.stopPropagation(); }
      }}
      onKeyDownCapture={event => {
        if ((event.key === 'Enter' || event.key === ' ') && openImage(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
      {!phonePresentation && <header className="op-pane-question-header">
        {index != null && total != null && <span>第 {index + 1}/{total} 题</span>}
        <strong>{question.options?.length ? '题目' : '问答题'}</strong>
      </header>}

      <div className="op-pane-stem">
        <RichContent text={questionStem(question)} rendered={question.stem_rendered} />
      </div>

      {showImageGallery && (
        <div className="op-pane-images">
          {promptImages.map((image, index) => {
            const src = image.image_url || image.image_path || '';
            if (!src) return null;
            return <img key={image.id || index} src={src} alt={image.description || '题图'} />;
          })}
        </div>
      )}

      {Boolean(question.options?.length) && (
        <div className="op-pane-options">
          {question.options!.map(option => {
            const active = selected.includes(option.label);
            const isCorrectOption = showChoiceResult && correctLabels.includes(option.label);
            const isSelectedWrong = showChoiceResult && active && !isCorrectOption;
            const isGivenCorrect = showChoiceResult && active && isCorrectOption;
            const isDimmed = showChoiceResult && !active && !isCorrectOption;
            const resultBadges = showChoiceResult
              ? [
                  ...(active ? ['我的选择'] : []),
                  ...(isCorrectOption ? ['正确答案'] : []),
                ]
              : [];
            const toggle = () => {
              if (!interactive || interactionLocked) return;
              onSelectionChange?.(nextSelectedLabels(selected, option.label, multipleChoice));
            };
            return (
              <button
                key={option.label}
                type="button"
                className={[
                  'op-pane-option',
                  active && !showChoiceResult ? 'selected' : '',
                  isCorrectOption ? 'is-correct' : '',
                  isGivenCorrect ? 'is-given-correct' : '',
                  isSelectedWrong ? 'is-wrong' : '',
                  isDimmed ? 'is-dimmed' : '',
                ].filter(Boolean).join(' ')}
                onClick={toggle}
                aria-pressed={active}
                disabled={!interactive || interactionLocked}
              >
                <span className={`op-pane-option-label${multipleChoice ? ' is-multiple' : ''}`}>
                  {option.label}
                </span>
                <RichContent text={option.text} rendered={option.rendered || option.text_rendered} />
                {resultBadges.length > 0 && (
                  <span className="op-pane-option-result-badges">
                    {resultBadges.map(badge => (
                      <span
                        key={badge}
                        className={[
                          'op-pane-option-result-badge',
                          badge === '正确答案' ? 'is-correct-answer' : '',
                          badge === '我的选择' && isSelectedWrong ? 'is-yours-wrong' : '',
                          badge === '我的选择' && isGivenCorrect ? 'is-yours-correct' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        {badge}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {solutionVisible && showAnswerSummary && (answer || correctAnswer || images.length > 0) && (
        <div className="op-pane-answer-grid">
          <section className={`op-pane-answer-card ${answerState?.correct === false ? 'wrong' : 'correct'}`}>
            <h2>我的答案</h2>
            <StudentAnswerContent answer={answer} images={images} />
          </section>
          <section className="op-pane-answer-card correct">
            <h2>正确答案</h2>
            {correctAnswer ? (
              <p>
                <RichContent
                  text={correctAnswer}
                  rendered={
                    answerState?.correctAnswerRendered ||
                    answerState?.correct_answer_rendered ||
                    question.correct_answer_rendered
                  }
                />
              </p>
            ) : (
              <p>待公布</p>
            )}
          </section>
        </div>
      )}

      {afterAnswer}

      {solutionVisible && showAnalysis && explanation.text && (
        <section className="op-pane-analysis">
          <h2>解析</h2>
          <RichContent text={explanation.text} rendered={explanation.rendered} />
        </section>
      )}
    </section>
  );
}

function answerStateProcessGrading(answerState?: AnswerState | null): ProcessGrading | null {
  return answerState?.processGrading || answerState?.process_grading || null;
}

function answerStateAiFeedback(answerState?: AnswerState | null): {
  text: string;
  rendered?: RenderedRichContent | null;
} {
  return {
    text: answerState?.aiFeedback || answerState?.ai_feedback || '',
    rendered: answerState?.aiFeedbackRendered || answerState?.ai_feedback_rendered,
  };
}

function answerStateExtractedAnswer(answerState?: AnswerState | null): {
  text: string;
  rendered?: RenderedRichContent | null;
} {
  return {
    text: answerState?.extractedAnswer || answerState?.extracted_answer || '',
    rendered: answerState?.extractedAnswerRendered || answerState?.extracted_answer_rendered,
  };
}

type PracticeResultTone = 'correct' | 'partial' | 'wrong';

function practiceResultCredit(correct: boolean, grading?: ProcessGrading | null): number {
  if (typeof grading?.score === 'number' && typeof grading.max_score === 'number' && grading.max_score > 0) {
    return Math.max(0, Math.min(1, grading.score / grading.max_score));
  }
  if (typeof grading?.process_score === 'number') {
    return Math.max(0, Math.min(1, grading.process_score / 100));
  }
  const stepScores = grading?.step_scores || [];
  const maxScore = stepScores.reduce((sum, step) => sum + (step.max_score || 0), 0);
  if (maxScore > 0) {
    const score = stepScores.reduce((sum, step) => sum + (step.score || 0), 0);
    return Math.max(0, Math.min(1, score / maxScore));
  }
  return correct ? 1 : 0;
}

function practiceResultStatus(correct: boolean, grading?: ProcessGrading | null): {
  tone: PracticeResultTone;
  label: string;
} {
  const credit = practiceResultCredit(correct, grading);
  if (correct || credit >= 0.999) return { tone: 'correct', label: '✓ 回答正确！' };
  if (credit > 0) return { tone: 'partial', label: '△ 部分正确' };
  return { tone: 'wrong', label: '✗ 需订正' };
}

function answerStateMisconception(answerState?: AnswerState | null): string {
  return (
    answerState?.detectedMisconception?.name ||
    answerState?.detected_misconception?.name ||
    ''
  ).trim();
}

function answerStateMasteryUpdate(answerState?: AnswerState | null): Record<string, MasteryUpdateValue> {
  return answerState?.masteryUpdate || answerState?.mastery_update || {};
}

function PracticeResultView({
  resultActions,
  question,
  selectedOptions,
  givenAnswer,
  answerState,
  canCorrectGrading = false,
  phonePresentation = false,
  index,
  total,
}: {
  resultActions?: ReactNode;
  question: Question;
  selectedOptions?: string[];
  givenAnswer?: string | null;
  answerState?: AnswerState | null;
  canCorrectGrading?: boolean;
  phonePresentation?: boolean;
  index?: number;
  total?: number;
}) {
  const imageRegion = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!phonePresentation) return;
    const images = imageRegion.current?.querySelectorAll('img') || [];
    images.forEach(image => {
      image.setAttribute('role', 'button');
      image.setAttribute('tabindex', '0');
      image.setAttribute('aria-label', `${image.alt || '图片'}，查看大图`);
    });
    return () => images.forEach(image => {
      image.removeAttribute('role'); image.removeAttribute('tabindex'); image.removeAttribute('aria-label');
    });
  }, [phonePresentation, question, answerState]);
  const openImage = (target: EventTarget) => {
    if (!phonePresentation || !(target instanceof HTMLImageElement)) return false;
    postBridgeEvent('onOpenImage', { src: target.src, questionId: question.id });
    return true;
  };
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const correct = answerState?.correct === true;
  const isChoice = Boolean(question.options?.length);
  const correctAnswer = questionCorrectAnswer(question, answerState);
  const explanation = questionExplanation(question, answerState);
  const extractedAnswer = answerStateExtractedAnswer(answerState);
  const aiFeedback = answerStateAiFeedback(answerState);
  const grading = answerStateProcessGrading(answerState);
  const misconception = answerStateMisconception(answerState);
  const masteryUpdate = answerStateMasteryUpdate(answerState);
  const status = practiceResultStatus(correct, grading);
  const displayedAnswer = extractedAnswer.text || givenAnswer || '';
  const answerImages = processAnswerImages(grading);
  const explanationImages = (question.images || []).filter(
    image => image.image_type === 'explanation',
  );
  const hasDetailedFeedback = Boolean(grading) || !correct;
  const phoneFocus = phonePresentation && (grading?.first_error || grading?.next_action);
  const originalQuestion = (
    <QuestionDisplay
        question={question}
        phonePresentation={phonePresentation}
        selectedOptions={selectedOptions}
        givenAnswer={givenAnswer}
        answerState={answerState}
        showAnswerSummary={false}
        showAnalysis={false}
        showChoiceResult={isChoice}
        index={index}
        total={total}
      />
  );

  return (
    <section ref={imageRegion} className="op-pane-practice-result"
      onClickCapture={event => { if (openImage(event.target)) { event.preventDefault(); event.stopPropagation(); } }}
      onKeyDownCapture={event => {
        if ((event.key === 'Enter' || event.key === ' ') && openImage(event.target)) { event.preventDefault(); event.stopPropagation(); }
      }}>
      {!phonePresentation && originalQuestion}
      <section className={`op-pane-grading-result ${status.tone}`}>
        <div className="op-pane-grading-result-title">{phonePresentation
          ? status.tone === 'correct' ? '回答正确' : status.tone === 'partial' ? '部分正确' : '需要订正'
          : status.label}</div>

        {/* Phone: the question stays open, like the web. A choice question's options carry 我的选择 /
            正确答案, so they come right after the verdict; other types follow the first problem. */}
        {phonePresentation && isChoice && originalQuestion}

        {phoneFocus && <div className="op-pane-phone-result-focus">
          {grading?.first_error && <div className="op-pane-phone-result-focus-item">
            <strong>第一处问题</strong>
            <RichContent text={grading.first_error} rendered={grading.first_error_rendered} />
          </div>}
          {grading?.next_action && <div className="op-pane-phone-result-focus-item">
            <strong>下一步</strong>
            <RichContent text={grading.next_action} rendered={grading.next_action_rendered} />
          </div>}
        </div>}

        {phonePresentation && !isChoice && originalQuestion}

        {extractedAnswer.text && (
          <div className="op-pane-grading-result-extracted">
            AI 识别答案：
            <span><RichContent text={extractedAnswer.text} rendered={extractedAnswer.rendered} /></span>
          </div>
        )}

        {phonePresentation && !isChoice && !extractedAnswer.text && givenAnswer && !/^\[(图片|手写|自评)/.test(givenAnswer) && (
          <div className="op-pane-phone-answer"><strong>我的答案</strong><RichContent text={givenAnswer} /></div>
        )}
        {answerImages.length > 0 && (
          <div className="op-pane-grading-result-answer-images">
            <div className="op-pane-grading-result-label">学生作答图片</div>
            <PaneImages images={answerImages} label="学生作答图片" />
          </div>
        )}

        {aiFeedback.text && (
          <div className="op-pane-grading-result-ai-feedback">
            <RichContent text={aiFeedback.text} rendered={aiFeedback.rendered} />
          </div>
        )}

        {!correct && misconception && (
          <div className="op-pane-grading-result-misconception">
            检测到知识点混淆：<span>{misconception}</span>
          </div>
        )}

        {!correct && !(phonePresentation && isChoice) && (
          <div className="op-pane-grading-result-correct-answer">
            <span className="op-pane-grading-result-label">正确答案</span>
            <span>
              <RichContent
                text={correctAnswer || '待公布'}
                rendered={
                  answerState?.correctAnswerRendered ||
                  answerState?.correct_answer_rendered ||
                  question.correct_answer_rendered
                }
              />
            </span>
          </div>
        )}

        {/* Like the web result: once graded, the explanation is open so the student reads it once. */}
        {phonePresentation ? <details className="op-pane-phone-explanation" key={`explanation-${question.id}`} open>
          <summary>完整解析</summary>
          <RichContent text={explanation.text.trim() || '暂无解析，可生成解析'} rendered={explanation.rendered} />
          <PaneImages images={explanationImages} label="解析附图" />
        </details> : <div className="op-pane-grading-result-explanation">
          <span className="op-pane-grading-result-label">解析</span>
          <RichContent
            text={explanation.text.trim() || '暂无解析，可生成解析'}
            rendered={explanation.rendered}
          />
        </div>}

        {!phonePresentation && explanationImages.length > 0 && (
          <div className="op-pane-grading-result-explanation-images">
            <PaneImages images={explanationImages} label="解析附图" />
          </div>
        )}

        {(hasDetailedFeedback || resultActions) && (
          <div className="op-pane-grading-result-detail-toggle">
            {hasDetailedFeedback && (
            <button
              type="button"
              className="op-pane-grading-result-action"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen(open => !open)}
            >
              {detailsOpen ? '收起详细批改' : '查看详细批改'}
            </button>
            )}
            {resultActions}
          </div>
        )}

        {detailsOpen && (
          <div className="op-pane-grading-result-details">
            {grading && (
              <>
                <GradingTrustPanel grading={grading} />
                <ProcessGradingSummary grading={grading} showFocus={!phonePresentation} />
              </>
            )}
            <GrowthFeedbackPanel
              correct={correct}
              grading={grading}
              misconception={misconception}
              masteryUpdate={masteryUpdate}
            />
            {canCorrectGrading && grading && (
              <div className="op-pane-grading-result-correction">
                <div className="op-pane-grading-result-correction-note">
                  AI 判断不准时，可以手动纠正，本题记录和掌握度会同步修正。
                </div>
                <div className="op-pane-grading-result-correction-form">
                  <input
                    type="text"
                    value={correctionText}
                    onChange={event => setCorrectionText(event.target.value)}
                    placeholder="可填写正确识别的答案"
                    className="op-pane-grading-result-correction-input"
                  />
                  <button
                    type="button"
                    className="op-pane-grading-result-action"
                    onClick={() => {
                      postBridgeEvent('onCorrectGrading', {
                        questionId: question.id,
                        correct: true,
                        correctedAnswer: correctionText.trim() || displayedAnswer,
                      });
                    }}
                  >
                    改为正确
                  </button>
                  <button
                    type="button"
                    className="op-pane-grading-result-action"
                    onClick={() => {
                      postBridgeEvent('onCorrectGrading', {
                        questionId: question.id,
                        correct: false,
                        correctedAnswer: correctionText.trim() || displayedAnswer,
                      });
                    }}
                  >
                    改为错误
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function GradingTrustPanel({ grading, headerActions }: { grading?: ProcessGrading | null; headerActions?: ReactNode }) {
  if (!grading) return headerActions ? <div className="op-pane-grading-trust-head"><div className="op-pane-grading-trust-actions">{headerActions}</div></div> : null;
  const level = grading.confidence_level || (grading.needs_human_review ? 'low' : 'medium');
  const confidence = grading.grading_confidence != null
    ? `${Math.round(grading.grading_confidence * 100)}%`
    : '';
  const copy = level === 'high'
    ? { label: '可信度高', tone: 'high' }
    : level === 'low'
      ? { label: '建议人工确认', tone: 'low' }
      : { label: '可信度中', tone: 'medium' };
  const displaySteps = (grading.step_scores || []).filter(step => {
    const name = (step.name || '').trim();
    return Boolean((step.comment || '').trim()) || !/^步骤\d+$/.test(name);
  });
  const visible = Boolean(
    grading.grading_basis ||
    grading.grading_basis_rendered?.html ||
    displaySteps.length ||
    grading.needs_human_review ||
    confidence,
  );
  if (!visible) return headerActions ? <div className="op-pane-grading-trust-head"><div className="op-pane-grading-trust-actions">{headerActions}</div></div> : null;

  return (
    <div className="op-pane-grading-trust">
      <div className="op-pane-grading-trust-head">
        <span className={`op-pane-grading-trust-badge ${copy.tone}`}>
          {copy.label}{confidence ? ` ${confidence}` : ''}
        </span>
        {grading.needs_human_review && (
          <span className="op-pane-grading-trust-review">建议人工确认后再作为学习结论</span>
        )}
        {headerActions && <div className="op-pane-grading-trust-actions">{headerActions}</div>}
      </div>
      {grading.grading_basis && (
        <div className="op-pane-grading-trust-basis">
          <span>判分依据：</span>
          <RichContent text={grading.grading_basis} rendered={grading.grading_basis_rendered} />
        </div>
      )}
      {displaySteps.length > 0 && (
        <div className="op-pane-grading-step-list">
          {displaySteps.map((step, index) => (
            <div className="op-pane-grading-step" key={`${step.name || '步骤'}-${index}`}>
              <div>
                <strong>{step.name || `步骤 ${index + 1}`}</strong>
                {step.score != null && step.max_score != null && (
                  <span>{step.score}/{step.max_score}</span>
                )}
              </div>
              {step.comment && <RichContent text={step.comment} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GrowthFeedbackPanel({
  correct,
  grading,
  misconception,
  masteryUpdate,
}: {
  correct: boolean;
  grading?: ProcessGrading | null;
  misconception: string;
  masteryUpdate: Record<string, MasteryUpdateValue>;
}) {
  const weakParts = [
    ['模型选择', grading?.model_correct],
    ['方程建立', grading?.equation_correct],
    ['计算处理', grading?.calculation_correct],
    ['单位/方向', grading?.unit_correct],
  ]
    .filter(([, ok]) => ok === false)
    .map(([label]) => label);
  const processPoint = grading?.error_type_name && grading.error_type !== 'none'
    ? `${grading.error_type_name}${weakParts.length ? `，重点检查${weakParts.join('、')}` : ''}`
    : weakParts.length
      ? `重点检查${weakParts.join('、')}`
      : grading?.process_score != null
        ? `过程得分 ${grading.process_score}/100`
        : '';
  const masteryPoints = Object.entries(masteryUpdate)
    .map(([kpId, item]) => ({
      name: item.name?.trim() || kpId,
      before: item.before || 0,
      after: item.after || 0,
    }))
    .filter(item => Math.abs(item.after - item.before) >= 0.005)
    .map(item => {
      const direction = item.after >= item.before ? '提升' : '回落';
      return `${item.name}：${Math.round(item.before * 100)}% 到 ${Math.round(item.after * 100)}%，掌握度${direction}`;
    });
  const points = [
    ...masteryPoints,
    ...(processPoint ? [processPoint] : []),
    ...(misconception ? [`需要澄清的概念：${misconception}`] : []),
    ...(grading?.first_error ? [`第一处问题：${grading.first_error}`] : []),
  ];
  const title = correct
    ? masteryPoints.length ? '这一步有效推进了掌握' : '本题方法基本稳定'
    : grading?.first_error ? '先修正第一处问题' : '把错误转化为下一次会做';
  const summary = correct
    ? masteryPoints.length
      ? '答案正确，同时系统记录到相关知识点的掌握变化。'
      : '答案正确，可以把注意力放到表达是否更简洁、模型选择是否更稳。'
    : '本题没有直接判对，但它已经暴露出最值得修正的位置。';
  const visiblePoints = points.length
    ? points
    : [correct ? '本题已经完成“作答、反馈、确认”的学习闭环。' : '先对照正确答案，找出自己第一步偏离的位置。'];
  const nextAction = correct
    ? '继续做下一题，遇到相似模型时优先复用这次的解题路径。'
    : grading?.next_action || '先重做关键一步，再完整写一遍解题过程。';

  return (
    <section className={`op-pane-growth-feedback ${correct ? 'correct' : 'repair'}`}>
      <div className="op-pane-growth-feedback-label">学习闭环反馈</div>
      <h3>{title}</h3>
      <p>{summary}</p>
      <ul>
        {visiblePoints.map(point => <li key={point}><RichContent text={point} /></li>)}
      </ul>
      <div className="op-pane-growth-feedback-next">
        <strong>下一步：</strong><RichContent text={nextAction} />
      </div>
    </section>
  );
}

function PaneImages({ images, label }: { images?: QuestionImage[] | null; label: string }) {
  if (!images?.length) return null;
  return (
    <div className="op-pane-images">
      {images.map((image, index) => {
        const src = image.image_url || image.image_path || '';
        if (!src) return null;
        return <img key={image.id || index} src={src} alt={image.description || label} />;
      })}
    </div>
  );
}

function KnowledgeCardView({
  title,
  sections,
}: {
  title?: string | null;
  sections?: KnowledgeCardSection[];
}) {
  return (
    <section className="op-pane-knowledge-card">
      {title && <h1>{title}</h1>}
      <div className="op-pane-knowledge-sections">
        {(sections || []).map((section, index) => (
          <article
            key={`${section.title || section.type || 'section'}-${index}`}
            className={`op-pane-knowledge-section ${knowledgeSectionTone(section)}`}
          >
            <h2>{section.title || knowledgeSectionDefaultTitle(section)}</h2>
            <KnowledgeSectionContent section={section} />
          </article>
        ))}
      </div>
    </section>
  );
}

function knowledgeSectionTone(section: KnowledgeCardSection): string {
  const type = (section.type || '').toLowerCase();
  if (type === 'formula') return 'formula';
  if (type === 'diagram') return 'diagram';
  if (type === 'example') return 'example';
  if (type === 'summary') return 'summary';
  if (type === 'concept') return 'concept';
  const title = (section.title || '').toLowerCase();
  if (title.includes('公式') || title.includes('规律')) return 'formula';
  if (title.includes('例')) return 'example';
  if (title.includes('总结')) return 'summary';
  if (title.includes('图')) return 'diagram';
  return 'concept';
}

function knowledgeSectionDefaultTitle(section: KnowledgeCardSection): string {
  const tone = knowledgeSectionTone(section);
  if (tone === 'formula') return '关键公式/规律';
  if (tone === 'example') return '示例';
  if (tone === 'diagram') return '物理图像';
  if (tone === 'summary') return '一句话总结';
  return '概念理解';
}

function normalizeFormulaSectionLatex(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !looksLikeLatexFormula(trimmed)) return '';
  return stripFormulaDelimiters(trimmed);
}

function stripFormulaDelimiters(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) return trimmed.slice(2, -2);
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) return trimmed.slice(1, -1);
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) return trimmed.slice(2, -2);
  if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) return trimmed.slice(2, -2);
  return trimmed;
}

function SelfReviewSolutionView({ question }: { question: Question }) {
  const correctAnswer = question.correct_answer || '';
  const explanation = questionExplanation(question);

  return (
    <section className="op-pane-self-review-solution">
      <section className="op-pane-self-review-answer">
        <h2>标准答案</h2>
        {correctAnswer ? (
          <RichContent text={correctAnswer} rendered={question.correct_answer_rendered} />
        ) : (
          <p>暂无标准答案</p>
        )}
      </section>

      {explanation.text && (
        <section className="op-pane-analysis">
          <h2>解析</h2>
          <RichContent text={explanation.text} rendered={explanation.rendered} />
        </section>
      )}
    </section>
  );
}

function ReviewMistakeDetail({ mistake, phonePresentation = false }: { mistake: ReviewMistake; phonePresentation?: boolean }) {
  const question: Question = {
    id: mistake.question_id,
    stem_text: mistake.stem_text,
    stem_rendered: mistake.stem_rendered,
    question_type: mistake.question_type,
    options: mistake.options || [],
    images: mistake.images || [],
  };
  const selectedOptions = question.options?.length ? answerToLabels(mistake.given_answer) : [];
  const givenAnswer = question.options?.length ? labelsToAnswer(selectedOptions) : mistake.given_answer || '';
  const answerImages = mistake.answer_images?.length ? mistake.answer_images : processAnswerImages(mistake.process_grading);
  const correctAnswer = mistake.correct_answer || '';
  const isCorrect = givenAnswer.trim() !== '' && correctAnswer.trim() !== '' && givenAnswer.trim() === correctAnswer.trim();

  return (
    <section className="op-pane-review-detail">
      <QuestionDisplay
        question={question}
        selectedOptions={selectedOptions}
        showAnswerSummary={false}
        phonePresentation={phonePresentation}
      />

      <div className="op-pane-answer-grid">
        <section className={`op-pane-answer-card ${isCorrect ? 'correct' : 'wrong'}`}>
          <h2>你的答案</h2>
          <StudentAnswerContent answer={givenAnswer} images={answerImages} />
        </section>
        <section className="op-pane-answer-card correct">
          <h2>正确答案</h2>
          {correctAnswer ? (
            <p>
              <RichContent text={correctAnswer} rendered={mistake.correct_answer_rendered} />
            </p>
          ) : (
            <p>待公布</p>
          )}
        </section>
      </div>

      {mistake.misconception_name && (
        <section className="op-pane-review-misconception">
          <strong>错因类型：</strong>
          <span>{mistake.misconception_name}</span>
        </section>
      )}

      {mistake.process_grading && (phonePresentation ? (
        <details className="op-pane-phone-explanation">
          <summary>过程批改与依据</summary>
          <ProcessGradingSummary grading={mistake.process_grading} />
        </details>
      ) : <ProcessGradingSummary grading={mistake.process_grading} />)}

      {mistake.explanation && (phonePresentation ? (
        <details className="op-pane-phone-explanation">
          <summary>完整解析</summary>
          <RichContent text={mistake.explanation} rendered={mistake.explanation_rendered} />
        </details>
      ) : (
        <section className="op-pane-analysis">
          <h2>解析</h2>
          <RichContent text={mistake.explanation} rendered={mistake.explanation_rendered} />
        </section>
      ))}
    </section>
  );
}

function ProcessGradingSummary({
  grading,
  showFocus = true,
}: {
  grading: ProcessGrading;
  showFocus?: boolean;
}) {
  const checks = [
    ['模型', grading.model_correct],
    ['方程', grading.equation_correct],
    ['计算', grading.calculation_correct],
    ['单位/方向', grading.unit_correct],
  ] as const;
  const hasDetails = Boolean(grading.error_type_name || grading.first_error || grading.next_action || grading.grading_basis);

  return (
    <section className="op-pane-process">
      <div className="op-pane-process-header">
        <span>过程批改</span>
        {grading.process_score != null && <span>{grading.score != null && grading.max_score != null
          ? `${grading.score}/${grading.max_score} 分 · 折合 ${grading.process_score_percent ?? grading.process_score}/100`
          : `${grading.process_score}/100`}</span>}
      </div>
      <div className={`op-pane-process-checks${hasDetails ? ' has-details' : ''}`}>
        {checks.map(([label, value]) => (
          <div key={label} className="op-pane-process-check">
            <span className="op-pane-process-label">{label}</span>
            <ProcessCheckMark value={value} />
          </div>
        ))}
      </div>
      {grading.error_type_name && <div className="op-pane-process-detail">错因类型：{grading.error_type_name}</div>}
      {showFocus && grading.first_error && (
        <div className="op-pane-process-detail">
          第一处问题：<RichContent text={grading.first_error} rendered={grading.first_error_rendered} />
        </div>
      )}
      {showFocus && grading.next_action && (
        <div className="op-pane-process-detail">
          下一步：<RichContent text={grading.next_action} rendered={grading.next_action_rendered} />
        </div>
      )}
      {grading.feedback && (
        <div className="op-pane-process-detail">
          过程反馈：<RichContent text={grading.feedback} rendered={grading.feedback_rendered} />
        </div>
      )}
      {grading.grading_basis && (
        <div className="op-pane-process-detail">
          批改依据：<RichContent text={grading.grading_basis} rendered={grading.grading_basis_rendered} />
        </div>
      )}
      {!!grading.step_scores?.length && (
        <div className="op-pane-process-steps">
          {grading.step_scores.map((step, index) => (
            <div key={`${step.name || '步骤'}-${index}`} className="op-pane-process-step">
              <strong>{step.name || `步骤 ${index + 1}`}</strong>
              {step.score != null && step.max_score != null && <span>{step.score}/{step.max_score}</span>}
              {step.comment && <small><RichContent text={step.comment} /></small>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProcessCheckMark({ value }: { value?: boolean | null }) {
  if (value === true) return <span className="op-pane-process-value correct">正确</span>;
  if (value === false) return <span className="op-pane-process-value wrong">需修正</span>;
  return <span className="op-pane-process-value">未判断</span>;
}

function hasProcessGradingDetails(grading?: ProcessGrading | null): grading is ProcessGrading {
  if (!grading) return false;
  return Boolean(
    grading.needs_human_review ||
    grading.confidence_level ||
    grading.grading_confidence != null ||
    grading.process_score != null ||
    grading.model_correct != null ||
    grading.equation_correct != null ||
    grading.calculation_correct != null ||
    grading.unit_correct != null ||
    grading.error_type_name ||
    grading.feedback ||
    grading.first_error ||
    grading.next_action ||
    grading.grading_basis ||
    grading.answer_image_path ||
    grading.answer_image_paths?.length ||
    grading.step_scores?.length
  );
}

function HistoryRecords({ records, onLayoutChange }: { records: HistoryRecord[]; onLayoutChange: () => void }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setExpandedId(null);
  }, [records]);

  useEffect(() => {
    onLayoutChange();
  }, [expandedId, onLayoutChange]);

  return (
    <section className="op-pane-history">
      {records.map(record => {
        const expanded = expandedId === record.id;
        const selectedOptions = record.options?.length ? answerToLabels(record.given_answer) : [];
        const question: Question = {
          id: record.question_id,
          stem_text: record.stem_text,
          question_type: record.question_type,
          options: record.options || [],
          images: record.images || [],
          correct_answer: record.correct_answer,
          correct_answer_rendered: record.correct_answer_rendered,
          explanation: record.explanation,
          stem_rendered: record.stem_rendered,
          explanation_rendered: record.explanation_rendered,
        };
        const kpNames = (record.knowledge_points || [])
          .map(kp => kp.name?.trim())
          .filter((name): name is string => Boolean(name));
        const needsReview = Boolean(record.process_grading?.needs_human_review);
        const hasGradingDetails = hasProcessGradingDetails(record.process_grading);

        return (
          <article key={record.id} className={`op-pane-history-record ${expanded ? 'is-expanded' : ''}`}>
            <button
              type="button"
              className={`op-pane-history-summary ${record.is_correct ? 'correct' : 'wrong'}`}
              onClick={() => setExpandedId(expanded ? null : record.id)}
              aria-expanded={expanded}
            >
              <span className="op-pane-status-dot" />
              <span className="op-pane-history-main">
                <span className="op-pane-history-title">
                  <SummaryRichContent text={questionStem(record) || record.question_id} />
                </span>
                <span className="op-pane-history-tags" aria-label="题目标签">
                  <HistoryTag text={questionTypeLabel(record.question_type)} />
                  {record.lesson_video && <HistoryTag text="有视频讲解" />}
                  {kpNames.slice(0, 2).map(name => <HistoryTag key={name} text={name} />)}
                  {needsReview && <HistoryTag text="建议确认" tone="warn" />}
                </span>
              </span>
              {record.created_at && <time>{formatDate(record.created_at)}</time>}
            </button>

            {expanded && (
              <div className="op-pane-history-detail">
                <QuestionDisplay
                  question={question}
                  selectedOptions={selectedOptions}
                  givenAnswer={record.given_answer}
                  answerImages={record.answer_images}
                  answerState={{
                    submitted: true,
                    correct: record.is_correct,
                    correctAnswer: record.correct_answer,
                    explanation: record.explanation,
                    explanation_rendered: record.explanation_rendered,
                    process_grading: record.process_grading,
                  }}
                  afterAnswer={<>
                    <GradingTrustPanel grading={record.process_grading} headerActions={record.lesson_video ? <LessonVideoButton video={record.lesson_video} answerId={record.id} questionId={record.question_id} /> : undefined} />
                    {hasGradingDetails && record.process_grading && <ProcessGradingSummary grading={record.process_grading} />}
                  </>}
                />
                {!record.is_correct && !record.reviewed_at && (
                  <button
                    type="button"
                    className="op-pane-review-button"
                    onClick={() => {
                      postBridgeEvent('onOpenReview', {
                        answerId: record.id,
                        questionId: record.question_id,
                      });
                    }}
                  >
                    去错题复盘
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function LessonVideoButton({ video, answerId, questionId }: { video?: LessonVideo | null; answerId: number; questionId: string }) {
  if (!video) return null;
  return video.available
    ? <button type="button" className="op-pane-grading-result-action" onClick={() => postBridgeEvent('onOpenLessonVideo', { answerId, questionId })}>视频讲解</button>
    : <span>{video.locked_reason || '整套批改完成后可看视频讲解'}</span>;
}

function HistoryTag({ text, tone }: { text: string; tone?: 'warn' }) {
  return <span className={`op-pane-history-tag ${tone === 'warn' ? 'warn' : ''}`}>{text}</span>;
}

function ReviewNotebook({
  groups,
  selectedAnswerIds,
  maxMistakesPerGroup,
  reviewGroupBatchSize,
}: {
  groups: ReviewGroup[];
  selectedAnswerIds?: number[];
  maxMistakesPerGroup?: number;
  reviewGroupBatchSize?: number;
}) {
  const selected = new Set(selectedAnswerIds || []);
  const maxVisible = Math.max(1, maxMistakesPerGroup || 5);
  const nonEmptyGroups = groups.filter(group => (group.mistakes || []).length > 0);
  const groupBatchSize = Math.max(1, reviewGroupBatchSize || 8);
  const groupIdentity = nonEmptyGroups
    .map(group => `${group.kp_id || group.kp_name || ''}:${group.mistakes?.length || 0}`)
    .join('|');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [visibleGroupCount, setVisibleGroupCount] = useState(groupBatchSize);

  useEffect(() => {
    setVisibleGroupCount(groupBatchSize);
  }, [groupIdentity, groupBatchSize]);

  const visibleGroups = nonEmptyGroups.slice(0, visibleGroupCount);
  const remainingGroupCount = Math.max(0, nonEmptyGroups.length - visibleGroups.length);

  return (
    <section className="op-pane-review-notebook">
      {visibleGroups.map((group, index) => {
        const groupId = group.kp_id || group.kp_name || `group-${index}`;
        const mistakes = group.mistakes || [];
        const expanded = expandedGroupIds.has(groupId);
        const visibleMistakes = expanded ? mistakes : mistakes.slice(0, maxVisible);
        return (
          <article key={groupId} className="op-pane-review-group">
            <button
              type="button"
              className="op-pane-review-group-header"
              onClick={() => {
                setExpandedGroupIds(current => {
                  const next = new Set(current);
                  if (next.has(groupId)) next.delete(groupId);
                  else next.add(groupId);
                  return next;
                });
              }}
              aria-expanded={expanded}
            >
              <span className="op-pane-review-caret">{expanded ? '▼' : '▶'}</span>
              <strong>{group.kp_name || '未归类知识点'}</strong>
              <HistoryTag text={`${mistakes.length} 题`} tone="warn" />
            </button>
            <div className="op-pane-review-rows">
              {visibleMistakes.map(mistake => (
                <ReviewMistakeRow
                  key={mistake.answer_id}
                  mistake={mistake}
                  selected={selected.has(mistake.answer_id)}
                />
              ))}
            </div>
            {mistakes.length > maxVisible && (
              <button
                type="button"
                className="op-pane-review-more"
                onClick={() => {
                  setExpandedGroupIds(current => {
                    const next = new Set(current);
                    if (next.has(groupId)) next.delete(groupId);
                    else next.add(groupId);
                    return next;
                  });
                }}
              >
                {expanded ? '收起' : `展开全部 ${mistakes.length} 道`}
              </button>
            )}
          </article>
        );
      })}
      {remainingGroupCount > 0 && (
        <button
          type="button"
          className="op-pane-review-more"
          onClick={() => setVisibleGroupCount(current => current + groupBatchSize)}
        >
          显示更多知识点（剩余 {remainingGroupCount} 组）
        </button>
      )}
    </section>
  );
}

function ReviewMistakeRow({ mistake, selected }: { mistake: ReviewMistake; selected: boolean }) {
  const stem = sanitizeSummaryText(mistake.stem_text || mistake.question_id);
  const needsReview = Boolean(mistake.process_grading?.needs_human_review);
  const hasAnswerImages = Boolean(mistake.answer_images?.length);
  const eventPayload = {
    answerId: mistake.answer_id,
    questionId: mistake.question_id,
  };

  return (
    <div className="op-pane-review-row">
      <button
        type="button"
        className={`op-pane-review-check ${selected ? 'selected' : ''}`}
        onClick={() => postBridgeEvent('onToggleMistakeSelection', eventPayload)}
        aria-label={`切换选择：${stem}`}
      >
        {selected ? '✓' : ''}
      </button>
      <button
        type="button"
        className="op-pane-review-main"
        onClick={() => postBridgeEvent('onOpenMistake', eventPayload)}
      >
        <span className="op-pane-review-tags">
          <HistoryTag text={questionTypeLabel(mistake.question_type)} />
          {mistake.lesson_video && <HistoryTag text="有视频讲解" />}
          {mistake.misconception_name && <HistoryTag text={mistake.misconception_name} />}
          {hasAnswerImages && <HistoryTag text="有作答图" />}
          {needsReview && <HistoryTag text="建议确认" tone="warn" />}
        </span>
        <span className="op-pane-review-title">
          <SummaryRichContent text={stem} />
        </span>
      </button>
      {mistake.created_at && <time className="op-pane-review-time">{formatDate(mistake.created_at)}</time>}
    </div>
  );
}

function questionTypeLabel(questionType?: string | null): string {
  const raw = (questionType || '').trim();
  if (!raw) return '练习题';
  const normalized = raw.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized.includes('choice') || raw.includes('选择') || raw.includes('单选') || raw.includes('多选')) {
    if (normalized.includes('multiple') || raw.includes('多选')) return '多选题';
    if (normalized.includes('single') || raw.includes('单选')) return '单选题';
    return '选择题';
  }
  if (normalized.includes('blank') || normalized.includes('fill') || raw.includes('填空')) return '填空题';
  if (normalized.includes('experiment') || raw.includes('实验')) return '实验题';
  if (
    normalized.includes('calculation') ||
    normalized.includes('problem') ||
    normalized.includes('subjective') ||
    normalized.includes('essay') ||
    normalized.includes('short_answer') ||
    normalized.includes('written') ||
    raw.includes('解答') ||
    raw.includes('计算') ||
    raw.includes('简答')
  ) {
    return '解答题';
  }
  if (normalized.includes('judge') || normalized.includes('true_false') || normalized.includes('boolean') || raw.includes('判断')) {
    return '判断题';
  }
  return '练习题';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

export function LearningContentPane() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [payload, setPayload] = useState<LearningContentPayload | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const mode = normalizePaneMode(payload?.mode);
  const markLayoutChanged = useCallback(() => {
    setLayoutVersion(version => version + 1);
  }, []);
  const handleQuestionSelectionChange = useCallback((labels: string[]) => {
    if (!payload?.question || payload.interactionLocked || payload.learningState?.submissionStatus === 'submitting') return;
    postBridgeEvent('onOptionSelected', {
      questionId: payload.question.id,
      selectedOptions: labels,
      answer: labelsToAnswer(labels),
    });
    setPayload(current => {
      if (current !== payload) return current;
      return {
        ...current,
        selectedOptions: labels,
      };
    });
  }, [payload]);
  const reportHeight = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const height = Math.max(1, Math.ceil(root.getBoundingClientRect().height), root.scrollHeight);
    postBridgeEvent('onHeightChanged', {
      pane: 'learning-content',
      height,
    });
  }, []);

  const applyPayload = useCallback((nextPayload: string | LearningContentPayload) => {
    try {
      setPayload(parseBridgePayload<LearningContentPayload>(nextPayload));
    } catch (error) {
      postBridgeEvent('onPaneError', {
        message: error instanceof Error ? error.message : 'Pane payload parse failed',
      });
    }
  }, []);

  const paneApi = useMemo(() => ({
    setPayload: applyPayload,
    setTheme: () => undefined,
    setFontScale: (nextScale: string | number) => {
      const value = typeof nextScale === 'string' ? Number(nextScale) : nextScale;
      if (Number.isFinite(value)) setFontScale(Math.min(1.3, Math.max(0.86, value)));
    },
    setAnswerState: (answerState: string | AnswerState | null) => {
      setPayload(current => {
        if (!current) return current;
        return {
          ...current,
          answerState: answerState == null ? null : parseBridgePayload<AnswerState>(answerState),
        };
      });
    },
    showAnalysis: (answerState: string | AnswerState | null) => {
      setPayload(current => {
        if (!current) return current;
        return {
          ...current,
          answerState: answerState == null ? null : parseBridgePayload<AnswerState>(answerState),
        };
      });
    },
  }), [applyPayload]);

  useEffect(() => {
    window.OpenPhysicsPane = paneApi;
    window.OpenPhysicsQuestionPane = {
      setQuestion: (questionPayload) => {
        const parsed = parseBridgePayload<LearningContentPayload>(questionPayload);
        applyPayload({
          ...parsed,
          mode: parsed.mode === 'readonly' ? 'question_readonly' : 'question_interactive',
        });
      },
      setTheme: paneApi.setTheme,
      setFontScale: paneApi.setFontScale,
      setAnswerState: paneApi.setAnswerState,
      showAnalysis: paneApi.showAnalysis,
    };
    return () => {
      delete window.OpenPhysicsPane;
      delete window.OpenPhysicsQuestionPane;
    };
  }, [applyPayload, paneApi]);

  useEffect(() => {
    postBridgeEvent('onPaneReady', {
      ready: true,
      pane: 'learning-content',
      version: '0.2.0',
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(reportHeight);
    return () => window.cancelAnimationFrame(frame);
  }, [payload, layoutVersion, reportHeight]);

  useEffect(() => {
    if (!payload) return undefined;
    const frame = window.requestAnimationFrame(() => {
      postBridgeEvent('onPayloadRendered', {
        pane: 'learning-content',
        mode,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode, payload]);

  useEffect(() => {
    if (!payload?.question?.id) return;
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }, [payload?.question?.id]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => reportHeight());
    observer.observe(root);
    return () => observer.disconnect();
  }, [reportHeight]);

  let content: ReactNode = null;
  if (mode === 'teacher_paper_review') {
    content = <section className="op-pane-paper-review" aria-label="套卷答卷">
      {(payload?.paperItems || []).map((item, index) => item.question && (
        <article key={String(item.question.id)} aria-label={`第 ${index + 1} 题`}>
          <h2>第 {index + 1} 题</h2>
          <PracticeResultView
            question={item.question} selectedOptions={item.selectedOptions}
            givenAnswer={item.givenAnswer} answerState={item.answerState} canCorrectGrading={item.canCorrectGrading}
            resultActions={<>
              <LessonVideoButton video={item.lessonVideo} answerId={item.answerId} questionId={String(item.question.id)} />
              <button type="button" className="op-pane-grading-result-action" onClick={() => postBridgeEvent('onOpenTutor', { answerId: item.answerId, questionId: item.question!.id })}>AI 答疑</button>
            </>}
          />
        </article>
      ))}
    </section>;
  } else if (payload?.question && mode === 'practice_result') {
    content = (
      <PracticeResultView
        key={String(payload.question.id)}
        question={payload.question}
        selectedOptions={payload.selectedOptions}
        givenAnswer={payload.givenAnswer}
        answerState={payload.answerState}
        canCorrectGrading={payload.canCorrectGrading}
        phonePresentation={payload.presentation === 'phone'}
        index={payload.index}
        total={payload.total}
      />
    );
  } else if (payload?.question && mode === 'self_review_solution') {
    content = <SelfReviewSolutionView question={payload.question} />;
  } else if (payload?.question && (mode === 'question_readonly' || mode === 'question_interactive')) {
    content = (
      <QuestionDisplay
        key={`${mode}:${payload.question.id}`}
        question={payload.question}
        selectedOptions={payload.selectedOptions}
        givenAnswer={payload.givenAnswer}
        answerState={payload.answerState}
        showAnswerSummary={payload.showAnswerSummary}
        interactive={mode === 'question_interactive'}
        interactionLocked={payload.interactionLocked || payload.learningState?.submissionStatus === 'submitting'}
        onSelectionChange={handleQuestionSelectionChange}
        phonePresentation={payload.presentation === 'phone'}
        index={payload.index}
        total={payload.total}
      />
    );
  } else if (payload?.mistake && mode === 'review_mistake_detail') {
    content = <ReviewMistakeDetail mistake={payload.mistake} phonePresentation={payload.presentation === 'phone'} />;
  } else if (mode === 'history_records') {
    content = (
      <HistoryRecords
        records={payload?.records || []}
        onLayoutChange={markLayoutChanged}
      />
    );
  } else if (mode === 'review_notebook') {
    content = (
      <ReviewNotebook
        groups={payload?.groups || []}
        selectedAnswerIds={payload?.selectedAnswerIds}
        maxMistakesPerGroup={payload?.maxMistakesPerGroup}
        reviewGroupBatchSize={payload?.reviewGroupBatchSize}
      />
    );
  } else if (mode === 'knowledge_card') {
    content = (
      <KnowledgeCardView
        title={payload?.presentation === 'phone' ? undefined : payload?.title}
        sections={payload?.sections || []}
      />
    );
  }

  return (
    <main
      ref={rootRef}
      className={`op-pane-root${payload?.presentation === 'phone' ? ' op-pane-phone' : ''}`}
      aria-busy={!payload}
      style={{ fontSize: `${payload?.presentation === 'phone' && Number.isFinite(payload.textScale)
        ? Math.min(3, Math.max(0.86, payload.textScale ?? 1)) : fontScale}rem` }}
    >
      {content}
    </main>
  );
}
