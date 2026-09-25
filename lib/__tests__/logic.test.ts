import { describe, expect, it } from 'vitest';
import { recommend, type AccessTime, type Flight } from '../recommend';
import { verifyAgainstDb } from '../ai/verify';
import { checkClass, checkEvent } from '../onboarding/validate';
import { layoutLanes } from '../onboarding/lanes';
import { dayPlan } from '../day';
import { kstToday, parseDate } from '../time';
import { dataHealth, type HealthInput } from '../server/data-health';

// 프로토타입(design/공항 찾기 대화.dc.html)과 같은 샘플 값
const access: AccessTime[] = [
  { airport: 'GMP', airportName: '김포', city: '서울', minutes: 55, source: '카카오모빌리티 경로' },
  { airport: 'CJJ', airportName: '청주', city: '청주', minutes: 80, source: '카카오모빌리티 경로' },
  { airport: 'ICN', airportName: '인천', city: '인천', minutes: 95, source: '카카오모빌리티 경로' },
];
let id = 0;
const f = (flight_no: string, origin: string, dep: string, arr: string): Flight =>
  ({ id: ++id, flight_no, origin, dep_time: `${dep}:00`, arr_time: `${arr}:00`, is_sample: true });
const jeju = [
  f('A 1203', 'GMP', '15:40', '16:50'), f('A 1207', 'GMP', '16:10', '17:20'), f('B 1213', 'GMP', '17:00', '18:10'),
  f('B 0871', 'CJJ', '16:40', '17:45'), f('C 0875', 'CJJ', '18:20', '19:25'),
  f('A 1901', 'ICN', '17:30', '18:40'), f('B 1905', 'ICN', '19:10', '20:20'),
];

describe('recommend', () => {
  it('14:30 차량 출발 → 김포 A 1207, 청주 B 0871, 인천 A 1901 순', () => {
    const r = recommend('14:30', access, jeju);
    expect(r.rows.map(x => [x.airport, x.flightNo, x.totalMin])).toEqual([
      ['GMP', 'A 1207', 170], // 15:25 도착 → 15:40편은 40분 여유 부족 → 16:10편
      ['CJJ', 'B 0871', 195],
      ['ICN', 'A 1901', 250],
    ]);
    expect(r.rows[0].slackMin).toBe(45);
  });

  it('노선이 없는 공항은 noRoute로 분리', () => {
    const r = recommend('14:30', access, jeju.filter(x => x.origin !== 'CJJ'));
    expect(r.noRoute).toEqual(['청주']);
  });

  it('늦게 출발해 탈 편이 없으면 noFlightInTime', () => {
    const r = recommend('19:00', access, jeju);
    expect(r.rows).toEqual([]);
    expect(r.noFlightInTime).toEqual(['김포', '청주', '인천']);
  });
});

