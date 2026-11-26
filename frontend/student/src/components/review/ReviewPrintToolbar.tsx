import PrintButton from '../PrintButton';

interface ReviewPrintToolbarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  className?: string;
}

export default function ReviewPrintToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  className = '',
}: ReviewPrintToolbarProps) {
  return (
    <div className={['page-action-group review-print-toolbar review-print-actions', className].filter(Boolean).join(' ')}>
      <span className="review-print-count">{selectedCount} 道已选</span>
      <button
        type="button"
        className="page-back-button"
        onClick={onSelectAll}
        disabled={totalCount === 0}
      >
        全选错题
      </button>
      {selectedCount > 0 && (
        <button type="button" className="page-back-button" onClick={onClearSelection}>
          清空
        </button>
      )}
      <PrintButton
        label={selectedCount > 0 ? '打印所选错题' : '选择错题后打印'}
        disabled={selectedCount === 0}
      />
    </div>
  );
}
