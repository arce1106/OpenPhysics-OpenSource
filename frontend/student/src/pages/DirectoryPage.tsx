import { hasKpContent, hasKpPractice } from '../utils/learningAccess';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getStudentId } from '../api/studentIdentity';
import {
  DirectoryWelcomePanel,
  KnowledgePointDetailPanel,
  ScopeDetailPanel,
} from '../components/directory';
import { ChapterKnowledgeGraph, CurriculumNavigator, LearningWorkspace, firstKpByLearningState, learningStateFor } from '../components/learningPath';
import { pickFocusedChapterKps } from '../utils/learningFocus';
import type { DirectoryData, DirectoryKpNode } from '../types';

type PanelState = 'welcome' | 'kp_detail' | 'scope_detail';

interface ScopeSelection {
  type: 'chapter' | 'section';
  id: string;    // chapter name, or "chapter||section"
  name: string;  // display name
  kpIds: string[];
}

interface KpDetailReturnSnapshot {
  panel: 'welcome' | 'scope_detail';
  scope: ScopeSelection | null;
  chapterKey: string | null;
  sectionKey: string | null;
}

interface DirectoryRouteState {
  restoreKpId?: string;
  restoreKpReturnSnapshot?: KpDetailReturnSnapshot;
}

const WELCOME_RETURN_SNAPSHOT: KpDetailReturnSnapshot = {
  panel: 'welcome',
  scope: null,
  chapterKey: null,
  sectionKey: null,
};

function pickRecommendedKp(kps: DirectoryKpNode[]) {
  kps = kps.filter(hasKpContent);
  return firstKpByLearningState(kps, ['learning', 'practice', 'to_learn', 'locked'])
    || kps.find(kp => learningStateFor(kp) !== 'mastered')
    || kps[0]
    || null;
}

function isMobileDirectoryViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 768px)').matches;
}

export const DIRECTORY_ASSESSMENT_COPY = {
  title: '掌握评估',
  scopeChapterTitle: '本章掌握评估',
  scopeSectionTitle: '本节掌握评估',
  resultTitle: '评估结果',
  scopeChapterResultTitle: '本章掌握评估结果',
  scopeSectionResultTitle: '本节掌握评估结果',
  participantText: '个知识点参与评估',
} as const;

const KP_ASSESSMENT_WORK_COPY = {
  title: DIRECTORY_ASSESSMENT_COPY.title,
  subtitle: '用 3 道题检查是否真正会用',
};

