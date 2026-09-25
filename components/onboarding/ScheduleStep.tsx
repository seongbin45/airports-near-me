'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkClass, checkEvent, DAYS, EVENT_KINDS, type ClassItem, type EventDraft, type EventKind } from '@/lib/onboarding/validate';
import { layoutLanes } from '@/lib/onboarding/lanes';
import { dateShortcuts, fmtDate, toMin } from '@/lib/time';
import { CALENDAR_IMPORT_READY } from '@/lib/data/calendar-import';
import { inputCls, pill } from '@/components/ui';

export interface EventItem extends EventDraft { id: number; source: string }

const SOURCE_LABEL: Record<string, string> = { manual: '직접 입력', google_calendar: '구글 캘린더', ics: '.ics 파일' };
const TINTS = [['#dfe8f8', '#1f4a9c'], ['#f6e1cf', '#8a4617'], ['#e0efe0', '#2d6a3a'], ['#eee0f2', '#6b3a80'], ['#f4ebc9', '#735c12'], ['#f5dddd', '#8f3434']];
const HOUR0 = 9, HOURS = 10, PX = 44;
const PRESETS = [['09:00', '10:15'], ['10:30', '11:45'], ['12:00', '13:15'], ['13:30', '14:45'], ['15:00', '16:15'], ['16:30', '17:45']];
const DESC_PH: Record<EventKind, string> = { 수업: '예: 보강 수업', 시험: '예: 운영체제 중간고사', 회의: '예: 캡스톤 팀 회의', 약속: '예: 고향 친구 결혼식', 기타: '예: 병원 예약' };
const TONE = { muted: 'text-muted', error: 'text-danger', warn: 'text-warn' };

const emptyClass: ClassItem = { name: '', place: '', days: [], start: '', end: '' };

interface Props {
  supabase: SupabaseClient;
  isStudent: boolean;
  classes: ClassItem[];
  setClasses: Dispatch<SetStateAction<ClassItem[]>>;
  events: EventItem[];
  setEvents: Dispatch<SetStateAction<EventItem[]>>;
}

