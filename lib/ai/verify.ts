import type { RecommendRow } from '../recommend';
import { DOMESTIC_BUFFER_MIN } from '../recommend';

// AI 문장 검증 — 구체 값 화이트리스트 (reference/…/validate/engine.py의 claim_whitelist를 이 서비스에 맞춘 것)
// 정규식은 "모양"만 찾는다. 찾은 값이 이번 추천의 DB 값에 있으면 통과, 없으면 차단.
// 추천 DB에 아예 없는 종류(요금·지연·연락처·링크 등)는 값과 상관없이 차단.

export interface SlotCheck { checked: string[]; mismatched: string[] }

export interface VerifyDetail {
  flights: SlotCheck;
  times: SlotCheck;
  places: SlotCheck;
  durations: SlotCheck;
  dates: SlotCheck;
  /** 추천 DB에 없는 종류라 값과 상관없이 막은 표현 */
  forbidden: string[];
  /** 구조화 응답에서 AI가 "썼다"고 밝힌 편명 중 문장에 없거나 DB에 없는 것 */
  claimMismatch?: string[];
  /** 검증 자체가 실패하면(예외) fail-closed로 막고 이유를 남긴다 */
  error?: string;
}

export interface VerifyResult {
  ok: boolean;
  detail: VerifyDetail;
}

export interface VerifyContext {
  rows: RecommendRow[];
  departure: string;
  dest: string;
  /** "YYYY-MM-DD" */
  date: string;
}

const FLIGHT_RE = /\b(?:[A-Z]{1,2}|[A-Z]\d|\d[A-Z])\s?\d{3,4}\b/g;
const TIME_RE = /\b\d{1,2}:\d{2}\b/g;
const DURATION_RE = /(\d{1,2})\s*시간(?:\s*(\d{1,2})\s*분)?|(\d{1,3})\s*분/g;
const DATE_RE = /(\d{1,2})\s*(?:\/|월\s*)(\d{1,2})\s*일?/g;
// 국내선 공항·도시 이름. 이번 추천에 없는 곳이 문장에 나오면 차단한다.
const PLACES = ['김포', '인천', '청주', '김해', '제주', '대구', '광주', '여수', '울산', '포항', '무안', '양양', '사천', '군산', '원주', '서울', '부산', '경주', '서귀포'];
const PLACE_RE = new RegExp(`(${PLACES.join('|')})(?:국제)?(?:공항)?`, 'g');
const FORBIDDEN: [string, RegExp][] = [
  ['요금', /\d[\d,]*\s*원|\d+\s*만\s*원|요금|운임|가격|할인|특가/g],
  ['운항 상황', /지연|결항|취소|만석|잔여석|좌석|혼잡|날씨|기상/g],
  ['연락처·링크', /https?:\/\/\S+|0\d{1,2}-?\d{3,4}-?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/g],
];

const normFlight = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const normTime = (s: string) => s.padStart(5, '0');
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function durationMinutes(m: RegExpMatchArray) {
  return m[3] != null ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] ?? 0);
}

/** AI가 쓴 문장의 구체 값이 모두 이번 추천의 DB 값인지 검사한다. 예외가 나면 차단(fail-closed). */
export function verifyAgainstDb(text: string, ctx: VerifyContext, claimedFlights?: string[]): VerifyResult {
  try {
    return check(text, ctx, claimedFlights);
  } catch (e) {
    const empty = { checked: [], mismatched: [] };
    return { ok: false, detail: { flights: empty, times: empty, places: empty, durations: empty, dates: empty, forbidden: [], error: String(e) } };
  }
}

function check(text: string, { rows, departure, dest, date }: VerifyContext, claimedFlights?: string[]): VerifyResult {
  const knownFlights = new Set(rows.map(r => normFlight(r.flightNo)));
  const knownTimes = new Set([departure, ...rows.flatMap(r => [r.dep, r.arr])].map(normTime));
  const knownMinutes = new Set([DOMESTIC_BUFFER_MIN, ...rows.flatMap(r => [r.accessMin, r.slackMin, r.totalMin])]);
  const knownPlaces = new Set([dest, ...rows.map(r => r.airportName)].map(p => p.replace(/(국제)?공항$/, '')));
  const [, mm, dd] = date.split('-').map(Number);

  const flights = uniq(text.match(FLIGHT_RE) ?? []);
  const times = uniq(text.match(TIME_RE) ?? []);
  const durations = uniq([...text.matchAll(DURATION_RE)].map(m => m[0].trim()));
  const dates = uniq([...text.matchAll(DATE_RE)].map(m => m[0].trim()));
  const places = uniq([...text.matchAll(PLACE_RE)].map(m => m[0]));

  const detail: VerifyDetail = {
    flights: { checked: flights, mismatched: flights.filter(f => !knownFlights.has(normFlight(f))) },
    times: { checked: times, mismatched: times.filter(t => !knownTimes.has(normTime(t))) },
    durations: {
      checked: durations,
      mismatched: [...text.matchAll(DURATION_RE)].filter(m => !knownMinutes.has(durationMinutes(m))).map(m => m[0].trim()),
    },
    dates: {
      checked: dates,
      mismatched: [...text.matchAll(DATE_RE)].filter(m => Number(m[1]) !== mm || Number(m[2]) !== dd).map(m => m[0].trim()),
    },
    places: {
      checked: places,
      mismatched: [...text.matchAll(PLACE_RE)].filter(m => !knownPlaces.has(m[1])).map(m => m[0]),
    },
    forbidden: uniq(FORBIDDEN.flatMap(([label, re]) => (text.match(re) ?? []).map(v => `${label}: ${v}`))),
  };
  detail.durations.mismatched = uniq(detail.durations.mismatched);
  detail.dates.mismatched = uniq(detail.dates.mismatched);
  detail.places.mismatched = uniq(detail.places.mismatched);

  // AI가 밝힌 "사용한 편명"은 전부 DB에 있고 문장에도 나와야 한다
  if (claimedFlights) {
    const inText = new Set(flights.map(normFlight));
    const bad = claimedFlights.map(normFlight).filter(f => !knownFlights.has(f) || !inText.has(f));
    if (bad.length) detail.claimMismatch = uniq(bad);
  }

  const ok = [detail.flights, detail.times, detail.durations, detail.dates, detail.places].every(s => !s.mismatched.length)
    && !detail.forbidden.length && !detail.claimMismatch?.length;
  return { ok, detail };
}

/** 차단 이유를 사람이 읽을 목록으로 */
export function mismatchList(d: VerifyDetail): string[] {
  return [
    ...d.flights.mismatched, ...d.times.mismatched, ...d.places.mismatched, ...d.durations.mismatched, ...d.dates.mismatched,
    ...d.forbidden, ...(d.claimMismatch ?? []).map(f => `언급 안 된 편 ${f}`), ...(d.error ? [`검증 오류`] : []),
  ];
}
