import { useState } from 'react';
import { VOLUME_COLORS, VOLUME_ORDER, CHAPTER_ORDER, chapterLabel } from './labels';

export interface KpTreeNode {
  id: string;
  name: string;
  volume?: string;
  chapter?: string;
  section?: string;
}

interface KpTreeProps {
  kps: KpTreeNode[];
  selectedKpId: string | null;
  onSelectKp: (id: string) => void;
  selectedVolumeKey?: string | null;
  onSelectVolume?: (vol: string) => void;
  selectedChapterKey?: string | null;
  onSelectChapter?: (vol: string, ch: string) => void;
  selectedSectionKey?: string | null;
  onSelectSection?: (vol: string, ch: string, sec: string) => void;
  badgeCount?: Record<string, number>;
  initialVolume?: string;
  dark?: boolean;
}

export default function KpTree({
  kps, selectedKpId, onSelectKp,
  selectedVolumeKey, onSelectVolume,
  selectedChapterKey, onSelectChapter,
  selectedSectionKey, onSelectSection,
  badgeCount, initialVolume, dark,
}: KpTreeProps) {
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(
    new Set(initialVolume ? [initialVolume] : ['必修 第一册'])
  );
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Colors
  const ACCENT = dark ? '#14919b' : '#0d7377';
  const ACCENT_BG = dark ? '#14919b22' : '#e0f5f6';
  const TEXT = dark ? '#c8ccd4' : '#333';
  const TEXT_DIM = dark ? '#8892a4' : '#555';
  const TEXT_MUTED = dark ? '#5c6370' : '#777';
  const BADGE_BG = dark ? '#2a2d35' : '#f0f0f0';
  const BADGE_COLOR = dark ? '#8892a4' : '#999';

  // Build tree
  const vt: Record<string, Record<string, { name: string; sections: string[] }>> = {};
  const sectionKps: Record<string, KpTreeNode[]> = {};
  // Count KPs per chapter and section for badges
  const chapterCounts: Record<string, number> = {};
  const sectionCounts: Record<string, number> = {};

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
    // Count
    const chKey = `${vol}||${ch}`;
    chapterCounts[chKey] = (chapterCounts[chKey] || 0) + 1;
    sectionCounts[secKey] = (sectionCounts[secKey] || 0) + 1;
  }

  const sortedVolumes = Object.keys(vt).sort(
    (a, b) => (VOLUME_ORDER[a] || 99) - (VOLUME_ORDER[b] || 99)
  );

  return (
    <>
      {sortedVolumes.map(vol => {
        const chapters = vt[vol];
        const isVolSelected = selectedVolumeKey === vol;
        const isVolExpanded = expandedVolumes.has(vol);
        const chapterNames = Object.keys(chapters).sort(
          (a, b) => (CHAPTER_ORDER[a] || 99) - (CHAPTER_ORDER[b] || 99)
        );
        return (
          <div key={vol}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span
                onClick={() => setExpandedVolumes(prev => {
                  const n = new Set(prev);
                  isVolExpanded ? n.delete(vol) : n.add(vol);
                  return n;
                })}
                style={{
                  padding: '6px 0 6px 12px', cursor: 'pointer', fontSize: 10,
                  color: TEXT_MUTED, flexShrink: 0,
                }}>
                {isVolExpanded ? '▾' : '▸'}
              </span>
              <span
                onClick={() => onSelectVolume?.(vol)}
                style={{
                  padding: '6px 12px 6px 4px', cursor: 'pointer', fontSize: 13, fontWeight: isVolSelected ? 800 : 600,
                  color: isVolSelected ? ACCENT : (dark ? '#e0e3e8' : '#333'),
                  background: isVolSelected ? ACCENT_BG : 'transparent',
                  borderLeft: isVolSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: VOLUME_COLORS[vol] || '#999', marginRight: 4,
              }} />
              {vol}
              </span>
            </div>
            {isVolExpanded && chapterNames.map(ch => {
              const chKey = `${vol}||${ch}`;
              const isSelected = selectedChapterKey === chKey;
              const isChExpanded = expandedChapters.has(chKey);
              const sections = chapters[ch].sections;
              return (
                <div key={chKey}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span
                      onClick={() => setExpandedChapters(prev => {
                        const n = new Set(prev);
                        isChExpanded ? n.delete(chKey) : n.add(chKey);
                        return n;
                      })}
                      style={{
                        padding: '4px 0 4px 40px', cursor: 'pointer', fontSize: 10,
                        color: TEXT_MUTED, flexShrink: 0,
                      }}>
                      {isChExpanded ? '▾' : '▸'}
                    </span>
                    <span
                      onClick={() => onSelectChapter?.(vol, ch)}
                      style={{
                        padding: '4px 16px 4px 0', cursor: 'pointer', fontSize: 12,
                        color: isSelected ? ACCENT : TEXT_DIM, flex: 1,
                        background: isSelected ? ACCENT_BG : 'transparent',
                        borderLeft: isSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                        fontWeight: isSelected ? 600 : 400,
                      }}>
                      {chapterLabel(ch)}
                      {chapterCounts[chKey] != null && (
                        <span style={{
                          fontSize: 10, color: BADGE_COLOR, marginLeft: 6,
                          background: BADGE_BG, borderRadius: 8, padding: '0 5px',
                        }}>
                          {chapterCounts[chKey]}
                        </span>
                      )}
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
                          <span
                            onClick={() => setExpandedSections(prev => {
                              const n = new Set(prev);
                              isSecExpanded ? n.delete(secKey) : n.add(secKey);
                              return n;
                            })}
                            style={{
                              padding: '3px 0 3px 56px', cursor: 'pointer', fontSize: 10,
                              color: TEXT_MUTED, flexShrink: 0,
                            }}>
                            {isSecExpanded ? '▾' : '▸'}
                          </span>
                          <span
                            onClick={() => onSelectSection?.(vol, ch, sec)}
                            style={{
                              padding: '3px 16px 3px 0', cursor: 'pointer', fontSize: 11,
                              color: isSecSelected ? ACCENT : TEXT_MUTED, flex: 1,
                              background: isSecSelected ? ACCENT_BG : 'transparent',
                              borderLeft: isSecSelected ? `3px solid ${ACCENT}` : '3px solid transparent',
                              fontWeight: isSecSelected ? 600 : 400,
                            }}>
                            {sec}
                            {sectionCounts[secKey] != null && (
                              <span style={{
                                fontSize: 10, color: BADGE_COLOR, marginLeft: 4,
                                background: BADGE_BG, borderRadius: 8, padding: '0 5px',
                              }}>
                                {sectionCounts[secKey]}
                              </span>
                            )}
                          </span>
                        </div>
                        {isSecExpanded && kpsInSec.map(kp => (
                          <div key={kp.id} onClick={() => onSelectKp(kp.id)}
                            style={{
                              padding: '4px 16px 4px 72px', cursor: 'pointer', fontSize: 12,
                              color: selectedKpId === kp.id ? ACCENT : TEXT,
                              background: selectedKpId === kp.id ? ACCENT_BG : 'transparent',
                              borderLeft: selectedKpId === kp.id ? `3px solid ${ACCENT}` : '3px solid transparent',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                            <span>{kp.name}</span>
                            {badgeCount && badgeCount[kp.id] != null && (
                              <span style={{
                                fontSize: 10, color: BADGE_COLOR, background: BADGE_BG,
                                borderRadius: 8, padding: '0 5px',
                              }}>
                                {badgeCount[kp.id]}
                              </span>
                            )}
                          </div>
                        ))}
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
