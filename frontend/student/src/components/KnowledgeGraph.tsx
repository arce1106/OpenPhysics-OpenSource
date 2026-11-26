import type { CSSProperties } from 'react';
import type { DirectoryKpNode, DirectoryRelation } from '../types';
import { getLearningKpStatus } from './learningPath/learningKpStatus';

interface KnowledgeGraphProps {
  kps: DirectoryKpNode[];
  relations: DirectoryRelation[];
  selectedKpId?: string | null;
  onSelectKp: (kpId: string) => void;
}

interface NodePosition {
  x: number;
  y: number;
}

const NODE_WIDTH = 156;
const NODE_HEIGHT = 62;
const COLUMN_GAP = 74;
const ROW_GAP = 34;
const HEADER_HEIGHT = 38;
const PAD = 24;

function masteryColor(kp: DirectoryKpNode): string {
  const status = getLearningKpStatus(kp);
  if (status.tone === 'mastered') return '#2f9e44';
  if (status.tone === 'practice') return '#d48806';
  if (status.tone === 'learning') return '#14919b';
  return '#9aa4b2';
}

function relationStroke(relationType: string): string {
  if (relationType === 'prerequisite_of') return '#6b7f99';
  if (relationType === 'confused_with') return '#b06a6a';
  return '#8a94a6';
}

function relationDash(relationType: string): string | undefined {
  return relationType === 'sequence' ? '5 6' : undefined;
}

function buildFallbackRelations(kps: DirectoryKpNode[]): DirectoryRelation[] {
  return kps.slice(1).map((kp, index) => ({
    id: -index - 1,
    source_id: kps[index].id,
    target_id: kp.id,
    relation_type: 'sequence',
    reason: null,
  }));
}

function getSectionName(kp: DirectoryKpNode): string {
  return kp.section || '未分节';
}

export default function KnowledgeGraph({
  kps,
  relations,
  selectedKpId,
  onSelectKp,
}: KnowledgeGraphProps) {
  const sortedKps = [...kps].sort((a, b) => {
    const sectionCompare = getSectionName(a).localeCompare(getSectionName(b), 'zh-CN');
    if (sectionCompare !== 0) return sectionCompare;
    return a.id.localeCompare(b.id, 'zh-CN');
  });
  const sectionNames = Array.from(new Set(sortedKps.map(getSectionName)));
  const kpSet = new Set(sortedKps.map(kp => kp.id));
  const grouped = sectionNames.map(section => ({
    section,
    kps: sortedKps.filter(kp => getSectionName(kp) === section),
  }));

  const maxRows = Math.max(1, ...grouped.map(group => group.kps.length));
  const width = Math.max(
    620,
    PAD * 2 + grouped.length * NODE_WIDTH + Math.max(0, grouped.length - 1) * COLUMN_GAP,
  );
  const height = PAD * 2 + HEADER_HEIGHT + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP;

  const positions = new Map<string, NodePosition>();
  grouped.forEach((group, colIndex) => {
    const x = PAD + colIndex * (NODE_WIDTH + COLUMN_GAP);
    group.kps.forEach((kp, rowIndex) => {
      const y = PAD + HEADER_HEIGHT + rowIndex * (NODE_HEIGHT + ROW_GAP);
      positions.set(kp.id, { x, y });
    });
  });

  const scopedRelations = relations.filter(
    relation => kpSet.has(relation.source_id) && kpSet.has(relation.target_id),
  );
  const visibleRelations = scopedRelations.length > 0 ? scopedRelations : buildFallbackRelations(sortedKps);

  if (sortedKps.length === 0) {
    return (
      <div style={{
        padding: '18px 20px',
        borderRadius: 8,
        border: '1px solid #eef0f3',
        color: '#8c8c8c',
        fontSize: 13,
      }}>
        暂无知识点
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid #eef0f3',
      borderRadius: 8,
      background: '#fff',
      overflowX: 'auto',
      overflowY: 'hidden',
    }}>
      <div style={{ position: 'relative', width, height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <defs>
            <marker id="knowledge-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#6b7f99" />
            </marker>
          </defs>
          {visibleRelations.map((relation, index) => {
            const source = positions.get(relation.source_id);
            const target = positions.get(relation.target_id);
            if (!source || !target) return null;

            const startX = source.x + NODE_WIDTH;
            const startY = source.y + NODE_HEIGHT / 2;
            const endX = target.x;
            const endY = target.y + NODE_HEIGHT / 2;
            const midX = startX + Math.max(24, (endX - startX) / 2);
            const sameColumn = Math.abs(endX - startX) < 20;
            const path = sameColumn
              ? `M ${source.x + NODE_WIDTH / 2} ${source.y + NODE_HEIGHT} C ${source.x + NODE_WIDTH / 2} ${source.y + NODE_HEIGHT + 24}, ${target.x + NODE_WIDTH / 2} ${target.y - 24}, ${target.x + NODE_WIDTH / 2} ${target.y}`
              : `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;

            return (
              <path
                key={`${relation.source_id}-${relation.target_id}-${relation.id}-${index}`}
                d={path}
                fill="none"
                stroke={relationStroke(relation.relation_type)}
                strokeWidth="1.6"
                strokeDasharray={relationDash(relation.relation_type)}
                markerEnd="url(#knowledge-arrow)"
                opacity={relation.relation_type === 'sequence' ? 0.48 : 0.72}
              />
            );
          })}
        </svg>

        {grouped.map((group, colIndex) => (
          <div
            key={group.section}
            style={{
              position: 'absolute',
              left: PAD + colIndex * (NODE_WIDTH + COLUMN_GAP),
              top: PAD,
              width: NODE_WIDTH,
              fontSize: 12,
              fontWeight: 700,
              color: '#6f7b8a',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={group.section}
          >
            {group.section}
          </div>
        ))}

        {sortedKps.map(kp => {
          const pos = positions.get(kp.id);
          if (!pos) return null;
          const color = masteryColor(kp);
          const status = getLearningKpStatus(kp);
          const isSelected = selectedKpId === kp.id;
          const style: CSSProperties = {
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            borderRadius: 8,
            border: isSelected ? `2px solid ${color}` : '1px solid #dfe5ec',
            background: isSelected ? '#f7fbfb' : '#fff',
            boxShadow: isSelected ? '0 8px 20px rgba(20, 145, 155, 0.12)' : '0 2px 8px rgba(25, 35, 50, 0.06)',
            cursor: 'pointer',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            textAlign: 'left',
            outline: 'none',
          };

          return (
            <button
              key={kp.id}
              type="button"
              onClick={() => onSelectKp(kp.id)}
              style={style}
              title={kp.name}
            >
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#1f2a37',
                lineHeight: '18px',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {kp.name}
              </span>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 5,
                fontSize: 11,
                color: '#7b8794',
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: color,
                  flexShrink: 0,
                }} />
                <span>{status.label}</span>
                <span style={{ marginLeft: 'auto', color, fontWeight: 700 }}>
                  {Math.round(kp.mastery * 100)}%
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
