import { hasKpContent, hasKpPractice } from '../../utils/learningAccess';
import KnowledgeGraph from '../KnowledgeGraph';
import type { DirectoryKpNode, DirectoryRelation } from '../../types';
import { buildDirectoryKpStats, firstKpByLearningState, getLearningKpStatus, learningStateFor } from '../learningPath';

interface ScopeSelection {
  type: 'chapter' | 'section';
  id: string;
  name: string;
  kpIds: string[];
}

interface ScopeDetailPanelProps {
  scope: ScopeSelection;
  scopeKps: DirectoryKpNode[];
  relations: DirectoryRelation[];
  selectedKpId?: string;
  avgMastery: number;
  onBackToDirectory: () => void;
  onGoToConsolidation: () => void;
  onSelectKp: (kpId: string) => void;
  onStartLearn: (kpId: string) => void;
  onStartCheck: (kpId: string) => void;
  onStartTrain: (kp: DirectoryKpNode) => void;
}

function chapterStats(kps: DirectoryKpNode[], avgMastery: number) {
  return { ...buildDirectoryKpStats(kps), avgMastery };
}

function nextKp(kps: DirectoryKpNode[]) {
  kps = kps.filter(hasKpContent);
  return firstKpByLearningState(kps, ['learning', 'practice', 'to_learn', 'locked'])
    || kps.find(kp => learningStateFor(kp) !== 'mastered')
    || kps[0];
}

interface KpPathCardProps {
  kp: DirectoryKpNode;
  onSelectKp: (kpId: string) => void;
  onStartLearn: (kpId: string) => void;
  onStartCheck: (kpId: string) => void;
  onStartTrain: (kp: DirectoryKpNode) => void;
}

function KpPathCard({ kp, onSelectKp, onStartLearn, onStartCheck, onStartTrain }: KpPathCardProps) {
  const status = getLearningKpStatus(kp);
  const pct = Math.round(kp.mastery * 100);
  return (
    <article className="directory-path-kp-card">
      <div className="directory-path-kp-main" onClick={() => onSelectKp(kp.id)} role="button" tabIndex={0}>
        <div className="directory-path-kp-title-row">
          <h3>{kp.name}</h3>
          <span className={`directory-path-kp-status directory-path-kp-status--${status.tone}`}>{status.label}</span>
        </div>
        <div className="directory-path-kp-meta">
          <span>{hasKpContent(kp) ? `掌握度 ${pct}%` : '内容待补充'}</span>
          <span>{kp.last_practiced ? `最近学习：${kp.last_practiced}` : '暂无最近学习记录'}</span>
        </div>
        <div className="directory-path-kp-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
      </div>
      <div className="directory-path-kp-actions">
        <button type="button" disabled={!hasKpContent(kp)} onClick={() => onStartLearn(kp.id)}>学习</button>
        <button type="button" disabled={!hasKpPractice(kp)} onClick={() => onStartCheck(kp.id)}>小测</button>
        <button type="button" disabled={!hasKpPractice(kp)} onClick={() => onStartTrain(kp)}>巩固</button>
      </div>
    </article>
  );
}

export default function ScopeDetailPanel({
  scope,
  scopeKps,
  relations,
  selectedKpId,
  avgMastery,
  onBackToDirectory,
  onGoToConsolidation,
  onSelectKp,
  onStartLearn,
  onStartCheck,
  onStartTrain,
}: ScopeDetailPanelProps) {
  const { type, name } = scope;
  const stats = chapterStats(scopeKps, avgMastery);
  const primaryKp = nextKp(scopeKps);

  return (
    <div className="scope-detail-panel directory-detail-panel directory-scope-detail-panel directory-path-panel">
      <button type="button" className="mobile-scope-back no-print" onClick={onBackToDirectory}>
        返回目录
      </button>

      <section className="directory-path-hero">
        <div>
          <span className="directory-path-eyebrow">{type === 'chapter' ? '本章学习路径' : '本节学习路径'}</span>
          <h1>{name}</h1>
          <p>{scopeKps[0]?.volume || '同步学习'} / {scopeKps[0]?.chapter || name}</p>
          <p className="directory-path-hero-copy">
            按教材顺序推进知识点，先完成理解，再通过小测和巩固训练确认掌握情况。
          </p>
        </div>
        <div className="directory-path-hero-action">
          <span>推荐下一步</span>
          <strong>{primaryKp ? primaryKp.name : '选择知识点'}</strong>
          <button type="button" onClick={() => primaryKp && onStartLearn(primaryKp.id)} disabled={!primaryKp}>
            {primaryKp?.mastery ? '继续学习' : '开始学习'}
          </button>
        </div>
      </section>

      <section className="directory-path-overview" aria-label="章节学习概览">
        <div className="directory-path-stat"><span>知识点总数</span><strong>{stats.total}</strong></div>
        <div className="directory-path-stat"><span>已掌握</span><strong>{stats.mastered}</strong></div>
        <div className="directory-path-stat"><span>待学习</span><strong>{stats.toLearn}</strong></div>
        <div className="directory-path-stat"><span>学习中</span><strong>{stats.learning}</strong></div>
        <div className="directory-path-stat"><span>待巩固</span><strong>{stats.practice}</strong></div>
        <div className="directory-path-stat directory-path-stat-primary"><span>平均掌握度</span><strong>{Math.round(stats.avgMastery * 100)}%</strong></div>
      </section>

      <div className="directory-path-loop-hint">
        先理解知识点，再用小测确认掌握情况；薄弱知识点会进入巩固提升和错因复盘。
      </div>

      <section className="directory-path-kp-section">
        <div className="directory-path-section-header">
          <h2>{type === 'chapter' ? '本章' : '本节'}知识点</h2>
          <button type="button" onClick={onGoToConsolidation}>去巩固提升</button>
        </div>
        <div className="directory-path-kp-list">
          {scopeKps.map(kp => (
            <KpPathCard
              key={kp.id}
              kp={kp}
              onSelectKp={onSelectKp}
              onStartLearn={onStartLearn}
              onStartCheck={onStartCheck}
              onStartTrain={onStartTrain}
            />
          ))}
        </div>
      </section>

      <section className="directory-scope-graph-card">
        <div className="directory-scope-graph-header">
          <div className="directory-scope-graph-title">
            {type === 'chapter' ? '本章' : '本节'}知识图谱
          </div>
          <span>辅助查看知识点关系</span>
        </div>
        <div className="directory-scope-graph-shell">
          <KnowledgeGraph
            kps={scopeKps}
            relations={relations}
            selectedKpId={selectedKpId}
            onSelectKp={onSelectKp}
          />
        </div>
      </section>
    </div>
  );
}
