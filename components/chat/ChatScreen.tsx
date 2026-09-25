'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, TopBar } from '@/components/ui';
import { MODE_LABEL, type Mode, type Recommendation } from '@/lib/recommend';
import { dateShortcuts, fmtDate, parseDate } from '@/lib/time';
import { DEFAULT_REASONS, parseTime, reasonCrossCheck, type Step, type Visit } from '@/lib/chat/flow';
import type { DayItem } from '@/lib/day';
import { mismatchList, type VerifyDetail } from '@/lib/ai/verify';
import { MessageList, type Msg } from './Messages';
import InfoPanel from './InfoPanel';

interface Props {
  name: string | null;
  userType: string | null;
  aiEnabled: boolean;
  country: string;
  home: string | null;
  visits: Visit[];
  destinations: string[];
  airports: { code: string; name: string }[];
}

interface Answers { dest?: string; date?: string; departure?: string; reason?: string }
type Result = Recommendation & { regionMissing: boolean; tripId: number | null; publishedUntil: string | null };

export default function ChatScreen(p: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [a, setA] = useState<Answers>({});
  const [mode, setMode] = useState<Mode>('car');
  const [result, setResult] = useState<Result | null>(null);
  const [dayItems, setDayItems] = useState<DayItem[]>([]);
  const [earliest, setEarliest] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [aiCalls, setAiCalls] = useState(0);
  const [sheet, setSheet] = useState(false);
  const uid = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const airportName = (code: string) => p.airports.find(x => x.code === code)?.name ?? code;
  const visitsTo = (dest: string) => p.visits.filter(v => v.dest_city === dest);
  const push = (...m: Omit<Msg, 'id'>[]) => setMsgs(list => [...list, ...m.map(x => ({ ...x, id: ++uid.current }))]);

  function greet() {
    push({
      role: 'bot',
      text: `${p.name ? `${p.name}님, ` : ''}이번엔 어디로 가시나요?\n지난 방문 기록에 있는 곳을 골라도 되고, 직접 적어도 돼요.`,
      src: p.visits.length ? '출처 · 방문 기록 DB' : '출처 · 운항 스케줄 DB',
    });
  }
  // 첫 인사 한 번
  const greeted = useRef(false);
  useEffect(() => { if (!greeted.current) { greeted.current = true; greet(); } });

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, typing, result]);

  async function api<T>(url: string, body?: object): Promise<T> {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? '요청에 실패했어요.');
    return json as T;
  }

  async function withTyping(fn: () => Promise<void>) {
    setTyping(true);
    try { await fn(); } catch (e) { push({ role: 'bot', text: (e as Error).message, src: '오류', error: true }); } finally { setTyping(false); }
  }

  async function answer(raw: string) {
    const t = raw.trim();
    if (!t || typing) return;
    setInput('');
    push({ role: 'user', text: t });

    if (step === 0) {
      const dest = p.destinations.find(d => t.includes(d));
      if (!dest) return push({ role: 'bot', text: `'${t}' 노선은 아직 운항 스케줄 DB에 없어요. 지금은 ${p.destinations.join('·')}만 있어요.`, src: '출처 · 운항 스케줄 DB' });
      setA({ dest }); setStep(1);
      return push({ role: 'bot', text: `${dest} 일정은 언제인가요?\n아래에서 고르거나 10/2처럼 적어주세요.`, src: '출처 · 사용자 입력' });
    }

    if (step === 1) {
      const date = dateShortcuts().find(c => c.label === t)?.iso ?? parseDate(t);
      if (!date) return push({ role: 'bot', text: '날짜를 알아듣지 못했어요. 10/2 또는 2026-10-02처럼 적어주세요.', src: '출처 · 사용자 입력' });
      setA(x => ({ ...x, date })); setStep(2);
      return withTyping(async () => {
        const day = await api<{ items: DayItem[]; earliest: string | null }>(`/api/day?date=${date}`);
        setDayItems(day.items);
        setEarliest(day.earliest);
        push(day.items.length
          ? {
              role: 'bot', src: '출처 · 일정 DB',
              text: `${fmtDate(date)}에 등록된 일정을 확인했어요.${day.earliest ? ` 마지막 일정이 ${day.earliest}에 끝나요.` : ''}\n몇 시 이후에 출발할까요?`,
              schedule: { title: `${fmtDate(date)} · ${p.userType === '대학생' ? '수업 시간표 + 개인 일정' : '일정'}`, items: day.items, earliest: day.earliest },
            }
          : { role: 'bot', src: '출처 · 일정 DB', text: `${fmtDate(date)}에는 등록된 일정이 없어요. 몇 시에 출발할까요?\n15:00이나 오후 3시처럼 적어주세요.` });
      });
    }

    if (step === 2) {
      const departure = parseTime(t);
      if (!departure) return push({ role: 'bot', text: '시각을 알아듣지 못했어요. 15:00이나 오후 3시처럼 적어주세요.', src: '출처 · 사용자 입력' });
      setA(x => ({ ...x, departure })); setStep(3);
      const h = visitsTo(a.dest!);
      return push({
        role: 'bot', src: '출처 · 방문 기록 DB (구글 타임라인 가져오기)',
        text: h.length ? `이번 ${a.dest} 방문 이유를 알려주세요. 지난 기록을 참고하세요.` : `이번 ${a.dest} 방문 이유를 알려주세요.`,
        history: h.length ? { title: `지난 ${a.dest} 방문 ${h.length}회`, items: h.map(v => ({ date: v.visited_on.slice(0, 7).replace('-', '.'), reason: v.reason ?? '이유 미입력', from: v.from_airport ? airportName(v.from_airport) : '-' })) } : undefined,
      });
    }

    if (step === 3) {
      const answers = { ...a, reason: t };
      setA(answers); setStep(4);
      return withTyping(async () => {
        const r = await api<Result>('/api/recommend', { dest: answers.dest, date: answers.date, departure: answers.departure, mode, reason: t });
        setResult(r);
        const allDay = dayItems.filter(i => i.endMin == null).map(i => `'${i.title}'`);
        const lines = [
          allDay.length ? `그날 하루 종일 일정 ${allDay.join(', ')}이 있어요.` : '',
          reasonCrossCheck(t, visitsTo(answers.dest!), airportName),
          r.regionMissing ? '거주지에서 공항까지 걸리는 시간이 아직 DB에 없어 계산할 수 없어요.'
            : !r.rows.length && r.publishedUntil && answers.date! > r.publishedUntil
              ? `${fmtDate(r.publishedUntil)} 이후 운항 스케줄은 아직 공개되지 않았어요. 공개되면 자동으로 불러와요.`
              : `${answers.departure}에 출발하면 공항별로 이렇게 걸려요.`,
        ].filter(Boolean);
        push({ role: 'bot', text: lines.join('\n'), results: true, src: '출처 · 일정 DB + 방문 기록 DB + 운항 스케줄 DB' });
      });
    }

    // 결과 이후 자유 질문 → AI 호출 전에 확인을 받는다
    if (!p.aiEnabled) return push({ role: 'bot', text: 'AI 사용이 꺼져 있어 DB 결과 밖의 질문에는 답할 수 없어요. 내 데이터 → 개인정보에서 켤 수 있어요.', src: '출처 · 계정 설정' });
    push({ role: 'bot', pending: t, src: 'AI 호출 대기 · 사용자 승인 필요' });
  }

  async function switchMode(m: Mode) {
    setMode(m);
    await withTyping(async () => {
      const r = await api<Result>('/api/recommend', { dest: a.dest, date: a.date, departure: a.departure, mode: m, reason: a.reason, save: false });
      setResult(prev => ({ ...r, tripId: prev?.tripId ?? null }));
    });
  }

  async function callAI(kind: 'summary' | 'question', question?: string, pendingId?: number) {
    setMsgs(list => list.filter(x => x.id !== pendingId));
    if (kind === 'summary') push({ role: 'user', text: 'AI 요약 받기' });
    setAiCalls(n => n + 1);
    await withTyping(async () => {
      const r = await api<{ verified: boolean; text: string | null; detail: VerifyDetail | null; refused: boolean; parseError: boolean; provider: string | null }>('/api/ai', {
        kind, question, dest: a.dest, date: a.date, departure: a.departure, mode, reason: a.reason, tripId: result?.tripId,
      });
      if (r.verified && r.text) {
        const d = r.detail!;
        push({ role: 'bot', ai: true, text: r.text, src: `AI가 쓴 문장${r.provider ? ` · ${r.provider}` : ''} · DB 결과만 사용`, verify: `DB 대조 통과 · 편명 ${d.flights.checked.length}개, 시각 ${d.times.checked.length}개 일치` });
      } else {
        const bad = r.detail ? mismatchList(r.detail) : [];
        push({
          role: 'bot', error: true, src: 'AI 응답 차단',
          text: r.refused ? 'AI가 이 요청에 답하지 않았어요.' : r.parseError ? 'AI 답이 정해진 형식이 아니어서 보여드리지 않아요.'
            : `AI 답에 DB와 맞지 않는 값${bad.length ? `(${bad.join(', ')})` : ''}이 있어 보여드리지 않아요. 위 표를 기준으로 봐주세요.`,
        });
      }
    });
  }

  function reset() {
    setMsgs([]); setStep(0); setA({}); setResult(null); setDayItems([]); setEarliest(null); setAiCalls(0);
    setTimeout(greet, 0);
  }

  const chips: { label: string; onClick?: () => void; primary?: boolean }[] = typing ? [] :
    step === 0 ? p.destinations.map(d => ({ label: visitsTo(d).length ? `${d} · 지난 ${visitsTo(d).length}회` : d, onClick: () => answer(d) }))
    : step === 1 ? dateShortcuts().map(c => ({ label: c.label }))
    : step === 2 ? [...(earliest ? [{ label: `${earliest} 이후 출발할게요`, onClick: () => answer(earliest) }] : []), ...['09:00', '12:00', '15:00', '18:00'].filter(x => x !== earliest).map(label => ({ label }))]
    : step === 3 ? [...new Set([...visitsTo(a.dest!).map(v => v.reason).filter(Boolean) as string[], ...DEFAULT_REASONS])].map(label => ({ label }))
    : [
        ...(p.aiEnabled ? [{ label: 'AI 요약 받기', onClick: () => callAI('summary'), primary: true }] : []),
        { label: `${MODE_LABEL[mode === 'car' ? 'transit' : 'car']}으로 보기`, onClick: () => switchMode(mode === 'car' ? 'transit' : 'car') },
        { label: '처음부터 다시', onClick: reset },
      ];

  const fields = [
    { label: '국가', value: p.country, src: '계정 설정 · 타국가는 관리자 승인 후' },
    { label: '거주지', value: p.home, src: '계정 설정' },
    { label: '목적지', value: a.dest, src: '사용자 입력' },
    { label: '날짜', value: a.date && fmtDate(a.date), src: '사용자 입력' },
    { label: '출발 가능', value: a.departure && `${a.departure} 이후`, src: '일정 DB 대조' },
    { label: '방문 이유', value: a.reason, src: '사용자 입력 · 기록 대조' },
  ];
  const filled = fields.filter(f => f.value).length;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar>
        <Badge />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-base font-bold">공항 찾기</div>
          <div className="text-xs text-muted">{p.userType ?? '사용자'} · {p.country} 국내선</div>
        </div>
        <button onClick={() => setSheet(s => !s)}
          className="min-h-10 flex-none rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold whitespace-nowrap min-[980px]:hidden">
          수집 정보 {filled}/{fields.length}
        </button>
        <Link href="/me" aria-label="내 데이터"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#efe6da] text-[13px] font-semibold text-[#5d4a38]">
          {(p.name ?? '나').slice(0, 2)}
        </Link>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 pt-5 pb-2">
            <div className="mx-auto flex max-w-[720px] flex-col gap-3.5">
              <div className="self-center rounded-xl bg-[#efe7dc] px-3 py-1.5 text-center text-xs text-[#8a8077] text-pretty">
                국가 {p.country} · 거주지 {p.home ?? '미입력'} — 계정 설정에서 불러옴
              </div>
              <MessageList
                msgs={msgs} result={result} dest={a.dest} departure={a.departure} mode={mode}
                onSend={(q, id) => callAI('question', q, id)}
                onCancel={id => setMsgs(list => list.filter(x => x.id !== id))}
              />
              {typing && (
                <div className="flex items-center gap-2">
                  <Badge size={30} />
                  <div className="rounded-[4px_18px_18px_18px] border border-line bg-surface px-4 py-3 text-sm text-muted">DB에서 불러오는 중…</div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <div className="pb-safe flex-none border-t border-[#e8dfd4] bg-bar px-4 pt-2.5">
            <div className="mx-auto flex max-w-[720px] flex-col gap-2.5">
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
                {chips.map(c => (
                  <button key={c.label} onClick={c.onClick ?? (() => answer(c.label))}
                    className={`min-h-11 flex-none rounded-full px-4 text-sm font-semibold whitespace-nowrap ${c.primary ? 'bg-accent text-white' : 'border border-line-strong bg-surface'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); answer(input); }} className="flex items-center gap-2">
                <input
                  value={input} onChange={e => setInput(e.target.value)}
                  placeholder={step >= 4 ? '질문하면 AI 호출 전에 확인을 받아요' : '직접 입력하거나 아래에서 고르세요'}
                  className="min-h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-[18px] text-[15px] outline-none focus:border-accent"
                />
                <button type="submit" className="min-h-12 flex-none rounded-full bg-accent px-5 text-[15px] font-semibold text-white">보내기</button>
              </form>
            </div>
          </div>
        </main>

        <InfoPanel fields={fields} aiCalls={aiCalls} aiEnabled={p.aiEnabled} open={sheet} onClose={() => setSheet(false)} />
      </div>
    </div>
  );
}
