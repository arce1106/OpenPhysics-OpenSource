import type { LearningResourceTab } from '../../utils/learningFlow';

const TAB_LABELS: Record<LearningResourceTab, string> = {
  card: '卡片',
  video: '讲解',
  slides: '微课',
  interactive: '模拟',
};

interface LearnResourceTabsProps {
  activeTab: LearningResourceTab;
  availableTabs: LearningResourceTab[];
  onChange: (tab: LearningResourceTab) => void;
  onPrefetch?: (tab: LearningResourceTab) => void;
  className?: string;
}

export default function LearnResourceTabs({
  activeTab,
  availableTabs,
  onChange,
  onPrefetch,
  className = '',
}: LearnResourceTabsProps) {
  return (
    <div className={['learn-action-panel', className].filter(Boolean).join(' ')}>
      <div className="learn-resource-tabs">
        {availableTabs.map(tab => (
          <button
            key={tab}
            onClick={() => onChange(tab)}
            onMouseEnter={() => onPrefetch?.(tab)}
            onFocus={() => onPrefetch?.(tab)}
            className={[
              'learn-resource-tab',
              activeTab === tab ? 'learn-resource-tab-active' : '',
            ].filter(Boolean).join(' ')}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}
