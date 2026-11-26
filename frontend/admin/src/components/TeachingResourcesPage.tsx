import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KpWithStats } from '../types';
import { chapterLabel } from '../common/labels';
import KpTree from '../common/KpTree';
import QualityPage from './QualityPage';
import WorkspacePage from './WorkspacePage';
import LearningResourcesPage from './LearningResourcesPage';

const SIDEBAR_BG = '#1a1d23';
const DIRECTORY_WIDTH = 248;

type ResourceTab = 'quality' | 'questions' | 'learning';

const tabs: { value: ResourceTab; label: string; hint: string }[] = [
  { value: 'quality', label: '质量总览', hint: '看当前范围整体健康度和待处理问题' },
  { value: 'questions', label: '题库', hint: '查看、编辑、筛选和审核题目' },
  { value: 'learning', label: '学习资源', hint: '检查知识卡片、讲解视频和互动模拟覆盖' },
];

interface TeachingResourcesPageProps {
  kps: KpWithStats[];
  loading: boolean;
  error: string | null;
  selectedVolumeKey: string | null;
  onSelectVolume: (vol: string) => void;
  selectedKpId: string | null;
  onSelectKp: (id: string) => void;
  selectedChapterKey: string | null;
  onSelectChapter: (vol: string, ch: string) => void;
  selectedSectionKey: string | null;
  onSelectSection: (vol: string, ch: string, sec: string) => void;
  allQuestionsId: string;
}

function splitKey(key: string | null | undefined): string[] {
  return key ? key.split('||') : [];
}

function scopeTitle({
  kps,
  selectedKpId,
  selectedVolumeKey,
  selectedChapterKey,
  selectedSectionKey,
  allQuestionsId,
}: {
  kps: KpWithStats[];
  selectedKpId: string | null;
  selectedVolumeKey: string | null;
  selectedChapterKey: string | null;
  selectedSectionKey: string | null;
  allQuestionsId: string;
}) {
  if (selectedKpId && selectedKpId !== allQuestionsId) {
    const kp = kps.find(item => item.id === selectedKpId);
    return {
      title: kp ? kp.name : selectedKpId,
      hint: kp ? [kp.volume, kp.chapter, kp.section, kp.id].filter(Boolean).join(' · ') : '知识点',
    };
  }
  if (selectedSectionKey) {
    const [volume, chapter, section] = splitKey(selectedSectionKey);
    return {
      title: section || '小节',
      hint: [volume, chapter].filter(Boolean).join(' · '),
    };
  }
  if (selectedChapterKey) {
    const [volume, chapter] = splitKey(selectedChapterKey);
    return {
      title: chapter ? chapterLabel(chapter) : '章节',
      hint: volume || '',
    };
  }
  if (selectedVolumeKey) {
    return {
      title: selectedVolumeKey,
      hint: '整册范围',
    };
  }
  return {
    title: '请选择教材范围',
    hint: '从左侧选择一册书、章节、小节或知识点。',
  };
}