describe('verifyAgainstDb', () => {
  const { rows } = recommend('14:30', access, jeju);
  const ctx = { rows, departure: '14:30', dest: '제주', date: '2026-10-02' };
  it('DB에 있는 편명·시각·공항·소요시간·날짜만 쓰면 통과', () => {
    const v = verifyAgainstDb(
      '10/2 14:30에 출발해 김포공항 16:10 A 1207편을 타면 제주에 17:20에 도착해요. 총 2시간 50분, 공항까지 55분이에요.',
      ctx, ['A 1207']);
    expect(v.ok).toBe(true);
    expect(v.detail.flights.checked).toEqual(['A 1207']);
    expect(v.detail.durations.checked).toEqual(['2시간 50분', '55분']);
  });
  it('편명 하나라도 틀리면 실패', () => {
    const v = verifyAgainstDb('김포 16:10 A 1208편이 가장 빨라요.', ctx);
    expect(v.ok).toBe(false);
    expect(v.detail.flights.mismatched).toEqual(['A 1208']);
  });
  it('없는 시각이 나오면 실패', () => {
    expect(verifyAgainstDb('A 1207편은 16:15 출발이에요.', ctx).ok).toBe(false);
  });
  it('추천에 없는 공항·틀린 소요시간·다른 날짜는 실패', () => {
    expect(verifyAgainstDb('김해공항에서 A 1207편을 타세요.', ctx).detail.places.mismatched).toEqual(['김해공항']);
    expect(verifyAgainstDb('총 3시간 걸려요.', ctx).detail.durations.mismatched).toEqual(['3시간']);
    expect(verifyAgainstDb('10월 3일에 출발해요.', ctx).detail.dates.mismatched).toEqual(['10월 3일']);
  });
  it('요금·운항 상황·연락처는 값과 상관없이 차단', () => {
    const v = verifyAgainstDb('A 1207편은 61,900원이고 지연 가능성이 낮아요. 문의 02-123-4567', ctx);
    expect(v.ok).toBe(false);
    expect(v.detail.forbidden).toEqual(['요금: 61,900원', '운항 상황: 지연', '연락처·링크: 02-123-4567']);
  });
  it('AI가 밝힌 사용 편명이 문장에 없으면 실패', () => {
    const v = verifyAgainstDb('김포에서 16:10에 떠나요.', ctx, ['A 1207']);
    expect(v.ok).toBe(false);
    expect(v.detail.claimMismatch).toEqual(['A1207']);
  });
});

describe('checkClass / checkEvent', () => {
  const classes = [{ id: 1, name: '운영체제', place: '', days: ['월' as const], start: '09:00', end: '10:15' }];
  it('필수값 누락', () => {
    expect(checkClass({ name: '', place: '', days: [], start: '', end: '' }, classes).ok).toBe(false);
  });
  it('겹치면 경고하지만 저장 가능', () => {
    const c = checkClass({ name: 'DB', place: '', days: ['월'], start: '10:00', end: '11:00' }, classes);
    expect(c).toMatchObject({ ok: true, tone: 'warn' });
  });
  it('설명 없는 일정은 저장 불가', () => {
    expect(checkEvent({ kind: '약속', date: '2026-10-02', start: '10:00', end: '11:00', allDay: false, description: ' ' }).ok).toBe(false);
  });
  it('하루 종일이면 시간 없이 저장 가능', () => {
    expect(checkEvent({ kind: '약속', date: '2026-10-03', start: '', end: '', allDay: true, description: '가족 모임' }).ok).toBe(true);
  });
});

