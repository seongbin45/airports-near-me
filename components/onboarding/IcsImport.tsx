'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkClass, checkEvent, DAYS, EVENT_KINDS, type ClassItem, type EventKind } from '@/lib/onboarding/validate';
import { existingClassNote, existingEvent, ICS_MAX_BYTES, parseIcs, type IcsClass, type IcsEvent, type IcsSkip } from '@/lib/data/ics';
import { fmtDate, kstToday } from '@/lib/time';
import { inputCls } from '@/components/ui';
import type { EventItem } from './ScheduleStep';

interface ClassRow { c: IcsClass; name: string; on: boolean; note: string | null }
interface EventRow { e: IcsEvent; description: string; kind: EventKind; on: boolean; dup: boolean }

interface Props {
  supabase: SupabaseClient;
  isStudent: boolean;
  classes: ClassItem[];
  setClasses: Dispatch<SetStateAction<ClassItem[]>>;
  events: EventItem[];
  setEvents: Dispatch<SetStateAction<EventItem[]>>;
  onClose: () => void;
}

const toClassItem = (r: ClassRow): ClassItem => ({ name: r.name.trim(), place: r.c.place, days: [...r.c.days], start: r.c.start, end: r.c.end });
const toDraft = (r: EventRow) => ({ kind: r.kind, date: r.e.date, start: r.e.start, end: r.e.end, allDay: r.e.allDay, description: r.description });

