'use client';

import { useRef, useState } from 'react';
import { summarizeTimeline, type AirportPoint, type TimelineSummary } from '@/lib/data/timeline-import';

const GUIDE = {
  android: ['설정 앱을 열고 위치 → 위치 서비스 → 타임라인으로 들어가요.', '타임라인 데이터 내보내기를 눌러요.', '저장 위치를 고르면 Timeline.json 파일이 만들어져요.', '아래 버튼으로 그 파일을 올려주세요.'],
  ios: ['구글 지도 앱을 열고 오른쪽 위 프로필 → 설정으로 들어가요.', '개인 콘텐츠 → 타임라인 데이터 내보내기를 눌러요.', '파일 앱에 저장을 골라요.', '아래 버튼으로 그 파일을 올려주세요.'],
};

interface Props {
  airports: AirportPoint[];
  consent: boolean;
  onConsent: (v: boolean) => void;
  summary: TimelineSummary | null;
  onSummary: (s: TimelineSummary) => void;
}

export default function HistoryStep({ airports, consent, onConsent, summary, onSummary }: Props) {
  const [os, setOs] = useState<'android' | 'ios'>('android');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr('');
    try {
      // 파일은 브라우저 안에서만 읽고 서버로 올리지 않는다.
      onSummary(summarizeTimeline(JSON.parse(await f.text()), airports));
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'JSON 파일이 아니에요.' : (e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 self-start rounded-[14px] bg-sand p-1">
        {([['android', '안드로이드'], ['ios', '아이폰']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setOs(id)}
            className={`min-h-10 rounded-[11px] px-[18px] text-sm font-semibold ${os === id ? 'bg-surface shadow-[0_1px_3px_rgba(60,40,20,.12)]' : ''}`}>{label}</button>
        ))}
      </div>
      <ol className="flex flex-col rounded-2xl border border-line bg-surface">
        {GUIDE[os].map((text, i) => (
          <li key={i} className={`flex items-start gap-3 p-3.5 ${i ? 'border-t border-divider' : ''}`}>
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">{i + 1}</span>
            <span className="text-sm leading-relaxed text-pretty">{text}</span>
          </li>
        ))}
      </ol>
      <div className="text-xs leading-normal text-muted text-pretty">구글 타임라인은 2024년부터 휴대폰에만 저장돼요. PC의 Takeout에서는 대부분 내보낼 수 없어요.</div>

      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => onFile(e.target.files?.[0])} />
      {!summary ? (
        <button onClick={() => fileRef.current?.click()}
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed border-[#cdbfae] bg-[#fbf7f1]">
          <span className="text-[15px] font-semibold">타임라인 파일 올리기</span>
          <span className="text-xs text-muted">Timeline.json · 휴대폰에서 바로 선택할 수 있어요</span>
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <div className="text-sm font-bold">Timeline.json 읽기 완료</div>
          <div className="grid grid-cols-3 gap-2">
            {[[summary.places, '방문지'], [summary.airportVisits, '공항 방문'], [Object.keys(summary.byAirport).length, '다녀간 공항']].map(([v, k]) => (
              <div key={k} className="flex flex-col gap-0.5 rounded-xl bg-tile px-3 py-2.5">
                <div className="text-lg font-bold tabular-nums">{v}</div>
                <div className="text-[11px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <div className="text-[13px] leading-normal text-ink-2 text-pretty">
            {summary.from && `${summary.from} ~ ${summary.to} 기록이에요. `}
            방문 이유는 파일에 없어요. 대화에서 공항 방문 {summary.airportVisits}회의 이유를 하나씩 여쭤볼게요.
          </div>
        </div>
      )}
      {err && <div className="text-[13px] text-danger">{err}</div>}

      <button onClick={() => onConsent(!consent)} role="checkbox" aria-checked={consent}
        className="flex items-start gap-3 rounded-[14px] border border-line-strong bg-surface p-3.5 text-left">
        <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] text-[13px] font-bold text-white ${consent ? 'bg-accent' : 'border-[1.5px] border-[#cdbfae] bg-surface'}`}>
          {consent ? '✓' : ''}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">위치정보 수집·이용 동의 (필수)</span>
          <span className="text-xs leading-normal text-muted">방문 기록은 공항 추천에만 쓰고, 계정 설정에서 언제든 지울 수 있어요.</span>
        </span>
      </button>
    </div>
  );
}
