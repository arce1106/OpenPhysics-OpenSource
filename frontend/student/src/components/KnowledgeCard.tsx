import { useState } from 'react';
import { api } from '../api/client';
import LatexSpan from './LatexSpan';
import { sanitizeKnowledgeSvg } from '../utils/sanitizeRichHtml';
import type { KnowledgeCard as KnowledgeCardType } from '../types';

interface Props {
  card: KnowledgeCardType;
  onConsumed: () => void;
}

const sectionColors: Record<string, { bg: string; border: string }> = {
  concept: { bg: '#f0f5ff', border: '#91caff' },
  formula: { bg: '#fff7e6', border: '#ffd591' },
  diagram: { bg: '#f6ffed', border: '#b7eb8f' },
  example: { bg: '#fff2f0', border: '#ffccc7' },
  summary: { bg: '#f9f0ff', border: '#d3adf7' },
};

export default function KnowledgeCard({ card, onConsumed }: Props) {
  const [consumed, setConsumed] = useState(card.consumed);
  const [loading, setLoading] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsume = async () => {
    if (consumed) return;
    setLoading(true);
    setError(null);
    try {
      await api.markLearnComplete(card.kp_id, {
        kp_id: card.kp_id,
        content_id: card.content_id,
        content_type: 'card',
        time_spent_seconds: 0,
      });
      setConsumed(true);
      onConsumed();
    } catch (e: any) {
      setError(e.message || '同步失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '0 0 16px' }}>
      {card.sections.map((section, i) => {
        const colors = sectionColors[section.type] || { bg: '#fff', border: '#e8e8e8' };

        return (
          <div
            key={i}
            style={{
              background: colors.bg,
              borderLeft: `3px solid ${colors.border}`,
              borderRadius: 6,
              padding: '14px 18px',
              marginBottom: 12,
            }}
          >
            <div style={{
              fontSize: 14, fontWeight: 600, color: '#1a1d23',
              marginBottom: 8,
            }}>
              {section.title}
            </div>

            {section.type === 'concept' && (
              <div style={{ fontSize: 14, color: '#444', lineHeight: 1.8 }}>
                <LatexSpan text={section.content.html as string || ''} />
              </div>
            )}

            {section.type === 'formula' && (
              <div>
                <div style={{
                  textAlign: 'center', padding: '12px 0',
                  fontSize: 16,
                }}>
                  <LatexSpan text={`$$${section.content.latex || ''}$$`} />
                </div>
                {Array.isArray(section.content.variable_table) && (
                  <table style={{
                    width: '100%', borderCollapse: 'collapse', marginTop: 8,
                    fontSize: 12,
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
                        <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>符号</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>名称</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>单位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(section.content.variable_table as Array<{ symbol: string; name: string; unit?: string }>).map((v, j) => (
                        <tr key={j} style={{ borderBottom: '1px solid #f5f5f5' }}>
                          <td style={{ padding: '4px 8px', fontWeight: 600, fontStyle: 'italic' }}>
                            <LatexSpan text={`$${v.symbol}$`} />
                          </td>
                          <td style={{ padding: '4px 8px' }}>{v.name}</td>
                          <td style={{ padding: '4px 8px', color: '#888' }}>{v.unit || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {section.type === 'diagram' && (
              <div
                style={{ textAlign: 'center', padding: 8 }}
                dangerouslySetInnerHTML={{ __html: sanitizeKnowledgeSvg(section.content.svg as string || '') }}
              />
            )}

            {section.type === 'example' && (
              <div>
                <div style={{ fontSize: 14, color: '#333', marginBottom: 8 }}>
                  <LatexSpan text={section.content.stem as string || ''} />
                </div>
                <button
                  onClick={() => setShowSolution(!showSolution)}
                  style={{
                    padding: '4px 12px', borderRadius: 4,
                    border: '1px solid #d9d9d9', background: '#fff',
                    cursor: 'pointer', fontSize: 12, color: '#14919b',
                  }}
                >
                  {showSolution ? '收起解答' : '查看解答'}
                </button>
                {showSolution && (
                  <div style={{ marginTop: 8, padding: '10px 14px', background: '#fff', borderRadius: 4 }}>
                    <div style={{ fontSize: 13, color: '#555', lineHeight: 1.7 }}>
                      <LatexSpan text={section.content.solution as string || ''} />
                    </div>
                    {!!section.content.key_takeaway && (
                      <div style={{
                        marginTop: 8, padding: '6px 10px',
                        background: '#fff7e6', borderRadius: 4,
                        fontSize: 12, color: '#ad6800', fontWeight: 500,
                      }}>
                        💡 <LatexSpan text={section.content.key_takeaway as string} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {section.type === 'summary' && (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 2 }}>
                {Array.isArray(section.content.items)
                  ? (section.content.items as string[]).map((item, j) => (
                      <li key={j}><LatexSpan text={item} /></li>
                    ))
                  : null}
              </ul>
            )}
          </div>
        );
      })}

      {/* Consume button */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        {error && (
          <div style={{
            display: 'inline-block',
            padding: '8px 12px',
            borderRadius: 6,
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            color: '#cf1322',
            fontSize: 13,
            marginBottom: 10,
          }}>
            {error}
          </div>
        )}
        {error && <br />}
        {consumed ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '10px 24px', borderRadius: 8,
            background: '#f6ffed', border: '1px solid #b7eb8f',
            color: '#52c41a', fontSize: 14, fontWeight: 600,
          }}>
            ✓ 已理解
          </div>
        ) : (
          <button
            onClick={handleConsume}
            disabled={loading}
            style={{
              padding: '10px 28px', borderRadius: 8, border: 'none',
              background: loading ? '#b3e5e8' : '#14919b',
              color: '#fff', cursor: loading ? 'default' : 'pointer',
              fontSize: 15, fontWeight: 600,
            }}
          >
            {loading ? '提交中...' : '我已理解'}
          </button>
        )}
      </div>
    </div>
  );
}
