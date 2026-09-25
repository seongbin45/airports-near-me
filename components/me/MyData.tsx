'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SampleTag, TopBar, pill } from '@/components/ui';
import { DEFAULT_REASONS } from '@/lib/chat/flow';
import { fmtDur, hhmm, toMin } from '@/lib/time';
import type { AccessRow, AiCallRow } from '@/app/me/page';
import { PROVIDER_LABEL, type ProviderId } from '@/lib/ai/providers-meta';

interface Visit { id: number; dest_city: string; visited_on: string; reason: string | null; from_airport: string | null; source: string; is_sample: boolean }

interface Props {
  email: string;
  name: string | null;
  joined: string;
  country: string;
  home: string | null;
  address: string | null;
  userType: string | null;
  aiEnabled: boolean;
  classes: { name: string; days: string[]; start_time: string; end_time: string }[];
  events: { date: string; description: string; source: string }[];
  visits: Visit[];
  aiCalls: AiCallRow[];
  hasConsent: boolean;
  access: AccessRow[];
}

const TABS = [['basic', '기본 정보'], ['trips', '방문 기록'], ['ai', 'AI 기록'], ['privacy', '개인정보']] as const;
type Tab = (typeof TABS)[number][0];
const SOURCE: Record<string, string> = { manual: '직접 입력', google_timeline: 'Timeline.json', google_calendar: '구글 캘린더', ics: '.ics 파일' };
// 가입 화면의 단계 번호 (수정 링크용)
const STEP = { home: 1, type: 2, schedule: 3 };

