import { describe, expect, it } from 'vitest';
import {
  ANY_BAND, bandFor, bandTitle, bandsForLookup, isBand, kstInstant, kstWeekday, nextDepartureAt, toKakaoDepartureTime,
} from '../data/access-bands';

// 시각대는 배치가 어떤 출발 시각으로 계산했는지를 정하고, 추천이 어느 행을 쓸지를 정한다.
// 한국 시간 기준 계산이라 서버 시간대(UTC)와 무관해야 한다 — 여기서 그걸 고정한다.

describe('kstWeekday / kstInstant', () => {
  it('한국 날짜의 요일을 UTC 서버에서도 맞게 준다', () => {
    expect(kstWeekday('2026-09-25')).toBe(5); // 금
    expect(kstWeekday('2026-09-26')).toBe(6); // 토
    expect(kstWeekday('2026-09-27')).toBe(0); // 일
    expect(kstWeekday('2026-09-28')).toBe(1); // 월
  });
  it('한국 시각은 UTC보다 9시간 앞선다', () => {
    expect(kstInstant('2026-09-28', '08:00').toISOString()).toBe('2026-09-27T23:00:00.000Z');
  });
});

describe('bandFor — 여정이 어느 시각대인가', () => {
  it('주말은 시각과 무관하게 weekend', () => {
    expect(bandFor('2026-09-26', '03:00')).toBe('weekend');
    expect(bandFor('2026-09-27', '22:00')).toBe('weekend');
  });
  it('평일은 10시 전 아침 / 17시 전 낮 / 그 뒤 저녁', () => {
    expect(bandFor('2026-09-25', '06:30')).toBe('weekday_am');
    expect(bandFor('2026-09-25', '09:59')).toBe('weekday_am');
    expect(bandFor('2026-09-25', '10:00')).toBe('weekday_day');
    expect(bandFor('2026-09-25', '16:59')).toBe('weekday_day');
    expect(bandFor('2026-09-25', '17:00')).toBe('weekday_pm');
    expect(bandFor('2026-09-25', '23:30')).toBe('weekday_pm');
  });
});

describe('nextDepartureAt — 그 시각대를 계산할 출발 시각', () => {
  // 2026-09-25 15:00 KST (금)
  const friAfternoon = new Date('2026-09-25T06:00:00Z');
  it("'any'는 출발 시각을 지정하지 않는다", () => {
    expect(nextDepartureAt(ANY_BAND, friAfternoon)).toBeNull();
  });
  it('오늘 그 시각이 아직 안 지났으면 오늘', () => {
    expect(nextDepartureAt('weekday_pm', friAfternoon)?.toISOString()).toBe('2026-09-25T09:00:00.000Z'); // 금 18:00 KST
  });
  it('오늘 그 시각이 지났으면 다음 같은 요일 (주말은 건너뛴다)', () => {
    // 아침 08:00은 이미 지났고, 토·일을 건너뛰어 월요일로
    expect(nextDepartureAt('weekday_am', friAfternoon)?.toISOString()).toBe('2026-09-27T23:00:00.000Z'); // 월 08:00 KST
  });
  it('저녁 시각이 지난 금요일 밤이면 월요일 저녁으로 넘어간다', () => {
    const friNight = new Date('2026-09-25T11:00:00Z'); // 20:00 KST
    expect(nextDepartureAt('weekday_pm', friNight)?.toISOString()).toBe('2026-09-28T09:00:00.000Z'); // 월 18:00 KST
  });
  it('주말 시각대는 다가오는 토요일', () => {
    expect(nextDepartureAt('weekend', friAfternoon)?.toISOString()).toBe('2026-09-26T04:00:00.000Z'); // 토 13:00 KST
  });
  it('항상 현재 이후를 준다 (제공자가 과거를 거부한다)', () => {
    for (const band of ['weekday_am', 'weekday_day', 'weekday_pm', 'weekend'] as const) {
      const at = nextDepartureAt(band, friAfternoon)!;
      expect(at.getTime()).toBeGreaterThan(friAfternoon.getTime());
    }
  });
});

describe('toKakaoDepartureTime', () => {
  it('한국 시간 YYYYMMDDHHmm 12자리', () => {
    expect(toKakaoDepartureTime(kstInstant('2026-09-28', '08:00'))).toBe('202609280800');
    expect(toKakaoDepartureTime(kstInstant('2026-09-26', '13:00'))).toBe('202609261300');
  });
  it('문서 예시 형식과 같은 자릿수 (202109170000)', () => {
    expect(toKakaoDepartureTime(kstInstant('2021-09-17', '00:00'))).toBe('202109170000');
  });
});

describe('bandTitle / isBand / bandsForLookup', () => {
  it('시각대 표기에 가정 출발 시각을 함께 보여준다', () => {
    expect(bandTitle('weekday_am')).toBe('평일 아침 (08:00)');
    expect(bandTitle('weekday_pm')).toBe('평일 저녁 (18:00)');
    expect(bandTitle('weekend')).toBe('주말 낮 (13:00)');
    expect(bandTitle('any')).toContain('시각 미지정');
  });
  it('허용되지 않는 시각대는 걸러낸다', () => {
    expect(isBand('weekday_am')).toBe(true);
    expect(isBand('weekday_lunch')).toBe(false);
    expect(isBand(null)).toBe(false);
  });
  it('추천은 정확한 시각대 → any 순으로 찾는다', () => {
    expect(bandsForLookup('weekday_pm')).toEqual(['weekday_pm', 'any']);
    expect(bandsForLookup('any')).toEqual(['any']);
  });
});
