import { Badge, SampleTag } from '@/components/ui';
import { DOMESTIC_BUFFER_MIN, MODE_LABEL, STALE_DAYS, type Mode, type Recommendation, type RecommendRow } from '@/lib/recommend';
import { fmtDur } from '@/lib/time';
import type { DayItem } from '@/lib/day';

export interface Msg {
  id: number;
  role: 'user' | 'bot';
  text?: string;
  src?: string;
  ai?: boolean;
  error?: boolean;
  verify?: string;
  pending?: string;
  results?: boolean;
  schedule?: { title: string; items: DayItem[]; earliest: string | null };
  history?: { title: string; items: { date: string; reason: string; from: string }[] };
}

interface Props {
  msgs: Msg[];
  result: (Recommendation & { regionMissing: boolean }) | null;
  dest?: string;
  departure?: string;
  mode: Mode;
  onSend: (question: string, id: number) => void;
  onCancel: (id: number) => void;
}

const card = 'w-full max-w-[440px] rounded-2xl border border-line bg-surface py-1.5';

export function MessageList({ msgs, result, dest, departure, mode, onSend, onCancel }: Props) {
  return (
    <>
      {msgs.map(m => m.role === 'user' ? (
        <div key={m.id} className="max-w-[78%] self-end rounded-[18px_18px_4px_18px] bg-accent px-[15px] py-[11px] text-[15px] leading-normal text-white text-pretty">
          {m.text}
        </div>
      ) : (
        <div key={m.id} className="flex items-start gap-2">
          <Badge size={30} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            {m.text && (
              <div className={`max-w-[88%] rounded-[4px_18px_18px_18px] border px-[15px] py-[11px] text-[15px] leading-relaxed whitespace-pre-line text-pretty ${
                m.error ? 'border-[#e9c9bd] bg-[#fdf3ef]' : 'border-line bg-surface'}`}>
                {m.text}
              </div>
            )}

            {m.schedule && (
              <div className={card}>
                <div className="px-4 py-2 text-xs font-semibold text-muted">{m.schedule.title}</div>
                {m.schedule.items.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 border-t border-divider px-4 py-2.5">
                    <div className="w-[104px] flex-none text-sm font-semibold tabular-nums">{s.time}</div>
                    <div className="min-w-0 flex-1 text-sm">{s.title}</div>
                    <div className="flex-none rounded-lg bg-chip px-2 py-0.5 text-[11px] text-muted">{s.source}</div>
                  </div>
                ))}
                {m.schedule.earliest && (
                  <div className="flex items-center gap-3 border-t border-divider px-4 py-2.5 text-accent">
                    <div className="w-[104px] flex-none text-sm font-bold tabular-nums">{m.schedule.earliest} 이후</div>
                    <div className="text-sm font-semibold">출발 가능</div>
                  </div>
                )}
              </div>
            )}

            {m.history && (
              <div className={card}>
                <div className="px-4 py-2 text-xs font-semibold text-muted">{m.history.title}</div>
                {m.history.items.map((h, i) => (
                  <div key={i} className="flex items-center gap-3 border-t border-divider px-4 py-2.5">
                    <div className="w-[72px] flex-none text-[13px] text-muted tabular-nums">{h.date}</div>
                    <div className="min-w-0 flex-1 text-sm font-semibold">{h.reason}</div>
                    <div className="flex-none text-xs text-muted">{h.from} 출발</div>
                  </div>
                ))}
              </div>
            )}

            {m.results && result && <Results result={result} dest={dest!} departure={departure!} mode={mode} />}

            {m.pending && (
              <div className="flex w-full max-w-[440px] flex-col gap-2.5 rounded-2xl border border-dashed border-[#cdbfae] bg-surface px-4 py-3.5">
                <div className="text-sm leading-normal text-pretty">이 질문은 DB에서 바로 답할 수 없어 AI 호출이 필요해요. AI는 버튼을 눌러야만 호출돼요.</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => onSend(m.pending!, m.id)} className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white">AI에게 보내기</button>
                  <button onClick={() => onCancel(m.id)} className="min-h-11 rounded-full border border-line-strong bg-surface px-4 text-sm">보내지 않기</button>
                </div>
              </div>
            )}

            {m.src && (
              <div className={`flex max-w-full items-center gap-1.5 pl-1 text-[11px] whitespace-nowrap ${m.ai ? 'text-ai' : 'text-[#8a8077]'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${m.ai ? 'bg-ai' : 'bg-[#8a8077]'}`} />
                <span className="truncate">{m.src}</span>
                {m.verify && <span className="rounded-lg bg-ok-soft px-2 py-0.5 text-ok">{m.verify}</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function Results({ result, dest, departure, mode }: { result: NonNullable<Props['result']>; dest: string; departure: string; mode: Mode }) {
  const excluded = [
    result.noRoute.length ? `${result.noRoute.join('·')} → ${dest}은(는) 그날 운항 스케줄 DB에 편이 없어 제외했어요.` : '',
    result.noFlightInTime.length ? `${result.noFlightInTime.join('·')}에서는 ${departure}에 출발해 탈 수 있는 편이 없어요.` : '',
  ].filter(Boolean);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted">{dest}행 · 총 소요시간 순 · {MODE_LABEL[mode]}</div>
        {result.rows.some(r => r.isSample) && <SampleTag />}
      </div>
      {result.rows.map((r, i) => (
        <div key={r.airport} className={`flex flex-col gap-3 rounded-[18px] bg-surface p-4 ${i ? 'border border-line' : 'border-2 border-accent'}`}>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <div className={`text-xs font-bold ${i ? 'text-muted' : 'text-accent'}`}>{i ? `${i + 1}순위` : '가장 빠름'}</div>
            <div className="text-[17px] font-bold">{r.airportName}공항</div>
            <div className="text-[13px] tracking-wider text-muted">{r.airport}</div>
            <div className="ml-auto flex flex-col items-end">
              <div className="text-xl font-bold tabular-nums">{fmtDur(r.totalMin)}</div>
              <div className="text-[11px] text-muted">{departure} 집 출발 기준 총 소요</div>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
            <Tile label={`집 → 공항 · ${MODE_LABEL[mode]}`} value={fmtDur(r.accessMin)} src={r.accessSource} />
            <Tile label={`탑승 편 · ${r.flightNo}`} value={`${r.dep} → ${r.arr}`} {...scheduleSrc(r)} />
            <Tile label="공항 도착 여유" value={fmtDur(r.slackMin)} src={`국내선 ${DOMESTIC_BUFFER_MIN}분 전 기준`} />
          </div>
        </div>
      ))}
      {excluded.map(t => <div key={t} className="px-1 text-xs text-muted">{t}</div>)}
    </div>
  );
}

/** 운항 스케줄 출처와 신선도: 샘플 / "한국공항공사 · 9/25 확인" / 오래되면 경고 */
function scheduleSrc(r: RecommendRow): { src: string; warn?: boolean } {
  if (r.isSample || !r.syncedAt) return { src: '운항 스케줄 DB · 샘플' };
  const synced = new Date(r.syncedAt);
  const days = Math.floor((Date.now() - synced.getTime()) / 86400000);
  const md = `${synced.getMonth() + 1}/${synced.getDate()}`;
  const fare = r.fare ? `일반석 ${r.fare.toLocaleString('ko-KR')}원 · ` : '';
  return days >= STALE_DAYS
    ? { src: `${fare}${r.source} · ${days}일 전 확인 · 항공사에서 다시 확인하세요`, warn: true }
    : { src: `${fare}${r.source} · ${md} 확인` };
}

function Tile({ label, value, src, warn }: { label: string; value: string; src: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-tile px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className={`text-[11px] ${warn ? 'text-warn' : 'text-faint'}`}>{src}</div>
    </div>
  );
}