const dot = (iso: string) => iso.slice(0, 10).replaceAll('-', '.');

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative h-6 w-10 flex-none rounded-full ${on ? 'bg-accent' : 'bg-[#d8cec2]'}`}>
      <span className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow" style={{ left: on ? 19 : 3 }} />
    </span>
  );
}

export default function MyData(p: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>('basic');
  const [visits, setVisits] = useState(p.visits);
  const [filter, setFilter] = useState('전체');
  const [consent, setConsent] = useState(p.hasConsent);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [ai, setAi] = useState(p.aiEnabled);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState('');

  const fail = (e: { message: string } | null) => { if (e) setErr(e.message); return !!e; };

  // ── 기본 정보
  const weekMin = p.classes.reduce((t, c) => t + (toMin(hhmm(c.end_time)) - toMin(hhmm(c.start_time))) * c.days.length, 0);
  const bySource = Object.entries(p.events.reduce<Record<string, number>>((m, e) => ({ ...m, [e.source]: (m[e.source] ?? 0) + 1 }), {}));
  const basics = [
    { k: '국가', v: p.country, note: '다른 국가는 관리자 승인 후 열려요', step: null },
    { k: '거주지', v: p.home ?? '미입력', note: p.address ? `상세 주소 ${p.address}` : '상세 주소 미입력 · 입력하면 소요시간이 정확해져요', step: STEP.home },
    { k: '유형', v: p.userType ?? '미입력', note: '', step: STEP.type },
    ...(p.userType === '대학생' ? [{ k: '수업', v: `${p.classes.length}과목 · 주 ${Math.round(weekMin / 6) / 10}시간`, note: p.classes.map(c => `${c.name} ${c.days.join('·')}`).join(', '), step: STEP.schedule }] : []),
    { k: '일정', v: `${p.events.length}개`, note: bySource.map(([s, n]) => `${SOURCE[s] ?? s} ${n}`).join(' · '), step: STEP.schedule },
  ];
  const airports = Object.values(p.access.reduce<Record<string, { code: string; name: string; car?: number; transit?: number; sample: boolean }>>((m, a) => {
    const x = m[a.airport] ??= { code: a.airport, name: a.airports?.name_ko ?? a.airport, sample: a.is_sample };
    x[a.mode] = a.minutes;
    return m;
  }, {})).sort((a, b) => (a.car ?? a.transit ?? 1e9) - (b.car ?? b.transit ?? 1e9)).slice(0, 3);

  // ── 방문 기록
  const eventsByDate = p.events.reduce<Record<string, string[]>>((m, e) => ({ ...m, [e.date]: [...(m[e.date] ?? []), e.description] }), {});
  const reasons = [...new Set(visits.map(v => v.reason).filter(Boolean) as string[])].slice(0, 3);
  const shown = visits.filter(v => filter === '전체' || (filter === '이유 미입력' ? !v.reason : v.reason === filter));

  async function setReason(id: number, reason: string) {
    if (fail((await supabase.from('visits').update({ reason }).eq('id', id)).error)) return;
    setVisits(vs => vs.map(v => v.id === id ? { ...v, reason } : v));
  }
  async function removeVisit(id: number) {
    if (fail((await supabase.from('visits').delete().eq('id', id)).error)) return;
    setVisits(vs => vs.filter(v => v.id !== id));
  }

  // ── 개인정보
  async function toggleConsent() {
    if (!consent) {
      if (fail((await supabase.from('location_consents').insert({ version: '2026-09-v1' })).error)) return;
      setConsent(true);
      return;
    }
    // 스위치를 한 번 더 누르면 확정 (디자인과 동일), 아래 버튼으로도 확정 가능
    if (confirmRevoke) return revoke();
    setConfirmRevoke(true);
  }
  async function revoke() {
    if (fail((await supabase.from('location_consents').update({ revoked_at: new Date().toISOString() }).is('revoked_at', null)).error)) return;
    if (fail((await supabase.from('visits').delete().gte('id', 0)).error)) return;
    setConsent(false); setConfirmRevoke(false); setVisits([]);
  }
  async function toggleAi() {
    const { data: { user } } = await supabase.auth.getUser();
    if (fail((await supabase.from('profiles').update({ ai_enabled: !ai }).eq('id', user!.id)).error)) return;
    setAi(!ai);
  }
  async function exportJson() {
    const tables = ['profiles', 'class_timetable', 'schedules', 'visits', 'trips', 'ai_calls', 'location_consents'] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), email: p.email };
    for (const t of tables) {
      const { data, error } = await supabase.from(t).select('*');
      if (fail(error)) return;
      out[t] = data;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'my-data.json' }).click();
    URL.revokeObjectURL(url);
  }
  async function deleteAccount() {
    if (!confirmDel) return setConfirmDel(true);
    if (fail((await supabase.rpc('delete_my_account')).error)) return;
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const row = (i: number) => (i ? 'border-t border-divider' : '');

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <Link href="/chat" className="flex min-h-10 items-center px-1 text-sm font-semibold text-ink-2">← 대화</Link>
        <div className="flex-1 text-center text-base font-bold">내 데이터</div>
        <div className="w-[52px]" />
      </TopBar>

      <main className="flex flex-1 justify-center px-4 pt-6 pb-10">
        <div className="flex w-full max-w-[640px] flex-col gap-[22px]">
          <div className="flex items-center gap-3.5">
            <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-[18px] bg-accent-soft text-xl font-bold text-accent">
              {(p.name ?? p.email).slice(0, 1)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="text-lg font-bold">{p.name ?? '이름 미입력'}</div>
              <div className="truncate text-[13px] text-muted">{p.email} · {p.joined.slice(0, 4)}년 {Number(p.joined.slice(5, 7))}월 가입</div>
            </div>
          </div>

          <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-[14px] bg-sand p-1" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`min-h-10 flex-1 rounded-[11px] px-3.5 text-sm font-semibold whitespace-nowrap ${tab === id ? 'bg-surface shadow-[0_1px_3px_rgba(60,40,20,.12)]' : ''}`}>{label}</button>
            ))}
          </div>

          {tab === 'basic' && (
            <div className="flex flex-col gap-[18px]">
              <div className="flex flex-col rounded-2xl border border-line bg-surface">
                {basics.map((f, i) => (
                  <div key={f.k} className={`flex items-center gap-3 px-4 py-3 ${row(i)}`}>
                    <div className="w-[72px] flex-none text-[13px] text-muted">{f.k}</div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="text-sm font-semibold">{f.v}</div>
                      {f.note && <div className="text-xs text-faint">{f.note}</div>}
                    </div>
                    {f.step != null
                      ? <Link href={`/onboarding?step=${f.step}`} className="flex min-h-9 flex-none items-center px-2.5 text-[13px] font-semibold text-accent">수정</Link>
                      : <span className="w-[52px] flex-none" />}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[13px] font-semibold text-ink-2">가까운 공항 <span className="font-normal text-faint">거주지 기준 · 카카오모빌리티 / ODsay</span></div>
                  {airports.some(a => a.sample) && <SampleTag />}
                </div>
                <div className="flex flex-col rounded-2xl border border-line bg-surface">
                  {airports.map((a, i) => (
                    <div key={a.code} className={`flex items-center gap-3 px-4 py-3 ${row(i)}`}>
                      <div className="w-11 flex-none text-[13px] font-bold tracking-wider text-accent">{a.code}</div>
                      <div className="min-w-0 flex-1 text-sm font-semibold">{a.name}</div>
                      <div className="flex flex-none flex-col items-end gap-px tabular-nums">
                        <div className="text-[13px] font-semibold">{a.car != null ? `자동차 ${fmtDur(a.car)}` : '자동차 -'}</div>
                        <div className="text-[11px] text-muted">{a.transit != null ? `대중교통 ${fmtDur(a.transit)}` : '대중교통 -'}</div>
                      </div>
                    </div>
                  ))}
                  {!airports.length && <div className="p-4 text-[13px] text-faint">이 거주지에서 공항까지 걸리는 시간이 아직 DB에 없어요.</div>}
                </div>
              </div>
            </div>
          )}

          {tab === 'trips' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 flex-1 truncate text-[13px] text-ink-2">공항 방문 {visits.length}회 · 이유 입력 {visits.filter(v => v.reason).length}회</div>
                {visits.some(v => v.is_sample) && <span className="flex-none"><SampleTag /></span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['전체', '이유 미입력', ...reasons].map(f => (
                  <button key={f} onClick={() => setFilter(f)} className={`min-h-9 rounded-full px-3 text-[13px] font-semibold ${pill(filter === f)}`}>{f}</button>
                ))}
              </div>
              <div className="flex flex-col gap-2.5">
                {shown.map(v => (
                  <div key={v.id} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-bold">
                        <span>{v.from_airport ?? '?'}</span><span className="font-normal text-faint">→</span><span>{v.dest_city}</span>
                      </div>
                      <div className="flex-none text-xs text-muted tabular-nums">{dot(v.visited_on)}</div>
                    </div>
                    {v.reason ? (
                      <>
                        <div><span className="rounded-[10px] bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-ink">{v.reason}</span></div>
                        {!!eventsByDate[v.visited_on]?.length && (
                          <div className="flex flex-wrap gap-1.5">
                            {eventsByDate[v.visited_on].map(d => <span key={d} className="rounded-lg bg-chip px-2 py-0.5 text-[11px] text-ink-2">일정: {d}</span>)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="text-[13px] text-warn">왜 다녀오셨는지 아직 몰라요.</div>
                        <div className="flex flex-wrap gap-1.5">
                          {DEFAULT_REASONS.map(r => (
                            <button key={r} onClick={() => setReason(v.id, r)} className="min-h-9 rounded-full border border-line-strong bg-surface px-3 text-[13px] font-semibold">{r}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-divider pt-2">
                      <div className="text-[11px] text-faint">{SOURCE[v.source] ?? v.source}</div>
                      <button onClick={() => removeVisit(v.id)} className="min-h-8 px-2 text-xs text-faint">기록 삭제</button>
                    </div>
                  </div>
                ))}
                {!shown.length && <div className="rounded-2xl border border-line bg-surface p-4 text-[13px] text-faint">해당하는 방문 기록이 없어요.</div>}
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] leading-normal text-ink-2 text-pretty">AI는 버튼을 누를 때만 호출돼요. 답변 속 편명·시각은 DB 값과 대조한 뒤에만 보여드려요.</div>
              <div className="flex flex-col rounded-2xl border border-line bg-surface">
                {p.aiCalls.map((c, i) => {
                  const d = c.verify_detail;
                  const bad = [
                    ...(d?.flights?.mismatched ?? []), ...(d?.times?.mismatched ?? []), ...(d?.places?.mismatched ?? []),
                    ...(d?.durations?.mismatched ?? []), ...(d?.dates?.mismatched ?? []), ...(d?.forbidden ?? []),
                  ];
                  const detail = c.verified
                    ? `편명 ${d?.flights?.checked.length ?? 0}개 · 시각 ${d?.times?.checked.length ?? 0}개 DB와 일치`
                    : d?.refused ? 'AI가 답하지 않음 · 표로 대체'
                    : d?.parseError ? '형식이 맞지 않는 답 · 표로 대체'
                    : d?.unavailable ? 'AI 제공자 모두 응답 없음 · 표로 대체'
                    : `불일치 ${bad.join(', ') || '-'} · 표로 대체`;
                  const ask = c.kind === 'summary' ? `${c.trips ? `${c.trips.dest_city} ${dot(c.trips.trip_date)} ` : ''}추천 요약` : c.prompt;
                  return (
                    <div key={c.id} className={`flex flex-col gap-1.5 px-4 py-3.5 ${row(i)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 text-sm font-semibold">{ask}</div>
                        <span className={`flex-none rounded-lg px-2 py-0.5 text-[11px] font-semibold ${c.verified ? 'bg-[#e0efe0] text-[#2d6a3a]' : 'bg-warn-soft text-warn'}`}>
                          {c.verified ? '검증 통과' : '표시 안 함'}
                        </span>
                      </div>
                      <div className="text-xs text-muted tabular-nums">
                        {new Date(c.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}{c.provider ? ` · ${PROVIDER_LABEL[c.provider as ProviderId] ?? c.provider}` : ''} · {detail}
                      </div>
                    </div>
                  );
                })}
                {!p.aiCalls.length && <div className="p-4 text-[13px] text-faint">아직 AI를 호출한 적이 없어요.</div>}
              </div>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-col rounded-2xl border border-line bg-surface">
                <button onClick={toggleConsent} role="switch" aria-checked={consent} className="flex items-center gap-3 px-4 py-3.5 text-left">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">위치정보 수집·이용</span>
                    <span className="text-xs leading-normal text-muted">방문 기록으로 공항 추천 정확도를 높여요.</span>
                  </span>
                  <Toggle on={consent} />
                </button>
                <div className="flex items-center gap-3 border-t border-divider px-4 py-3.5 opacity-60">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">캘린더 연결 <span className="font-normal text-faint">준비 중</span></span>
                    <span className="text-xs leading-normal text-muted">구글 캘린더 일정을 읽기 전용으로 불러와요.</span>
                  </span>
                  <Toggle on={false} />
                </div>
                <button onClick={toggleAi} role="switch" aria-checked={ai} className="flex items-center gap-3 border-t border-divider px-4 py-3.5 text-left">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">AI 문장 다듬기</span>
                    <span className="text-xs leading-normal text-muted">끄면 DB 결과를 표 그대로만 보여드려요.</span>
                  </span>
                  <Toggle on={ai} />
                </button>
              </div>
              {confirmRevoke && (
                <div className="flex flex-col gap-2.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-normal text-warn">
                  <div>위치정보 동의를 끄면 방문 기록 {visits.length}건이 바로 삭제되고, 추천은 거주지 기준으로만 계산돼요. 스위치를 한 번 더 누르면 확정돼요.</div>
                  <div className="flex gap-2">
                    <button onClick={revoke} className="min-h-10 rounded-full bg-danger px-4 text-[13px] font-semibold text-white">동의 철회하고 삭제</button>
                    <button onClick={() => setConfirmRevoke(false)} className="min-h-10 rounded-full border border-line-strong bg-surface px-4 text-[13px] text-ink">취소</button>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button onClick={exportJson} className="min-h-12 rounded-full border border-line-strong bg-surface text-sm font-semibold">내 데이터 내보내기 (JSON 파일)</button>
                <button onClick={deleteAccount} className="min-h-12 rounded-full border border-[#e9c9bd] bg-surface px-4 text-sm font-semibold text-danger">
                  {confirmDel ? '한 번 더 누르면 계정과 모든 데이터가 삭제돼요' : '계정 삭제'}
                </button>
                {confirmDel && <button onClick={() => setConfirmDel(false)} className="min-h-10 text-[13px] text-muted">취소</button>}
              </div>
            </div>
          )}

          {err && <div className="text-[13px] text-danger">{err}</div>}
        </div>
      </main>
    </div>
  );
}
