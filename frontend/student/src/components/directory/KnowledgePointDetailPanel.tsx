import { hasKpContent, hasKpPractice } from '../../utils/learningAccess';
import type { DirectoryKpNode } from '../../types';
import { getLearningKpStatus, learningStateFor } from '../learningPath';

interface WorkCopy {
  title: string;
  subtitle: string;
}

interface KnowledgePointDetailPanelProps {
  kp: DirectoryKpNode;
  returnPanel: 'welcome' | 'scope_detail';
  workCopy: WorkCopy;
  onBack: () => void;
  onStartLearn: () => void;
  onStartWork: () => void;
}

function getPrimaryActionLabel(kp: DirectoryKpNode) {
  const state = learningStateFor(kp);
  if (state === 'mastered') return '查看学习';
  if (state === 'learning' || state === 'practice') return '继续学习';
  return '开始学习';
}

function CompactMastery({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="kp-entry-mastery">
      <strong>{pct}%</strong>
      <span>掌握度</span>
    </div>
  );
}

export default function KnowledgePointDetailPanel({
  kp,
  returnPanel,
  workCopy,
  onBack,
  onStartLearn,
  onStartWork,
}: KnowledgePointDetailPanelProps) {
  const { name, mastery, volume, chapter, section } = kp;
  const state = getLearningKpStatus(kp);

  return (
    <div className="kp-detail-panel directory-detail-panel directory-kp-detail-panel kp-entry-panel">
      <div className="kp-detail-topline">
        <button type="button" className="kp-detail-back" onClick={onBack}>
          <span className="desktop-back-label">返回</span>
          <span className="mobile-back-label">
            {returnPanel === 'scope_detail' ? '返回图谱' : '返回目录'}
          </span>
        </button>
        <div className="kp-detail-breadcrumb directory-kp-meta">
          {[volume, chapter, section].filter(Boolean).join(' › ')}
        </div>
      </div>

      <section className="kp-entry-hero">
        <div className="kp-entry-main">
          <span className="kp-entry-eyebrow">知识点学习入口</span>
          <h1 className="kp-entry-title">{name}</h1>
          <p className="kp-entry-meta">
            {[volume, chapter, section].filter(Boolean).join(' · ')}
          </p>
          <div className="kp-entry-status-row">
            <span className={`kp-entry-status tone-${state.tone}`}>{state.label}</span>
            {hasKpContent(kp) && <span>掌握度 {Math.round(mastery * 100)}%</span>}
          </div>
          <p className="kp-entry-copy">{hasKpContent(kp) ? '学习本知识点的概念、例题和辅助理解。' : '内容待补充：目录已保留，学习卡片和题目由部署者补充。'}</p>
          <div className="kp-entry-actions">
            <button type="button" className="kp-entry-primary" disabled={!hasKpContent(kp)} onClick={onStartLearn}>
              {getPrimaryActionLabel(kp)}
            </button>
            <button type="button" className="kp-entry-secondary" disabled={!hasKpPractice(kp)} onClick={onStartWork}>
              {workCopy.title}
            </button>
          </div>
        </div>
        {hasKpContent(kp) && <CompactMastery value={mastery} />}
      </section>

      <section className="kp-learning-steps" aria-label="学习流程">
        <div className="kp-learning-step">
          <span>1</span>
          <div>
            <strong>学习卡片</strong>
            <p>理解概念、例题和辅助讲解</p>
          </div>
        </div>
        <div className="kp-learning-step">
          <span>2</span>
          <div>
            <strong>小测确认</strong>
            <p>{workCopy.subtitle}</p>
          </div>
        </div>
        <div className="kp-learning-step">
          <span>3</span>
          <div>
            <strong>巩固提升</strong>
            <p>薄弱知识点进入训练</p>
          </div>
        </div>
      </section>

      <div className="directory-kp-guidance kp-guidance-card">
        <div className="directory-kp-guidance-title">学习建议</div>
        <div className="directory-kp-guidance-text">
          建议先完成知识卡片和辅助理解，再用小测确认掌握情况；若仍薄弱，系统会推荐进入巩固提升和错因复盘。
        </div>
      </div>
    </div>
  );
}
