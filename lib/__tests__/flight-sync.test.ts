import { describe, expect, it } from 'vitest';
import { addDaysIso, dedupe, planOnDemand, planTagoDates } from '../server/flight-sync';
import { KAC_SOURCE } from '../data/kac-schedule';
import { TAGO_SOURCE } from '../data/tago-flights';
import type { FlightScheduleRecord } from '../data/flight-schedule';

// 동기화 코드가 조용히 데이터를 지운 적이 있다(2026-09-25, 565건). 그 경로의 판단 함수를 여기서 고정한다.

const rec = (over: Partial<FlightScheduleRecord>): FlightScheduleRecord => ({
  flight_no: 'OZ8963', airline: '아시아나 항공', origin: 'GMP', dest: 'CJU',
  dep_time: '15:05', arr_time: '16:10', days_of_week: [5], valid_from: '2026-10-02', valid_to: '2026-10-02',
  source: TAGO_SOURCE, economy_fare: null, ...over,
});

describe('addDaysIso', () => {
  it('월·연 경계를 넘는다', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('dedupe', () => {
  it('같은 편이 시각만 다르게 두 번 오면 더 이른 출발을 남긴다', () => {
    const out = dedupe([rec({ dep_time: '15:10' }), rec({ dep_time: '15:05' })]);
    expect(out).toHaveLength(1);
    expect(out[0].dep_time).toBe('15:05');
  });
  it('출처가 다르면 따로 남는다 (추천에서 출처 우선순위로 고른다)', () => {
    expect(dedupe([rec({ source: TAGO_SOURCE }), rec({ source: KAC_SOURCE })])).toHaveLength(2);
  });
});

describe('planTagoDates', () => {
  it('노선별 정기 스케줄 끝까지, TAGO 공항 id가 없는 노선은 뺀다', () => {
    const plan = planTagoDates([
      { origin: 'GMP', dest: 'CJU', valid_to: '2026-10-03' },
      { origin: 'GMP', dest: 'CJU', valid_to: '2026-10-01' }, // 같은 노선은 더 늦은 끝을 쓴다
      { origin: 'GMP', dest: 'ZZZ', valid_to: '2026-10-03' }, // TAGO에 없는 공항
    ], '2026-10-01', 5);
    expect(plan.filter(p => p.dest === 'CJU').map(p => p.date))
      .toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(plan.every(p => p.dest !== 'ZZZ')).toBe(true);
  });
  it('정기 스케줄 끝이 없으면 maxDays까지만 본다', () => {
    expect(planTagoDates([{ origin: 'GMP', dest: 'CJU', valid_to: null }], '2026-10-01', 2).map(p => p.date))
      .toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('planOnDemand', () => {
  const route = { origin: 'GMP', dest: 'CJU' };
  const now = new Date('2026-10-01T12:00:00Z');
  it('DB에 없고 물어본 적도 없으면 두 출처 모두', () => {
    expect(planOnDemand([route], [], [], now).map(t => t.source)).toEqual([KAC_SOURCE, TAGO_SOURCE]);
  });
  it('그날을 덮는 편이 있고 TAGO를 최근에 물어봤으면 아무것도 안 한다', () => {
    expect(planOnDemand([route], [{ source: KAC_SOURCE, origin: 'GMP', dest: 'CJU' }],
      [{ source: TAGO_SOURCE, origin: 'GMP', dest: 'CJU', fetched_at: '2026-10-01T09:00:00Z' }], now)).toEqual([]);
  });
  it('TAGO 조회 기록이 6시간을 넘으면 다시 물어본다', () => {
    expect(planOnDemand([route], [{ source: KAC_SOURCE, origin: 'GMP', dest: 'CJU' }],
      [{ source: TAGO_SOURCE, origin: 'GMP', dest: 'CJU', fetched_at: '2026-10-01T03:00:00Z' }], now).map(t => t.source))
      .toEqual([TAGO_SOURCE]);
  });
});