export default function DirectoryPage() {
  const [dirData, setDirData] = useState<DirectoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Selection — KP
  const [selectedKp, setSelectedKp] = useState<DirectoryKpNode | null>(null);
  // Selection — chapter/section scope
  const [selectedScope, setSelectedScope] = useState<ScopeSelection | null>(null);
  const [selectedChapterKey, setSelectedChapterKey] = useState<string | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [kpDetailReturnSnapshot, setKpDetailReturnSnapshot] = useState<KpDetailReturnSnapshot>(WELCOME_RETURN_SNAPSHOT);

  const [panelState, setPanelState] = useState<PanelState>('welcome');
  const [syncPreviewKpId, setSyncPreviewKpId] = useState<string | null>(null);
  const [showSyncFullGraph, setShowSyncFullGraph] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const restoredLocationStateRef = useRef(false);
  const mobileHistoryDepthRef = useRef(0);
  const studentId = getStudentId();

  const pushMobileDirectoryHistory = useCallback(() => {
    if (!isMobileDirectoryViewport()) return;
    mobileHistoryDepthRef.current += 1;
    window.history.pushState({
      ...(window.history.state || {}),
      openPhysicsMobileDirectoryLayer: true,
    }, '', window.location.href);
  }, []);

  const rememberDirectoryReturnPoint = (kpId: string) => {
    const currentState = window.history.state;
    if (!currentState) return;
    window.history.replaceState({
      ...currentState,
      usr: {
        ...(currentState.usr || {}),
        restoreKpId: kpId,
        restoreKpReturnSnapshot: kpDetailReturnSnapshot,
      },
    }, '');
  };

  const currentDirectoryPath = () => `${location.pathname}${location.search}`;

  const goToLearn = (kpId: string) => {
    if (!hasKpContent(dirData?.kps.find(kp => kp.id === kpId))) return;
    rememberDirectoryReturnPoint(kpId);
    navigate(`/learn?kp=${kpId}`, {
      state: { from: currentDirectoryPath(), restoreKpId: kpId, restoreKpReturnSnapshot: kpDetailReturnSnapshot },
    });
  };

  const goToKpCheck = (kpId: string) => {
    if (!hasKpPractice(dirData?.kps.find(kp => kp.id === kpId))) return;
    rememberDirectoryReturnPoint(kpId);
    navigate(`/learn/check?kp=${kpId}&count=3&mode=check`, {
      state: { from: currentDirectoryPath(), restoreKpId: kpId, restoreKpReturnSnapshot: kpDetailReturnSnapshot },
    });
  };

  const goToKpWork = (kp: DirectoryKpNode) => {
    if (!hasKpPractice(kp)) return;
    rememberDirectoryReturnPoint(kp.id);
    navigate(`/learn/check?kp=${kp.id}&count=3&mode=check`, {
      state: { from: currentDirectoryPath(), restoreKpId: kp.id, restoreKpReturnSnapshot: kpDetailReturnSnapshot },
    });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDirData(await api.getDirectory(studentId));
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const syncChapterKps = useMemo(
    () => (dirData ? pickFocusedChapterKps(dirData.kps, selectedChapterKey) : []),
    [dirData, selectedChapterKey],
  );
  const syncRecommendedKp = useMemo(() => pickRecommendedKp(syncChapterKps), [syncChapterKps]);

  useEffect(() => {
    if (panelState !== 'welcome') return;
    setSyncPreviewKpId(syncRecommendedKp?.id || null);
    setShowSyncFullGraph(false);
  }, [panelState, selectedChapterKey, syncRecommendedKp?.id]);

  useEffect(() => {
    if (!dirData || restoredLocationStateRef.current) return;
    const routeState = location.state as DirectoryRouteState | null;
    const restoreKpId = routeState?.restoreKpId;
    if (!restoreKpId) return;
    const kp = dirData.kps.find(item => item.id === restoreKpId);
    if (!kp) return;
    const returnSnapshot = routeState?.restoreKpReturnSnapshot || WELCOME_RETURN_SNAPSHOT;
    setSelectedKp(kp);
    setSelectedScope(null);
    setSelectedChapterKey(null);
    setSelectedSectionKey(null);
    setKpDetailReturnSnapshot(returnSnapshot);
    setPanelState('kp_detail');
    pushMobileDirectoryHistory();
    restoredLocationStateRef.current = true;
  }, [dirData, location.state, pushMobileDirectoryHistory]);

  // ── KP selection ────────────────────────────────────────────────────────────

  const handleSelectKp = (kpId: string) => {
    if (!dirData) return;
    const kp = dirData.kps.find(k => k.id === kpId);
    if (kp) {
      setKpDetailReturnSnapshot(selectedScope
        ? {
          panel: 'scope_detail',
          scope: selectedScope,
          chapterKey: selectedChapterKey,
          sectionKey: selectedSectionKey,
        }
        : {
          panel: 'welcome',
          scope: null,
          chapterKey: null,
          sectionKey: null,
        });
      setSelectedKp(kp);
      setSelectedScope(null);
      setSelectedChapterKey(null);
      setSelectedSectionKey(null);
      setPanelState('kp_detail');
      pushMobileDirectoryHistory();
      setSidebarOpen(false);
    }
  };

  const handleSelectKpFromWelcome = (kpId: string) => {
    if (!dirData) return;
    const kp = dirData.kps.find(k => k.id === kpId);
    if (!kp) return;
    setKpDetailReturnSnapshot({
      panel: 'welcome',
      scope: null,
      chapterKey: selectedChapterKey,
      sectionKey: selectedSectionKey,
    });
    setSelectedKp(kp);
    setSelectedScope(null);
    setPanelState('kp_detail');
    pushMobileDirectoryHistory();
    setSidebarOpen(false);
  };

  // ── Scope (chapter/section) selection ───────────────────────────────────────

  const handleSelectChapter = (vol: string, ch: string) => {
    if (!dirData) return;
    const kpsInChapter = dirData.kps.filter(k => k.volume === vol && k.chapter === ch);
    setSelectedScope({
      type: 'chapter',
      id: ch,
      name: ch,
      kpIds: kpsInChapter.map(k => k.id),
    });
    setSelectedChapterKey(`${vol}||${ch}`);
    setSelectedSectionKey(null);
    setSelectedKp(null);
    setPanelState('scope_detail');
    pushMobileDirectoryHistory();
    setSidebarOpen(false);
  };

  const handleSelectSection = (vol: string, ch: string, sec: string) => {
    if (!dirData) return;
    const kpsInSection = dirData.kps.filter(k => k.volume === vol && k.chapter === ch && k.section === sec);
    setSelectedScope({
      type: 'section',
      id: `${ch}||${sec}`,
      name: sec,
      kpIds: kpsInSection.map(k => k.id),
    });
    setSelectedSectionKey(`${vol}||${ch}||${sec}`);
    setSelectedChapterKey(null);
    setSelectedKp(null);
    setPanelState('scope_detail');
    pushMobileDirectoryHistory();
    setSidebarOpen(false);
  };

  const handleSelectNavigatorChapter = (vol: string, ch: string) => {
    setSelectedChapterKey(`${vol}||${ch}`);
    setSelectedSectionKey(null);
    setSelectedKp(null);
    setSelectedScope(null);
    setPanelState('welcome');
    setSidebarOpen(false);
  };

  const handleGoToConsolidation = () => {
    if (!selectedScope) return;
    const params = new URLSearchParams({
      scope_type: selectedScope.type,
      scope_id: selectedScope.id,
      scope_name: selectedScope.name,
    });
    navigate(`/train?${params.toString()}`);
  };

  const handleBackFromKpDetail = () => {
    setSelectedKp(null);
    if (kpDetailReturnSnapshot.panel === 'scope_detail' && kpDetailReturnSnapshot.scope) {
      setSelectedScope(kpDetailReturnSnapshot.scope);
      setSelectedChapterKey(kpDetailReturnSnapshot.chapterKey);
      setSelectedSectionKey(kpDetailReturnSnapshot.sectionKey);
      setPanelState('scope_detail');
      return;
    }
    setSelectedScope(null);
    setSelectedChapterKey(null);
    setSelectedSectionKey(null);
    setPanelState('welcome');
  };

  const handleBackToDirectory = () => {
    setSelectedKp(null);
    setSelectedScope(null);
    setSelectedChapterKey(null);
    setSelectedSectionKey(null);
    setPanelState('welcome');
    setSidebarOpen(false);
  };

  const handleRequestBackFromKpDetail = () => {
    if (isMobileDirectoryViewport() && mobileHistoryDepthRef.current > 0) {
      window.history.back();
      return;
    }
    handleBackFromKpDetail();
  };

  const handleRequestBackToDirectory = () => {
    if (isMobileDirectoryViewport() && mobileHistoryDepthRef.current > 0) {
      window.history.back();
      return;
    }
    handleBackToDirectory();
  };

  useEffect(() => {
    const handleMobileHistoryBack = () => {
      if (!isMobileDirectoryViewport()) return;

      if (panelState === 'kp_detail') {
        mobileHistoryDepthRef.current = Math.max(0, mobileHistoryDepthRef.current - 1);
        handleBackFromKpDetail();
        return;
      }

      if (panelState === 'scope_detail') {
        mobileHistoryDepthRef.current = Math.max(0, mobileHistoryDepthRef.current - 1);
        handleBackToDirectory();
      }
    };

    window.addEventListener('popstate', handleMobileHistoryBack);
    return () => window.removeEventListener('popstate', handleMobileHistoryBack);
  }, [panelState, kpDetailReturnSnapshot]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  // ── Loading / Error ─────────────────────────────────────────────────────────

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return (
    <div className="container">
      <div className="error-banner">{error}</div>
      <button onClick={fetchData} style={{
        padding: '8px 16px', borderRadius: 4, border: '1px solid #d9d9d9',
        background: '#fff', cursor: 'pointer', fontSize: 13,
      }}>重试</button>
    </div>
  );
  if (!dirData) return null;

  // ── Panel routing ───────────────────────────────────────────────────────────

  const renderPanel = () => {
    switch (panelState) {
      case 'kp_detail': return renderKpDetail();
      case 'scope_detail': return renderScopeDetail();
      default: return renderWelcome();
    }
  };

  // ── Welcome ─────────────────────────────────────────────────────────────────

  const renderWelcome = () => (
    <DirectoryWelcomePanel
      dirData={dirData}
      selectedKpId={selectedKp?.id || null}
      selectedChapterKey={selectedChapterKey}
      selectedSectionKey={selectedSectionKey}
      onSelectKp={handleSelectKpFromWelcome}
      onSelectChapter={handleSelectChapter}
      onSelectSection={handleSelectSection}
      onStartLearn={goToLearn}
      onStartTrain={goToKpWork}
      activeKpId={syncPreviewKpId}
      onPreviewKp={setSyncPreviewKpId}
      showFullGraph={showSyncFullGraph}
      onToggleFullGraph={() => setShowSyncFullGraph(value => !value)}
    />
  );

  // ── KP Detail ───────────────────────────────────────────────────────────────

  const renderKpDetail = () => {
    if (!selectedKp) return null;
    const { id } = selectedKp;

    return (
      <KnowledgePointDetailPanel
        kp={selectedKp}
        returnPanel={kpDetailReturnSnapshot.panel}
        workCopy={KP_ASSESSMENT_WORK_COPY}
        onBack={handleRequestBackFromKpDetail}
        onStartLearn={() => goToLearn(id)}
        onStartWork={() => selectedKp && goToKpWork(selectedKp)}
      />
    );
  };

  // ── Scope Detail ────────────────────────────────────────────────────────────

  const renderScopeDetail = () => {
    if (!selectedScope || !dirData) return null;
    const scopeKps = dirData.kps.filter(k => selectedScope.kpIds.includes(k.id));
    const availableKps = scopeKps.filter(hasKpContent);
    const avgMastery = availableKps.length > 0
      ? availableKps.reduce((s, k) => s + k.mastery, 0) / availableKps.length
      : 0;

    return (
      <ScopeDetailPanel
        scope={selectedScope}
        scopeKps={scopeKps}
        relations={dirData.relations || []}
        selectedKpId={selectedKp?.id}
        avgMastery={avgMastery}
        onBackToDirectory={handleRequestBackToDirectory}
        onGoToConsolidation={handleGoToConsolidation}
        onSelectKp={handleSelectKp}
        onStartLearn={goToLearn}
        onStartCheck={goToKpCheck}
        onStartTrain={goToKpWork}
      />
    );
  };

  // ── Main layout ─────────────────────────────────────────────────────────────

  const selectedNavParts = selectedChapterKey?.split('||')
    || selectedSectionKey?.split('||')
    || [selectedKp?.volume || null, selectedKp?.chapter || null];
  const selectedNavVolume = selectedNavParts[0] || null;
  const selectedNavChapter = selectedNavParts[1] || null;

  return (
    <LearningWorkspace className="directory-workspace">
      <div className={`directory-layout${showSyncFullGraph ? ' has-full-graph' : ''}`}>
      {/* Overlay for mobile */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <div className={`directory-sidebar directory-sidebar-drawer sidebar-drawer${sidebarOpen ? ' open' : ''}`}>
        <CurriculumNavigator
          kps={dirData.kps}
          selectedVolume={selectedNavVolume}
          selectedChapter={selectedNavChapter}
          selectedKpId={selectedKp?.id || null}
          onSelectChapter={handleSelectNavigatorChapter}
        />
      </div>

      {/* Right panel */}
      <div className="directory-main">
        {renderPanel()}
      </div>
      {panelState === 'welcome' && showSyncFullGraph && (
        <section className="sync-full-graph-wide">
          <div className="sync-full-graph-panel">
            <ChapterKnowledgeGraph
              kps={syncChapterKps}
              relations={dirData.relations || []}
              recommendedKpId={syncRecommendedKp?.id}
              onOpenKp={setSyncPreviewKpId}
            />
          </div>
        </section>
      )}
      </div>
    </LearningWorkspace>
  );
}
