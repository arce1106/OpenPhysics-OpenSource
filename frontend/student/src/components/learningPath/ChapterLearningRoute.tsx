import type { DirectoryKpNode } from '../../types';
import { firstKpByLearningState, getLearningKpStatus } from './learningKpStatus';

interface ChapterLearningRouteProps {
  kps: DirectoryKpNode[];
  recommendedKpId?: string | null;
  activeKpId?: string | null;
  onOpenKp: (kpId: string) => void;
  onToggleFullGraph?: () => void;
  fullGraphExpanded?: boolean;
  className?: string;
}

const MAX_RECOMMENDED_PATH_NODES = 6;

function pickFallbackStartIndex(kps: DirectoryKpNode[]) {
  const fallback = firstKpByLearningState(kps, ['learning', 'practice', 'to_learn', 'locked']);
  return fallback ? kps.indexOf(fallback) : 0;
}

function pickRecommendedPath(kps: DirectoryKpNode[], recommendedKpId?: string | null) {
  if (kps.length <= MAX_RECOMMENDED_PATH_NODES) {
    return { nodes: kps, hiddenCount: 0 };
  }

  const recommendedIndex = recommendedKpId
    ? kps.findIndex(kp => kp.id === recommendedKpId)
    : -1;
  const anchor = recommendedIndex >= 0 ? recommendedIndex : pickFallbackStartIndex(kps);
  const halfWindow = Math.floor(MAX_RECOMMENDED_PATH_NODES / 2);
  let start = Math.max(0, anchor - halfWindow);
  const maxStart = Math.max(0, kps.length - MAX_RECOMMENDED_PATH_NODES);
  start = Math.min(start, maxStart);
  const nodes = kps.slice(start, start + MAX_RECOMMENDED_PATH_NODES);

  return {
    nodes,
    hiddenCount: Math.max(0, kps.length - nodes.length),
  };
}

export default function ChapterLearningRoute({
  kps,
  recommendedKpId,
  activeKpId,
  onOpenKp,
  onToggleFullGraph,
  fullGraphExpanded = false,
  className = '',
}: ChapterLearningRouteProps) {
  const { nodes, hiddenCount } = pickRecommendedPath(kps, recommendedKpId);

  return (
    <section className={`sync-recommended-path-card${className ? ` ${className}` : ''}`}>
      <div className="sync-recommended-path-header">
        <div>
          <span>本章推荐学习路径</span>
          <h2>按顺序理解核心概念</h2>
          <p>点击知识点切换上方学习入口，完整关系可展开查看。</p>
        </div>
        {onToggleFullGraph && (
          <button type="button" onClick={onToggleFullGraph}>
            {fullGraphExpanded ? '收起完整知识图谱' : '查看完整知识图谱'}
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div className="sync-empty-text">从左侧选择章节后查看推荐学习路径。</div>
      ) : (
        <div className="sync-recommended-path-line">
          {nodes.map((kp, index) => {
            const status = getLearningKpStatus(kp);
            const recommended = recommendedKpId === kp.id;
            const active = activeKpId === kp.id;
            return (
              <div className="sync-recommended-path-segment" key={kp.id}>
                {index > 0 && <span className="sync-recommended-path-arrow">→</span>}
                <button
                  type="button"
                  className={`sync-recommended-path-node tone-${status.tone}${recommended ? ' is-recommended' : ''}${active ? ' is-active' : ''}`}
                  onClick={() => onOpenKp(kp.id)}
                >
                  <span>{kp.name}</span>
                  <small>{active ? '当前选择' : recommended ? '推荐' : status.label}</small>
                </button>
              </div>
            );
          })}
          {hiddenCount > 0 && <div className="sync-path-more">+ {hiddenCount} 个知识点</div>}
        </div>
      )}
    </section>
  );
}
