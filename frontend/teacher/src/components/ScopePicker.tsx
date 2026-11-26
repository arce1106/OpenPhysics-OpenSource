import { useEffect, useMemo, useRef, useState } from 'react';
import { VOLUME_COLORS, VOLUME_ORDER, chapterRank, sectionRank } from '../catalog';
import type { KnowledgePointOption, OutlineCounts } from '../types';

export interface ScopeEntry {
  volume: string;
  chapter?: string;
  section?: string;
}

interface Chapter {
  chapter: string;
  /** Empty when the chapter has no sections in the bank. */
  sections: string[];
}

export interface Volume {
  volume: string;
  chapters: Chapter[];
}

const SEP = '||';
const leafKey = (volume: string, chapter: string, section: string) => [volume, chapter, section].join(SEP);

export function buildCatalog(points: KnowledgePointOption[]): Volume[] {
  const volumes = new Map<string, Map<string, Set<string>>>();
  for (const kp of points) {
    if (!kp.volume || !kp.chapter) continue;
    if (!volumes.has(kp.volume)) volumes.set(kp.volume, new Map());
    const chapters = volumes.get(kp.volume)!;
    if (!chapters.has(kp.chapter)) chapters.set(kp.chapter, new Set());
    if (kp.section) chapters.get(kp.chapter)!.add(kp.section);
  }
  return [...volumes.entries()]
    .sort(([a], [b]) => (VOLUME_ORDER[a] ?? 99) - (VOLUME_ORDER[b] ?? 99))
    .map(([volume, chapters]) => ({
      volume,
      chapters: [...chapters.entries()]
        .sort(([a], [b]) => chapterRank(a) - chapterRank(b) || a.localeCompare(b, 'zh-CN'))
        .map(([chapter, sections]) => ({
          chapter,
          sections: [...sections].sort((a, b) => sectionRank(a) - sectionRank(b) || a.localeCompare(b, 'zh-CN')),
        })),
    }));
}

/** The smallest leaves of a chapter: its sections, or the chapter itself when it has none. */
function chapterLeaves(volume: string, chapter: Chapter): string[] {
  return chapter.sections.length
    ? chapter.sections.map((section) => leafKey(volume, chapter.chapter, section))
    : [leafKey(volume, chapter.chapter, '')];
}

function volumeLeaves(volume: Volume): string[] {
  return volume.chapters.flatMap((chapter) => chapterLeaves(volume.volume, chapter));
}

/** Whole volumes and chapters collapse to one entry; a partly picked chapter lists its sections. */
export function scopeFromPicks(catalog: Volume[], picked: Set<string>): ScopeEntry[] {
  const scope: ScopeEntry[] = [];
  for (const volume of catalog) {
    if (volumeLeaves(volume).every((leaf) => picked.has(leaf))) {
      scope.push({ volume: volume.volume });
      continue;
    }
    for (const chapter of volume.chapters) {
      const leaves = chapterLeaves(volume.volume, chapter);
      if (leaves.every((leaf) => picked.has(leaf))) {
        scope.push({ volume: volume.volume, chapter: chapter.chapter });
      } else {
        for (const section of chapter.sections) {
          if (picked.has(leafKey(volume.volume, chapter.chapter, section))) {
            scope.push({ volume: volume.volume, chapter: chapter.chapter, section });
          }
        }
      }
    }
  }
  return scope;
}

/** "必修 第一册" → "必修一", for the summary line. */
function shortVolume(volume: string): string {
  return volume.replace(/\s*第([一二三])册/, '$1').replace('选择性必修', '选必');
}

export function scopeLabel(entry: ScopeEntry): string {
  if (entry.section) return `${shortVolume(entry.volume)} ${entry.section}`;
  if (entry.chapter) return `${shortVolume(entry.volume)} ${entry.chapter}`;
  return `${entry.volume}（整册）`;
}

function TriCheckbox({ label, state, onChange }: {
  label: string;
  state: 'all' | 'some' | 'none';
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === 'all'} onChange={onChange} />;
}

/**
 * The textbook catalogue as on the test composer's left, with a box on each row: tick a
 * volume, chapter or section; open a row to go one level down.
 */
