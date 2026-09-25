'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge, BotLine, TopBar } from '@/components/ui';
import type { RegionRow } from '@/lib/regions';
import type { AirportPoint, TimelineSummary } from '@/lib/data/timeline-import';
import { hhmm, toMin } from '@/lib/time';
import type { ClassItem, Day, EventKind } from '@/lib/onboarding/validate';
import CountryStep, { type CountryRow } from './CountryStep';
import HomeStep from './HomeStep';
import TypeStep, { type UserType } from './TypeStep';
import ScheduleStep, { type EventItem } from './ScheduleStep';
import HistoryStep from './HistoryStep';
import SummaryStep from './SummaryStep';

const STEPS = ['country', 'home', 'type', 'schedule', 'history', 'done'] as const;

// 위치정보 수집·이용 동의 문구 버전. 문구가 바뀌면 올리고 다시 동의를 받는다.
const CONSENT_VERSION = '2026-09-v1';

interface Props {
  profile: { display_name: string | null; country: string; region_id: number | null; address: string | null; user_type: string | null; onboarding_step: number };
  countries: CountryRow[];
  regions: RegionRow[];
  initialClasses: { id: number; name: string; place: string | null; days: string[]; start_time: string; end_time: string }[];
  initialEvents: { id: number; kind: string; date: string; all_day: boolean; start_time: string | null; end_time: string | null; description: string; source: string }[];
  hasConsent: boolean;
  airports: AirportPoint[];
  startStep: number;
}

