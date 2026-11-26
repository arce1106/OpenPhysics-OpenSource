import PrintButton from '../PrintButton';
import { useState, type ReactNode } from 'react';

interface QuestionHeaderBarProps {
  title: string;
  answeredCount: number;
  total: number;
  showPaperBatch: boolean;
  onBack: () => void;
  onTogglePaperBatch: () => void;
  extraAction?: ReactNode;
  allowPaperBatch?: boolean;
}

export default function QuestionHeaderBar({
  title,
  answeredCount,
  total,
  showPaperBatch,
  onBack,
  onTogglePaperBatch,
  extraAction,
  allowPaperBatch = true,
}: QuestionHeaderBarProps) {
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <div className="page-header page-header-actions question-workspace-header">
      <div className="question-workspace-title-block">
        <div className="question-workspace-title-row">
          <button type="button" className="page-back-button question-workspace-back" onClick={onBack}>
            返回
          </button>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="page-action-group question-workspace-actions">
        <div className="question-workspace-count">{answeredCount} / {total}</div>
        <button
          type="button"
          className="page-back-button question-workspace-tools-trigger"
          onClick={() => setToolsOpen(open => !open)}
          aria-expanded={toolsOpen}
          aria-controls="question-workspace-tools"
        >
          工具
        </button>
        {extraAction}
        {toolsOpen && (
          <div className="question-workspace-tools" id="question-workspace-tools">
            <PrintButton />
            {allowPaperBatch && <button
              type="button"
              className="page-back-button"
              onClick={onTogglePaperBatch}
            >
              {showPaperBatch ? '收起纸笔批改' : '纸笔批改'}
            </button>}
          </div>
        )}
      </div>
    </div>
  );
}
