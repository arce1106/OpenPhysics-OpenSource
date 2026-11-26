import { useEffect, useMemo, useState } from 'react';
import type { DirectoryKpNode } from '../../types';
import { pickFocusedChapterKey } from '../../utils/learningFocus';
import { buildDirectoryKpStats, firstKpByLearningState } from './learningKpStatus';

const VOLUME_ORDER: Record<string, number> = {
  '必修 第一册': 1,
  '必修 第二册': 2,
  '必修 第三册': 3,
  '选择性必修 第一册': 4,
  '选择性必修 第二册': 5,
  '选择性必修 第三册': 6,
};

const VOLUME_COLORS = ['#14919b', '#52c41a', '#faad14', '#4c78a8', '#b279a2', '#ff7a45'];

type ChapterTone = 'current' | 'mastered' | 'learning' | 'practice' | 'locked';

interface ChapterNavItem {
  key: string;
  volume: string;
  chapter: string;
  kps: DirectoryKpNode[];
  avgMastery: number;
  status: { label: string; tone: ChapterTone };
}

interface VolumeNavItem {
  key: string;
  color: string;
  chapters: ChapterNavItem[];
}

interface CurriculumNavigatorProps {
  kps: DirectoryKpNode[];
  selectedVolume?: string | null;
  selectedChapter?: string | null;
  selectedKpId?: string | null;
  onSelectChapter: (volume: string, chapter: string) => void;
  className?: string;
}

function chapterStatus(kps: DirectoryKpNode[]): { label: string; tone: ChapterTone } {
  if (kps.length === 0) return { label: '未开始', tone: 'locked' };
  const stats = buildDirectoryKpStats(kps);
  if (stats.practice > 0) return { label: '待巩固', tone: 'practice' };
  if (stats.learning > 0) return { label: '学习中', tone: 'learning' };
  if (stats.toLearn > 0) return { label: '待学习', tone: 'learning' };
  if (stats.mastered === stats.total) return { label: '已掌握', tone: 'mastered' };
  return { label: '未开始', tone: 'locked' };
}

function selectRecommendedChapter(items: ChapterNavItem[]) {
  const focusedKey = pickFocusedChapterKey(items.flatMap(item => item.kps));
  return items.find(item => item.key === focusedKey)
    || items.find(item => firstKpByLearningState(item.kps, ['learning', 'practice', 'to_learn']))
    || items.find(item => item.status.tone === 'locked')
    || items[0]
    || null;
}

export default function CurriculumNavigator({
  kps,
  selectedVolume,
  selectedChapter,
  selectedKpId,
  onSelectChapter,
  className = '',
}: CurriculumNavigatorProps) {
  const { volumes, activeChapter } = useMemo(() => {
    const grouped = new Map<string, Map<string, DirectoryKpNode[]>>();
    kps.forEach(kp => {
      const volume = kp.volume || '未分类';
      const chapter = kp.chapter || '未分类';
      if (!grouped.has(volume)) grouped.set(volume, new Map());
      const chapters = grouped.get(volume)!;
      if (!chapters.has(chapter)) chapters.set(chapter, []);
      chapters.get(chapter)!.push(kp);
    });

    const volumeItems: VolumeNavItem[] = Array.from(grouped.entries())
      .sort(([left], [right]) => (VOLUME_ORDER[left] || 99) - (VOLUME_ORDER[right] || 99))
      .map(([volume, chapters], volumeIndex) => {
        const chapterItems: ChapterNavItem[] = Array.from(chapters.entries()).map(([chapter, chapterKps]) => {
          const key = `${volume}||${chapter}`;
          const avgMastery = chapterKps.length > 0
            ? chapterKps.reduce((sum, kp) => sum + kp.mastery, 0) / chapterKps.length
            : 0;
          return {
            key,
            volume,
            chapter,
            kps: chapterKps,
            avgMastery,
            status: chapterStatus(chapterKps),
          };
        });
        return {
          key: volume,
          color: VOLUME_COLORS[volumeIndex % VOLUME_COLORS.length],
          chapters: chapterItems,
        };
      });

    const allChapters = volumeItems.flatMap(volume => volume.chapters);
    const selectedByKp = selectedKpId
      ? allChapters.find(item => item.kps.some(kp => kp.id === selectedKpId))
      : null;
    const selectedByChapter = selectedVolume && selectedChapter
      ? allChapters.find(item => item.volume === selectedVolume && item.chapter === selectedChapter)
      : null;
    const active = selectedByChapter || selectedByKp || selectRecommendedChapter(allChapters);
    return { volumes: volumeItems, activeChapter: active };
  }, [kps, selectedChapter, selectedKpId, selectedVolume]);

  const [expandedVolume, setExpandedVolume] = useState<string | null>(activeChapter?.volume || volumes[0]?.key || null);

  useEffect(() => {
    if (activeChapter?.volume) setExpandedVolume(activeChapter.volume);
  }, [activeChapter?.volume]);

  const learnedVolumeCount = volumes.filter(volume => volume.chapters.some(chapter => chapter.avgMastery > 0)).length;

  return (
    <nav className={`curriculum-navigator${className ? ` ${className}` : ''}`} aria-label="教材导航">
      <div className="curriculum-card">
        <div className="curriculum-card-header">
          <div>
            <h2>教材导航</h2>
            <p>按章节推进</p>
          </div>
          <span>{learnedVolumeCount}/{volumes.length} 册已学习</span>
        </div>
        <div className="curriculum-card-body">
          {volumes.map(volume => {
            const expanded = expandedVolume === volume.key;
            const learnedCount = volume.chapters.filter(chapter => chapter.avgMastery > 0).length;
            return (
              <section key={volume.key} className="curriculum-volume">
                <button
                  type="button"
                  className={`curriculum-volume-button${expanded ? ' is-expanded' : ''}`}
                  onClick={() => setExpandedVolume(expanded ? null : volume.key)}
                >
                  <span className="curriculum-volume-dot" style={{ backgroundColor: volume.color }} />
                  <span className="curriculum-volume-title">{volume.key}</span>
                  <span className="curriculum-volume-meta">{learnedCount}/{volume.chapters.length} 已学</span>
                  <span className="curriculum-volume-arrow">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <div className="curriculum-chapter-list">
                    {volume.chapters.map(chapter => {
                      const current = activeChapter?.key === chapter.key;
                      return (
                        <button
                          key={chapter.key}
                          type="button"
                          className={`curriculum-chapter-row${current ? ' is-current' : ''}`}
                          onClick={() => onSelectChapter(chapter.volume, chapter.chapter)}
                        >
                          <span className="curriculum-chapter-name">{chapter.chapter}</span>
                          <span className={`curriculum-chapter-status tone-${chapter.status.tone}`}>
                            {chapter.status.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
