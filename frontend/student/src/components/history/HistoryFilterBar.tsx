import type { HistoryResultFilter } from '../../utils/historyRecords';

interface HistoryFilterOption {
  id: HistoryResultFilter;
  label: string;
}

interface HistoryFilterBarProps {
  activeFilter: HistoryResultFilter;
  filters: HistoryFilterOption[];
  onChange: (filter: HistoryResultFilter) => void;
  className?: string;
}

export default function HistoryFilterBar({
  activeFilter,
  filters,
  onChange,
  className,
}: HistoryFilterBarProps) {
  return (
    <div className={`page-action-group history-filter-bar${className ? ` ${className}` : ''}`}>
      {filters.map(filter => {
        const active = activeFilter === filter.id;
        return (
          <button
            key={filter.id}
            type="button"
            className={`history-filter-button${active ? ' active history-filter-button-active' : ''}`}
            onClick={() => onChange(filter.id)}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