export default function ScheduleStep({ supabase, isStudent, classes, setClasses, events, setEvents }: Props) {
  const [tab, setTab] = useState<'classes' | 'events'>(isStudent ? 'classes' : 'events');
  const shown = isStudent ? tab : 'events';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <div className="text-sm font-semibold">캘린더에서 한 번에 불러오기</div>
          <div className="text-xs leading-normal text-muted">구글·애플 캘린더 연결 또는 .ics 파일로 가져와요. 불러온 일정은 아래 목록에 표시돼요.</div>
        </div>
        <button disabled={!CALENDAR_IMPORT_READY}
          className="min-h-11 flex-none rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-[#f1ebe2] disabled:text-faint">
          {CALENDAR_IMPORT_READY ? '캘린더 연결' : '준비 중'}
        </button>
      </div>

      {isStudent && (
        <div className="flex gap-1.5 self-start rounded-[14px] bg-sand p-1">
          {([['classes', `수업 시간표 ${classes.length}`], ['events', `다가오는 일정 ${events.length}`]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`min-h-10 rounded-[11px] px-4 text-sm font-semibold whitespace-nowrap ${tab === id ? 'bg-surface shadow-[0_1px_3px_rgba(60,40,20,.12)]' : ''}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {shown === 'classes'
        ? <Classes supabase={supabase} classes={classes} setClasses={setClasses} />
        : <Events supabase={supabase} events={events} setEvents={setEvents} />}
    </div>
  );
}

function Classes({ supabase, classes, setClasses }: Pick<Props, 'supabase' | 'classes' | 'setClasses'>) {
  const [cf, setCf] = useState<ClassItem>(emptyClass);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cc = checkClass(cf, classes);
  const set = (p: Partial<ClassItem>) => { setCf(c => ({ ...c, ...p })); setNote(''); };

  const gridDays = [...DAYS.slice(0, 5), ...(classes.some(c => c.days.includes('토')) ? ['토' as const] : [])];
  const colorOf = (id?: number) => TINTS[Math.max(0, classes.findIndex(c => c.id === id)) % TINTS.length];

  async function save() {
    if (!cc.ok || busy) return;
    setBusy(true);
    const row = { name: cf.name.trim(), place: cf.place.trim() || null, days: DAYS.filter(d => cf.days.includes(d)), start_time: cf.start, end_time: cf.end };
    const q = cf.id
      ? supabase.from('class_timetable').update(row).eq('id', cf.id).select('id').single()
      : supabase.from('class_timetable').insert(row).select('id').single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { setNote(error.message); return; }
    const saved: ClassItem = { ...cf, id: data.id, name: row.name, days: row.days };
    setClasses(cs => cf.id ? cs.map(c => c.id === cf.id ? saved : c) : [...cs, saved]);
    setCf(emptyClass);
    setNote(`${row.name} 수업을 저장했어요.`);
  }

  async function remove() {
    if (!cf.id) return;
    const { error } = await supabase.from('class_timetable').delete().eq('id', cf.id);
    if (error) { setNote(error.message); return; }
    setClasses(cs => cs.filter(c => c.id !== cf.id));
    setNote(`${cf.name} 수업을 지웠어요.`);
    setCf(emptyClass);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-3">
        <div className="grid min-w-[320px] gap-x-1 gap-y-1.5" style={{ gridTemplateColumns: `40px repeat(${gridDays.length},minmax(52px,1fr))` }}>
          <div />
          {gridDays.map(d => <div key={d} className="text-center text-xs font-bold text-muted">{d}</div>)}
          <div className="relative" style={{ height: HOURS * PX }}>
            {Array.from({ length: HOURS + 1 }, (_, i) => (
              <div key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-faint tabular-nums" style={{ top: i * PX }}>{HOUR0 + i}</div>
            ))}
          </div>
          {gridDays.map(d => {
            const list = classes.filter(c => c.days.includes(d));
            const lanes = layoutLanes(list.map(c => ({ id: c.id!, start: c.start, end: c.end })));
            return (
              <div key={d} className="relative rounded-[10px] bg-[#faf6f0]"
                style={{ height: HOURS * PX, backgroundImage: `repeating-linear-gradient(to bottom,#efe7dc 0,#efe7dc 1px,transparent 1px,transparent ${PX}px)` }}>
                {list.map(c => {
                  const a = Math.max(toMin(c.start), HOUR0 * 60), b = Math.min(toMin(c.end), (HOUR0 + HOURS) * 60);
                  const { lane, lanes: n } = lanes.get(c.id!)!;
                  const [bg, ink] = colorOf(c.id);
                  return (
                    <button key={c.id} onClick={() => { setCf({ ...c, days: [...c.days] }); setNote(''); }}
                      className="absolute flex flex-col gap-px overflow-hidden rounded-lg px-1.5 py-1 text-left"
                      style={{
                        top: ((a - HOUR0 * 60) / 60) * PX, height: Math.max(22, ((b - a) / 60) * PX - 2),
                        left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`,
                        background: bg, color: ink, border: cf.id === c.id ? `2px solid ${ink}` : 'none',
                      }}>
                      <span className="text-xs leading-tight font-bold">{c.name}</span>
                      <span className="text-[10px] tabular-nums opacity-85">{c.start}–{c.end}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-bold">{cf.id ? `${cf.name || '수업'} 수정` : '수업 추가'}</div>
          {cf.id && <button onClick={() => { setCf(emptyClass); setNote(''); }} className="min-h-9 rounded-full bg-chip px-3 text-[13px] text-ink-2">새 수업으로</button>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
          <input value={cf.name} onChange={e => set({ name: e.target.value })} placeholder="과목명 (필수)" className={inputCls} />
          <input value={cf.place} onChange={e => set({ place: e.target.value })} placeholder="강의실 (선택)" className={inputCls} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-ink-2">요일 · 여러 개 선택</div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(d => {
              const on = cf.days.includes(d);
              return (
                <button key={d} onClick={() => set({ days: on ? cf.days.filter(x => x !== d) : [...cf.days, d] })}
                  className={`h-11 w-12 rounded-xl text-sm font-bold ${on ? 'bg-accent text-white' : 'border border-line-strong bg-surface'}`}>{d}</button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-ink-2">시간 · 자주 쓰는 시간을 누르거나 직접 입력</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {PRESETS.map(([a, b]) => (
              <button key={a} onClick={() => set({ start: a, end: b })}
                className={`min-h-10 flex-none rounded-full px-3 text-[13px] font-semibold whitespace-nowrap tabular-nums ${pill(cf.start === a && cf.end === b)}`}>{a}–{b}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="time" step={300} value={cf.start} onChange={e => set({ start: e.target.value })} className={`${inputCls} min-w-0 flex-1`} />
            <span className="text-faint">–</span>
            <input type="time" step={300} value={cf.end} onChange={e => set({ end: e.target.value })} className={`${inputCls} min-w-0 flex-1`} />
          </div>
        </div>
        {(note || cc.msg) && <div className={`text-[13px] leading-normal ${note ? 'text-[#2d6a3a]' : TONE[cc.tone]}`}>{note || cc.msg}</div>}
        <div className="flex gap-2">
          {cf.id && <button onClick={remove} className="min-h-12 flex-none rounded-full border border-[#e9c9bd] bg-surface px-[18px] text-sm font-semibold text-danger">삭제</button>}
          <button onClick={save} disabled={!cc.ok || busy} className="min-h-12 flex-1 rounded-full bg-accent text-[15px] font-bold text-white disabled:bg-disabled">
            {cf.id ? '변경 저장' : '시간표에 추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Events({ supabase, events, setEvents }: Pick<Props, 'supabase' | 'events' | 'setEvents'>) {
  const [ef, setEf] = useState<EventDraft>({ kind: '약속', date: '', start: '', end: '', allDay: false, description: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ec = checkEvent(ef);
  const set = (p: Partial<EventDraft>) => setEf(e => ({ ...e, ...p }));
  const sorted = [...events].sort((x, y) => (x.date + (x.start || '00')).localeCompare(y.date + (y.start || '00')));

  async function save() {
    if (!ec.ok || busy) return;
    setBusy(true);
    const row = {
      kind: ef.kind, date: ef.date, all_day: ef.allDay, description: ef.description.trim(), source: 'manual',
      start_time: ef.allDay ? null : ef.start, end_time: ef.allDay ? null : ef.end,
    };
    const { data, error } = await supabase.from('schedules').insert(row).select('id').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEvents(es => [...es, { ...ef, description: row.description, id: data.id, source: 'manual' }]);
    setEf({ kind: ef.kind, date: '', start: '', end: '', allDay: false, description: '' });
    setErr('');
  }

  async function remove(id: number) {
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    setEvents(es => es.filter(e => e.id !== id));
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-4">
        <div className="text-[15px] font-bold">일정 추가</div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-ink-2">종류</div>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_KINDS.map(k => (
              <button key={k} onClick={() => set({ kind: k })} className={`min-h-10 rounded-full px-3.5 text-[13px] font-semibold ${pill(ef.kind === k)}`}>{k}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-ink-2">날짜 (필수)</div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {dateShortcuts().map(c => (
              <button key={c.label} onClick={() => set({ date: c.iso })}
                className={`min-h-10 flex-none rounded-full px-3 text-[13px] font-semibold whitespace-nowrap ${pill(ef.date === c.iso)}`}>{c.label}</button>
            ))}
          </div>
          <input type="date" value={ef.date} onChange={e => set({ date: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-ink-2">시간 (필수)</div>
            <button onClick={() => set({ allDay: !ef.allDay })} role="switch" aria-checked={ef.allDay}
              className="flex min-h-9 items-center gap-2 px-1 text-[13px] text-ink-2">
              <span className={`relative h-[22px] w-9 rounded-full ${ef.allDay ? 'bg-accent' : 'bg-[#d8cec2]'}`}>
                <span className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow" style={{ left: ef.allDay ? 16 : 2 }} />
              </span>
              하루 종일
            </button>
          </div>
          {!ef.allDay && (
            <div className="flex items-center gap-2">
              <input type="time" step={300} value={ef.start} onChange={e => set({ start: e.target.value })} className={`${inputCls} min-w-0 flex-1`} />
              <span className="text-faint">–</span>
              <input type="time" step={300} value={ef.end} onChange={e => set({ end: e.target.value })} className={`${inputCls} min-w-0 flex-1`} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-ink-2">설명 (필수)</div>
          <input value={ef.description} onChange={e => set({ description: e.target.value })} placeholder={DESC_PH[ef.kind]} className={inputCls} />
        </div>
        {(err || ec.msg) && <div className="text-[13px] leading-normal text-warn">{err || ec.msg}</div>}
        <button onClick={save} disabled={!ec.ok || busy} className="min-h-12 rounded-full bg-accent text-[15px] font-bold text-white disabled:bg-disabled">일정 추가</button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-ink-2">다가오는 일정 {events.length}개</div>
        <div className="flex flex-col rounded-2xl border border-line bg-surface">
          {sorted.map((e, i) => (
            <div key={e.id} className={`flex items-center gap-3 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
              <div className="flex w-[76px] flex-none flex-col gap-0.5">
                <div className="text-[13px] font-bold tabular-nums">{fmtDate(e.date)}</div>
                <div className="text-[11px] text-muted tabular-nums">{e.allDay ? '하루 종일' : `${e.start}–${e.end}`}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="text-sm font-semibold">{e.description}</div>
                <div className="flex flex-wrap gap-1">
                  <span className="rounded-lg bg-chip px-2 py-0.5 text-[11px] text-ink-2">{e.kind}</span>
                  <span className="rounded-lg bg-chip px-2 py-0.5 text-[11px] text-muted">{SOURCE_LABEL[e.source] ?? e.source}</span>
                </div>
              </div>
              <button onClick={() => remove(e.id)} className="min-h-9 flex-none rounded-[10px] px-2.5 text-xs text-faint">삭제</button>
            </div>
          ))}
          {!events.length && <div className="p-3.5 text-[13px] text-faint">아직 일정이 없어요.</div>}
        </div>
      </div>
    </div>
  );
}
