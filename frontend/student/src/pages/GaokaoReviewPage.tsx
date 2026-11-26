import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import GaokaoTopicWorkbench from '../components/GaokaoTopicWorkbench';
import AccountAccessPanel from '../components/AccountAccessPanel';
import { hasLearningAccess, isLearningAccessError } from '../utils/learningAccess';
import { gaokaoLayerQuestionCount } from '../utils/gaokaoTopicLayers';
import QuestionSessionRunner from '../components/QuestionSessionRunner';
import SessionResultDialog from '../components/SessionResultDialog';
import { useQuestionSessionState } from '../hooks/useQuestionSessionState';
import {loadPracticeRecord} from '../utils/practicePersistence';
import { buildPracticeSummary } from '../utils/practiceSummary';
import type {
  LearningCatalogData,
  LearningCatalogTopicLayer,
  LearningCatalogTopicOverview,
  PracticeSession,
  SubmitResult,
} from '../types';

const SESSION_LAYER_NAMES: Record<LearningCatalogTopicLayer, string> = {
  diagnostic: '专题摸底',
  foundation: '基础巩固',
  breakthrough: '典型突破',
  transfer: '综合迁移',
  paper: '专题套卷',
};

export default function GaokaoReviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showingSession = searchParams.get('view') === 'practice';
  const showSessionView = useCallback((show: boolean) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (show) next.set('view', 'practice');
      else next.delete('view');
      return next;
    });
  }, [setSearchParams]);
  const accountActive = hasLearningAccess(getStudentProfile());
  const [accessDenied, setAccessDenied] = useState(false);
  const accessRequired = !accountActive || accessDenied;
  useEffect(() => {
    if (accountActive) setAccessDenied(false);
  }, [accountActive]);
  const studentId = getStudentId();
  const [restoredPractice]=useState(()=>loadPracticeRecord(studentId,'gaokao'));
  const restored=restoredPractice?.payload || {};
  const [catalog, setCatalog] = useState<LearningCatalogData | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [resumeTopicId, setResumeTopicId] = useState<string | null | undefined>(undefined);
  const [expandedBlockOverride, setExpandedBlockId] = useState<string | null | undefined>(undefined);
  const [requestedTopicId, setSelectedTopicId] = useState<string | null>((restored.selectedTopicId as string) || null);
  const [overview, setOverview] = useState<LearningCatalogTopicOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const [settledOverviewKey, setSettledOverviewKey] = useState<string | null>(null);
  const [session, setSession] = useState<PracticeSession | null>((restored.session as PracticeSession) || null);
  const [sessionLayer, setSessionLayer] = useState<LearningCatalogTopicLayer>((restored.sessionLayer as LearningCatalogTopicLayer) || 'diagnostic');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const knowledgeBlocks = (catalog?.nodes ?? []).filter(node => node.node_type === 'block');
  const topicEntries = knowledgeBlocks.flatMap(block => block.children
    .filter(topic => topic.node_type === 'topic')
    .map(topic => ({ blockId: block.id, topic })));
  // Resolve in the same render as the catalog, without painting an unselected frame.
  const selectedEntry = topicEntries.find(entry => entry.topic.id === requestedTopicId)
    || topicEntries.find(entry => entry.topic.id === resumeTopicId)
    || topicEntries[0];
  const selectedTopic = selectedEntry?.topic ?? null;
  // Retain the unfinished session's topic while the catalog is still loading.
  const selectedTopicId = selectedTopic?.id ?? requestedTopicId;
  const expandedBlockId = expandedBlockOverride === undefined
    ? selectedEntry?.blockId ?? null : expandedBlockOverride;
  const overviewTopicId = selectedTopic?.id ?? null;
  const overviewKey = `${overviewTopicId}:${overviewRefreshKey}`;
  const overviewCurrent = settledOverviewKey === overviewKey;

  const recordTopicEvidence = useCallback(async (result: SubmitResult) => {
    if (!selectedTopicId || !result.answer_id) return null;
    return api.recordLearningCatalogTopicEvidence(
      'gaokao_review',
      selectedTopicId,
      sessionLayer,
      result.answer_id,
    );
  }, [selectedTopicId, sessionLayer]);

  const submitAnswer = useCallback(
    (questionId: string, answer: string, timeSpentMs: number, submissionId?: string) => (
      api.submitAnswer(studentId, {
        question_id: questionId,
        ...(selectedTopicId && { topic_context: { catalog_code: 'gaokao_review' as const, node_id: selectedTopicId, layer: sessionLayer } }),
        given_answer: answer,
        time_spent_ms: timeSpentMs,

        ...(submissionId && {submission_id:submissionId}),
        target_knowledge_point_id: session?.questions.find(question => question.id === questionId)
          ?.target_knowledge_point_id,
      })
    ),
    [session, studentId, selectedTopicId, sessionLayer],
  );
  const {
    answers,
    collectedAnswers,
    currentIdx,
    showPaperBatch,
    resetSessionState,
    goToQuestion,
    togglePaperBatch,
    handleAnswer,
    handleAnsweredResult,
    handleBatchGraded,
    handleCollectAnswer,
    getQuestionTimeSpentMs,
    attemptId,
    persistSessionPayload,
  } = useQuestionSessionState({ submitAnswer,studentId,persistenceScope:'gaokao' });

  useEffect(()=>{
    if(session && showingSession && !sessionLoading)persistSessionPayload({session,sessionLayer,selectedTopicId});
  },[session,sessionLayer,selectedTopicId,persistSessionPayload,attemptId,showingSession,sessionLoading]);

  const handleTopicAnsweredResult = useCallback((
    questionId: string,
    result: SubmitResult,
  ) => {
    handleAnsweredResult(questionId, result);
    void recordTopicEvidence(result)
      .then(nextOverview => {
        if (nextOverview) setOverview(nextOverview);
        setSessionError(null);
      })
      .catch(error => {
        setSessionError(
          error instanceof Error ? error.message : '专题学习记录更新失败',
        );
      });
  }, [handleAnsweredResult, recordTopicEvidence]);

  const handleTopicBatchGraded = useCallback((
    results: Record<string, SubmitResult>,
    collectExtractedAnswers: boolean,
  ) => {
    handleBatchGraded(results, collectExtractedAnswers);
    void (async () => {
      const outcomes = await Promise.allSettled(
        Object.values(results).map(result => recordTopicEvidence(result)),
      );
      if (selectedTopicId) {
        setOverview(await api.getLearningCatalogTopicOverview(
          'gaokao_review',
          selectedTopicId,
        ));
      }
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      setSessionError(null);
    })().catch(error => {
      setSessionError(
        error instanceof Error ? error.message : '专题学习记录更新失败',
      );
    });
  }, [handleBatchGraded, recordTopicEvidence, selectedTopicId]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [catalogResult, resumeResult] = await Promise.allSettled([
        api.getLearningCatalog('gaokao_review'),
        api.getLearningCatalogResume('gaokao_review'),
      ]);
      if (catalogResult.status === 'rejected') throw catalogResult.reason;
      setCatalog(catalogResult.value);
      setResumeTopicId(
        resumeResult.status === 'fulfilled' ? resumeResult.value.node_id : null,
      );
    } catch (loadError) {
      setCatalogError(
        loadError instanceof Error
          ? loadError.message
          : '高考复习目录加载失败',
      );
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!overviewTopicId) return undefined;

    let active = true;
    setOverviewLoading(true);
    setOverviewError(null);
    setOverview(null);
    void api.getLearningCatalogTopicOverview(
      'gaokao_review',
      overviewTopicId,
    )
      .then(result => {
        if (!active) return;
        if (result.node_id !== overviewTopicId) throw new Error('专题学习状态不匹配，请重新加载');
        setOverview(result);
      })
      .catch(loadError => {
        if (!active) return;
        setOverview(null);
        setOverviewError(
          loadError instanceof Error
            ? loadError.message
            : '专题学习状态加载失败',
        );
      })
      .finally(() => {
        if (active) {
          setSettledOverviewKey(overviewKey);
          setOverviewLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [overviewKey, overviewTopicId]);

  const startTopicSession = useCallback(async (layer: LearningCatalogTopicLayer, restart = false) => {
    if (!selectedTopic) return;
    if (accessDenied || !hasLearningAccess(getStudentProfile())) { navigate('/login'); return; }
    const localRecord = loadPracticeRecord(studentId, 'gaokao');
    showSessionView(true);
    if (!restart && session && sessionLayer === layer && localRecord?.payload.selectedTopicId === selectedTopic.id
      && session.questions.some(question => !answers[question.id])) return;
    setSessionLoading(true); setSessionError(null); setResultOpen(false);
    try {
      const nextSession = await api.startLearningCatalogTopicSession('gaokao_review', selectedTopic.id, layer, gaokaoLayerQuestionCount(layer));
      resetSessionState(); setSession(nextSession); setSessionLayer(layer);
    } catch (cause) {
      if (isLearningAccessError(cause)) { setAccessDenied(true); return; }
      setSessionError(cause instanceof Error ? cause.message : '专题题目加载失败');
    } finally { setSessionLoading(false); }
  }, [accessDenied, navigate, resetSessionState, selectedTopic, studentId, showSessionView, session, sessionLayer, answers]);

  const accountNotice = accessRequired ? (
    <AccountAccessPanel
      title="账号不可用，请重新登录或联系部署管理员。"
      description="账号不可用，请重新登录或联系部署管理员。"
      features={['专题摸底', '分层训练', '专题套卷']}
    />
  ) : null;

  const returnToWorkbench = useCallback((refreshOverview: boolean, preserveSaved = !refreshOverview) => {
    showSessionView(false);
    setResultOpen(false);
    setSessionError(null);
    if (!preserveSaved) {
      setSession(null);
      resetSessionState();
    }
    if (refreshOverview) {
      setOverviewRefreshKey(current => current + 1);
    }
  }, [resetSessionState, showSessionView]);

  if (session && showingSession) {
    if (sessionLoading) {
      return <div className="loading">正在准备专题题目...</div>;
    }
    if (session.questions.length === 0) {
      return (
        <main className="container train-workspace train-empty-state">
          <div className="error-banner">
            {sessionError || '当前层级暂无可用题目'}
          </div>
          <button
            type="button"
            className="train-route-secondary-button"
            onClick={() => returnToWorkbench(false)}
          >
            返回专题路径
          </button>
        </main>
      );
    }

    const isWholePaper = sessionLayer === 'paper';
    const isDiagnostic = sessionLayer === 'diagnostic' || isWholePaper;
    const answeredQuestionIds = new Set([
      ...Object.keys(answers),
      ...Object.keys(collectedAnswers),
    ]);
    const answeredCount = answeredQuestionIds.size;
    const allGraded = session.questions.every(question => !!answers[question.id]);
    const practiceSummary = buildPracticeSummary(answers);
    const title = SESSION_LAYER_NAMES[sessionLayer];
    const selectedTopicTitle = selectedTopic?.title || '高考专题';

    return (
      <>
        {accountNotice ? <div className="container">{accountNotice}</div> : null}
        <QuestionSessionRunner
          topicContext={selectedTopicId ? { catalog_code: 'gaokao_review', node_id: selectedTopicId, layer: sessionLayer } : undefined}
          key={attemptId}
          persistenceKey={attemptId}
          title={title}


          subtitle={session.session_objective}
          printTitle={`${selectedTopicTitle} · ${title}`}
          questions={session.questions}
          currentIndex={currentIdx}
          answeredCount={answeredCount}
          progressForQuestion={(questionId) => {
            const result = answers[questionId];
            return {
              answered: !!result || !!collectedAnswers[questionId],
              correct: result?.is_correct,
            };
          }}
          resultForQuestion={(questionId) => answers[questionId]}
          statusForQuestion={(questionId) => {
            const result = answers[questionId];
            if (!result && isDiagnostic && collectedAnswers[questionId]) {
              return <span className="gaokao-session-status is-collected">已作答</span>;
            }
            if (!result) return null;
            return (
              <span className={`gaokao-session-status${result.is_correct ? ' is-correct' : ' is-wrong'}`}>
                {result.is_correct ? '已答对' : '需订正'}
              </span>
            );
          }}

          onAbandon={() => { setSession(null); resetSessionState(); }}
          onBack={() => returnToWorkbench(false, true)}
          onGoToQuestion={goToQuestion}
          showPaperBatch={showPaperBatch}
          onTogglePaperBatch={togglePaperBatch}
          onBatchGraded={(results) => handleTopicBatchGraded(results, isDiagnostic)}
          onAnswer={handleAnswer}
          onAnswered={handleTopicAnsweredResult}
          collectMode={isDiagnostic}
          deferredGrading={isDiagnostic}
          wholePaper={isWholePaper}
          readOnly={isWholePaper && allGraded}
          onCollect={isDiagnostic ? handleCollectAnswer : undefined}
          getTimeSpentMs={getQuestionTimeSpentMs}
          disabledCurrent={
            isWholePaper
              ? !!answers[session.questions[currentIdx].id] : isDiagnostic
              ? !!collectedAnswers[session.questions[currentIdx].id]
                || !!answers[session.questions[currentIdx].id]
              : !!answers[session.questions[currentIdx].id]
          }
          error={sessionError}
          onAllGraded={() => setResultOpen(true)}
          lastAction={allGraded ? (
            <button
              type="button"
              onClick={() => setResultOpen(true)}
              className="question-workspace-nav-button question-workspace-nav-button-primary question-workspace-header-submit"
            >
              {isWholePaper ? '查看整卷结果' : '查看本组结果'}
            </button>
          ) : (
            <span className="gaokao-session-hint">
              {isDiagnostic ? '答完后统一批改' : '答完后查看本组结果'}
            </span>
          )}
        />
        <SessionResultDialog
          open={resultOpen && allGraded}
          onClose={() => setResultOpen(false)}
          title={`${title}结果`}
          scoreText={`得分 ${practiceSummary.correctCount}/${practiceSummary.totalCount} · 得分率 ${Math.round(practiceSummary.accuracy * 100)}%`}
          label={practiceSummary.headline}
          feedback={`${practiceSummary.nextStep.description} 本次作答已保存，并计入当前高考专题的学习记录。`}
          actions={(
            <>
              {isWholePaper ? (
                <button type="button" className="train-primary-button" onClick={() => {
                  const firstWrong = session.questions.findIndex(question => !answers[question.id]?.is_correct);
                  goToQuestion(Math.max(0, firstWrong));
                  setResultOpen(false);
                }}>逐题复盘</button>
              ) : null}
              <button
                type="button"
                className="train-primary-button"
                onClick={() => returnToWorkbench(true)}
              >
                回到专题路径
              </button>
              <button
                type="button"
                className="train-ghost-button"
                onClick={() => void startTopicSession(sessionLayer, true)}
              >
                再练一组
              </button>
            </>
          )}
        />
      </>
    );
  }

  return (
    <main className="container sync-page gaokao-review-page">
      <section className="page-header sync-topbar sync-header-panel" aria-label="高考复习">
        <div className="sync-title-block">
          <h1>高考复习</h1>
          <p>按知识板块选择专题，完成摸底、分层复习和综合迁移。</p>
        </div>
        <div className="sync-current-badge">
          {catalog
            ? `${knowledgeBlocks.length} 个知识板块 · ${catalog.topic_count} 个专题`
            : catalogError ? '目录暂不可用' : '目录加载中'}
        </div>
      </section>

      <section className="sync-map-layout" aria-label="高考复习专题目录">
        <aside className="sync-side-panel">
          <div className="sync-side-header">
            <span>复习目录</span>
            <h2>选择知识板块</h2>
          </div>

          <div className="gaokao-block-list">
            {catalogLoading ? (
              <div className="gaokao-catalog-status" role="status">
                正在加载复习目录...
              </div>
            ) : null}
            {catalogError ? (
              <div className="gaokao-catalog-status is-error" role="alert">
                <span>{catalogError}</span>
                <button type="button" onClick={() => void loadCatalog()}>
                  重新加载
                </button>
              </div>
            ) : null}
            {knowledgeBlocks.map(block => {
              const isExpanded = block.id === expandedBlockId;
              const topicListId = `gaokao-topics-${block.id}`;
              const topics = block.children.filter(
                topic => topic.node_type === 'topic',
              );
              return (
                <div
                  className={`gaokao-block-group${isExpanded ? ' is-expanded' : ''}`}
                  key={block.id}
                >
                  <button
                    type="button"
                    className={`sync-chapter-item gaokao-block-trigger${isExpanded ? ' is-active' : ''}`}
                    onClick={() => setExpandedBlockId(expandedBlockId === block.id ? null : block.id)}
                    aria-expanded={isExpanded}
                    aria-controls={topicListId}
                  >
                    <span className="gaokao-block-copy">
                      <span className="sync-chapter-title">{block.title}</span>
                      <span className="sync-chapter-meta">{topics.length} 个专题</span>
                    </span>
                    <svg
                      className="gaokao-block-chevron"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="m6 8 4 4 4-4" />
                    </svg>
                  </button>

                  {isExpanded ? (
                    <ol
                      className="gaokao-block-topics"
                      id={topicListId}
                      aria-label={`${block.title}专题`}
                    >
                      {topics.map(topic => {
                        const displayCode = String(
                          topic.config.display_code
                          ?? topic.code.replace('topic_', ''),
                        );
                        const isSelected = selectedTopicId === topic.id;
                        return (
                          <li key={topic.id}>
                            <button
                              type="button"
                              className={`gaokao-topic-select${isSelected ? ' is-active' : ''}`}
                              onClick={() => {
                                setSelectedTopicId(topic.id);
                                setSessionError(null);
                              }}
                              aria-pressed={isSelected}
                            >
                              <span className="gaokao-block-topic-number">
                                {displayCode}
                              </span>
                              <span>{topic.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <section
          className="sync-map-main gaokao-workbench-panel"
          aria-label="专题复习工作台"
        >
          {accountNotice}
          {sessionError ? (
            <div className="gaokao-workbench-inline-error" role="alert">
              {sessionError}
            </div>
          ) : null}
          <GaokaoTopicWorkbench
            topic={selectedTopic}
            overview={overview?.node_id === overviewTopicId ? overview : null}
            loading={catalogLoading || (!catalogError && !!selectedTopic && (!overviewCurrent || overviewLoading))}
            error={catalogError || (overviewCurrent ? overviewError : null)}
            sessionLoading={sessionLoading}
            accessRequired={accessRequired}
            onStartSession={(layer) => void startTopicSession(layer)}

            onRetry={() => {
              if (catalogError) void loadCatalog();
              else setOverviewRefreshKey(current => current + 1);
            }}
          />
        </section>
      </section>
    </main>
  );
}
