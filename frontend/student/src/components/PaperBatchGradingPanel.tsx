import { usePracticeSubmissionActivity } from './PracticeExitGuard';
import { useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Question, SubmitResult } from '../types';
import LatexSpan from './LatexSpan';
import GradingTrustPanel from './GradingTrustPanel';
import ZoomableImage from './ZoomableImage';
import {PracticeAttemptContext,TeacherPaperAttemptContext,TopicSubmissionContext,optionalPaperSubmissionScope, optionalAttemptScope} from './PracticeAttemptContext';
import {loadAttemptResults, loadPracticeDrafts, savePracticeDrafts, saveAttemptResult, reportPracticeSaveError} from '../utils/practicePersistence';
import {
  ANSWER_IMAGE_MAX_SOURCE_BYTES,
  PAPER_BATCH_MAX_TOTAL_BYTES,
  PAPER_IMAGE_MAX_BYTES,
  compressPaperImageFile,
} from '../utils/imageCompression';
import {
  buildSelfReviewItems,
  canSelfReviewQuestion,
  type SelfReviewItem,
  type SelfReviewStatus,
} from '../utils/selfReview';

interface PaperBatchGradingPanelProps {
  questions: Question[];
  onGraded?: (results: Record<string, SubmitResult>) => void;
}

interface PaperGradeState {
  error?: string | null;
  result?: SubmitResult | null;
  solution?: { correct_answer: string; explanation?: string | null } | null;
  showSelfReview?: boolean;
  selfReviewItems?: SelfReviewItem[];
  correction?: string;
  correctionLoading?: boolean;
  correctionResult?: SubmitResult | null;
}

function answerImagePaths(result?: SubmitResult | null): string[] {
  const grading = result?.process_grading;
  const paths = [
    ...(grading?.answer_image_paths || []),
    ...(grading?.answer_image_path ? [grading.answer_image_path] : []),
  ];
  return Array.from(new Set(paths.filter(Boolean)));
}