describe('layoutLanes', () => {
  it('겹친 수업은 나란히, 안 겹치면 한 줄', () => {
    const l = layoutLanes([
      { id: 1, start: '09:00', end: '10:15' },
      { id: 2, start: '09:30', end: '11:00' },
      { id: 3, start: '13:00', end: '14:00' },
    ]);
    expect(l.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(l.get(2)).toEqual({ lane: 1, lanes: 2 });
    expect(l.get(3)).toEqual({ lane: 0, lanes: 1 });
  });
});

describe('dayPlan', () => {
  it('그날 마지막 일정 종료 시각이 출발 가능 시각', () => {
    // 2026-10-02는 금요일
    const p = dayPlan('2026-10-02',
      [{ name: '캡스톤디자인', days: ['금'], start_time: '10:30:00', end_time: '12:45:00' },
       { name: '운영체제', days: ['월'], start_time: '09:00:00', end_time: '10:15:00' }],
      [{ kind: '회의', all_day: false, start_time: '13:00:00', end_time: '14:30:00', description: '캡스톤 팀 회의' }]);
    expect(p.items.map(i => i.title)).toEqual(['캡스톤디자인', '캡스톤 팀 회의']);
    expect(p.earliest).toBe('14:30');
  });
  it('일정이 없으면 null', () => {
    expect(dayPlan('2026-10-02', [], []).earliest).toBeNull();
  });
});

describe('parseDate', () => {
  const today = new Date(2026, 8, 25);
  it('여러 형식', () => {
    expect(parseDate('10/2', today)).toBe('2026-10-02');
    expect(parseDate('10월 3일', today)).toBe('2026-10-03');
    expect(parseDate('2026-12-31', today)).toBe('2026-12-31');
    expect(parseDate('1/5', today)).toBe('2027-01-05');
    expect(parseDate('2/30', today)).toBeNull();
    expect(parseDate('제주', today)).toBeNull();
  });
});

import { checkReason, parseTime, reasonCrossCheck, sameReason } from '../chat/flow';
import { confirmableError, pendingFromTrips, pendingVisits, visitFromTrip, type CandidateRow, type TripRow } from '../visits';
import { inferTimelineTrips, parseAirportVisits, summarizeTimeline, type AirportPoint } from '../data/timeline-import';

describe('chat flow', () => {
  const visits = [
    { dest_city: '제주', visited_on: '2025-10-03', reason: '추석 고향 방문', from_airport: 'GMP' },
    { dest_city: '제주', visited_on: '2025-02-10', reason: '현장 강의 수강', from_airport: 'CJJ' },
    { dest_city: '제주', visited_on: '2024-09-15', reason: '추석 고향 방문', from_airport: 'GMP' },
  ];
  const name = (c: string) => ({ GMP: '김포', CJJ: '청주' })[c] ?? c;
  it('같은 이유 대조', () => {
    expect(sameReason('연휴 고향 방문', '추석 고향 방문')).toBe(true);
    expect(sameReason('출장', '여행')).toBe(false);
    expect(reasonCrossCheck('연휴 고향 방문', visits, name)).toBe('지난 기록 중 같은 이유로 간 2번은 모두 김포에서 출발하셨어요.');
    expect(reasonCrossCheck('출장', visits, name)).toBe('지난 기록 중 같은 이유로 간 적은 없어요.');
    expect(reasonCrossCheck('출장', [], name)).toBe('');
  });
  it('시각 입력', () => {
    expect(parseTime('15:00')).toBe('15:00');
    expect(parseTime('오후 3시 반')).toBe('15:30');
    expect(parseTime('9시')).toBe('09:00');
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('제주')).toBeNull();
  });
});


describe('verifyAgainstDb — 문장 안 사실 조합', () => {
  const { rows } = recommend('14:30', access, jeju);
  const ctx = { rows, departure: '14:30', dest: '제주', date: '2026-10-02' };
  it('편명과 공항을 바꿔 붙이면 실패 (값은 각각 DB에 있지만 조합이 틀림)', () => {
    const v = verifyAgainstDb('청주공항에서 A 1207편을 타세요.', ctx);
    expect(v.ok).toBe(false);
    expect(v.detail.pairing.mismatched).toEqual(['청주↔A 1207']);
  });
  it('그 편이 아닌 다른 공항의 시각을 붙이면 실패', () => {
    const v = verifyAgainstDb('A 1207편은 16:40에 출발해요.', ctx);
    expect(v.detail.pairing.mismatched).toContain('시각 16:40↔A 1207');
  });
  it('공항이 있는 도시 이름은 통과 (김포공항 → 서울)', () => {
    expect(verifyAgainstDb('서울에서 16:10 A 1207편을 타면 17:20에 제주에 도착해요.', ctx, ['A 1207']).ok).toBe(true);
  });
  it('다른 공항을 함께 언급한 비교 문장은 통과', () => {
    expect(verifyAgainstDb('청주 16:40편보다 김포 16:10 A 1207편이 빨라요.', ctx).ok).toBe(true);
  });
});

describe('checkReason', () => {
  it('빈 값·너무 긴 값·금액·연락처는 입구에서 막는다', () => {
    expect(checkReason('출장')).toBeNull();
    expect(checkReason('  ')).toContain('입력');
    expect(checkReason('6만원 이하로')).toContain('금액');
    expect(checkReason('010-1234-5678로 연락')).toContain('금액');
    expect(checkReason('가'.repeat(61))).toContain('60자');
  });
});


