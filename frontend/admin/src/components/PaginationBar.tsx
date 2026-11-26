import { useEffect, useState } from 'react';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid #d9d9d9',
  borderRadius: 4,
  padding: '3px 12px',
  background: '#fff',
  fontSize: 12,
  color: '#666',
};

export default function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  loading = false,
  onPageChange,
}: PaginationBarProps) {
  const [jumpValue, setJumpValue] = useState(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  if (total <= pageSize) return null;

  const prevDisabled = page <= 1 || loading;
  const nextDisabled = page >= totalPages || loading;
  const jumpDisabled = loading || totalPages <= 1;
  const commitJump = () => {
    const raw = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(raw)) {
      setJumpValue(String(page));
      return;
    }
    const nextPage = Math.min(totalPages, Math.max(1, raw));
    setJumpValue(String(nextPage));
    if (nextPage !== page) onPageChange(nextPage);
  };

  return (
    <div style={{
      padding: '10px 20px',
      background: '#fff',
      borderTop: '1px solid #e8e8e8',
      display: 'flex',
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      fontSize: 12,
      color: '#888',
    }}>
      <span>共 {total} 题，每页 {pageSize} 题</span>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={prevDisabled}
        style={{
          ...buttonStyle,
          opacity: prevDisabled ? 0.45 : 1,
          cursor: prevDisabled ? 'not-allowed' : 'pointer',
        }}>
        上一页
      </button>
      <span>{page} / {totalPages}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        跳至
        <input
          type="number"
          min={1}
          max={totalPages}
          value={jumpValue}
          disabled={jumpDisabled}
          onChange={event => setJumpValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') commitJump();
          }}
          onBlur={commitJump}
          aria-label="跳转页码"
          style={{
            width: 54,
            height: 26,
            boxSizing: 'border-box',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 12,
            color: '#333',
          }}
        />
        页
        <button
          type="button"
          onClick={commitJump}
          disabled={jumpDisabled}
          style={{
            ...buttonStyle,
            padding: '3px 8px',
            opacity: jumpDisabled ? 0.45 : 1,
            cursor: jumpDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          跳转
        </button>
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={nextDisabled}
        style={{
          ...buttonStyle,
          opacity: nextDisabled ? 0.45 : 1,
          cursor: nextDisabled ? 'not-allowed' : 'pointer',
        }}>
        下一页
      </button>
    </div>
  );
}