export default function Onboarding(p: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState(Math.min(p.startStep, STEPS.length - 1));
  const [country, setCountry] = useState(p.profile.country);
  const [regionId, setRegionId] = useState<number | null>(p.profile.region_id);
  const [address, setAddress] = useState(p.profile.address ?? '');
  const [userType, setUserType] = useState<UserType | null>(p.profile.user_type as UserType | null);
  const [classes, setClasses] = useState<ClassItem[]>(p.initialClasses.map(c => ({
    id: c.id, name: c.name, place: c.place ?? '', days: c.days as Day[], start: hhmm(c.start_time), end: hhmm(c.end_time),
  })));
  const [events, setEvents] = useState<EventItem[]>(p.initialEvents.map(e => ({
    id: e.id, kind: e.kind as EventKind, date: e.date, allDay: e.all_day,
    start: e.start_time ? hhmm(e.start_time) : '', end: e.end_time ? hhmm(e.end_time) : '', description: e.description, source: e.source,
  })));
  const [consent, setConsent] = useState(p.hasConsent);
  const [timeline, setTimeline] = useState<TimelineSummary | null>(null);
  const [skippedHistory, setSkippedHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const key = STEPS[step];
  const region = p.regions.find(r => r.id === regionId) ?? null;
  const name = p.profile.display_name;

  // 단계마다 DB에 저장한 뒤 다음으로. 새로고침해도 onboarding_step에서 이어간다.
  async function saveAndGo(next: number, patch: Record<string, unknown> = {}): Promise<boolean> {
    setSaving(true);
    setError('');
    if (key === 'history' && consent && !p.hasConsent) {
      const { error } = await supabase.from('location_consents').insert({ version: CONSENT_VERSION });
      if (error) { setSaving(false); setError(error.message); return false; }
    }
    const { error } = await supabase.from('profiles')
      .update({ onboarding_step: Math.max(next, p.profile.onboarding_step), ...patch })
      .eq('id', (await supabase.auth.getUser()).data.user!.id);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setStep(next);
    return true;
  }

  const patchFor: Record<(typeof STEPS)[number], Record<string, unknown>> = {
    country: { country }, home: { region_id: regionId, address: address.trim() || null }, type: { user_type: userType },
    schedule: {}, history: {}, done: {},
  };
  const canNext = { country: country === 'KR', home: !!regionId, type: !!userType, schedule: true, history: consent || skippedHistory, done: true }[key];

  async function finish() {
    if (await saveAndGo(step, { onboarding_done: true })) router.replace('/chat');
  }

  const isStudent = userType === '대학생';
  const TITLES: Record<(typeof STEPS)[number], [string, string]> = {
    country: ['어느 나라에서 이용하시나요?', '지금은 대한민국 국내선만 안내할 수 있어요.'],
    home: ['어디에 사세요?', '공항까지 걸리는 시간을 계산하는 기준이 돼요. 동네 이름으로 찾거나 차례로 골라주세요.'],
    type: ['어떤 일정을 주로 챙기시나요?', '고른 유형에 맞춰 시간표나 일정 입력 칸을 보여드려요.'],
    schedule: [isStudent ? '수업 시간표와 일정을 알려주세요.' : '다가오는 일정을 알려주세요.', '출발 가능한 시각을 계산할 때 이 일정과 겹치지 않는지 확인해요.'],
    history: ['지난 방문 기록을 가져올까요?', '어디를 왜 다녀왔는지 알면 다음 추천이 정확해져요. 휴대폰에서 파일을 내보내 올려주세요.'],
    done: [name ? `준비됐어요, ${name}님.` : '준비됐어요.', '입력하신 내용은 계정에 저장되고 대화에서 불러와 씁니다.'],
  };

  const weekMin = classes.reduce((t, c) => t + (toMin(c.end) - toMin(c.start)) * c.days.length, 0);
  const summary = [
    { k: '국가', v: p.countries.find(c => c.code === country)?.name_ko ?? country },
    { k: '거주지', v: region ? region.full_name + (address.trim() ? ` ${address.trim()}` : '') : '-' },
    { k: '유형', v: userType ?? '-' },
    { k: '수업 시간표', v: isStudent ? `${classes.length}과목 · 주 ${Math.round(weekMin / 6) / 10}시간` : '해당 없음' },
    { k: '일정', v: `${events.length}개` },
    { k: '방문 기록', v: timeline ? `방문지 ${timeline.places}곳 · 공항 방문 ${timeline.airportVisits}회` : '나중에 가져오기' },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <Badge />
        <div className="flex-1 text-base font-bold">공항 찾기 시작하기</div>
        <div className="text-[13px] whitespace-nowrap text-muted">{step + 1} / {STEPS.length}</div>
      </TopBar>
      <div className="h-1 bg-[#ebe2d6]">
        <div className="h-1 bg-accent transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <main className="flex flex-1 justify-center px-4 pt-7 pb-6">
        <div className="flex w-full max-w-[640px] flex-col gap-5">
          <BotLine title={TITLES[key][0]} sub={TITLES[key][1]} />

          {key === 'country' && <CountryStep countries={p.countries} value={country} onChange={setCountry} />}
          {key === 'home' && (
            <HomeStep regions={p.regions} regionId={regionId} onRegion={setRegionId} address={address} onAddress={setAddress} />
          )}
          {key === 'type' && <TypeStep value={userType} onChange={setUserType} />}
          {key === 'schedule' && (
            <ScheduleStep
              supabase={supabase} isStudent={isStudent}
              classes={classes} setClasses={setClasses} events={events} setEvents={setEvents}
            />
          )}
          {key === 'history' && (
            <HistoryStep airports={p.airports} consent={consent} onConsent={setConsent} summary={timeline} onSummary={setTimeline} />
          )}
          {key === 'done' && <SummaryStep rows={summary} onFinish={finish} saving={saving} />}

          {error && <div className="text-[13px] text-danger">{error}</div>}
        </div>
      </main>

      {key !== 'done' && (
        <footer className="pb-safe sticky bottom-0 flex flex-none justify-center border-t border-[#e8dfd4] bg-bar px-4 pt-3">
          <div className="flex w-full max-w-[640px] gap-2.5">
            <button
              onClick={() => setStep(s => Math.max(0, s - 1))}
              className={`min-h-[52px] flex-none rounded-full border border-line-strong bg-surface px-5 text-[15px] font-semibold ${step ? '' : 'invisible'}`}
            >
              이전
            </button>
            {key === 'history' && !timeline && (
              <button
                onClick={() => { setSkippedHistory(true); saveAndGo(step + 1); }}
                className="min-h-[52px] flex-none rounded-full px-4 text-sm text-muted"
              >
                나중에 하기
              </button>
            )}
            <button
              onClick={() => canNext && saveAndGo(step + 1, patchFor[key])}
              disabled={!canNext || saving}
              className="min-h-[52px] flex-1 rounded-full bg-accent text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-disabled"
            >
              {saving ? '저장 중…' : key === 'history' ? '저장하고 계속' : '다음'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
