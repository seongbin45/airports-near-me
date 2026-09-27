'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkClass, DAYS, type ClassItem } from '@/lib/onboarding/validate';
import { existingClassNote, insertedId } from '@/lib/data/ics';
import { safeSnap, type EtItem, type EtSkip } from '@/lib/everytime/items';
import { parseTimetableXml } from '@/lib/everytime/xml';
import { BOOKMARKLET } from '@/lib/everytime/bookmarklet';
import { inputCls } from '@/components/ui';

interface Row { item: EtItem; on: boolean; timeOk: boolean; note: string | null }
interface Preview { semester: string | null; rows: Row[]; skipped: EtSkip[] }
type Msg = { text: string; kind: 'error' | 'warn' } | null;

interface Props {
  supabase: SupabaseClient;
  classes: ClassItem[];
  setClasses: Dispatch<SetStateAction<ClassItem[]>>;
}

const GUIDE = [
  '에브리타임 앱에서 시간표 탭 → 오른쪽 위 설정(톱니바퀴) → 공개 범위를 "전체 공개"로 바꿔요.',
  '공유 아이콘 → "URL 복사"로 링크를 복사해요.',
  '브라우저(PC 크롬·엣지 등)에서 그 링크를 열고, 아래 북마크 [에브리타임 → 공항 찾기]를 눌러요.',
  '복사된 내용을 아래 칸에 붙여넣고 불러오기를 눌러요.',
];

const toClass = (r: Row): ClassItem => ({ name: r.item.name.trim(), place: r.item.place, days: [...r.item.days], start: r.item.start, end: r.item.end });

/** 결과를 미리보기 행으로: 이미 있는 과목은 체크를 풀어 두고, 온라인 강의는 고를 수 없다 */
export function toRows(items: EtItem[], classes: ClassItem[]): Row[] {
  return items.map(item => {
    const note = item.online ? null : existingClassNote(item, classes);
    return { item, on: !item.online && !note, timeOk: !item.needsTimeCheck, note };
  });
}

/**
 * 에브리타임 시간표 불러오기 (가입 4단계 · 수업 시간표 탭, 시안 '공항 찾기 시작하기').
 * 공유 링크 방식: 사용자 브라우저에서 북마클릿이 XML을 받아 복사 → 여기 붙여넣기 → 미리보기 → 고른 과목만 저장.
 * 서버는 에브리타임에 접속하지 않는다(docs/EVERYTIME.md). 링크·원문은 저장하지 않는다.
 */
