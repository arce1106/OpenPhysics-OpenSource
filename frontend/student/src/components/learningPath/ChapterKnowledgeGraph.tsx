import type { DirectoryKpNode, DirectoryRelation, KnowledgeMasteryJudgment } from '../../types';
import { mapKnowledgeMasteryJudgmentToMasteryDisplay } from '../../utils/knowledgeMasteryJudgment';
import { getLearningKpStatus } from './learningKpStatus';
import { buildChapterKnowledgeMap } from './knowledgePathModel';
import { hasKpContent } from '../../utils/learningAccess';

interface ChapterKnowledgeGraphProps {
  kps: DirectoryKpNode[];
  relations?: DirectoryRelation[];
  recommendedKpId?: string | null;
  masteryJudgments?: Record<string, KnowledgeMasteryJudgment>;
  masteryJudgmentsLoading?: boolean;
  onOpenKp: (kpId: string) => void;
  className?: string;
}

interface GraphNode {
  kp: DirectoryKpNode;
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
}

type GraphMasteryTone = 'pending' | 'weak' | 'developing' | 'stable' | 'mastered';

const GRAPH_ROWS = 3;
const GRAPH_NODE_WIDTH = 148;
const GRAPH_NODE_HEIGHT = 96;
const GRAPH_NODE_DOT_SIZE = 62;
const GRAPH_COLUMN_GAP = 58;
const GRAPH_ROW_GAP = 20;
const GRAPH_PADDING_X = 22;
const GRAPH_PADDING_Y = 42;

const GRAPH_OFFSETS = [
  { x: 0, y: 10 },
  { x: 16, y: -8 },
  { x: -12, y: 14 },
  { x: 18, y: 6 },
  { x: -8, y: -18 },
  { x: 12, y: 12 },
  { x: -16, y: 0 },
  { x: 8, y: -10 },
];

function buildGraphNodes(kps: DirectoryKpNode[]): GraphNode[] {
  return kps.map((kp, index) => {
    const col = Math.floor(index / GRAPH_ROWS);
    const row = index % GRAPH_ROWS;
    const offset = GRAPH_OFFSETS[index % GRAPH_OFFSETS.length];

    return {
      kp,
      index,
      row,
      col,
      x: GRAPH_PADDING_X + col * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP) + offset.x,
      y: GRAPH_PADDING_Y + row * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP) + offset.y,
    };
  });
}

function graphDimensions(nodes: GraphNode[]) {
  if (nodes.length === 0) return { width: 0, height: 0 };
  const maxX = Math.max(...nodes.map(node => node.x));
  const maxY = Math.max(...nodes.map(node => node.y));
  return {
    width: maxX + GRAPH_NODE_WIDTH + GRAPH_PADDING_X,
    height: maxY + GRAPH_NODE_HEIGHT + GRAPH_PADDING_Y,
  };
}

function nodeCenter(node: GraphNode) {
  return {
    x: node.x + GRAPH_NODE_WIDTH / 2,
    y: node.y + GRAPH_NODE_DOT_SIZE / 2,
  };
}

