import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { ClassMember, TeacherClassSummary } from '../types';

export type StudentSelection = Record<string, string[]>;
export function selectedRecipients(classes: TeacherClassSummary[], selected: StudentSelection): StudentSelection {
  return Object.fromEntries(classes.filter((item) => selected[item.id] !== undefined).map((item) => [item.id, selected[item.id]]));
}

/** A fixed-position picker keeps long rosters above the following settings cards. */
export default function StudentRecipients({ classes, chosen, onClassesChange, selected, onChange, disabled = false, unavailable = new Set<string>(), allowStudents = true }: {
  classes: TeacherClassSummary[]; chosen: Set<string>; onClassesChange: (next: Set<string>) => void;
  selected: StudentSelection; onChange: (next: StudentSelection) => void; disabled?: boolean; unavailable?: Set<string>; allowStudents?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, ClassMember[]>>({});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const pickedClasses = classes.filter((item) => chosen.has(item.id));
  const count = pickedClasses.reduce((sum, item) => sum + (selected[item.id]?.length ?? item.member_count), 0);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const useBelow = below >= Math.min(320, rect.top - 16);
      setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: useBelow ? rect.bottom + 6 : undefined, bottom: useBelow ? undefined : window.innerHeight - rect.top + 6,
        maxHeight: Math.max(100, useBelow ? below : rect.top - 16) });
    };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    place();
    panel.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  useEffect(() => {
    if (!open || !expanded || members[expanded]) return;
    let active = true;
    setError('');
    api.classDetail(expanded).then((detail) => {
      if (active) setMembers((current) => ({ ...current, [expanded]: detail.members.filter((m) => m.status === 'active')
        .sort((a, b) => (a.student_number == null ? 1 : 0) - (b.student_number == null ? 1 : 0)
          || Number(a.student_number ?? 0) - Number(b.student_number ?? 0)) }));
    }).catch((err) => active && setError(err instanceof Error ? err.message : '名单加载失败'));
    return () => { active = false; };
  }, [open, expanded, members, attempt]);

  function selectClass(id: string, include: boolean) {
    const next = new Set(chosen); if (include) next.add(id); else next.delete(id);
    const individuals = { ...selected }; delete individuals[id];
    onClassesChange(next); onChange(individuals);
  }
  function toggleStudent(classId: string, studentId: string) {
    const list = members[classId] ?? [];
    const ids = new Set(chosen.has(classId) ? selected[classId] ?? list.map((member) => member.id) : []);
    if (ids.has(studentId)) ids.delete(studentId); else ids.add(studentId);
    const next = new Set(chosen); const individuals = { ...selected };
    if (ids.size === 0) { next.delete(classId); delete individuals[classId]; }
    else { next.add(classId); if (ids.size === list.length) delete individuals[classId]; else individuals[classId] = [...ids]; }
    onClassesChange(next); onChange(individuals);
  }
  const summary = pickedClasses.length === 0 ? '选择班级和学生'
    : pickedClasses.length === 1 ? `${pickedClasses[0].name} · ${selected[pickedClasses[0].id] ? '已选' : '全班'} ${count} 人`
      : `${pickedClasses.length} 个班 · ${count} 人`;
  const label = allowStudents ? '选择班级和学生' : '选择班级';
  return <section ref={root} className="settings-section student-recipients" aria-label={allowStudents ? '布置对象' : '布置班级'}>
    <h2>{allowStudents ? '布置对象' : '布置班级'}</h2>
    <button ref={trigger} type="button" className="recipient-trigger" disabled={disabled || classes.length === 0}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
      onClick={() => setOpen((value) => !value)}><span>{classes.length ? pickedClasses.length ? summary : label : '暂无班级'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div ref={panel} id={popupId} className="recipient-popover" style={position} role="dialog" aria-label={allowStudents ? '选择班级学生' : '选择布置班级'}>
      <div className="recipient-popover-head"><strong>{allowStudents ? '班级与学生' : '班级'}</strong><button type="button" className="link-button" onClick={() => { onClassesChange(new Set()); onChange({}); }}>清空</button>
        <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>完成</button></div>
      {classes.map((item) => {
        const blocked = unavailable.has(item.id) || item.member_count === 0 || disabled;
        const partial = chosen.has(item.id) && selected[item.id] !== undefined;
        const list = members[item.id];
        const ids = new Set(chosen.has(item.id) ? selected[item.id] ?? list?.map((m) => m.id) ?? [] : []);
        return <div key={item.id} className="recipient-group">
          <div className="recipient-class-row">
            <input type="checkbox" aria-label={item.name} ref={(input) => { if (input) input.indeterminate = partial; }} disabled={blocked}
              checked={chosen.has(item.id) && !partial} onChange={() => selectClass(item.id, !chosen.has(item.id) || partial)} />
            <button type="button" className="recipient-class-name" aria-expanded={allowStudents ? expanded === item.id : undefined} disabled={blocked}
              aria-label={allowStudents ? `${expanded === item.id ? '收起' : '展开'}${item.name}学生` : `选择${item.name}`} onClick={() => {
                if (!allowStudents) { selectClass(item.id, !chosen.has(item.id)); return; }
                setExpanded(expanded === item.id ? null : item.id); setSearch(''); setError('');
                if (!chosen.has(item.id)) selectClass(item.id, true);
              }}><span>{item.name}{unavailable.has(item.id) ? '（已发布）' : item.member_count === 0 ? '（无学生）' : ''}</span>
              <span className="muted small">{allowStudents ? `${chosen.has(item.id) ? selected[item.id]?.length ?? item.member_count : 0}/` : ''}{item.member_count} 人{allowStudents ? ' ⌄' : ''}</span></button>
          </div>
          {allowStudents && expanded === item.id && <div className="recipient-roster">
            {error ? <p className="error" role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>重试</button></p>
              : !list ? <p className="muted small">正在加载名单…</p> : <>
                <input type="search" aria-label={`搜索${item.name}学生`} placeholder="姓名或学号" value={search} onChange={(event) => setSearch(event.target.value)} />
                {list.filter((m) => `${m.student_number ?? ''} ${m.display_name}`.includes(search.trim())).map((member) => <label className="toggle" key={member.id}>
                  <input type="checkbox" aria-label={`${item.name}学生 ${member.display_name}`} disabled={disabled} checked={ids.has(member.id)} onChange={() => toggleStudent(item.id, member.id)} />
                  <span>{member.student_number ? `${member.student_number} · ` : ''}{member.display_name}</span>
                </label>)}
              </>}
          </div>}
        </div>;
      })}
    </div>}
  </section>;
}
