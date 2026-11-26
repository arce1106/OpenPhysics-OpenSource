import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId, getStudentProfile } from '../api/studentIdentity';
import AccountAccessPanel from '../components/AccountAccessPanel';
import { ChapterKnowledgeGraph, firstKpByLearningState, getLearningKpStatus, learningStateFor } from '../components/learningPath';
import {
  mapKnowledgeMasteryJudgmentToMasteryDisplay,
  type KnowledgeMasterySyncActionKind,
} from '../utils/knowledgeMasteryJudgment';
import { buildReturnState } from '../utils/navigation';
import { canAccessKp, canEnterLearningArea, hasKpContent, hasKpPractice } from '../utils/learningAccess';
import { hasCompletedKpAssessment, hasKpQuestionSet, loadSyncAssessment } from '../utils/kpPracticeLifecycle';
import type { PracticeRecord } from '../utils/practicePersistence';
import type { DirectoryData, DirectoryKpNode, KnowledgeMasteryJudgment } from '../types';

type SyncSideMode = 'directory' | 'kp';
type SyncKpActionKind = KnowledgeMasterySyncActionKind;
type SyncReturnState = {
  restoreKpId?: string;
};

export interface SyncKpActions {
  primary: {
    label: string;
    kind: SyncKpActionKind;
  };
  secondary: {
    label: string;
    kind: SyncKpActionKind;
  };
}

interface ChapterSummary {
  key: string;
  volume: string;
  chapter: string;
  kps: DirectoryKpNode[];
  total: number;
  availableCount: number;
  mastered: number;
  avgMastery: number;
  latestLastPracticed: string | null;
}

function normalizeVolume(volume: string | null) {
  return volume || '默认教材';
}

function normalizeChapter(chapter: string | null) {
  return chapter || '默认章节';
}

function makeChapterKey(volume: string, chapter: string) {
  return `${volume}||${chapter}`;
}

