import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  /** 正在提交：禁用两个按钮，防止重复点击。 */
  busy?: boolean;
  /** 额外禁止确认（例如表单未填完整）。 */
  confirmDisabled?: boolean;
  /** 提交失败的原因，显示在按钮上方。 */
  error?: string | null;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  tone = 'default',
  busy = false,
  confirmDisabled = false,
  error,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const cancelHandler = useRef(onCancel);
  cancelHandler.current = onCancel;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const hasChildren = Boolean(children);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) cancelHandler.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    // 打开时把焦点放在“取消”，避免回车误触危险操作；带表单内容时交给表单自己的 autoFocus。
    if (open && !hasChildren) cancelRef.current?.focus();
  }, [open, hasChildren]);

  if (!open) return null;

  const danger = tone === 'danger';
  const disabled = busy || confirmDisabled;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        autoComplete="off"
        onSubmit={event => { event.preventDefault(); if (!disabled) onConfirm(); }}
        style={{
          width: 400, maxWidth: 'calc(100vw - 32px)',
          background: '#fff', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          border: '1px solid #e8e8e8',
        }}
      >
        <div style={{ padding: '18px 20px 10px' }}>
          <div id={titleId} style={{ fontSize: 16, fontWeight: 700, color: danger ? '#cf1322' : '#222' }}>
            {title}
          </div>
          {message && (
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7, color: '#555', whiteSpace: 'pre-wrap' }}>
              {message}
            </div>
          )}
          {children && <div style={{ marginTop: 12 }}>{children}</div>}
          {error && (
            <div role="alert" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6, color: '#cf1322' }}>
              {error}
            </div>
          )}
        </div>
        <div style={{
          padding: '12px 20px 16px',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              border: '1px solid #d9d9d9', borderRadius: 4,
              background: '#fff', color: '#555', cursor: busy ? 'default' : 'pointer',
              padding: '5px 14px', fontSize: 13,
            }}>
            取消
          </button>
          <button
            type="submit"
            disabled={disabled}
            style={{
              border: `1px solid ${danger ? '#ff7875' : '#0d7377'}`,
              borderRadius: 4,
              background: danger ? '#fff1f0' : '#e0f5f6',
              color: danger ? '#cf1322' : '#0d7377',
              cursor: disabled ? 'default' : 'pointer', padding: '5px 14px', fontSize: 13,
              fontWeight: 600,
              opacity: disabled ? 0.55 : 1,
            }}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
