import { describe, expect, it } from 'vitest';
import { recommend, type AccessTime, type Flight } from '../recommend';
import { verifyAgainstDb } from '../ai/verify';
import { checkClass, checkEvent } from '../onboarding/validate';
import { layoutLanes } from '../onboarding/lanes';
import { dayPlan } from '../day';
import { parseDate } from '../time';

// 프로토타입(design/공항 찾기 대화.dc.html)과 같은 샘플 값
const access: AccessTime[] = [
  { airport: 'GMP', airportName: '김포', minutes: 55, source: '카카오모빌리티 경로' },
  { airport: 'CJJ', airportName: '청주', minutes: 80, source: '카카오모빌리티 경로' },
  { airport: 'ICN', airportName: '인천', minutes: 95, source: '카카오모빌리티 경로' },
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

import { parseTime, reasonCrossCheck, sameReason } from '../chat/flow';

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
