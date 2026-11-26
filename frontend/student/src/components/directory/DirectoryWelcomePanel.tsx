import { hasKpContent, hasKpPractice } from '../../utils/learningAccess';
import { useMemo } from 'react';
import KpDirectoryTree from '../KpDirectoryTree';
import {
  ChapterLearningRoute,
  buildDirectoryKpStats,
  firstKpByLearningState,
  learningStateFor,
} from '../learningPath';
import type { DirectoryData, DirectoryKpNode } from '../../types';
import { pickFocusedChapterKps } from '../../utils/learningFocus';

interface DirectoryWelcomePanelProps {
  dirData: DirectoryData;
  selectedKpId: string | null;
  selectedChapterKey: string | null;
  selectedSectionKey: string | null;
  onSelectKp: (kpId: string) => void;
  onSelectChapter: (volume: string, chapter: string) => void;
  onSelectSection: (volume: string, chapter: string, section: string) => void;
  onStartLearn: (kpId: string) => void;
  onStartTrain: (kp: DirectoryKpNode) => void;
  activeKpId?: string | null;
  onPreviewKp: (kpId: string) => void;
  showFullGraph: boolean;
  onToggleFullGraph: () => void;
}

function nextKp(kps: DirectoryKpNode[]) {
  kps = kps.filter(hasKpContent);
  return firstKpByLearningState(kps, ['learning', 'practice', 'to_learn', 'locked'])
    || kps.find(kp => learningStateFor(kp) !== 'mastered')
    || kps[0];
}

export default function DirectoryWelcomePanel({
  dirData,
  selectedKpId,
  selectedChapterKey,
  selectedSectionKey,
  onSelectKp,
  onSelectChapter,
  onSelectSection,
  onStartLearn,
  onStartTrain,
  activeKpId,
  onPreviewKp,
  showFullGraph,
  onToggleFullGraph,
}: DirectoryWelcomePanelProps) {
  const chapterKps = useMemo(() => pickFocusedChapterKps(dirData.kps, selectedChapterKey), [dirData.kps, selectedChapterKey]);
  const primaryKp = useMemo(() => nextKp(chapterKps), [chapterKps]);
  const activeKp = useMemo(
    () => chapterKps.find(kp => kp.id === activeKpId) || primaryKp,
    [activeKpId, chapterKps, primaryKp],
  );
  const stats = useMemo(() => buildDirectoryKpStats(chapterKps), [chapterKps]);
  const allStats = useMemo(() => {
    const fallback = buildDirectoryKpStats(dirData.kps);
    return {
      ...fallback,
      total: dirData.stats?.total ?? fallback.total,
      mastered: dirData.stats?.mastered ?? fallback.mastered,
      toLearn: dirData.stats?.to_learn ?? fallback.toLearn,
      learning: dirData.stats?.learning ?? fallback.learning,
      practice: dirData.stats?.practice ?? fallback.practice,
    };
  }, [dirData.kps, dirData.stats]);
  const chapterName = activeKp?.chapter || primaryKp?.chapter || '推荐章节';
  const volumeName = activeKp?.volume || primaryKp?.volume || '同步学习';
  const sectionName = activeKp?.section;
  const activeMastery = Math.round((activeKp?.mastery || 0) * 100);
  const activeIsRecommended = Boolean(activeKp && primaryKp && activeKp.id === primaryKp.id);

  return (
    <>
      <div className="mobile-directory-page directory-mobile-panel">
        <div className="mobile-directory-header">
          <div>
            <div className="mobile-directory-title">同步学习</div>
            <div className="mobile-directory-subtitle">选择章节、知识图谱或知识点</div>
          </div>
          {dirData.stats && (
            <div className="mobile-directory-count">{dirData.stats.total} 个知识点</div>
          )}
        </div>
        {dirData.stats && (
          <div className="mobile-directory-stats">
            <span>已掌握 {allStats.mastered}</span>
            <span>待学习 {allStats.toLearn}</span>
            <span>待巩固 {allStats.practice}</span>
          </div>
        )}
        <div className="mobile-directory-tree">
          <KpDirectoryTree
            kps={dirData.kps}
            selectedKpId={selectedKpId}
            onSelectKp={onSelectKp}
            selectedChapterKey={selectedChapterKey}
            onSelectChapter={onSelectChapter}
            selectedSectionKey={selectedSectionKey}
            onSelectSection={onSelectSection}
          />
        </div>
      </div>

      <div className="desktop-directory-welcome directory-detail-panel directory-welcome-panel directory-path-panel">
        <section className="sync-graph-hero">
          <div className="sync-graph-hero-main">
            <span>{activeIsRecommended ? '推荐学习' : '当前选择'}</span>
            <h1>{activeKp?.name || chapterName}</h1>
            <p>
              {[volumeName, chapterName, sectionName].filter(Boolean).join(' / ')}
              {' '}· 先完成知识卡片，再用小测确认掌握情况。
            </p>
            <div className="sync-graph-hero-meta">
              <strong>{stats.total}</strong><span>知识点</span>
              <strong>{stats.mastered}</strong><span>已掌握</span>
              <strong>{stats.toLearn}</strong><span>待学习</span>
              <strong>{stats.learning}</strong><span>学习中</span>
              <strong>{stats.practice}</strong><span>待巩固</span>
              <strong>{Math.round(stats.avgMastery * 100)}%</strong><span>平均掌握</span>
            </div>
            {activeKp && (
              <div className="sync-hero-recommendation">
                {activeIsRecommended ? '推荐先学：' : '已选择：'}<strong>{activeKp.name}</strong>
                <span>{hasKpContent(activeKp) ? `掌握度 ${activeMastery}%` : '内容待补充'}</span>
              </div>
            )}
          </div>
          <div className="sync-graph-hero-side">
            {activeKp && (
              <div className="sync-hero-actions">
                <button type="button" className="sync-start-button" disabled={!hasKpContent(activeKp)} onClick={() => onStartLearn(activeKp.id)}>
                  {activeKp.mastery > 0 ? '继续学习' : '开始学习'}
                </button>
                <button type="button" className="sync-secondary-button" disabled={!hasKpPractice(activeKp)} onClick={() => onStartTrain(activeKp)}>
                  掌握评估
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="directory-path-kp-section directory-route-section">
          <ChapterLearningRoute
            kps={chapterKps}
            recommendedKpId={primaryKp?.id}
            activeKpId={activeKp?.id}
            onOpenKp={onPreviewKp}
            fullGraphExpanded={showFullGraph}
            onToggleFullGraph={onToggleFullGraph}
          />
        </section>
      </div>
    </>
  );
}
