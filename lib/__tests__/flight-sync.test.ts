import { describe, expect, it } from 'vitest';
import {
  addDaysIso, deadlineHit, dedupe, isTransportFailure, nextStreak, planOnDemand, planTagoDates, SYNC_DEADLINE_MS,
} from '../server/flight-sync';
import { DataGoKrError } from '../data/data-go-kr';
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

// 2026-09-25: 러너에서 공공데이터포털 연결이 막혀 TAGO 1,102회를 22분 동안 두드리다 워크플로 timeout에 걸려
// cancelled로 끝났다. 취소는 알림 없이 묻히므로 스스로 멈추는 장치를 여기서 고정한다.
describe('연결 실패 회로 차단기', () => {
  it('NETWORK와 재시도 가능한 오류를 연결 실패로 센다', () => {
    expect(isTransportFailure(new DataGoKrError('네트워크 오류: fetch failed', 'NETWORK', false))).toBe(true);
    expect(isTransportFailure(new DataGoKrError('HTTP 502', '502', true))).toBe(true);
  });
  it('형식 오류와 DB 권한 오류는 세지 않는다', () => {
    expect(isTransportFailure(new DataGoKrError('응답 형식이 예상과 달라요', 'FORMAT', false))).toBe(false);
    expect(isTransportFailure({ code: '42501', message: 'RLS에 막힘' })).toBe(false);
  });
  it('4번까지는 계속하고 5번째에 멈춘다', () => {
    const e = new DataGoKrError('네트워크 오류: fetch failed', 'NETWORK', false);
    let streak = 0;
    for (let i = 1; i <= 4; i++) {
      const r = nextStreak(streak, e);
      expect(r.stop, `${i}번째에 멈추면 안 된다`).toBeNull();
      streak = r.streak;
    }
    expect(streak).toBe(4);
    expect(nextStreak(streak, e).stop).toContain('5번');
  });
  it('중간에 다른 종류의 오류가 오면 연속이 끊긴다', () => {
    expect(nextStreak(4, new DataGoKrError('응답 형식', 'FORMAT', false)).streak).toBe(0);
  });
});

describe('내부 데드라인', () => {
  const t0 = Date.parse('2026-09-27T02:00:00Z');
  it('44분은 지나가고 46분은 멈춘다', () => {
    expect(deadlineHit(t0, t0 + 44 * 60_000)).toBe(false);
    expect(deadlineHit(t0, t0 + 46 * 60_000)).toBe(true);
  });
  it('워크플로 timeout(60분)보다 짧아야 한다 — 그래야 job이 cancelled가 아니라 failed로 끝난다', () => {
    expect(SYNC_DEADLINE_MS).toBeLessThan(60 * 60_000);
  });
});