describe('pendingFromTrips — 방문 기록으로 넘길 지난 여정', () => {
  const trip = (over: Partial<TripRow> = {}): TripRow => ({
    id: 1, dest_city: '제주', trip_date: '2026-09-20', reason: '출장', chosen_origin: 'GMP',
    chosen_flight_no: 'OZ8901', visit_dismissed_at: null, ...over,
  });
  const today = '2026-09-25';
  it('날짜가 지난 여정만 확인 대기로 올린다', () => {
    expect(pendingFromTrips([trip(), trip({ id: 2, trip_date: today }), trip({ id: 3, trip_date: '2026-10-01' })], [], today).map(t => t.id))
      .toEqual([1]);
  });
  it('공항을 고르지 못한 여정과 "안 갔어요"로 지운 여정은 뺀다', () => {
    expect(pendingFromTrips([trip({ chosen_origin: null })], [], today)).toEqual([]);
    expect(pendingFromTrips([trip({ visit_dismissed_at: '2026-09-24T00:00:00Z' })], [], today)).toEqual([]);
  });
  it('이미 기록이 있는 날은 다시 묻지 않는다', () => {
    expect(pendingFromTrips([trip()], [{ dest_city: '제주', visited_on: '2026-09-20' }], today)).toEqual([]);
  });
  it('같은 날 같은 목적지를 두 번 검색했으면 대표 한 건만', () => {
    const out = pendingFromTrips([trip({ id: 1 }), trip({ id: 2 })], [], today);
    expect(out.map(t => t.id)).toEqual([2]);
  });
  it('최신 날짜부터 정렬', () => {
    const out = pendingFromTrips([trip({ id: 1, trip_date: '2026-09-01' }), trip({ id: 2, trip_date: '2026-09-20', dest_city: '부산' })], [], today);
    expect(out.map(t => t.id)).toEqual([2, 1]);
  });
});

describe('visitFromTrip', () => {
  const t: TripRow = { id: 7, dest_city: '제주', trip_date: '2026-09-20', reason: '출장', chosen_origin: 'GMP', chosen_flight_no: 'OZ8901' };
  it('값은 여정 행에서만 가져온다', () => {
    expect(visitFromTrip(t)).toEqual({ trip_id: 7, dest_city: '제주', visited_on: '2026-09-20', reason: '출장', from_airport: 'GMP', source: 'trip' });
  });
  it('이유를 따로 주면 그 값을 쓴다 (공백뿐이면 여정 이유)', () => {
    expect(visitFromTrip(t, '현장 강의 수강').reason).toBe('현장 강의 수강');
    expect(visitFromTrip(t, '   ').reason).toBe('출장');
  });
});

describe('confirmableError', () => {
  const base: TripRow = { id: 1, dest_city: '제주', trip_date: '2026-09-20', reason: '출장', chosen_origin: 'GMP' };
  it('오늘·미래 여정과 공항 없는 여정은 확인할 수 없다', () => {
    expect(confirmableError(base, '2026-09-25')).toBeNull();
    expect(confirmableError({ ...base, trip_date: '2026-09-25' }, '2026-09-25')).toContain('지나지 않은');
    expect(confirmableError({ ...base, chosen_origin: null }, '2026-09-25')).toContain('공항');
  });
});

describe('kstToday', () => {
  it('서버 시간대와 무관하게 한국 날짜', () => {
    expect(kstToday(new Date('2026-09-25T14:59:59Z'))).toBe('2026-09-25');
    expect(kstToday(new Date('2026-09-25T15:00:00Z'))).toBe('2026-09-26');
  });
});


