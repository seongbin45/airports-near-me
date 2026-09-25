// 이동 시간의 시각대.
//
// 카카오모빌리티는 출발 시각을 지정하지 않으면 호출 시각의 실시간 교통으로 계산한다.
// 2026-09-25 배치는 금요일 16~17시에 돌아 전국 값에 퇴근길 정체가 섞였다(수원 영통구 → 김포 137분).
// 그 값을 "평균"으로 쓰면 사용자가 실제로 겪는 시간과 어긋나므로, 배치가 시각대별로 다시 계산해
// access_times.depart_band에 남긴다. 여기 있는 건 그 시각대의 정의와 계산에 필요한 순수 함수뿐이다.

import { kstToday, toMin } from '../time';

export const BANDS = ['any', 'weekday_am', 'weekday_day', 'weekday_pm', 'weekend'] as const;
export type Band = (typeof BANDS)[number];

/** 출발 시각을 지정하지 않는 시각대. 제공자의 실시간 교통 기준 */
/** 리터럴 타입으로 둔다 — 이게 Band면 `band === ANY_BAND`가 'any'를 걸러내지 못한다. */
export const ANY_BAND = 'any' as const;

export const BAND_LABEL: Record<Band, string> = {
  any: '시각 미지정(호출 시점 실시간)',
  weekday_am: '평일 아침',
  weekday_day: '평일 낮',
  weekday_pm: '평일 저녁',
  weekend: '주말 낮',
};

export interface BandSpec { days: number[]; hhmm: string }

/** 시각대별 가정 출발 시각 (KST). days는 JS getDay() 기준 (0=일 … 6=토) */
const SPEC: Record<Exclude<Band, 'any'>, BandSpec> = {
  weekday_am: { days: [1, 2, 3, 4, 5], hhmm: '08:00' },
  weekday_day: { days: [1, 2, 3, 4, 5], hhmm: '13:00' },
  weekday_pm: { days: [1, 2, 3, 4, 5], hhmm: '18:00' },
  weekend: { days: [0, 6], hhmm: '13:00' },
};

/** 시각대의 가정 출발 시각. 'any'는 출발 시각을 지정하지 않으므로 null. */
export function bandSpec(band: Band): BandSpec | null {
  return band === ANY_BAND ? null : SPEC[band];
}

export const KST_OFFSET = '+09:00';

/** 한국 날짜·시각 → 그 순간(Date). 서버 시간대와 무관하다. */
export function kstInstant(dateIso: string, hhmm: string): Date {
  return new Date(Date.parse(`${dateIso}T${hhmm}:00${KST_OFFSET}`));
}

/**
 * "YYYY-MM-DD"의 요일 (0=일 … 6=토).
 * 이 문자열은 이미 한국 날짜라서(사용자가 고른 날짜·DB의 trip_date) 달력 그대로의 요일을 본다.
 * UTC 자정으로 파싱하지 않으면 KST 자정을 UTC로 환산하면서 하루 앞의 요일이 나온다(금 → 목).
 */
export function kstWeekday(dateIso: string): number {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`)).getUTCDay();
}

function shiftIso(dateIso: string, days: number): string {
  const d = new Date(Date.parse(`${dateIso}T00:00:00Z`) + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * 여정 날짜·출발 시각이 어느 시각대인지.
 * 주말은 시각과 무관하게 'weekend'다(주말은 아침·저녁 구분 없이 한 값만 둔다).
 * 평일은 10시 전 → 아침, 17시 전 → 낮, 그 뒤 → 저녁. (시각대 값이 없을 때 가장 가까운 값을 고르는 기준)
 */
export function bandFor(dateIso: string, hhmm: string): Band {
  const day = kstWeekday(dateIso);
  if (day === 0 || day === 6) return 'weekend';
  const m = toMin(hhmm);
  if (m < 10 * 60) return 'weekday_am';
  if (m < 17 * 60) return 'weekday_day';
  return 'weekday_pm';
}

/**
 * 그 시각대를 계산할 출발 시각(한국 시간 기준 앞으로 다가오는 그 요일·시각).
 * 제공자는 현재 시각 이후만 받으므로, 오늘 해당 시각이 지났으면 다음 같은 요일로 넘어간다.
 * 'any'면 null (출발 시각을 지정하지 않는다는 뜻).
 */
export function nextDepartureAt(band: Band, now: Date, leadMinutes = 5): Date | null {
  const spec = bandSpec(band);
  if (!spec) return null;
  const base = kstToday(now);
  for (let i = 0; i <= 7; i++) {
    const dateIso = shiftIso(base, i);
    if (!spec.days.includes(kstWeekday(dateIso))) continue;
    const at = kstInstant(dateIso, spec.hhmm);
    if (at.getTime() > now.getTime() + leadMinutes * 60_000) return at;
  }
  return null;
}

/** 카카오모빌리티 departure_time 형식: 한국 시간 "YYYYMMDDHHmm" (예: 202109170000) */
export function toKakaoDepartureTime(at: Date): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace(/\D/g, '');
}

/** 시각대 표기: "평일 아침 (08:00)" */
export function bandTitle(band: Band): string {
  const spec = bandSpec(band);
  return spec ? `${BAND_LABEL[band]} (${spec.hhmm})` : BAND_LABEL[band];
}

export function isBand(v: unknown): v is Band {
  return typeof v === 'string' && (BANDS as readonly string[]).includes(v);
}

/** 추천이 쓸 시각대 순서: 정확히 맞는 시각대 → 'any' */
export function bandsForLookup(band: Band): Band[] {
  return band === ANY_BAND ? [ANY_BAND] : [band, ANY_BAND];
}
