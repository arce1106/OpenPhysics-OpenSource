import { useEffect, useId, useState } from 'react';
import { api } from '../api';

export type DeliveryMode = 'app' | 'paper';
export default function DeliveryChoice({ value, onChange, disabled = false }: {
  value: DeliveryMode | null; onChange: (value: DeliveryMode) => void; disabled?: boolean;
}) {
  const name = useId();
  return <section className="settings-section delivery-choice" aria-label="布置方式"><h2>布置方式</h2>
    <div className="delivery-options" role="radiogroup" aria-label="布置方式">
      {([['app', '推送 App'], ['paper', '打印']] as const).map(([mode, label]) => <label key={mode} className={value === mode ? 'selected' : ''}>
        <input type="radio" name={name} value={mode} checked={value === mode} disabled={disabled} onChange={() => onChange(mode)} />{label}
      </label>)}
    </div>
  </section>;
}

const listed = (names: string[]) => `${names.slice(0, 5).join('、')}${names.length > 5 ? ` 等 ${names.length} 名学生` : ''}`;

/**
 * Before App work goes out: who will get it on paper instead (never signed in to the App or web),
 * and who declined AI processing in the iOS app and so cannot submit written answers there.
 */
export function AppDeliveryNotice({ classIds }: { classIds: string[] }) {
  const [found, setFound] = useState<{ offline: string[]; declined: string[] }>({ offline: [], declined: [] });
  const key = [...classIds].sort().join(',');
  useEffect(() => {
    let active = true;
    if (!classIds.length) { setFound({ offline: [], declined: [] }); return undefined; }
    Promise.all(classIds.map((id) => api.classDetail(id).catch(() => null))).then((details) => {
      if (!active) return;
      const members = details.flatMap((detail) => (detail?.members ?? []).filter((m) => m.status === 'active'));
      setFound({
        offline: members.filter((m) => !m.last_login_at).map((m) => m.display_name),
        declined: members.filter((m) => m.last_login_at && m.app_ai_declined).map((m) => m.display_name),
      });
    });
    return () => { active = false; };
  }, [key]);
  if (!found.offline.length && !found.declined.length) return null;
  return <div className="notice-warn delivery-notice" role="note">
    {found.offline.length > 0 && <p>{listed(found.offline)}还没有登录过 App 或网页，会自动改为纸质：请打印给他们，收回后扫描。</p>}
    {found.declined.length > 0 && <p>{listed(found.declined)}已在 iOS App 拒绝 AI 批改，无法在 App 提交主观题，可请他们在网页端作答。</p>}
  </div>;
}

/** App-first homework that still has students on paper is printed and collected for them. */
export function printsForSome(row: { delivery?: DeliveryMode | null; paper_students?: number }) {
  return row.delivery !== 'app' || (row.paper_students ?? 0) > 0;
}