/** How many approved questions a row holds, so the teacher can tell whether a scope has enough. */
function Count({ value }: { value: number | undefined }) {
  return value == null ? null : <span className="tree-count">{value}</span>;
}

export default function ScopePicker({ points, picked, onPicked, counts = null, onBrowse }: {
  points: KnowledgePointOption[];
  picked: Set<string>;
  onPicked: (next: Set<string>) => void;
  counts?: OutlineCounts | null;
  /** Clicking a row's name also shows its questions in the bank beside the catalogue. */
  onBrowse?: (scope: ScopeEntry) => void;
}) {
  const catalog = useMemo(() => buildCatalog(points), [points]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const stateOf = (leaves: string[]) => {
    const count = leaves.filter((leaf) => picked.has(leaf)).length;
    return count === 0 ? 'none' : count === leaves.length ? 'all' : 'some';
  };
  const toggleLeaves = (leaves: string[]) => {
    const next = new Set(picked);
    const all = leaves.every((leaf) => next.has(leaf));
    for (const leaf of leaves) {
      if (all) next.delete(leaf);
      else next.add(leaf);
    }
    onPicked(next);
  };
  const toggleOpen = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <aside className="catalog scope-catalog" aria-label="教材目录">
      <div className="catalog-head">
        <strong>教材目录</strong>
        <span>勾选册、章或节作为出题范围</span>
      </div>
      <div className="catalog-body">
        {catalog.length === 0 && <p className="catalog-empty">正在加载教材目录…</p>}
        {catalog.map((volume) => {
          const leaves = volumeLeaves(volume);
          const isOpen = open.has(volume.volume);
          return (
            <div key={volume.volume}>
              <div className="tree-line">
                <button type="button" className="tree-toggle" aria-expanded={isOpen}
                  aria-label={`${isOpen ? '收起' : '展开'}${volume.volume}`}
                  onClick={() => toggleOpen(volume.volume)}>{isOpen ? '▾' : '▸'}</button>
                <TriCheckbox label={volume.volume} state={stateOf(leaves)} onChange={() => toggleLeaves(leaves)} />
                <button type="button" className="tree-row level-1"
                  onClick={() => { toggleOpen(volume.volume); onBrowse?.({ volume: volume.volume }); }}>
                  <span className="volume-dot" style={{ background: VOLUME_COLORS[volume.volume] ?? '#999' }} />
                  {volume.volume}<Count value={counts?.volumes[volume.volume]} />
                </button>
              </div>
              {isOpen && volume.chapters.map((chapter) => {
                const chapterKey = `${volume.volume}${SEP}${chapter.chapter}`;
                const chapterOpen = open.has(chapterKey);
                const chapterLeafKeys = chapterLeaves(volume.volume, chapter);
                return (
                  <div key={chapterKey}>
                    <div className="tree-line indent-1">
                      {chapter.sections.length > 0 ? (
                        <button type="button" className="tree-toggle" aria-expanded={chapterOpen}
                          aria-label={`${chapterOpen ? '收起' : '展开'}${chapter.chapter}`}
                          onClick={() => toggleOpen(chapterKey)}>{chapterOpen ? '▾' : '▸'}</button>
                      ) : <span className="tree-toggle" aria-hidden />}
                      <TriCheckbox label={chapter.chapter} state={stateOf(chapterLeafKeys)}
                        onChange={() => toggleLeaves(chapterLeafKeys)} />
                      <button type="button" className="tree-row level-2"
                        onClick={() => {
                          if (chapter.sections.length) toggleOpen(chapterKey);
                          else toggleLeaves(chapterLeafKeys);
                          onBrowse?.({ volume: volume.volume, chapter: chapter.chapter });
                        }}>
                        {chapter.chapter}<Count value={counts?.chapters[chapterKey]} />
                      </button>
                    </div>
                    {chapterOpen && chapter.sections.map((section) => {
                      const leaf = leafKey(volume.volume, chapter.chapter, section);
                      return (
                        <label key={leaf} className="tree-line indent-2 scope-section">
                          <span className="tree-toggle" aria-hidden />
                          <input type="checkbox" checked={picked.has(leaf)} onChange={() => toggleLeaves([leaf])} />
                          <span className="tree-row level-3">{section}<Count value={counts?.sections[leaf]} /></span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