describe('타임라인 가져오기 — 지점 파싱과 여정 추정', () => {
  const apts: AirportPoint[] = [
    { code: 'GMP', name_ko: '김포국제공항', city: '서울', lat: 37.5583, lng: 126.7906 },
    { code: 'CJU', name_ko: '제주국제공항', city: '제주', lat: 33.5113, lng: 126.4930 },
    { code: 'PUS', name_ko: '김해국제공항', city: '부산', lat: 35.1795, lng: 128.9382 },
  ];
  const seg = (at: string, latLng?: string) => ({ startTime: at, ...(latLng ? { visit: { topCandidate: { placeLocation: { latLng } } } } : {}) });
  const gmp = seg('2026-09-20T08:10:00.000+09:00', '37.558°, 126.790°');
  const cju = seg('2026-09-20T10:30:00.000+09:00', '33.511°, 126.493°');
  const gmpBack = seg('2026-09-23T19:00:00.000+09:00', '37.559°, 126.791°');
  const home = seg('2026-09-20T07:00:00.000+09:00', '37.250°, 127.020°');

  it('타임라인 형식이 아니면 알려준다', () => {
    expect(() => parseAirportVisits({}, apts)).toThrow('타임라인 형식');
  });
  it('공항 반경 안의 지점만 공항 방문으로 남는다', () => {
    const v = parseAirportVisits({ semanticSegments: [home, gmp, cju] }, apts);
    expect(v.map(x => x.code)).toEqual(['GMP', 'CJU']);
    expect(v[0].date).toBe('2026-09-20');
  });
  it('왕복은 한 건으로 묶고 귀국일을 남긴다', () => {
    expect(inferTimelineTrips(parseAirportVisits({ semanticSegments: [home, gmp, cju, gmpBack] }, apts), apts))
      .toEqual([{ from_airport: 'GMP', dest_airport: 'CJU', dest_city: '제주', depart_on: '2026-09-20', return_on: '2026-09-23' }]);
  });
  it('편도면 귀국일 없이 한 건', () => {
    expect(inferTimelineTrips(parseAirportVisits({ semanticSegments: [gmp, cju] }, apts), apts))
      .toEqual([{ from_airport: 'GMP', dest_airport: 'CJU', dest_city: '제주', depart_on: '2026-09-20', return_on: null }]);
  });
  it('출발·도착이 MAX_HOP_DAYS보다 멀면 여정으로 보지 않는다', () => {
    const late = seg('2026-09-25T10:30:00.000+09:00', '33.511°, 126.493°');
    expect(inferTimelineTrips(parseAirportVisits({ semanticSegments: [gmp, late] }, apts), apts)).toEqual([]);
  });
  it('도시를 모르는 공항으로 간 구간은 후보에서 뺀다', () => {
    const noCity: AirportPoint[] = [apts[0]];
    expect(inferTimelineTrips(parseAirportVisits({ semanticSegments: [gmp, cju] }, noCity), noCity)).toEqual([]);
  });
  it('같은 파일을 두 번 올려도 같은 여정은 한 번만', () => {
    expect(inferTimelineTrips(parseAirportVisits({ semanticSegments: [gmp, cju, gmpBack, gmp, cju] }, apts), apts).length).toBe(1);
  });
  it('요약은 방문 지점 수·공항 방문 수·기간을 준다', () => {
    const s = summarizeTimeline({ semanticSegments: [home, gmp, cju, gmpBack] }, apts);
    expect(s).toMatchObject({ places: 4, airportVisits: 3, from: '2026-09-20', to: '2026-09-23' });
    expect(s.byAirport).toEqual({ GMP: 2, CJU: 1 });
  });
});

describe('pendingVisits — 대화 여정과 파일 후보를 한 목록으로', () => {
  const today = '2026-09-25';
  const trip: TripRow = { id: 1, dest_city: '제주', trip_date: '2026-09-20', reason: '출장', chosen_origin: 'GMP' };
  const cand: CandidateRow = { id: 9, dest_city: '부산', visited_on: '2026-06-20', from_airport: 'GMP', reason: null, source: 'google_timeline', dismissed_at: null };
  it('출처를 구분해 최신순으로 합친다', () => {
    const out = pendingVisits([trip], [cand], [], today);
    expect(out.map(x => [x.kind, x.dest_city, x.visited_on])).toEqual([['trip', '제주', '2026-09-20'], ['timeline', '부산', '2026-06-20']]);
    expect(out[1].source).toBe('Timeline.json');
  });
  it('이미 기록이 있는 날짜·지운 후보·미래 날짜는 뺀다', () => {
    expect(pendingVisits([], [cand], [{ dest_city: '부산', visited_on: '2026-06-20' }], today)).toEqual([]);
    expect(pendingVisits([], [{ ...cand, dismissed_at: '2026-09-01T00:00:00Z' }], [], today)).toEqual([]);
    expect(pendingVisits([], [{ ...cand, visited_on: today }], [], today)).toEqual([]);
  });
});

