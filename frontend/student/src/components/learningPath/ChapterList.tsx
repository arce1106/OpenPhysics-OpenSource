interface ChapterListProps<T> {
  chapters: T[];
  activeChapterKey?: string | null;
  getKey: (chapter: T) => string;
  getTitle: (chapter: T) => string;
  getMeta?: (chapter: T, index: number) => string;
  getStatus?: (chapter: T) => string;
  getMasteryPercent?: (chapter: T) => number;
  onSelectChapter: (chapter: T) => void;
  className?: string;
  emptyText?: string;
}

export default function ChapterList<T>({
  chapters,
  activeChapterKey,
  getKey,
  getTitle,
  getMeta,
  getStatus,
  getMasteryPercent,
  onSelectChapter,
  className = '',
  emptyText = '暂无章节数据',
}: ChapterListProps<T>) {
  return (
    <div className={`learning-chapter-list${className ? ` ${className}` : ''}`}>
      {chapters.length === 0 ? (
        <div className="learning-chapter-empty">{emptyText}</div>
      ) : chapters.map((chapter, index) => {
        const key = getKey(chapter);
        const active = activeChapterKey === key;
        const percent = Math.max(0, Math.min(100, Math.round(getMasteryPercent?.(chapter) ?? 0)));
        return (
          <button
            key={key}
            type="button"
            className={`learning-chapter-item${active ? ' is-active' : ''}`}
            onClick={() => onSelectChapter(chapter)}
          >
            <div className="learning-chapter-item-main">
              <div className="learning-chapter-item-copy">
                {getMeta && <span className="learning-chapter-meta">{getMeta(chapter, index)}</span>}
                <span className="learning-chapter-title">{getTitle(chapter)}</span>
              </div>
              {getStatus && <span className="learning-chapter-status">{getStatus(chapter)}</span>}
            </div>
            <div className="learning-chapter-progress" aria-hidden="true">
              <span className="learning-chapter-track">
                <span style={{ width: `${percent}%` }} />
              </span>
              <span className="learning-chapter-percent">{percent}%</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
