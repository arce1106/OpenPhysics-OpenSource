import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import KnowledgeCard from '../components/KnowledgeCard';
import AITutorChat from '../components/AITutorChat';
import AccountAccessPanel from '../components/AccountAccessPanel';
import VideoRecommendations from '../components/VideoRecommendations';
import { LearnHeader, LearnProgressPanel, LearnResourceTabs, LearnContentPanel } from '../components/learn';
import { defaultDemoForKnowledgePoint } from '../physics-demos/elective2Models';
import type { LearningResourceTab } from '../utils/learningFlow';
import { navigateBackToPreviousPage } from '../utils/navigation';
import { getStudentProfile } from '../api/studentIdentity';
import { canEnterLearningArea, isLearningAccessError } from '../utils/learningAccess';
import type { LearnBundle } from '../types';

const Elective2DemoPanel = lazy(() => import('../physics-demos/Elective2DemoPanel'));

type Tab = LearningResourceTab;

export default function LearnPage() {
  const [searchParams] = useSearchParams();
  const kpId = searchParams.get('kp') || '';
  const navigate = useNavigate();
  const location = useLocation();
  const canUseLearning = canEnterLearningArea(getStudentProfile());

  const [data, setData] = useState<LearnBundle | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('card');
  const [loading, setLoading] = useState(canUseLearning);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!canUseLearning) {
      setLoading(false);
      return;
    }
    if (!kpId) {
      setError('未指定知识点');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const bundle = await api.getLearnBundle(kpId);
      setData(bundle);

      // Auto-select first available tab
      if (bundle.card) setActiveTab('card');
      else if (bundle.simulations?.length) setActiveTab('interactive');
      else if (bundle.slides) setActiveTab('slides');
      else setActiveTab('video');
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [canUseLearning, kpId]);

  const localDemo = useMemo(() => defaultDemoForKnowledgePoint(kpId), [kpId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleConsumed = () => {
    // Refresh data to update consumed states
    fetchData();
  };

  const handleBack = () => {
    navigateBackToPreviousPage(navigate, location, '/sync', { state: { restoreKpId: kpId } });
  };

  const availableTabs: Tab[] = useMemo(() => {
    const tabs: Tab[] = [];
    if (data?.card) tabs.push('card');
    tabs.push('video');
    if (data?.slides) tabs.push('slides');
    if (localDemo || (data?.simulations && data.simulations.length > 0)) tabs.push('interactive');
    return tabs;
  }, [data, localDemo]);

  const prefetchResource = (tab: Tab) => {
    if (tab === 'video') {
      api.getLearnVideos(kpId).catch(() => undefined);
    }
    if (tab === 'interactive') {
      api.getLearnSimulation(kpId).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [availableTabs, activeTab]);

  if (!canUseLearning) {
    return (
      <div className="container learn-workspace">
        <LearnHeader
          title="同步学习"
          subtitle="知识卡片、讲解和掌握评估"
          onBack={handleBack}
        />
        <AccountAccessPanel
          features={['知识卡片', 'AI助教', '讲解视频', '掌握评估']}
        />
      </div>
    );
  }

  if (loading) return <div className="loading">加载中...</div>;
  if (isLearningAccessError(error)) return (
    <div className="container learn-workspace">
      <LearnHeader
        title="同步学习"
        subtitle="有效账号可使用完整学习功能"
        onBack={handleBack}
      />
      <AccountAccessPanel
        title="账号不可用，请重新登录或联系部署管理员。"
        description="账号不可用，请重新登录或联系部署管理员。"
        features={['知识卡片', 'AI助教', '讲解视频', '掌握评估']}
      />
    </div>
  );
  if (error) return (
    <div className="container learn-workspace learn-error-state">
      <div className="error-banner">{error}</div>
      <button onClick={fetchData} className="learn-retry-button">重试</button>
    </div>
  );
  if (!data) return null;
  const hasConsumedCard = !!data.card?.consumed;

  const cardContent = data.card ? (
    <KnowledgeCard card={data.card} onConsumed={handleConsumed} />
  ) : null;
  const videoContent = (
    <VideoRecommendations kpId={kpId} />
  );
  const slidesContent = data.slides ? (
    <div className="learn-placeholder learn-content-empty">
      微课功能即将上线
    </div>
  ) : null;
  const interactiveContent = localDemo ? (
    <Suspense fallback={<div className="loading">加载模拟中...</div>}>
      <Elective2DemoPanel kpId={kpId} kpName={data.kp_name} />
    </Suspense>
  ) : (
    <div className="learn-placeholder learn-content-empty">
      模拟功能即将上线
    </div>
  );

  return (
    <div className="container learn-workspace">
      {/* Header */}
      <LearnHeader
        title={data.kp_name}
        subtitle="同步学习"
        onBack={handleBack}
        aside={<LearnProgressPanel progress={data.progress} />}
      />

      {/* Resource tabs */}
      <LearnResourceTabs
        activeTab={activeTab}
        availableTabs={availableTabs}
        onChange={setActiveTab}
        onPrefetch={prefetchResource}
      />

      {activeTab !== 'card' && data.card && !hasConsumedCard && (
        <div className="learn-card-reminder">
          <span>如果概念还没有理顺，建议先回到卡片完成主线学习。</span>
          <button
            onClick={() => setActiveTab('card')}
            className="learn-card-reminder-button"
          >
            回到卡片
          </button>
        </div>
      )}

      {/* Content area */}
      <LearnContentPanel
        activeTab={activeTab}
        cardContent={cardContent}
        videoContent={videoContent}
        slidesContent={slidesContent}
        interactiveContent={interactiveContent}
      />

      <AITutorChat kpId={kpId} kpName={data.kp_name} />
    </div>
  );
}