describe('dataHealth — 데이터 상태 게이트', () => {
  const base: HealthInput = {
    schedules: { total: 10, real: 10, sample: 0, bySource: { KAC: 10 }, coveringToday: 10, lastSyncedAt: '2026-09-25T03:00:00Z', publishedUntil: '2026-10-31' },
    runs: [{ job: 'kac-full', ok: true, startedAt: new Date(Date.now() - 3600_000).toISOString(), finishedAt: new Date(Date.now() - 3600_000).toISOString(), aborted: null, failed: 0, note: null }],
    access: { rows: 6, regions: 1, airports: 3, sample: 6 },
    regions: { active: 250, withCoords: 250 },
    fetch: { errors: 0, empty: 3 },
    today: '2026-09-25',
  };
  const gate = (i: HealthInput, id: string) => dataHealth(i).gates.find(g => g.id === id)!;

  it('전부 정상이면 종료 코드 0', () => {
    expect(dataHealth(base).exitCode).toBe(0);
    expect(dataHealth(base).gates.every(g => g.ok)).toBe(true);
  });
  it('실제 스케줄이 0건이면 치명 실패 (화면이 샘플로만 돈다)', () => {
    const r = dataHealth({ ...base, schedules: { ...base.schedules, real: 0, coveringToday: 0, bySource: {} } });
    expect(gate({ ...base, schedules: { ...base.schedules, real: 0, coveringToday: 0, bySource: {} } }, 'schedules-real').ok).toBe(false);
    expect(r.exitCode).toBe(1);
  });
  it('스케줄이 오늘 이후를 못 덮으면 실패, 공개 끝을 알려준다', () => {
    const g = gate({ ...base, schedules: { ...base.schedules, coveringToday: 0, publishedUntil: '2026-09-20' } }, 'schedules-real');
    expect(g.ok).toBe(false);
    expect(g.detail).toContain('2026-09-20');
  });
  it('성공한 동기화가 30시간을 넘으면 실패, 마지막 실패 이유를 함께 보여준다', () => {
    const old = new Date(Date.now() - 40 * 3600_000).toISOString();
    const runs = [
      { job: 'kac-full', ok: false, startedAt: old, finishedAt: old, aborted: 'SUPABASE_SERVICE_ROLE_KEY에 publishable 키가 들어 있어요.', failed: 0, note: null },
      { job: 'kac-full', ok: true, startedAt: old, finishedAt: old, aborted: null, failed: 0, note: null },
    ];
    const g = gate({ ...base, runs }, 'sync-recent');
    expect(g.ok).toBe(false);
    expect(g.detail).toContain('publishable');
  });
  it('접근 시간이 없으면 치명 실패 (핵심 계산)', () => {
    const r = dataHealth({ ...base, access: { rows: 0, regions: 0, airports: 0, sample: 0 } });
    expect(r.gates.find(g => g.id === 'access-times')!.ok).toBe(false);
    expect(r.exitCode).toBe(1);
  });
  it('좌표가 비면 주의지만 종료 코드는 유지된다', () => {
    const r = dataHealth({ ...base, regions: { active: 250, withCoords: 3 } });
    expect(r.gates.find(g => g.id === 'regions-coords')!.ok).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.gates.find(g => g.id === 'regions-coords')!.headline).toBe('행정구역 좌표 3/250');
  });
});
