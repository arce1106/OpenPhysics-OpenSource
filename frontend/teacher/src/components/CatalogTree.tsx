import { useMemo, useState } from 'react';
import { VOLUME_COLORS, VOLUME_ORDER, chapterRank, sectionRank } from '../catalog';
import type { KnowledgePointOption, OutlineCounts, QuestionFilters } from '../types';

export type CatalogScope = Pick<QuestionFilters, 'volume' | 'chapter' | 'section' | 'kp_id'>;

interface Tree {
  volume: string;
  chapters: Array<{ chapter: string; sections: Array<{ section: string; points: KnowledgePointOption[] }> }>;
}

function buildTree(points: KnowledgePointOption[]): Tree[] {
  const volumes = new Map<string, Map<string, Map<string, KnowledgePointOption[]>>>();
  for (const kp of points) {
    const volume = kp.volume || '未分册';
    const chapter = kp.chapter || '未分章';
    const section = kp.section || '未分节';
    if (!volumes.has(volume)) volumes.set(volume, new Map());
    const chapters = volumes.get(volume)!;
    if (!chapters.has(chapter)) chapters.set(chapter, new Map());
    const sections = chapters.get(chapter)!;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(kp);
  }
  return [...volumes.entries()]
    .sort(([a], [b]) => (VOLUME_ORDER[a] ?? 99) - (VOLUME_ORDER[b] ?? 99))
    .map(([volume, chapters]) => ({
      volume,
      chapters: [...chapters.entries()]
        .sort(([a], [b]) => chapterRank(a) - chapterRank(b) || a.localeCompare(b, 'zh-CN'))
        .map(([chapter, sections]) => ({
          chapter,
          sections: [...sections.entries()]
            .sort(([a], [b]) => sectionRank(a) - sectionRank(b) || a.localeCompare(b, 'zh-CN'))
            .map(([section, kps]) => ({ section, points: kps })),
        })),
    }));
}

function Count({ value }: { value: number | undefined }) {
  return value ? <span className="tree-count">{value}</span> : null;
}

/** Textbook catalogue with approved-question counts; picking any level scopes the question list. */
export default function CatalogTree({
  points,
  counts,
  scope,
  onScope,
}: {
  points: KnowledgePointOption[];
  counts: OutlineCounts | null;
  scope: CatalogScope;
  onScope: (scope: CatalogScope) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['必修 第一册']));
  const term = keyword.trim();
  const tree = useMemo(
    () => buildTree(term ? points.filter((kp) => kp.name.includes(term)) : points),
    [points, term],
  );

  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const expanded = (key: string) => Boolean(term) || open.has(key);
  const selected = (target: CatalogScope) =>
    scope.volume === target.volume && scope.chapter === target.chapter
    && scope.section === target.section && scope.kp_id === target.kp_id;
  // A question on several knowledge points counts once overall, as the question list does.
  const total = counts ? counts.total ?? Object.values(counts.volumes).reduce((sum, n) => sum + n, 0) : undefined;

  return (
    <aside className="catalog" aria-label="教材目录">
      <div className="catalog-head">
        <strong>教材目录</strong>
        <span>按章节和知识点选题</span>
      </div>
      <div className="catalog-search">
        <input aria-label="搜索知识点" placeholder="搜索知识点" value={keyword}
          onChange={(event) => setKeyword(event.target.value)} />
      </div>
      <div className="catalog-body">
        <button type="button" className={`tree-row level-0${selected({}) ? ' selected' : ''}`} onClick={() => onScope({})}>
          全部<Count value={total} />
        </button>
        {tree.map(({ volume, chapters }) => (
          <div key={volume}>
            <div className="tree-line">
              <button type="button" className="tree-toggle" aria-label={`${expanded(volume) ? '收起' : '展开'}${volume}`}
                onClick={() => toggle(volume)}>{expanded(volume) ? '▾' : '▸'}</button>
              <button type="button" className={`tree-row level-1${selected({ volume }) ? ' selected' : ''}`}
                onClick={() => onScope({ volume })}>
                <span className="volume-dot" style={{ background: VOLUME_COLORS[volume] ?? '#999' }} />
                {volume}<Count value={counts?.volumes[volume]} />
              </button>
            </div>
            {expanded(volume) && chapters.map(({ chapter, sections }) => {
              const chapterKey = `${volume}||${chapter}`;
              return (
                <div key={chapterKey}>
                  <div className="tree-line indent-1">
                    <button type="button" className="tree-toggle" aria-label={`${expanded(chapterKey) ? '收起' : '展开'}${chapter}`}
                      onClick={() => toggle(chapterKey)}>{expanded(chapterKey) ? '▾' : '▸'}</button>
                    <button type="button" className={`tree-row level-2${selected({ volume, chapter }) ? ' selected' : ''}`}
                      onClick={() => onScope({ volume, chapter })}>
                      {chapter}<Count value={counts?.chapters[chapterKey]} />
                    </button>
                  </div>
                  {expanded(chapterKey) && sections.map(({ section, points: kps }) => {
                    const sectionKey = `${chapterKey}||${section}`;
                    return (
                      <div key={sectionKey}>
                        <div className="tree-line indent-2">
                          <button type="button" className="tree-toggle" aria-label={`${expanded(sectionKey) ? '收起' : '展开'}${section}`}
                            onClick={() => toggle(sectionKey)}>{expanded(sectionKey) ? '▾' : '▸'}</button>
                          <button type="button" className={`tree-row level-3${selected({ volume, chapter, section }) ? ' selected' : ''}`}
                            onClick={() => onScope({ volume, chapter, section })}>
                            {section}<Count value={counts?.sections[sectionKey]} />
                          </button>
                        </div>
                        {expanded(sectionKey) && kps.map((kp) => (
                          <button key={kp.id} type="button"
                            className={`tree-row level-4${selected({ kp_id: kp.id }) ? ' selected' : ''}`}
                            onClick={() => onScope({ kp_id: kp.id })}>
                            {kp.name}<Count value={counts?.points[kp.id]} />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
        {tree.length === 0 && <p className="catalog-empty">没有匹配的知识点</p>}
      </div>
    </aside>
  );
}