function topologyPath(from: GraphNode, to: GraphNode) {
  const start = nodeCenter(from);
  const end = nodeCenter(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const curve = Math.min(58, Math.max(18, Math.abs(dx) * 0.12 + Math.abs(dy) * 0.08));
  const sweep = from.index % 2 === 0 ? -curve : curve;
  const controlA = {
    x: start.x + dx * 0.42,
    y: start.y + dy * 0.28 + sweep,
  };
  const controlB = {
    x: start.x + dx * 0.62,
    y: start.y + dy * 0.72 - sweep,
  };
  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
}

function fallbackRelations(kps: DirectoryKpNode[]): DirectoryRelation[] {
  const knowledgeMap = buildChapterKnowledgeMap([{ id: 'chapter-network', title: '本章知识网', kps, masteredCount: 0, avgMastery: 0 }]);
  return knowledgeMap.nodes.flatMap((node, index) => {
    return node.dependencies.map((sourceId, dependencyIndex) => ({
      id: -(index * 100 + dependencyIndex + 1),
      source_id: sourceId,
      target_id: node.kp.id,
      relation_type: 'fallback_prerequisite',
      reason: null,
    }));
  });
}

function buildSectionMarkers(nodes: GraphNode[]) {
  const seen = new Set<string>();
  return nodes.flatMap(node => {
    const section = node.kp.section?.trim();
    if (!section || seen.has(section)) return [];
    seen.add(section);
    return [{ section, node }];
  });
}

function graphMasteryToneFor(
  pct: number | null | undefined,
  pending: boolean,
): GraphMasteryTone {
  if (pending) return 'pending';
  if (typeof pct !== 'number') return 'pending';
  if (pct < 40) return 'weak';
  if (pct < 70) return 'developing';
  // 80% is the backend's single "已掌握" threshold (learning state and judgment).
  if (pct < 80) return 'stable';
  return 'mastered';
}

export default function ChapterKnowledgeGraph({
  kps,
  relations = [],
  recommendedKpId,
  masteryJudgments = {},
  masteryJudgmentsLoading = false,
  onOpenKp,
  className = '',
}: ChapterKnowledgeGraphProps) {
  const nodes = buildGraphNodes(kps);
  const dimensions = graphDimensions(nodes);
  const nodeById = new Map(nodes.map(node => [node.kp.id, node]));
  const sectionMarkers = buildSectionMarkers(nodes);
  const kpIds = new Set(kps.map(kp => kp.id));
  const scopedRelations = relations.filter(relation => {
    return kpIds.has(relation.source_id)
      && kpIds.has(relation.target_id)
      && relation.source_id !== relation.target_id;
  });
  const visibleRelations = scopedRelations.length > 0 ? scopedRelations : fallbackRelations(kps);
  const topologyEdges = visibleRelations
    .map(relation => {
      const source = nodeById.get(relation.source_id);
      const target = nodeById.get(relation.target_id);
      return source && target ? { from: source, to: target, relation } : null;
    })
    .filter((edge): edge is { from: GraphNode; to: GraphNode; relation: DirectoryRelation } => Boolean(edge));

  return (
    <section className={`sync-chapter-graph${className ? ` ${className}` : ''}`}>
      {nodes.length > 0 && <div className="sync-mastery-legend" role="group" aria-label="掌握度颜色图例">
        <strong>掌握度</strong>
        <span className="mastery-weak"><i aria-hidden="true" />0–39%</span>
        <span className="mastery-developing"><i aria-hidden="true" />40–69%</span>
        <span className="mastery-stable"><i aria-hidden="true" />70–79%</span>
        <span className="mastery-mastered"><i aria-hidden="true" />80–100%</span>
      </div>}
      {nodes.length === 0 ? (
        <div className="sync-empty-text">从左侧选择章节后查看知识图谱。</div>
      ) : (
        <div className="sync-graph-scroll">
          <div className="sync-graph-board">
            <div
              className="sync-graph-network"
              style={{ width: dimensions.width, height: dimensions.height }}
            >
              <svg
                className="sync-graph-network-lines"
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="sync-graph-arrow"
                    markerHeight="8"
                    markerWidth="8"
                    orient="auto"
                    refX="7"
                    refY="4"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {topologyEdges.map(edge => (
                  <path
                    className={`sync-graph-network-line is-topology relation-${edge.relation.relation_type}`}
                    d={topologyPath(edge.from, edge.to)}
                    key={`t-${edge.relation.id}-${edge.from.kp.id}-${edge.to.kp.id}`}
                    markerEnd="url(#sync-graph-arrow)"
                  />
                ))}
              </svg>
              {nodes.map(node => {
                const contentPending = !hasKpContent(node.kp);
                const status = getLearningKpStatus(node.kp);
                const fallbackPct = Math.round(node.kp.mastery * 100);
                const judgment = masteryJudgments[node.kp.id];
                const pendingJudgment = !contentPending && masteryJudgmentsLoading && !judgment;
                const judgmentBadge = mapKnowledgeMasteryJudgmentToMasteryDisplay(judgment, {
                  label: status.label,
                  reason: status.label,
                  tone: status.tone,
                  masteryPct: fallbackPct,
                });
                const recommended = !contentPending && recommendedKpId === node.kp.id;
                const pct = contentPending || pendingJudgment ? null : judgmentBadge.masteryPct ?? fallbackPct;
                const label = contentPending ? '内容待补充' : pendingJudgment
                  ? '更新中'
                  : recommended && judgment && judgment.confidence !== 'low'
                    ? `推荐 · ${judgmentBadge.label}`
                    : recommended && !judgment
                      ? '推荐'
                      : judgmentBadge.label;
                const masteryTone = graphMasteryToneFor(pct, contentPending || pendingJudgment);
                const title = contentPending ? `${node.kp.name}，内容待补充` : pendingJudgment
                  ? `${node.kp.name}，掌握判断更新中`
                  : `${node.kp.name}，${label}，掌握度 ${pct}%`;

                return (
                  <div
                    className="sync-graph-network-node"
                    key={node.kp.id}
                    style={{ left: node.x, top: node.y }}
                  >
                    <button
                      type="button"
                      className={`sync-graph-node tone-${judgmentBadge.tone} mastery-${masteryTone}${recommended ? ' is-recommended' : ''}`}
                      onClick={() => onOpenKp(node.kp.id)}
                      title={title}
                    >
                      <span className="sync-graph-node-core">
                        <b>{contentPending ? '待补充' : pendingJudgment ? '…' : `${pct}%`}</b>
                      </span>
                      <span className="sync-graph-node-title">{node.kp.name}</span>
                      <span className="sync-graph-node-meta">
                        <i aria-hidden="true" />
                        {label}
                      </span>
                    </button>
                  </div>
                );
              })}
              {sectionMarkers.map(({ section, node }) => (
                <div
                  className="sync-graph-section-marker"
                  key={section}
                  style={{
                    left: node.x + GRAPH_NODE_WIDTH / 2,
                    top: 8,
                  }}
                >
                  {section}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
