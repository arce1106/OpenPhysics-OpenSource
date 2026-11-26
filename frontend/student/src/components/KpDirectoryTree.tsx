import { useState, useEffect } from 'react';
import type { DirectoryKpNode } from '../types';
import { hasKpContent } from '../utils/learningAccess';

const VOLUME_ORDER: Record<string, number> = {
  '必修 第一册': 1, '必修 第二册': 2, '必修 第三册': 3,
  '选择性必修 第一册': 4, '选择性必修 第二册': 5, '选择性必修 第三册': 6,
};
const VOLUME_COLORS: Record<string, string> = {
  '必修 第一册': '#4C78A8', '必修 第二册': '#F58518', '必修 第三册': '#E45756',
  '选择性必修 第一册': '#72B7B2', '选择性必修 第二册': '#54A24B', '选择性必修 第三册': '#B279A2',
};
const CHAPTER_ORDER: Record<string, number> = {
  '第一章 运动的描述': 1, '第二章 匀变速直线运动的研究': 2, '第三章 相互作用——力': 3, '第四章 运动和力的关系': 4,
  '第五章 抛体运动': 5, '第六章 圆周运动': 6, '第七章 万有引力与宇宙航行': 7, '第八章 机械能守恒定律': 8,
  '第九章 静电场及其应用': 9, '第十章 静电场中的能量': 10, '第十一章 电路及其应用': 11, '第十二章 电能 能量守恒定律': 12, '第十三章 电磁感应与电磁波初步': 13,
  '第一章 动量守恒定律': 14, '第二章 机械振动': 15, '第三章 机械波': 16, '第四章 光': 17,
  '第一章 安培力与洛伦兹力': 18, '第二章 电磁感应': 19, '第三章 交变电流': 20, '第四章 电磁振荡与电磁波': 21, '第五章 传感器': 22,
  '第一章 分子动理论': 23, '第二章 气体、固体和液体': 24, '第三章 热力学定律': 25, '第四章 原子结构和波粒二象性': 26, '第五章 原子核': 27,
};

const ACCENT = '#14919b';
const ACCENT_BG = '#e0f5f6';

function masteryColor(m: number): string {
  if (m >= 0.8) return '#52c41a';
  if (m >= 0.5) return '#faad14';
  return '#ff7a45';
}

function masteryLabel(m: number): string {
  return Math.round(m * 100) + '%';
}

interface Props {
  kps: DirectoryKpNode[];
  selectedKpId: string | null;
  onSelectKp: (id: string) => void;
  selectedChapterKey?: string | null;
  onSelectChapter?: (vol: string, ch: string) => void;
  selectedSectionKey?: string | null;
  onSelectSection?: (vol: string, ch: string, sec: string) => void;
}