function newerIsoDate(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function pickRecommendedKp(kps: DirectoryKpNode[]) {
  const available = kps.filter(hasKpContent);
  return firstKpByLearningState(available, ['learning', 'practice', 'to_learn'])
    || available.find(kp => learningStateFor(kp) !== 'mastered')
    || available[0]
    || null;
}

function pickRecentlyPracticedKp(kps: DirectoryKpNode[]) {
  return kps
    .filter(kp => hasKpContent(kp) && !!kp.last_practiced)
    .sort((a, b) => (
      new Date(b.last_practiced || '').getTime()
      - new Date(a.last_practiced || '').getTime()
    ))[0] || null;
}

function pickInitialSyncKp(kps: DirectoryKpNode[]) {
  return pickRecentlyPracticedKp(kps) || pickRecommendedKp(kps);
}

function groupVolumes(kps: DirectoryKpNode[]) {
  const volumes: string[] = [];
  const seen = new Set<string>();
  kps.forEach(kp => {
    const volume = normalizeVolume(kp.volume);
    if (seen.has(volume)) return;
    seen.add(volume);
    volumes.push(volume);
  });
  return volumes;
}

function groupChaptersByVolume(kps: DirectoryKpNode[], volume: string): ChapterSummary[] {
  const grouped = new Map<string, DirectoryKpNode[]>();
  kps.forEach(kp => {
    if (normalizeVolume(kp.volume) !== volume) return;
    const chapter = normalizeChapter(kp.chapter);
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(kp);
  });

  return Array.from(grouped.entries()).map(([chapter, chapterKps]) => {
    const total = chapterKps.length;
    const available = chapterKps.filter(hasKpContent);
    const mastered = available.filter(kp => learningStateFor(kp) === 'mastered').length;
    const avgMastery = available.length > 0 ? available.reduce((sum, kp) => sum + kp.mastery, 0) / available.length : 0;
    const latestLastPracticed = chapterKps.reduce<string | null>(
      (latest, kp) => newerIsoDate(latest, kp.last_practiced),
      null,
    );
    return {
      key: makeChapterKey(volume, chapter),
      volume,
      chapter,
      kps: chapterKps,
      total,
      availableCount: available.length,
      mastered,
      avgMastery,
      latestLastPracticed,
    };
  });
}

function getChapterRecommendedKp(chapterKps: DirectoryKpNode[]) {
  return pickRecommendedKp(chapterKps);
}

function getRestoreKpId(state: unknown) {
  if (!state || typeof state !== 'object') return null;
  const restoreKpId = (state as SyncReturnState).restoreKpId;
  return typeof restoreKpId === 'string' && restoreKpId.trim() ? restoreKpId : null;
}

function findKpById(kps: DirectoryKpNode[], kpId: string | null) {
  if (!kpId) return null;
  return kps.find(kp => kp.id === kpId) || null;
}

function getPreferredSyncKp(restoreKp: DirectoryKpNode | null, initialSyncKp: DirectoryKpNode | null) {
  return restoreKp || initialSyncKp;
}

function findChapterForKp(
  chapters: ChapterSummary[],
  kp: DirectoryKpNode | null,
  selectedVolume: string | null,
) {
  if (!kp || normalizeVolume(kp.volume) !== selectedVolume) return null;
  return chapters.find(chapter => chapter.kps.some(item => item.id === kp.id)) || null;
}

function getKpInChapter(chapter: ChapterSummary | null, kp: DirectoryKpNode | null) {
  if (!chapter || !kp) return null;
  return chapter.kps.some(item => item.id === kp.id) ? kp : null;
}

function getKpStatusLabel(kp: DirectoryKpNode) {
  return getLearningKpStatus(kp).label;
}

function getKpAdvice(kp: DirectoryKpNode, recommendedKpId?: string | null) {
  if (kp.id === recommendedKpId) return '推荐先学这个知识点。';
  if (learningStateFor(kp) === 'mastered') return '已基本掌握，可进行巩固或进入后续知识点。';
  if (learningStateFor(kp) === 'practice') return '当前需要巩固，建议先补齐基础。';
  if (learningStateFor(kp) === 'learning') return '可通过知识卡片和小测确认掌握情况。';
  return '建议先学习知识卡片，再用小测确认理解。';
}

export function getSyncKpActions(
  kp: DirectoryKpNode,
  _judgment?: KnowledgeMasteryJudgment | null,
  assessment: PracticeRecord | null = null,
): SyncKpActions {
  if (!hasKpPractice(kp)) return {
    primary: { label: '开始学习', kind: 'learn' },
    secondary: { label: '练习待补充', kind: 'check' },
  };
  if (hasKpQuestionSet(assessment) && !hasCompletedKpAssessment(assessment)) {
    return {
      primary: { label: '继续评估', kind: 'check' },
      secondary: { label: '回看知识卡', kind: 'learn' },
    };
  }
  const state = learningStateFor(kp);
  if (hasCompletedKpAssessment(assessment) || state === 'mastered') {
    return {
      primary: { label: '巩固小练', kind: 'train' },
      secondary: { label: '回看知识卡', kind: 'learn' },
    };
  }
  if (state === 'practice') {
    return {
      primary: { label: '巩固小练', kind: 'train' },
      secondary: { label: '回看知识卡', kind: 'learn' },
    };
  }
  if (state === 'learning') {
    return {
      primary: { label: '继续学习', kind: 'learn' },
      secondary: { label: '掌握评估', kind: 'check' },
    };
  }
  return {
    primary: { label: '开始学习', kind: 'learn' },
    secondary: { label: '掌握评估', kind: 'check' },
  };
}

export function getSyncKpActionPath(kind: SyncKpActionKind, kpId: string): string {
  const encodedKpId = encodeURIComponent(kpId);
  if (kind === 'improvement') return '/train';
  if (kind === 'train') return `/learn/check?kp=${encodedKpId}&count=5&mode=practice`;
  if (kind === 'check') return `/learn/check?kp=${encodedKpId}&count=3&mode=check`;
  return `/learn?kp=${encodedKpId}`;
}

export default function SyncPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const studentId = getStudentId();
  const studentProfile = useMemo(() => getStudentProfile(), []);
  const canUseLearning = canEnterLearningArea(studentProfile);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [loading, setLoading] = useState(canUseLearning);
  const [error, setError] = useState<string | null>(null);
  const [selectedVolume, setSelectedVolume] = useState<string | null>(null);
  const [selectedChapterKey, setSelectedChapterKey] = useState<string | null>(null);
  const [activeKpId, setActiveKpId] = useState<string | null>(null);
  const [sideMode, setSideMode] = useState<SyncSideMode>('directory');
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [judgmentByKpId, setJudgmentByKpId] = useState<Record<string, KnowledgeMasteryJudgment>>({});
  const [judgmentsLoading, setJudgmentsLoading] = useState(false);
  const [judgmentsError, setJudgmentsError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!canUseLearning) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await api.getDirectory(studentId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '同步学习数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [canUseLearning, studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const kps = data?.kps ?? [];
  const accessibleKps = useMemo(
    () => kps.filter(kp => canAccessKp(studentProfile, kp) && hasKpContent(kp)),
    [kps, studentProfile],
  );
  const volumes = useMemo(() => groupVolumes(kps), [kps]);
  const initialSyncKp = useMemo(() => pickInitialSyncKp(accessibleKps.length > 0 ? accessibleKps : kps), [accessibleKps, kps]);
  const restoreKpId = getRestoreKpId(location.state);
  const restoreKp = useMemo(() => findKpById(kps, restoreKpId), [kps, restoreKpId]);
  const preferredSyncKp = useMemo(
    () => getPreferredSyncKp(
      restoreKp && canAccessKp(studentProfile, restoreKp) ? restoreKp : null,
      initialSyncKp,
    ),
    [initialSyncKp, restoreKp, studentProfile],
  );

  useEffect(() => {
    if (volumes.length === 0) return;
    const preferredVolume = preferredSyncKp ? normalizeVolume(preferredSyncKp.volume) : null;
    if (!selectedVolume || !volumes.includes(selectedVolume)) {
      setSelectedVolume(preferredVolume && volumes.includes(preferredVolume) ? preferredVolume : volumes[0]);
    }
  }, [preferredSyncKp, selectedVolume, volumes]);

  const chapters = useMemo(() => {
    return selectedVolume ? groupChaptersByVolume(kps, selectedVolume) : [];
  }, [kps, selectedVolume]);

  useEffect(() => {
    if (!selectedVolume || chapters.length === 0) return;
    const preferredChapter = findChapterForKp(chapters, preferredSyncKp, selectedVolume);
    const selectedChapterExists = selectedChapterKey
      ? chapters.some(chapter => chapter.key === selectedChapterKey)
      : false;
    if (!selectedChapterExists) {
      setSelectedChapterKey((preferredChapter || chapters[0]).key);
    }
  }, [chapters, preferredSyncKp, selectedChapterKey, selectedVolume]);

  const selectedChapter = chapters.find(chapter => chapter.key === selectedChapterKey) || chapters[0] || null;
  const chapterKps = selectedChapter?.kps ?? [];
  const chapterJudgmentKpIds = useMemo(
    () => Array.from(new Set(chapterKps.filter(hasKpContent).map(kp => kp.id).filter(Boolean))),
    [chapterKps],
  );
  const missingChapterJudgmentSignature = useMemo(
    () => chapterJudgmentKpIds.filter(kpId => !judgmentByKpId[kpId]).join('|'),
    [chapterJudgmentKpIds, judgmentByKpId],
  );
  const recommendedKp = useMemo(() => getChapterRecommendedKp(chapterKps), [chapterKps]);
  const activeKp = chapterKps.find(kp => kp.id === activeKpId) || recommendedKp || chapterKps[0] || null;
  const activeKpAllowed = canAccessKp(studentProfile, activeKp);

  useEffect(() => {
    if (!canUseLearning || chapterJudgmentKpIds.length === 0) {
      if (!canUseLearning) setJudgmentByKpId({});
      setJudgmentsLoading(false);
      setJudgmentsError(false);
      return;
    }

    const requestKpIds = missingChapterJudgmentSignature
      ? missingChapterJudgmentSignature.split('|')
      : [];
    if (requestKpIds.length === 0) {
      setJudgmentsLoading(false);
      setJudgmentsError(false);
      return;
    }

    let cancelled = false;
    setJudgmentsLoading(true);
    setJudgmentsError(false);
    api.getKnowledgeMasteryJudgments(requestKpIds, studentId)
      .then(response => {
        if (cancelled) return;
        setJudgmentByKpId(prev => ({
          ...prev,
          ...Object.fromEntries(response.items.map(item => [item.kpId, item])),
        }));
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[SyncPage] mastery judgment loading failed; falling back to directory mastery state.', err);
        setJudgmentsError(true);
      })
      .finally(() => {
        if (!cancelled) setJudgmentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canUseLearning, chapterJudgmentKpIds.length, missingChapterJudgmentSignature, studentId]);

  useEffect(() => {
    if (!selectedChapter) return;
    if (activeKpId && selectedChapter.kps.some(kp => kp.id === activeKpId)) return;
    const restoredInChapter = getKpInChapter(selectedChapter, restoreKp);
    const fallbackKp = getChapterRecommendedKp(selectedChapter.kps) || selectedChapter.kps[0] || null;
    const nextActiveKp = restoredInChapter || fallbackKp;
    if (restoredInChapter) setSideMode('kp');
    setActiveKpId(nextActiveKp?.id || null);
  }, [activeKpId, restoreKp, selectedChapter]);

  const handleSelectVolume = (volume: string) => {
    setSelectedVolume(volume);
    setSelectedChapterKey(null);
    setActiveKpId(null);
    setSideMode('directory');
    setVolumeMenuOpen(false);
  };

  const handleSelectChapter = (chapter: ChapterSummary) => {
    const nextKp = getChapterRecommendedKp(chapter.kps) || chapter.kps[0] || null;
    setSelectedChapterKey(chapter.key);
    setActiveKpId(nextKp?.id || null);
    setSideMode('directory');
  };

  const handleOpenKp = (kpId: string) => {
    setActiveKpId(kpId);
    setSideMode('kp');
  };

  const goLearn = () => {
    if (activeKp && activeKpAllowed && hasKpContent(activeKp)) navigate(getSyncKpActionPath('learn', activeKp.id), {
      state: buildReturnState(location, { restoreKpId: activeKp.id }),
    });
  };

  const goCheck = () => {
    if (activeKp && activeKpAllowed && hasKpPractice(activeKp)) navigate(getSyncKpActionPath('check', activeKp.id), {
      state: buildReturnState(location, { restoreKpId: activeKp.id }),
    });
  };

  const goTrain = () => {
    if (activeKp && activeKpAllowed && hasKpPractice(activeKp)) navigate(getSyncKpActionPath('train', activeKp.id), {
      state: buildReturnState(location, { restoreKpId: activeKp.id }),
    });
  };

  const goImprovement = () => {
    if (activeKp && activeKpAllowed && hasKpPractice(activeKp)) navigate(getSyncKpActionPath('improvement', activeKp.id), {
      state: buildReturnState(location, { restoreKpId: activeKp.id }),
    });
  };

  const runKpAction = (kind: SyncKpActionKind) => {
    if (!activeKpAllowed) {
      navigate('/login');
      return;
    }
    if (kind === 'train') {
      goTrain();
      return;
    }
    if (kind === 'improvement') {
      goImprovement();
      return;
    }
    if (kind === 'check') {
      goCheck();
      return;
    }
    goLearn();
  };

  if (!canUseLearning) {
    return (
      <main className="container sync-page">
        <section className="page-header sync-topbar sync-header-panel" aria-label="同步学习">
          <div className="sync-title-block">
            <h1>同步学习</h1>
            <p>按教材章节推进，查看当前章节学习路径。</p>
          </div>
          <div className="sync-current-badge">功能预览</div>
        </section>
        <AccountAccessPanel
          features={['知识卡片', '章节同步', '小测巩固']}
        />
      </main>
    );
  }

  if (loading) return <div className="loading">加载中...</div>;

  if (error) {
    return (
      <main className="container sync-page">
        <div className="error-banner">{error}</div>
        <button type="button" className="page-back-button" onClick={fetchData}>重试</button>
      </main>
    );
  }

  if (!data || kps.length === 0) {
    return (
      <main className="container sync-page">
        <section className="sync-empty-card">
          <h1>暂无同步学习数据</h1>
          <p>当前还没有可学习的教材目录。完成题库同步后，这里会显示章节路径和知识点推荐。</p>
        </section>
      </main>
    );
  }

  const masteredCount = selectedChapter?.mastered ?? 0;
  const totalCount = selectedChapter?.total ?? 0;
  const avgMasteryPct = Math.round((selectedChapter?.avgMastery ?? 0) * 100);
  const currentBadge = [selectedVolume, selectedChapter?.chapter].filter(Boolean).join(' / ');
  const activeJudgment = activeKp ? judgmentByKpId[activeKp.id] || null : null;
  const activeKpStatus = activeKp ? getLearningKpStatus(activeKp) : null;
  const activeKpBadge = activeKp && hasKpContent(activeKp) && activeKpStatus
    ? mapKnowledgeMasteryJudgmentToMasteryDisplay(activeJudgment, {
      label: activeKpStatus.label,
      reason: getKpAdvice(activeKp, recommendedKp?.id),
      tone: activeKpStatus.tone,
      masteryPct: Math.round((activeKp.mastery ?? 0) * 100),
    })
    : null;
  const activeMasteryPct = activeKpBadge?.masteryPct ?? Math.round((activeKp?.mastery ?? 0) * 100);
  const kpActions = activeKp && hasKpContent(activeKp) ? getSyncKpActions(activeKp, activeJudgment, loadSyncAssessment(studentId, activeKp.id)) : null;

  return (
    <main className="container sync-page">
      <section className="page-header sync-topbar sync-header-panel" aria-label="同步学习">
        <div className="sync-title-block">
          <h1>同步学习</h1>
          <p>按教材章节推进，查看当前章节学习路径。</p>
        </div>
        <div className="sync-current-badge">{currentBadge || '同步学习'}</div>
      </section>

      <section className="sync-map-layout" aria-label="同步学习地图">
        <aside className="sync-side-panel">
          {sideMode === 'directory' || !activeKp ? (
            <>
              <div className="sync-side-header">
                <span>学习控制面板</span>
                <h2>选择教材与章节</h2>
              </div>
              <div className="sync-volume-menu">
                <button
                  type="button"
                  className="sync-volume-trigger"
                  onClick={() => setVolumeMenuOpen(open => !open)}
                  aria-expanded={volumeMenuOpen}
                  aria-controls="sync-volume-list"
                >
                  <span aria-hidden="true" className="sync-volume-menu-icon">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{selectedVolume || '选择教材'}</span>
                </button>
                {volumeMenuOpen && (
                  <div className="sync-volume-dropdown" id="sync-volume-list" role="menu">
                    {volumes.map(volume => (
                      <button
                        type="button"
                        className={`sync-volume-option${volume === selectedVolume ? ' is-active' : ''}`}
                        key={volume}
                        onClick={() => handleSelectVolume(volume)}
                        role="menuitem"
                      >
                        {volume}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="sync-chapter-list">
                {chapters.map(chapter => (
                  <button
                    type="button"
                    className={`sync-chapter-item${chapter.key === selectedChapter?.key ? ' is-active' : ''}`}
                    key={chapter.key}
                    onClick={() => handleSelectChapter(chapter)}
                  >
                    <span className="sync-chapter-title">{chapter.chapter}</span>
                    <span className="sync-chapter-meta">
                      {chapter.availableCount > 0
                        ? `${chapter.mastered}/${chapter.availableCount} 已掌握 · ${Math.round(chapter.avgMastery * 100)}% 平均掌握`
                        : `${chapter.total} 个知识点 · 内容待补充`}
                    </span>
                    <span className="sync-chapter-progress">
                      <span className="sync-chapter-track">
                        <span style={{ width: `${Math.round(chapter.avgMastery * 100)}%` }} />
                      </span>
                      <span className="sync-chapter-percent">{chapter.availableCount > 0 ? `${Math.round(chapter.avgMastery * 100)}%` : '—'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="sync-kp-panel">
              <button type="button" className="sync-back-directory" onClick={() => setSideMode('directory')}>
                返回目录
              </button>
              <h2 className="sync-kp-title">{activeKp.name}</h2>
              <p className="sync-kp-location">
                {[activeKp.volume, activeKp.chapter, activeKp.section].filter(Boolean).join(' / ')}
              </p>
              <div className="sync-kp-status-row">
                <span className={`sync-kp-status${activeKpBadge ? ` tone-${activeKpBadge.tone}` : ''}`}>
                  {activeKpBadge?.label ?? getKpStatusLabel(activeKp)}
                </span>
                {hasKpContent(activeKp) && <span className="sync-kp-mastery">掌握度 {activeMasteryPct}%</span>}
              </div>
              <div className="sync-kp-advice">
                {!hasKpContent(activeKp) ? '目录已保留，学习卡片和题目待部署者补充。' : activeKpAllowed
                  ? activeKpBadge?.reason ?? getKpAdvice(activeKp, recommendedKp?.id)
                  : '请使用有效账号登录后继续学习。'}
                {activeKpAllowed && judgmentsLoading && (
                  <span className="sync-kp-judgment-note">正在更新掌握判断...</span>
                )}
                {activeKpAllowed && judgmentsError && (
                  <span className="sync-kp-judgment-note">暂用最近学习记录判断。</span>
                )}
              </div>
              <div className="sync-kp-actions">
                {!hasKpContent(activeKp) ? <p>内容待补充</p> : !activeKpAllowed ? (
                  <button
                    type="button"
                    className="sync-primary-button"
                    onClick={() => navigate('/login')}
                  >
                    前往登录
                  </button>
                ) : kpActions && (
                  <>
                    <button
                      type="button"
                      className="sync-primary-button"
                      onClick={() => runKpAction(kpActions.primary.kind)}
                    >
                      {kpActions.primary.label}
                    </button>
                    <button
                      type="button"
                      className="sync-secondary-button"
                      disabled={!hasKpPractice(activeKp)}
                      onClick={() => runKpAction(kpActions.secondary.kind)}
                    >
                      {kpActions.secondary.label}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </aside>

        <section className="sync-map-main">
          <div className="sync-map-header">
            <div className="sync-map-header-main">
              <span>当前章节学习路径</span>
              <h2>{selectedChapter?.chapter || '选择章节'}</h2>
            </div>
            <div className="sync-map-stats" aria-label="章节统计">
              <div className="sync-map-stat">
                <strong>{totalCount}</strong>
                <span>知识点</span>
              </div>
              <div className="sync-map-stat">
                <strong>{masteredCount}</strong>
                <span>已掌握</span>
              </div>
              <div className="sync-map-stat">
                <strong>{selectedChapter?.availableCount ? `${avgMasteryPct}%` : '—'}</strong>
                <span>平均掌握</span>
              </div>
            </div>
          </div>

          <div className="sync-route-wrap">
            {selectedChapter?.availableCount === 0 && <p className="sync-empty-text">本章目录已完整保留，学习内容和题目待补充。</p>}
            {chapterKps.length === 0 ? (
              <div className="sync-empty-text">当前章节还没有知识点。</div>
            ) : (
              <ChapterKnowledgeGraph
                kps={chapterKps}
                relations={data.relations}
                recommendedKpId={recommendedKp?.id}
                masteryJudgments={judgmentByKpId}
                masteryJudgmentsLoading={judgmentsLoading && !judgmentsError}
                onOpenKp={handleOpenKp}
              />
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