export default function EverytimeImport({ supabase, classes, setClasses }: Props) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState(false);
  const bookmark = useRef<HTMLAnchorElement>(null);

  // React는 javascript: href를 막는다. 북마크로 끌어다 놓을 수 있게 속성을 직접 넣는다.
  useEffect(() => { bookmark.current?.setAttribute('href', BOOKMARKLET); }, [open, preview]);

  function load(text: string) {
    const r = parseTimetableXml(text);
    if (!r.ok) return setMsg({ text: r.error, kind: r.kind === 'link' ? 'warn' : 'error' });
    setMsg(null);
    setPreview({ semester: r.semester, rows: toRows(r.items, classes), skipped: r.skipped });
  }

  async function pasteFromClipboard() {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      setPaste(t); setMsg(null);
    } catch {
      setMsg({ text: '클립보드를 읽을 수 없어요. 칸을 길게 눌러 직접 붙여넣어 주세요.', kind: 'warn' });
    }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(BOOKMARKLET); setCopied(true); } catch { setMsg({ text: '복사하지 못했어요. 북마크 버튼을 북마크바로 끌어다 놓아 주세요.', kind: 'warn' }); }
  }

  const rows = preview?.rows ?? [];
  // 겹침은 이미 있는 수업 + 이번에 고른 앞쪽 과목과 비교한다 (경고만, 저장은 허용)
  const picked = (r: Row, ok: boolean) => r.on && ok && !r.item.online && r.timeOk;
  const checks: (ReturnType<typeof checkClass> | null)[] = [];
  rows.forEach((r, i) => {
    checks.push(r.item.online ? null : checkClass(toClass(r), [...classes, ...rows.filter((x, j) => j < i && picked(x, !!checks[j]?.ok)).map(toClass)]));
  });
  const chosen = rows.filter((r, i) => picked(r, !!checks[i]?.ok));
  const setRow = (i: number, p: Partial<Row> & { item?: Partial<EtItem> }) => setPreview(pv => pv && ({
    ...pv, rows: pv.rows.map((x, j) => (j === i ? { ...x, ...p, item: { ...x.item, ...(p.item ?? {}) } } : x)),
  }));

  async function apply() {
    if (!chosen.length || busy) return;
    setBusy(true); setMsg(null);
    const insert = chosen.map(r => {
      const t = safeSnap(r.item.start, r.item.end); // 사용자가 고친 시각도 안전한 쪽으로
      return { name: r.item.name.trim(), place: r.item.place.trim() || null, days: DAYS.filter(d => r.item.days.includes(d)), start_time: t.start, end_time: t.end, source: 'everytime' };
    });
    const { data, error } = await supabase.from('class_timetable').insert(insert).select('id');
    setBusy(false);
    if (error) return setMsg({ text: `수업을 저장하지 못했어요: ${error.message}`, kind: 'error' });
    setClasses(cs => [...cs, ...insert.map((row, i) => ({ id: insertedId(data, i), name: row.name, place: row.place ?? '', days: row.days, start: row.start_time, end: row.end_time }))]);
    setPreview(null); setPaste(''); setOpen(false);
    setDone(`에브리타임에서 ${insert.length}과목을 시간표에 넣었어요. 블록을 눌러 고칠 수 있어요.`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-[#fbe3dc] text-sm font-extrabold text-[#c0392b]">E</div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <div className="text-sm font-bold">에브리타임 시간표 불러오기</div>
          <div className="text-xs leading-normal text-muted">공유 링크 하나로 과목·요일·시간을 한 번에 채워요.</div>
        </div>
        {!open && !preview && (
          <button onClick={() => { setOpen(true); setDone(''); setMsg(null); }}
            className="min-h-11 flex-none rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold">
            {done ? '다시 불러오기' : '불러오기'}
          </button>
        )}
      </div>

      {open && !preview && (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col rounded-xl bg-[#faf6f0]">
            {GUIDE.map((text, i) => (
              <li key={i} className={`flex items-start gap-2.5 px-3 py-2.5 ${i ? 'border-t border-[#efe7dc]' : ''}`}>
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{i + 1}</span>
                <span className="text-[13px] leading-normal text-pretty">{text}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {/* 북마크바로 끌어다 놓아 쓴다. 이 페이지에서 눌러도 에브리타임이 아니라서 동작하지 않게 막는다 */}
            <a ref={bookmark} onClick={e => { e.preventDefault(); setMsg({ text: '이 버튼은 북마크바로 끌어다 놓은 뒤, 에브리타임 공유 링크 페이지에서 눌러 주세요.', kind: 'warn' }); }}
              className="flex min-h-10 cursor-grab items-center rounded-full bg-[#fbe3dc] px-4 text-[13px] font-bold text-[#c0392b]" data-testid="everytime-bookmarklet">
              에브리타임 → 공항 찾기
            </a>
            <button onClick={copyCode} className="min-h-10 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold">
              {copied ? '코드를 복사했어요' : '북마크 코드 복사'}
            </button>
          </div>
          <div className="text-xs leading-normal text-muted text-pretty">
            끌어다 놓기가 안 되면(휴대폰 등) 코드를 복사해 새 북마크의 주소 칸에 붙여넣고, 에브리타임 링크 페이지의 주소창에 그 북마크 이름을 입력해 눌러 주세요.
          </div>
          <textarea value={paste} onChange={e => { setPaste(e.target.value); setMsg(null); }} rows={3}
            placeholder="북마크를 누르면 복사되는 내용을 여기에 붙여넣어요" aria-label="에브리타임에서 복사한 내용"
            className={`${inputCls} min-h-24 py-2.5 font-mono text-xs`} />
          <div className="flex flex-wrap gap-2">
            <button onClick={pasteFromClipboard} className="min-h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-[13px] font-semibold text-ink-2">붙여넣기</button>
            <button onClick={() => load(paste)} disabled={!paste.trim()}
              className="min-h-12 flex-1 rounded-[14px] bg-accent px-4 text-sm font-bold text-white disabled:bg-disabled">불러오기</button>
            <button onClick={() => { setOpen(false); setMsg(null); }} className="min-h-12 rounded-[14px] px-3 text-[13px] text-muted">닫기</button>
          </div>
          <div className="text-[11px] leading-normal text-faint text-pretty">
            공개 시간표를 내 브라우저에서 한 번 읽어 와요. 링크와 원본은 저장하지 않고, 고른 과목만 시간표에 넣어요. 에브리타임 계정 로그인은 필요 없어요.
          </div>
        </div>
      )}

      {msg && <div className={`text-xs leading-normal text-pretty ${msg.kind === 'error' ? 'text-danger' : 'text-warn'}`}>{msg.text}</div>}

      {preview && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 text-[13px] font-semibold text-ink-2">{preview.semester ?? '에브리타임 시간표'} · {chosen.length}과목 선택</div>
          </div>
          <div className="flex flex-col rounded-xl border border-line">
            {rows.map((r, i) => {
              const chk = checks[i];
              const can = !r.item.online && !!chk?.ok && r.timeOk;
              const note = r.item.online ? '시간이 없는 과목은 출발 시각 계산에 쓰지 않아 뺐어요.'
                : r.note ?? (chk && !chk.ok ? chk.msg : chk?.msg ? chk.msg : '');
              return (
                <div key={i} className={`flex gap-3 px-3 py-2.5 ${i ? 'border-t border-divider' : ''}`}>
                  <input type="checkbox" className="mt-0.5 h-5 w-5 flex-none accent-[var(--color-accent)]"
                    checked={r.on && can} disabled={!can} onChange={e => setRow(i, { on: e.target.checked })} aria-label={`${r.item.name} 추가`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="text-sm font-semibold">{r.item.name}</div>
                    <div className="text-xs text-muted tabular-nums">
                      {r.item.online ? '시간 없음 (온라인 강의)' : `${r.item.days.join('·')} ${r.item.start}–${r.item.end}`}{r.item.place ? ` · ${r.item.place}` : ''}
                    </div>
                    {note && <div className={`text-[11px] ${chk?.tone === 'warn' || chk?.tone === 'error' ? 'text-warn' : 'text-faint'}`}>{note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {preview.skipped.length > 0 && (
            <details className="rounded-xl bg-[#faf6f0] px-3.5 py-2.5 text-xs leading-normal text-ink-2">
              <summary className="cursor-pointer font-semibold">넣지 못한 것 {preview.skipped.length}건</summary>
              <ul className="mt-2 flex flex-col gap-1">{preview.skipped.map((s, i) => <li key={i}><b>{s.name}</b> — {s.reason}</li>)}</ul>
            </details>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setPreview(null); setOpen(true); }} className="min-h-12 flex-none rounded-full border border-line-strong bg-surface px-[18px] text-sm font-semibold text-ink-2">취소</button>
            <button onClick={apply} disabled={!chosen.length || busy} className="min-h-12 flex-1 rounded-full bg-accent text-[15px] font-bold text-white disabled:bg-disabled">
              {busy ? '추가하는 중…' : chosen.length ? `${chosen.length}과목 시간표에 추가` : '추가할 과목을 골라주세요'}
            </button>
          </div>
        </div>
      )}

      {done && !open && !preview && <div className="text-[13px] leading-normal text-[#2d6a3a]">{done}</div>}
    </div>
  );
}
