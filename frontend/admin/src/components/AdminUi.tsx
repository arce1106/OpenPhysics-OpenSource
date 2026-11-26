import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** The admin console's shared page frame, header, panels and figures, so pages look alike. */
export const ACCENT = '#0d7377';
export const panelStyle: CSSProperties = {
  background: '#fffdf8', border: '1px solid #e8e0d2', borderRadius: 8,
  boxShadow: '0 1px 3px rgba(36, 30, 18, 0.04)',
};
export const secondaryButton: CSSProperties = {
  border: '1px solid #d0d5dd', background: '#fff', color: '#344054', borderRadius: 6,
  padding: '7px 13px', cursor: 'pointer', fontWeight: 700,
};

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f2933', margin: 0 }}>{title}</h1>
        {description && <div style={{ fontSize: 13, color: '#667085', marginTop: 4 }}>{description}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>{children}</div>;
}

/** A figure with what it means; a card that leads somewhere is a link. */
export function MetricCard({ label, value, hint, warn = false, to }: {
  label: string; value: ReactNode; hint: ReactNode; warn?: boolean; to?: string;
}) {
  const body = <>
    <div style={{ color: '#667085', fontSize: 12, marginBottom: 7, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>{label}</span>{to && <span aria-hidden="true" style={{ color: ACCENT }}>→</span>}
    </div>
    <div data-metric-value style={{ color: warn ? '#b42318' : '#1f2933', fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{value}</div>
    <div style={{ color: '#8a7458', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{hint}</div>
  </>;
  const style: CSSProperties = { ...panelStyle, padding: 16, display: 'block', textDecoration: 'none' };
  return to ? <Link to={to} style={style}>{body}</Link> : <div style={style}>{body}</div>;
}