export default function PaperBatchGradingPanel({ questions, onGraded }: PaperBatchGradingPanelProps) {
  const attemptScope = useContext(PracticeAttemptContext);
  const teacherPaperAttempt = useContext(TeacherPaperAttemptContext);
  const topicContext = useContext(TopicSubmissionContext);
  const [items, setItems] = useState<Record<string, PaperGradeState>>({});
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  usePracticeSubmissionActivity(batchLoading || preparingPhotos || Object.values(items).some(item => item.correctionLoading));
  const [batchError, setBatchError] = useState<string | null>(null);
  const [restored, setRestored] = useState(!attemptScope);
  const mounted = useRef(true);
  const batchLock = useRef(false);
  const persistRef = useRef(() => {});
  const pendingSaveRef = useRef(false);
  const saveVersionRef = useRef(0);
  const [ownerToken] = useState(() => localStorage.getItem('openphysics.student_token'));
  const isCurrent = () => mounted.current && localStorage.getItem('openphysics.student_token') === ownerToken;

  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSaveRef.current) return;
      persistRef.current();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      persistRef.current();
      mounted.current = false;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!attemptScope) return;
    let active = true;
    void loadPracticeDrafts(attemptScope + ':paper').then(draft => {
      if (!active) return;
      const results = loadAttemptResults(attemptScope);
      const savedItems = Object.fromEntries(Object.entries((draft?.metadata?.items || {}) as Record<string, PaperGradeState>)
        .map(([id, item]) => [id, {...item, correctionLoading:false}]));
      setItems({...savedItems, ...Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {...savedItems[id], result}]))});
      setPendingPhotos(Object.values(draft?.photos || {}));
    }).catch(reportPracticeSaveError).finally(() => { if (active) setRestored(true); });
    return () => { active = false; };
  }, [attemptScope]);

  useEffect(() => {
    if (!attemptScope || !restored) return;
    const snapshot = {answers:{}, photos:Object.fromEntries(pendingPhotos.map((file, index) => [String(index), file])),
      handwriting:{}, selfReviews:{}, backgrounds:{}, metadata:{items:Object.fromEntries(Object.entries(items)
        .map(([id, item]) => [id, {...item, correctionLoading:false}]))}};
    const version = ++saveVersionRef.current;
    const persist = () => {
      pendingSaveRef.current = true;
      void savePracticeDrafts(attemptScope + ':paper', snapshot).then(() => {
        if (saveVersionRef.current === version) pendingSaveRef.current = false;
      }).catch(() => {});
    };
    persistRef.current = persist;
    persist();
  }, [attemptScope, restored, items, pendingPhotos]);

  const updateItem = (questionId: string, patch: Partial<PaperGradeState>) => {
    setItems(prev => ({
      ...prev,
      [questionId]: { ...(prev[questionId] || {}), ...patch },
    }));
  };

  const handleWorksheetPhotos = async (files: FileList | null, replace = false) => {
    const availableSlots = replace ? 6 : Math.max(0, 6 - pendingPhotos.length);
    const imageFiles = Array.from(files || []).slice(0, availableSlots);
    if (imageFiles.length === 0) {
      if (files?.length) setBatchError('一次最多添加 6 张照片');
      return;
    }

    setPreparingPhotos(true);
    setBatchError(null);
    try {
      const prepared: File[] = [];
      for (const file of imageFiles) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
        if (file.size > ANSWER_IMAGE_MAX_SOURCE_BYTES) throw new Error('单张原图不能超过 20MB');
        const compressed = await compressPaperImageFile(file);
        if (!['image/jpeg', 'image/jpg', 'image/png'].includes(compressed.type)) {
          throw new Error('图片格式无法处理，请改用 JPEG 或 PNG');
        }
        if (compressed.size > PAPER_IMAGE_MAX_BYTES) {
          throw new Error('单张图片处理后仍超过 5MB，请裁剪后重试');
        }
        prepared.push(compressed);
      }

      const retained = replace ? [] : pendingPhotos;
      const totalBytes = [...retained, ...prepared].reduce((total, file) => total + file.size, 0);
      if (totalBytes > PAPER_BATCH_MAX_TOTAL_BYTES) {
        throw new Error('整套图片处理后仍超过 10MB，请减少页数或裁剪后重试');
      }
      if (isCurrent()) setPendingPhotos([...retained, ...prepared].slice(0, 6));
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '图片处理失败，请重试');
    } finally {
      setPreparingPhotos(false);
    }
  };

  const handleStartBatchGrading = async () => {
    const pendingQuestions = questions.filter(question => !items[question.id]?.result && !items[question.id]?.correctionResult);
    if (pendingPhotos.length === 0 || batchLock.current || preparingPhotos || !pendingQuestions.length || !isCurrent()) return;
    batchLock.current = true;
    setConfirming(false);
    setBatchLoading(true);
    setBatchError(null);
    setItems(prev => {
      const next = { ...prev };
      questions.forEach(question => {
        next[question.id] = { ...(next[question.id] || {}), error: null };
      });
      return next;
    });
    try {
      await teacherPaperAttempt?.beforeSubmit?.();
      const response = await api.submitPaperBatch(
        pendingPhotos,
        questions.map(question => question.id),
        0,
        Object.fromEntries(
          questions.flatMap(question => question.target_knowledge_point_id
            ? [[question.id, question.target_knowledge_point_id]]
            : []),
        ),
        ...optionalPaperSubmissionScope(attemptScope, teacherPaperAttempt?.id, topicContext),
      );
      if (!isCurrent()) return;
      onGraded?.(response.results);
      setItems(prev => {
        const next = { ...prev };
        pendingQuestions.forEach(question => {
          const solution = response.solutions?.[question.id] || next[question.id]?.solution || null;
          next[question.id] = {
            ...(next[question.id] || {}),
            result: response.results[question.id] || next[question.id]?.result || null,
            correctionResult: null,
            solution,
            selfReviewItems: solution
              ? buildSelfReviewItems(question, solution.correct_answer)
              : next[question.id]?.selfReviewItems,
            error: response.errors[question.id] || null,
          };
        });
        return next;
      });
    } catch (e: any) {
      setBatchError(e.message || '整套题批改失败，请重新拍照上传');
    } finally {
      batchLock.current = false;
      if (isCurrent()) setBatchLoading(false);
    }
  };

  const handleResetPhotos = () => {
    if (batchLoading || preparingPhotos) return;
    setPendingPhotos([]);
    setBatchError(null);
  };

  const handleCorrection = async (question: Question, isCorrect = true) => {
    const correction = items[question.id]?.correction?.trim();
    const original = items[question.id]?.result;
    if (!correction && isCorrect) return;
    updateItem(question.id, { correctionLoading: true, error: null });
    try {
      if (!original?.answer_id) {
        updateItem(question.id, {
          correctionLoading: false,
          error: '这条纸笔批改记录缺少记录编号，请重新上传后再订正',
        });
        return;
      }
      const result = await api.correctAnswer(original.answer_id, {
        corrected_answer: correction || original.extracted_answer || '',
        is_correct: isCorrect,
        correction_reason: '学生手动纠正 AI 批改结果',
      });
      if (attemptScope) saveAttemptResult(attemptScope,question.id,result);
      if (!isCurrent()) return;
      updateItem(question.id, { correctionLoading: false, correctionResult: result });
      onGraded?.({[question.id]:result});
    } catch (e: any) {
      updateItem(question.id, { correctionLoading: false, error: e.message || '订正提交失败' });
    }
  };

  const updateSelfReviewItem = (
    questionId: string,
    itemIndex: number,
    status: SelfReviewStatus,
  ) => {
    setItems(prev => {
      const current = prev[questionId] || {};
      const reviewItems = current.selfReviewItems || [{ label: '整题', status: null }];
      return {
        ...prev,
        [questionId]: {
          ...current,
          selfReviewItems: reviewItems.map((item, index) => (
            index === itemIndex ? { ...item, status } : item
          )),
        },
      };
    });
  };

  const handleSelfReviewSubmit = async (question: Question) => {
    const state = items[question.id] || {};
    const reviewItems = state.selfReviewItems || buildSelfReviewItems(question, state.solution?.correct_answer);
    if (reviewItems.some(item => !item.status)) {
      updateItem(question.id, { error: '请先完成每一小问的自评' });
      return;
    }
    updateItem(question.id, { correctionLoading: true, error: null });
    try {
      await teacherPaperAttempt?.beforeSubmit?.();
      const result = await api.submitSelfReview({ ...(topicContext && { topic_context: topicContext }),
        ...(teacherPaperAttempt && { teacher_paper_attempt_id: teacherPaperAttempt.id }),
        question_id: question.id,
        items: reviewItems.map(item => ({
          label: item.label,
          status: item.status || 'wrong',
        })),
        time_spent_ms: 0,
        target_knowledge_point_id: question.target_knowledge_point_id,
      }, ...optionalAttemptScope(attemptScope));
      updateItem(question.id, {
        correctionLoading: false,
        correctionResult: result,
      });
      onGraded?.({ [question.id]: result });
    } catch (e: any) {
      updateItem(question.id, { correctionLoading: false, error: e.message || '自评提交失败' });
    }
  };

  if (questions.length === 0) {
    return (
      <div className="paper-batch-panel">
        <div className="paper-batch-empty">当前没有可批改的题目。</div>
      </div>
    );
  }

  if (!restored) return <div className="loading">正在恢复纸笔作答...</div>;

  const hasResults = Object.values(items).some(item => item.result || item.error || item.correctionResult);
  const hasPendingQuestions = questions.some(question => !items[question.id]?.result && !items[question.id]?.correctionResult);

  return (
    <section className="paper-batch-panel" aria-label="纸笔批改">
      {(confirming || batchLoading) && (
        <div className="question-workspace-submit-confirm-overlay">
          <div className="question-workspace-submit-confirm" role="dialog" aria-modal="true" aria-label={batchLoading ? '整套纸笔批改进度' : '确认整套纸笔批改'}>
            <strong>{batchLoading ? 'AI 正在批改整套作答' : '确认提交整套作答照片？'}</strong>
            <span>已选择 {pendingPhotos.length} 张照片，共 {questions.length} 题。</span>
            {batchLoading ? <span role="status">正在按题号识别与批改，完成后显示结果。照片和已完成结果会保留。</span> : <>
              <span>请确认所有作答页均已上传。未能识别的题目会提示补拍或重试。</span>
              <div className="question-workspace-submit-confirm-actions">
                <button type="button" className="question-workspace-nav-button" onClick={() => setConfirming(false)}>返回检查</button>
                <button type="button" className="question-workspace-nav-button question-workspace-nav-button-primary" onClick={handleStartBatchGrading}>确认整套批改</button>
              </div>
            </>}
          </div>
        </div>
      )}
      {!hasResults && (
        <div className="paper-batch-upload-page">
          <div className="paper-batch-title">上传整套题单</div>
          <div className="paper-batch-subtitle">
            本次默认批改当前这套题，共 {questions.length} 道。多页题单可以连续添加照片，确认页数后再开始批改。
          </div>
          <label className="paper-upload-button paper-upload-main" htmlFor="paper-batch-upload">
            {preparingPhotos ? '正在处理照片...' : pendingPhotos.length > 0 ? '继续添加照片' : '拍照上传'}
          </label>
          <input
            id="paper-batch-upload"
            aria-label={pendingPhotos.length > 0 ? '继续添加纸面答案照片' : '上传整套纸面答案'}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={batchLoading || preparingPhotos}
            onChange={(event) => {
              void handleWorksheetPhotos(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          {preparingPhotos && pendingPhotos.length === 0 && (
            <div className="paper-photo-queue" aria-live="polite">正在优化图片...</div>
          )}
          {pendingPhotos.length > 0 && (
            <div className="paper-photo-queue" aria-live="polite">
              <div className="paper-photo-queue-head">
                <span>{preparingPhotos ? '正在优化图片...' : `已添加 ${pendingPhotos.length} 张`}</span>
                <button type="button" onClick={handleResetPhotos} disabled={batchLoading || preparingPhotos}>清空</button>
              </div>
              <ol className="paper-photo-queue-list">
                {pendingPhotos.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`}>
                    第 {index + 1} 页：{file.name || '拍照图片'}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="paper-start-grade-button"
                disabled={batchLoading || preparingPhotos || pendingPhotos.length === 0}
                onClick={() => setConfirming(true)}
              >
                {batchLoading ? '整套批改中...' : '开始批改整套题'}
              </button>
            </div>
          )}
        </div>
      )}

      {batchError && <div className="paper-batch-error">{batchError}</div>}

      {hasResults && (
        <div className="paper-batch-header">
          <div>
            <div className="paper-batch-title">整套题批改结果</div>
            <div className="paper-batch-subtitle">按题号查看 AI 识别、批改反馈；如果某题判断不准，可以直接订正。</div>
          </div>
          {hasPendingQuestions && <label className="paper-upload-button" htmlFor="paper-batch-upload-again">
            {batchLoading ? '重新批改中...' : '重新上传'}
          </label>}
          {hasPendingQuestions && pendingPhotos.length > 0 && <button type="button" className="paper-upload-button"
            disabled={batchLoading || preparingPhotos} onClick={() => setConfirming(true)}>
            {batchLoading ? '批改中...' : '重试未完成题目'}
          </button>}
          <input
            id="paper-batch-upload-again"
            aria-label="重新上传整套纸面答案"
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={batchLoading || preparingPhotos}
            onChange={(event) => {
              void handleWorksheetPhotos(event.currentTarget.files, true);
              event.currentTarget.value = '';
            }}
          />
        </div>
      )}

      {hasResults && <div className="paper-batch-list">
        {questions.map((question, index) => {
          const state = items[question.id] || {};
          const finalResult = state.correctionResult || state.result || null;
          const stateAnswerImagePaths = answerImagePaths(state.result);
          const selfReviewItems = state.selfReviewItems || buildSelfReviewItems(question, state.solution?.correct_answer);
          return (
            <article className="paper-batch-item" key={question.id}>
              <div className="paper-batch-item-head">
                <div>
                  <div className="paper-batch-index">第 {index + 1} 题</div>
                </div>
                <div className={finalResult?.is_correct ? 'paper-batch-status ok' : finalResult ? 'paper-batch-status wrong' : 'paper-batch-status'}>
                  {finalResult ? (finalResult.is_correct ? '正确' : '需订正') : batchLoading ? '等待批改' : '未批改'}
                </div>
              </div>

              {state.error && <div className="paper-batch-error">{state.error}</div>}

              {state.error && state.solution && canSelfReviewQuestion(question) && (
                <div className="paper-self-review">
                  <button
                    type="button"
                    className="paper-self-review-toggle"
                    onClick={() => updateItem(question.id, { showSelfReview: !state.showSelfReview })}
                  >
                    对照解析自评
                  </button>
                  {state.showSelfReview && (
                    <div className="paper-self-review-body">
                      <div className="paper-batch-result">
                        <div>
                          <span>正确答案：</span>
                          <LatexSpan text={state.solution.correct_answer} />
                        </div>
                        {state.solution.explanation && (
                          <div>
                            <span>解析：</span>
                            <LatexSpan text={state.solution.explanation} />
                          </div>
                        )}
                      </div>
                      <div className="paper-self-review-list">
                        {selfReviewItems.map((item, itemIndex) => (
                          <div className="paper-self-review-item" key={`${question.id}-${item.label}`}>
                            <span>{item.label}</span>
                            <div className="paper-self-review-actions">
                              {[
                                ['correct', '全对'],
                                ['partial', '半对'],
                                ['wrong', '不会'],
                              ].map(([status, label]) => (
                                <button
                                  key={status}
                                  type="button"
                                  className={item.status === status ? 'active' : ''}
                                  onClick={() => updateSelfReviewItem(
                                    question.id,
                                    itemIndex,
                                    status as SelfReviewStatus,
                                  )}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="paper-self-review-submit"
                        disabled={state.correctionLoading || selfReviewItems.some(item => !item.status)}
                        onClick={() => handleSelfReviewSubmit(question)}
                      >
                        {state.correctionLoading ? '提交中...' : '提交自评'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {state.result && (
                <div className="paper-batch-result">
                  {stateAnswerImagePaths.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: '#697386', fontWeight: 700, marginBottom: 6 }}>
                        学生作答图片
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {stateAnswerImagePaths.map((path, imageIndex) => (
                          <ZoomableImage
                            key={path}
                            src={path}
                            alt={stateAnswerImagePaths.length > 1 ? `学生作答图片 ${imageIndex + 1}` : '学生作答图片'}
                            style={{
                              display: 'block',
                              width: '100%',
                              maxWidth: 520,
                              maxHeight: 280,
                              objectFit: 'contain',
                              border: '1px solid #d6e4ff',
                              borderRadius: 6,
                              background: '#fff',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <span>AI 识别：</span>
                    <LatexSpan text={state.result.extracted_answer || '(未识别出文字)'} />
                  </div>
                  <div className={state.result.is_correct ? 'paper-batch-correct' : 'paper-batch-wrong'}>
                    AI 判断：{state.result.is_correct ? '正确' : '需要订正'}
                  </div>
                  <div>
                    <span>正确答案：</span>
                    <LatexSpan text={state.result.correct_answer || ''} />
                  </div>
                  {state.result.explanation && (
                    <div>
                      <span>解析：</span>
                      <LatexSpan text={state.result.explanation} />
                    </div>
                  )}
                  {state.result.process_grading && (
                    <GradingTrustPanel grading={state.result.process_grading} />
                  )}
                </div>
              )}

              {(state.result || state.error) && (
                <div className="paper-correction-row">
                  <input
                    type="text"
                    value={state.correction || ''}
                    onChange={(event) => updateItem(question.id, { correction: event.target.value })}
                    placeholder={state.result ? '如果 AI 识别不准，在这里输入订正答案' : 'AI 未识别时，可直接输入这题答案'}
                  />
                  <button
                    type="button"
                    onClick={() => handleCorrection(question, true)}
                    disabled={!state.correction?.trim() || state.correctionLoading}
                  >
                    {state.correctionLoading ? '提交中...' : '提交订正'}
                  </button>
                  {state.result?.is_correct && (
                    <button
                      type="button"
                      onClick={() => handleCorrection(question, false)}
                      disabled={state.correctionLoading}
                    >
                      改为错误
                    </button>
                  )}
                </div>
              )}

              {state.correctionResult && (
                <div className={state.correctionResult.is_correct ? 'paper-batch-correct' : 'paper-batch-wrong'}>
                  订正后：{state.correctionResult.is_correct ? '正确' : '仍需修改'}
                </div>
              )}

              {finalResult?.process_grading?.next_action && (
                <div className="paper-batch-tip">
                  下一步：<LatexSpan text={finalResult.process_grading.next_action} />
                </div>
              )}
            </article>
          );
        })}
      </div>}
    </section>
  );
}
