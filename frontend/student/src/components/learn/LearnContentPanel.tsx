import type { ReactNode } from 'react';
import type { LearningResourceTab } from '../../utils/learningFlow';

interface LearnContentPanelProps {
  activeTab: LearningResourceTab;
  cardContent?: ReactNode;
  videoContent?: ReactNode;
  slidesContent?: ReactNode;
  interactiveContent?: ReactNode;
  className?: string;
}

export default function LearnContentPanel({
  activeTab,
  cardContent,
  videoContent,
  slidesContent,
  interactiveContent,
  className = '',
}: LearnContentPanelProps) {
  const contentMap: Record<LearningResourceTab, ReactNode> = {
    card: cardContent,
    video: videoContent,
    slides: slidesContent,
    interactive: interactiveContent,
  };
  const tabClass = `learn-content-panel-${activeTab}`;
  const sectionClass = `learn-content-section-${activeTab}`;

  return (
    <div className={['card learn-main learn-content-panel', tabClass, className].filter(Boolean).join(' ')}>
      <div className={['learn-content-section', sectionClass].join(' ')}>
        {contentMap[activeTab] || null}
      </div>
    </div>
  );
}
