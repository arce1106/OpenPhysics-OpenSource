import type {
  LearningCatalogNode,
  LearningCatalogTopicLayer,
  LearningCatalogTopicOverview,
} from '../types';
import { GAOKAO_TOPIC_LAYERS } from '../utils/gaokaoTopicLayers';

interface GaokaoTopicWorkbenchProps {
  topic: LearningCatalogNode | null;
  overview: LearningCatalogTopicOverview | null;
  loading: boolean;
  error: string | null;
  sessionLoading: boolean;
  accessRequired?: boolean;
  onStartSession: (layer: LearningCatalogTopicLayer) => void;

  onRetry: () => void;
}

function formatRecentDate(value: string | null) {
  if (!value) return '暂无复习记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '已有复习记录';
  return `最近复习 ${date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  })}`;
}

export default function GaokaoTopicWorkbench({
  topic,
  overview,
  loading,
  error,
  sessionLoading,
  accessRequired = false,
  onStartSession,

  onRetry,
}: GaokaoTopicWorkbenchProps) {
  if (loading) {
    return (
      <div className="gaokao-workbench-status" role="status">
        {topic ? '正在加载专题复习路径...' : '正在恢复最近复习专题...'}
      </div>
    );
  }

  if (error) {
    return (
      <div className="gaokao-workbench-status is-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={onRetry}>重新加载</button>
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="gaokao-workbench-empty">
        <div className="gaokao-workbench-empty-mark" aria-hidden="true">专题</div>
        <h2>暂无可用复习专题</h2>
        <p>专题目录正在准备中，请稍后再来查看。</p>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="gaokao-workbench-status is-error" role="alert">
        <span>专题学习状态加载失败</span>
        <button type="button" onClick={onRetry}>重新加载</button>
      </div>
    );
  }

  const hasLearningEvidence = overview.attempted_knowledge_point_count > 0;

  return (
    <div className="gaokao-workbench-content">
      {hasLearningEvidence ? (
        <section className="card train-recent-scope-card gaokao-recent-topic-card">
          <div className="train-recent-scope-copy">
            <div className="train-route-eyebrow">最近专题状态</div>
            <div className="train-recent-scope-title">
              「{overview.title}」{overview.status_label}
            </div>
            <div className="train-recent-scope-meta">
              <span>{formatRecentDate(overview.last_practiced)}</span>
              <span>待检测 {Math.max(0, overview.core_knowledge_point_count - overview.attempted_knowledge_point_count)} 个</span>
            </div>
            <div className="train-recent-scope-next">
              推荐进入「{overview.recommended_layer_name}」
            </div>
          </div>
          <div className="train-recent-scope-actions">
            <button
              type="button"
              className="train-route-primary-button"
              disabled={sessionLoading}
              onClick={() => onStartSession(overview.recommended_layer)}
            >
              {accessRequired ? '登录后继续复习' : '继续专题复习'}
            </button>
            <button
              type="button"
              className="train-route-secondary-button"
              disabled={sessionLoading}
              onClick={() => onStartSession('diagnostic')}
            >
              {accessRequired ? '登录后重新摸底' : '重新摸底'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card train-route-card gaokao-topic-route-card">
        <div className="train-route-header">
          <div>
            <div className="train-route-eyebrow">当前专题复习路径</div>
            <div className="train-route-current-label">
              专题 {overview.topic_code}
            </div>
            <div className="train-route-title">{overview.title}</div>
          </div>
          <button
            type="button"
            className={[
              'train-route-primary-button',
              'gaokao-topic-diagnostic-entry',
              overview.recommended_layer === 'diagnostic' ? 'is-recommended' : '',
            ].filter(Boolean).join(' ')}
            disabled={sessionLoading}
            onClick={() => onStartSession('diagnostic')}
            aria-label={accessRequired ? '登录后进入专题摸底' : '进入专题摸底'}
            title={`当前状态：${overview.status_label}`}
          >
            <span>{accessRequired ? '登录后摸底' : '专题摸底'}</span>
          </button>
        </div>

        <div className="train-route-stats" aria-label="专题复习统计">
          {[
            ['核心知识点', overview.core_knowledge_point_count],
            ['已检测', overview.attempted_knowledge_point_count],
            ['待检测', overview.untested_knowledge_point_count ?? Math.max(0, overview.core_knowledge_point_count - overview.attempted_knowledge_point_count)],
            ['作答记录', overview.evidence_count ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="train-route-stat">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className="gaokao-topic-path-heading">
          <div>
            <span>专题训练入口</span>
            <p>{accessRequired ? '登录后可进入三个复习层级，按当前需要选择。' : '三个复习层级都可以直接进入，按当前需要选择。'}</p>
          </div>
          <strong>{overview.performance_score == null ? '专题表现待检测' : `${Math.round(overview.performance_score * 100)}% 专题作答表现`}</strong>
        </div>

        <p className="gaokao-topic-evidence-note">按本专题已作答题目的得分计算；未练知识点标为待检测，不计零分。</p>
        <div
          className="gaokao-topic-layer-grid"
          role="group"
          aria-label="三个复习层级"
        >
          {GAOKAO_TOPIC_LAYERS.map(layer => {
            const isRecommended = overview.recommended_layer === layer.id;
            const performance = overview.layer_performance?.find(item => item.layer === layer.id);
            return (
              <button
                type="button"
                key={layer.id}
                className={[
                  'gaokao-topic-layer-card',
                  isRecommended ? 'is-recommended' : '',
                ].filter(Boolean).join(' ')}
                disabled={sessionLoading}
                onClick={() => onStartSession(layer.id)}
                aria-label={`${accessRequired ? '登录后' : ''}进入${layer.name}`}
              >
                <span className="gaokao-topic-layer-number">{layer.number}</span>
                <span className="gaokao-topic-layer-copy">
                  <span className="gaokao-topic-layer-title-row">
                    <strong>{layer.name}</strong>
                    {accessRequired ? <em>登录后开启</em> : isRecommended ? <em>当前建议</em> : null}
                  </span>
                  <span>
                    {layer.questionCount} 题 · {layer.difficulty}
                    <br />
                    {layer.description}
                    {performance ? <>
                      <br />
                      {performance.performance_score == null ? '该层待检测' : `已作答 ${performance.evidence_count} 次 · 得分 ${Math.round(performance.performance_score * 100)}%`}
                    </> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="gaokao-topic-current-action">
          <div>
            <strong>专题套卷</strong>
            <p>混合基础、典型和综合题，共 10 题，适合阶段验收与限时训练。</p>
          </div>
          <button
            type="button"
            className="train-route-primary-button"
            disabled={sessionLoading}
            onClick={() => onStartSession('paper')}
          >
            {sessionLoading ? '正在准备题目...' : accessRequired ? '登录后开始套卷' : '开始专题套卷'}
          </button>
        </div>


      </section>
    </div>
  );
}