export default function TeachingResourcesPage({
  kps,
  loading,
  error,
  selectedVolumeKey,
  onSelectVolume,
  selectedKpId,
  onSelectKp,
  selectedChapterKey,
  onSelectChapter,
  selectedSectionKey,
  onSelectSection,
  allQuestionsId,
}: TeachingResourcesPageProps) {
  const [params, setParams] = useSearchParams();
  const activeTab = (params.get('tab') || 'quality') as ResourceTab;
  const currentTab = tabs.some(tab => tab.value === activeTab) ? activeTab : 'quality';

  const badgeCount = useMemo(() => {
    const counts: Record<string, number> = {};
    kps.forEach(kp => { counts[kp.id] = kp.question_count; });
    return counts;
  }, [kps]);

  const scope = useMemo(
    () => scopeTitle({ kps, selectedKpId, selectedVolumeKey, selectedChapterKey, selectedSectionKey, allQuestionsId }),
    [allQuestionsId, kps, selectedChapterKey, selectedKpId, selectedSectionKey, selectedVolumeKey],
  );

  const handleTabChange = (value: ResourceTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <aside style={{
        width: DIRECTORY_WIDTH,
        minWidth: DIRECTORY_WIDTH,
        background: SIDEBAR_BG,
        borderRight: '1px solid #2a2d35',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #2a2d35' }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 800 }}>教材目录</div>
          <div style={{ color: '#5c6370', fontSize: 11, marginTop: 3 }}>按章节维护题库与学习资源</div>
        </div>

        {!loading && !error && (
          <>
            <div style={{ padding: '7px 14px', fontSize: 11, color: '#5c6370', borderBottom: '1px solid #2a2d35' }}>
              {kps.length} 知识点
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
              <KpTree
                kps={kps}
                selectedKpId={selectedKpId}
                onSelectKp={onSelectKp}
                selectedVolumeKey={selectedVolumeKey}
                onSelectVolume={onSelectVolume}
                selectedChapterKey={selectedChapterKey}
                onSelectChapter={onSelectChapter}
                selectedSectionKey={selectedSectionKey}
                onSelectSection={onSelectSection}
                badgeCount={badgeCount}
                dark
              />
            </div>
          </>
        )}

        {loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6370', fontSize: 12 }}>
            加载教材目录...
          </div>
        )}
        {error && (
          <div style={{ padding: 18, color: '#ffb4a8', fontSize: 12, lineHeight: 1.6 }}>{error}</div>
        )}
      </aside>

      <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: '#fffdf8', borderBottom: '1px solid #e8e0d2', flexShrink: 0 }}>
          <div style={{
            padding: '7px 14px',
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 1fr) auto',
            gap: 12,
            alignItems: 'center',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: '#1f2933', whiteSpace: 'nowrap' }}>教学资源</span>
                <span style={{ fontSize: 12, color: '#52606d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  当前范围：<strong style={{ color: '#1f2933' }}>{scope.title}</strong>
                  {scope.hint && <span style={{ color: '#8a7458' }}> · {scope.hint}</span>}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {tabs.map(tab => (
              <button
                key={tab.value}
                type="button"
                onClick={() => handleTabChange(tab.value)}
                title={tab.hint}
                style={{
                  padding: '6px 11px',
                  borderRadius: 6,
                  border: currentTab === tab.value ? '1px solid #0d7377' : '1px solid #d9d2c5',
                  background: currentTab === tab.value ? '#e0f5f6' : '#fffdf8',
                  color: currentTab === tab.value ? '#0d7377' : '#52606d',
                  cursor: 'pointer',
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {tab.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667085', fontSize: 13 }}>
              加载教学资源...
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 24, color: '#b42318', fontSize: 13 }}>{error}</div>
          )}
          {!loading && !error && currentTab === 'quality' && (
            <QualityPage
              kps={kps}
              selectedVolumeKey={selectedVolumeKey}
              selectedKpId={selectedKpId}
              selectedChapterKey={selectedChapterKey}
              selectedSectionKey={selectedSectionKey}
              allQuestionsId={allQuestionsId}
            />
          )}
          {!loading && !error && currentTab === 'questions' && (
            <WorkspacePage
              kps={kps}
              selectedVolumeKey={selectedVolumeKey}
              selectedKpId={selectedKpId}
              selectedChapterKey={selectedChapterKey}
              selectedSectionKey={selectedSectionKey}
              allQuestionsId={allQuestionsId}
            />
          )}
          {!loading && !error && currentTab === 'learning' && (
            <LearningResourcesPage
              kps={kps}
              selectedVolumeKey={selectedVolumeKey}
              selectedKpId={selectedKpId}
              selectedChapterKey={selectedChapterKey}
              selectedSectionKey={selectedSectionKey}
              allQuestionsId={allQuestionsId}
            />
          )}
        </div>
      </main>
    </div>
  );
}