export default function KpDirectoryTree({
  kps, selectedKpId, onSelectKp,
  selectedChapterKey, onSelectChapter,
  selectedSectionKey, onSelectSection,
}: Props) {
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(
    new Set(['必修 第一册'])
  );
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Auto-expand parents when a child is selected
  useEffect(() => {
    if (selectedChapterKey) {
      const vol = selectedChapterKey.split('||')[0];
      setExpandedVolumes(prev => { const n = new Set(prev); n.add(vol); return n; });
      setExpandedChapters(prev => { const n = new Set(prev); n.add(selectedChapterKey); return n; });
    }
  }, [selectedChapterKey]);

  useEffect(() => {
    if (selectedSectionKey) {
      const [vol, ch] = selectedSectionKey.split('||');
      setExpandedVolumes(prev => { const n = new Set(prev); n.add(vol); return n; });
      setExpandedChapters(prev => { const n = new Set(prev); n.add(`${vol}||${ch}`); return n; });
      setExpandedSections(prev => { const n = new Set(prev); n.add(selectedSectionKey); return n; });
    }
  }, [selectedSectionKey]);

  // Build tree
  const vt: Record<string, Record<string, { name: string; sections: string[] }>> = {};
  const sectionKps: Record<string, DirectoryKpNode[]> = {};

  for (const kp of kps) {
    const vol = kp.volume || '未分类';
    const ch = kp.chapter || '未分类';
    const sec = kp.section || '未分类';
    if (!vt[vol]) vt[vol] = {};
    if (!vt[vol][ch]) vt[vol][ch] = { name: ch, sections: [] };
    if (!vt[vol][ch].sections.includes(sec)) vt[vol][ch].sections.push(sec);
    const secKey = `${vol}||${ch}||${sec}`;
    if (!sectionKps[secKey]) sectionKps[secKey] = [];
    sectionKps[secKey].push(kp);
  }

  const sortedVolumes = Object.keys(vt).sort(
    (a, b) => (VOLUME_ORDER[a] || 99) - (VOLUME_ORDER[b] || 99)
  );

  return (
    <>
      {sortedVolumes.map(vol => {
        const chapters = vt[vol];
        const isVolExpanded = expandedVolumes.has(vol);
        const chapterNames = Object.keys(chapters).sort(
          (a, b) => (CHAPTER_ORDER[a] || 99) - (CHAPTER_ORDER[b] || 99)
        );
        return (
          <div key={vol}>
            <div
              className="kp-tree-volume-row"
              onClick={() => setExpandedVolumes(prev => {
                const n = new Set(prev);
                isVolExpanded ? n.delete(vol) : n.add(vol);
                return n;
              })}
              style={{
                padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                color: '#333', display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span style={{ fontSize: 10 }}>{isVolExpanded ? '▾' : '▸'}</span>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: VOLUME_COLORS[vol] || '#999',
              }} />
              {vol}
            </div>
            {isVolExpanded && chapterNames.map(ch => {
              const chKey = `${vol}||${ch}`;
              const isSelected = selectedChapterKey === chKey;
              const isChExpanded = expandedChapters.has(chKey);
              const sections = chapters[ch].sections;
              return (
                <div key={chKey}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {/* Arrow — expand/collapse toggle */}
                    <span
                      className="kp-tree-chapter-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedChapters(prev => {
                          const n = new Set(prev);
                          isChExpanded ? n.delete(chKey) : n.add(chKey);
                          return n;
                        });
                      }}
                      style={{
                        padding: '5px 0 5px 40px', cursor: 'pointer', fontSize: 10,
                        color: '#999', flexShrink: 0,
                      }}>
                      {isChExpanded ? '▾' : '▸'}
                    </span>
                    {/* Chapter name — selectable */}
                    <span
                      className="kp-tree-chapter-row"
                      onClick={() => onSelectChapter?.(vol, ch)}
                      style={{
                        padding: '5px 16px 5px 0', cursor: 'pointer', fontSize: 12,
                        color: isSelected ? ACCENT : '#555', flex: 1,
                        background: isSelected ? ACCENT_BG : 'transparent',
                        borderLeft: isSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                        fontWeight: isSelected ? 600 : 400,
                      }}>
                      {ch}
                    </span>
                  </div>
                  {isChExpanded && sections.map(sec => {
                    const secKey = `${vol}||${ch}||${sec}`;
                    const isSecSelected = selectedSectionKey === secKey;
                    const isSecExpanded = expandedSections.has(secKey);
                    const kpsInSec = sectionKps[secKey] || [];
                    return (
                      <div key={secKey}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          {/* Arrow — expand/collapse toggle */}
                          <span
                            className="kp-tree-section-toggle"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSections(prev => {
                                const n = new Set(prev);
                                isSecExpanded ? n.delete(secKey) : n.add(secKey);
                                return n;
                              });
                            }}
                            style={{
                              padding: '4px 0 4px 56px', cursor: 'pointer', fontSize: 10,
                              color: '#aaa', flexShrink: 0,
                            }}>
                            {isSecExpanded ? '▾' : '▸'}
                          </span>
                          {/* Section name — selectable */}
                          <span
                            className="kp-tree-section-row"
                            onClick={() => onSelectSection?.(vol, ch, sec)}
                            style={{
                              padding: '4px 16px 4px 0', cursor: 'pointer', fontSize: 11,
                              color: isSecSelected ? ACCENT : '#777', flex: 1,
                              background: isSecSelected ? ACCENT_BG : 'transparent',
                              borderLeft: isSecSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                              fontWeight: isSecSelected ? 600 : 400,
                            }}>
                            {sec}
                          </span>
                        </div>
                        {isSecExpanded && kpsInSec.map(kp => {
                          const isSelected = selectedKpId === kp.id;
                          const dotColor = hasKpContent(kp) ? masteryColor(kp.mastery) : '#888';
                          return (
                            <div
                              className="kp-tree-kp-row"
                              key={kp.id}
                              onClick={() => onSelectKp(kp.id)}
                              style={{
                                padding: '4px 16px 4px 72px', cursor: 'pointer', fontSize: 12,
                                color: isSelected ? ACCENT : '#333',
                                background: isSelected ? ACCENT_BG : 'transparent',
                                borderLeft: isSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              }}>
                              <span className="kp-tree-kp-name">{kp.name}</span>
                              <span className="kp-tree-kp-mastery" style={{
                                fontSize: 10, fontWeight: 600, color: dotColor,
                                minWidth: 28, textAlign: 'right',
                              }}>
                                {hasKpContent(kp) ? masteryLabel(kp.mastery) : '待补充'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
