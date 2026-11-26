import { useEffect, type ReactNode } from 'react';
import PracticeResultPanel from './train/PracticeResultPanel';

interface SessionResultDialogProps {
  open: boolean;
  title: string;
  scoreText: string;
  label: string;
  feedback: string;
  tone?: 'mastered' | 'practice' | 'study' | 'neutral';
  meta?: string;
  actions: ReactNode;
  onClose: () => void;
}

export default function SessionResultDialog({
  open,
  title,
  scoreText,
  label,
  feedback,
  tone = 'neutral',
  meta,
  actions,
  onClose,
}: SessionResultDialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="session-result-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="session-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          type="button"
          className="session-result-close"
          onClick={onClose}
          aria-label="关闭结果"
        >
          ×
        </button>
        <PracticeResultPanel
          title={title}
          scoreText={scoreText}
          label={label}
          feedback={feedback}
          tone={tone}
          meta={meta}
          actions={actions}
          className="session-result-panel"
        />
      </div>
    </div>
  );
}