/** .ics 파일을 브라우저에서 읽어 수업·일정 후보를 보여주고, 사용자가 고른 것만 저장한다. 파일은 서버로 보내지 않는다. */
export default function IcsImport({ supabase, isStudent, classes, setClasses, events, setEvents, onClose }: Props) {
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [classRows, setClassRows] = useState<ClassRow[]>([]);
  const [eventRows, setEventRows] = useState<EventRow[]>([]);
  const [skipped, setSkipped] = useState<IcsSkip[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const loaded = !!fileName && !error;

  async function onFile(file: File | undefined) {
    setError(''); setDone(''); setClassRows([]); setEventRows([]); setSkipped([]); setNotices([]);
    if (!file) return;
    setFileName(file.name);
    if (file.size > ICS_MAX_BYTES) { setError('파일이 1MB보다 커요. 수업·일정이 든 캘린더만 골라 내보내 주세요.'); return; }
    const r = parseIcs(await file.text(), { today: kstToday() });
    if (!r.ok) { setError(r.error); return; }
    setClassRows(r.classes.map(c => {
      const note = existingClassNote(c, classes);
      return { c, name: c.name, on: isStudent && !note, note };
    }));
    setEventRows(r.events.map(e => {
      const dup = existingEvent(e, events);
      return { e, description: e.description, kind: e.kind, on: !dup, dup };
    }));
    setSkipped(r.skipped);
    setNotices(r.notices);
    if (!r.classes.length && !r.events.length) setError('가져올 수 있는 수업·일정이 없어요. 아래 사유를 확인해 주세요.');
  }

  // 수업: 과목명이 있어야 하고(checkClass), 겹침은 경고만. 이미 있는 수업과 이번에 고른 다른 수업을 함께 본다.
  const classChecks = classRows.map((r, i) =>
    checkClass(toClassItem(r), [...classes, ...classRows.filter((x, j) => j < i && x.on).map(toClassItem)]));
  // 일정: 설명 등 필수값이 빠진 후보가 하나라도 체크된 채 들어가면 배치 insert 전체가 CHECK 위반(23514)으로 실패한다.
  // 그래서 checkEvent를 통과하지 못한 후보는 고를 수 없게 한다(설명을 채우면 고를 수 있다).
  const eventChecks = eventRows.map(r => checkEvent(toDraft(r)));
  const pickedClasses = classRows.filter((r, i) => r.on && classChecks[i].ok);
  const pickedEvents = eventRows.filter((r, i) => r.on && eventChecks[i].ok);
  const total = pickedClasses.length + pickedEvents.length;

  async function add() {
    if (!total || busy) return;
    setBusy(true); setError('');
    let addedClasses = 0, addedEvents = 0;
    if (pickedClasses.length) {
      const rows = pickedClasses.map(r => ({
        name: r.name.trim(), place: r.c.place || null, days: DAYS.filter(d => r.c.days.includes(d)),
        start_time: r.c.start, end_time: r.c.end, source: 'ics',
      }));
      const { data, error } = await supabase.from('class_timetable').insert(rows).select('id');
      if (error) { setBusy(false); setError(`수업을 저장하지 못했어요: ${error.message}`); return; }
      setClasses(cs => [...cs, ...rows.map((row, i) => ({ id: data[i].id, name: row.name, place: row.place ?? '', days: row.days, start: row.start_time, end: row.end_time }))]);
      addedClasses = rows.length;
    }
    if (pickedEvents.length) {
      const rows = pickedEvents.map(r => ({
        kind: r.kind, date: r.e.date, all_day: r.e.allDay, description: r.description.trim(), source: 'ics',
        start_time: r.e.allDay ? null : r.e.start, end_time: r.e.allDay ? null : r.e.end,
      }));
      const { data, error } = await supabase.from('schedules').insert(rows).select('id');
      if (error) {
        setBusy(false);
        setError(`${addedClasses ? `수업 ${addedClasses}개는 저장했지만 ` : ''}일정을 저장하지 못했어요: ${error.message}`);
        setClassRows([]);
        return;
      }
      setEvents(es => [...es, ...pickedEvents.map((r, i) => ({ ...toDraft(r), description: rows[i].description, id: data[i].id, source: 'ics' }))]);
      addedEvents = rows.length;
    }
    setBusy(false);
    setClassRows([]); setEventRows([]); setSkipped([]); setNotices([]); setFileName('');
    setDone(`수업 ${addedClasses}개 · 일정 ${addedEvents}개를 추가했어요. 아래에서 고칠 수 있어요.`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold">.ics 파일로 불러오기</div>
        <button onClick={onClose} className="min-h-9 rounded-full bg-chip px-3 text-[13px] text-ink-2">닫기</button>
      </div>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-normal text-ink-2">
        <li>구글 캘린더(웹): 설정 → 가져오기/내보내기 → 내보내기. 받은 zip을 풀면 .ics 파일이 있어요.</li>
        <li>애플 캘린더(Mac): 캘린더를 고른 뒤 파일 → 내보내기 → 내보내기.</li>
        <li>파일은 이 기기에서만 읽고 서버로 보내지 않아요. 고른 수업·일정만 저장돼요.</li>
      </ol>
      <div className="text-xs leading-normal text-muted">에브리타임은 파일 내보내기를 지원하지 않아 직접 입력해 주세요.</div>
      {/* 값을 비워 두어야 같은 파일을 다시 골라도 change가 일어난다 (고친 뒤 다시 가져오기) */}
      <input type="file" accept=".ics,text/calendar" onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
        className="text-sm file:mr-3 file:min-h-10 file:rounded-full file:border file:border-line-strong file:bg-surface file:px-4 file:text-sm file:font-semibold" />

      {loaded && <div className="text-xs text-muted">읽은 파일: {fileName}</div>}
      {error && <div className="text-[13px] leading-normal text-danger">{error}</div>}
      {done && <div className="text-[13px] leading-normal text-[#2d6a3a]">{done}</div>}

      {loaded && classRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-ink-2">매주 반복 → 수업 시간표 {classRows.length}개</div>
          {!isStudent && <div className="text-xs text-muted">수업 시간표는 학생 유형에서만 써요. 필요하면 일정으로 직접 추가해 주세요.</div>}
          <div className="flex flex-col rounded-2xl border border-line">
            {classRows.map((r, i) => {
              const chk = classChecks[i];
              const can = isStudent && chk.ok;
              const set = (p: Partial<ClassRow>) => setClassRows(rs => rs.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className={`flex gap-3 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
                  <input type="checkbox" className="mt-1 h-5 w-5 flex-none accent-[var(--color-accent)]" checked={r.on && can} disabled={!can}
                    onChange={e => set({ on: e.target.checked })} aria-label={`${r.name} 추가`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <input value={r.name} onChange={e => set({ name: e.target.value })} placeholder="과목명 (필수)" className={`${inputCls} min-h-10 py-1.5`} />
                    <div className="text-xs text-muted tabular-nums">{r.c.days.join('·')} {r.c.start}–{r.c.end}{r.c.place ? ` · ${r.c.place}` : ''}</div>
                    {r.note && <div className="text-xs text-warn">{r.note}</div>}
                    {chk.msg && <div className={`text-xs ${chk.ok ? 'text-warn' : 'text-danger'}`}>{chk.msg}</div>}
                    {r.c.cancelled.length > 0 && (
                      <div className="text-xs leading-normal text-warn">
                        취소된 회차 {r.c.cancelled.length}건({r.c.cancelled.map(fmtDate).join(', ')}) — 주간 시간표에는 반영할 수 없어요. 그 날짜는 앱에서 직접 확인하세요.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loaded && eventRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-ink-2">일회성 → 다가오는 일정 {eventRows.length}개</div>
          <div className="flex max-h-[420px] flex-col overflow-y-auto rounded-2xl border border-line">
            {eventRows.map((r, i) => {
              const chk = eventChecks[i];
              const set = (p: Partial<EventRow>) => setEventRows(rs => rs.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className={`flex gap-3 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
                  <input type="checkbox" className="mt-1 h-5 w-5 flex-none accent-[var(--color-accent)]" checked={r.on && chk.ok} disabled={!chk.ok}
                    onChange={e => set({ on: e.target.checked })} aria-label={`${r.description || '일정'} 추가`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="text-xs font-bold tabular-nums">{fmtDate(r.e.date)} · {r.e.allDay ? '하루 종일' : `${r.e.start}–${r.e.end}`}{r.e.moved ? ' · 옮겨진 수업' : ''}</div>
                    <div className="flex gap-1.5">
                      <select value={r.kind} onChange={e => set({ kind: e.target.value as EventKind })} className={`${inputCls} min-h-10 w-[84px] flex-none py-1.5`} aria-label="종류">
                        {EVENT_KINDS.map(k => <option key={k}>{k}</option>)}
                      </select>
                      <input value={r.description} onChange={e => set({ description: e.target.value, on: true })} placeholder="설명 (필수)" className={`${inputCls} min-h-10 min-w-0 flex-1 py-1.5`} />
                    </div>
                    {r.dup && <div className="text-xs text-warn">이미 일정에 있어요</div>}
                    {!chk.ok && <div className="text-xs text-danger">{chk.msg.includes('설명') ? '설명을 채워야 추가할 수 있어요.' : chk.msg}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loaded && (skipped.length > 0 || notices.length > 0) && (
        <details className="rounded-xl bg-[#faf6f0] px-3.5 py-2.5 text-xs leading-normal text-ink-2">
          <summary className="cursor-pointer font-semibold">가져오지 않은 것 {skipped.length}건{notices.length ? ` · 안내 ${notices.length}건` : ''}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {notices.map(n => <li key={n}>{n}</li>)}
            {skipped.map((s, i) => <li key={i}><b>{s.summary}</b> — {s.reason}</li>)}
          </ul>
        </details>
      )}

      {loaded && (classRows.length > 0 || eventRows.length > 0) && (
        <button onClick={add} disabled={!total || busy} className="min-h-12 rounded-full bg-accent text-[15px] font-bold text-white disabled:bg-disabled">
          {busy ? '추가하는 중…' : total ? `${total}개 추가` : '추가할 항목을 골라 주세요'}
        </button>
      )}
    </div>
  );
}
