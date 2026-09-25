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
  /** 편명과 공항·시각이 같은 문장 안에서 맞물리는지. 값이 모두 DB에 있어도 조합이 틀리면 막는다 */
  pairing: SlotCheck;
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
// 국내선 공항·도시 이름. 이번 추천에 없는 곳이 문장에 나오면 막는다.
const PLACES = ['김포', '인천', '청주', '김해', '제주', '대구', '광주', '여수', '울산', '포항', '무안', '양양', '사천', '군산', '원주', '서울', '부산', '경주', '서귀포'];
const PLACE_RE = new RegExp(`(${PLACES.join('|')})(?:국제)?(?:공항)?`, 'g');
/** 문장 경계. 편명·공항·시각의 조합은 이 단위로 본다 */
const SENTENCE_RE = /[.?!\n]+/;
const FORBIDDEN: [string, RegExp][] = [
  ['요금', /\d[\d,]*\s*원|\d+\s*만\s*원|요금|운임|가격|할인|특가/g],
  ['운항 상황', /지연|결항|취소|만석|잔여석|좌석|혼잡|날씨|기상/g],
  ['연락처·링크', /https?:\/\/\S+|0\d{1,2}-?\d{3,4}-?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/g],
];

const normFlight = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const normTime = (s: string) => s.padStart(5, '0');
/** "김포국제공항" → "김포" */
const corePlace = (s: string) => s.replace(/(국제)?공항$/, '');
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
    return { ok: false, detail: { flights: empty, times: empty, places: empty, durations: empty, dates: empty, pairing: empty, forbidden: [], error: String(e) } };
  }
}

/**
 * 값 하나하나는 DB에 있어도 조합이 틀릴 수 있다. A 1207은 김포 편인데 "청주공항에서 A 1207편"이라고 쓰면
 * 편명도 청주도 각각 DB 값이라 값 집합 비교로는 통과한다. 그래서 문장 단위로 묶어서 본다.
 *  - 그 문장에 나온 편명의 공항(과 그 공항이 있는 도시)이 아닌 지명은 막는다
 *  - 시각은 그 문장에 나온 편명들의 출발·도착 시각이거나, 그 문장에 함께 언급된 다른 공항의 편 시각이어야 한다
 *    (비교 문장 "청주 16:40편보다 김포가 빨라요"를 막지 않기 위해서다)
 */
function checkPairing(text: string, rows: RecommendRow[], departure: string, dest: string): SlotCheck {
  const byFlight = new Map<string, RecommendRow>();
  for (const r of rows) byFlight.set(normFlight(r.flightNo), r);

  const checked: string[] = [], mismatched: string[] = [];
  for (const sentence of text.split(SENTENCE_RE)) {
    const found = uniq(sentence.match(FLIGHT_RE) ?? []);
    if (!found.length) continue;
    const matched = found.map(f => byFlight.get(normFlight(f))).filter((r): r is RecommendRow => !!r);
    if (!matched.length) continue; // DB에 없는 편명은 flights.mismatched가 잡는다

    const allowedPlaces = new Set<string>([dest, corePlace(dest)]);
    for (const r of matched) {
      allowedPlaces.add(corePlace(r.airportName));
      if (r.airportCity) allowedPlaces.add(corePlace(r.airportCity));
    }
    // 비교 문장("청주 16:40편보다 김포 16:10 A 1207편이 빨라요")은 다른 공항을 함께 부른다.
    // 그 공항 편의 출발·도착 시각이 문장에 있으면 그 지명도 이 문장의 사실로 인정한다.
    const sentenceTimes = uniq(sentence.match(TIME_RE) ?? []);
    for (const r of rows) {
      if (sentenceTimes.some(t => normTime(t) === r.dep || normTime(t) === r.arr)) {
        allowedPlaces.add(corePlace(r.airportName));
        if (r.airportCity) allowedPlaces.add(corePlace(r.airportCity));
      }
    }
    for (const m of sentence.matchAll(PLACE_RE)) {
      const label = `${m[1]}↔${found.join('/')}`;
      checked.push(label);
      if (!allowedPlaces.has(m[1])) mismatched.push(label);
    }

    const allowedTimes = new Set<string>([departure]);
    const mentioned = new Set<string>();
    for (const m of sentence.matchAll(PLACE_RE)) mentioned.add(m[1]);
    for (const r of rows) {
      const cores = [corePlace(r.airportName), ...(r.airportCity ? [corePlace(r.airportCity)] : [])];
      if (matched.includes(r) || cores.some(c => mentioned.has(c))) {
        allowedTimes.add(r.dep);
        allowedTimes.add(r.arr);
      }
    }
    for (const t of uniq(sentence.match(TIME_RE) ?? [])) {
      const label = `시각 ${t}↔${found.join('/')}`;
      checked.push(label);
      if (!allowedTimes.has(normTime(t))) mismatched.push(label);
    }
  }
  return { checked, mismatched: uniq(mismatched) };
}

function check(text: string, { rows, departure, dest, date }: VerifyContext, claimedFlights?: string[]): VerifyResult {
  const knownFlights = new Set(rows.map(r => normFlight(r.flightNo)));
  const knownTimes = new Set([departure, ...rows.flatMap(r => [r.dep, r.arr])].map(normTime));
  const knownMinutes = new Set([DOMESTIC_BUFFER_MIN, ...rows.flatMap(r => [r.accessMin, r.slackMin, r.totalMin])]);
  // 지명은 공항 이름뿐 아니라 그 공항이 있는 도시 이름도 허용한다 (김포공항 → 서울).
  // 허용하지 않으면 "서울에서 출발" 같은 맞는 문장이 오탐으로 막힌다.
  const knownPlaces = new Set([dest, ...rows.flatMap(r => [r.airportName, r.airportCity ?? ''])].map(corePlace));
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
    pairing: checkPairing(text, rows, departure, dest),
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

  const ok = [detail.flights, detail.times, detail.durations, detail.dates, detail.places, detail.pairing]
    .every(s => !s.mismatched.length)
    && !detail.forbidden.length && !detail.claimMismatch?.length;
  return { ok, detail };
}

/** 차단 이유를 사람이 읽을 목록으로 */
export function mismatchList(d: VerifyDetail): string[] {
  return [
    ...d.flights.mismatched, ...d.times.mismatched, ...d.places.mismatched, ...d.durations.mismatched, ...d.dates.mismatched,
    ...d.pairing.mismatched, ...d.forbidden, ...(d.claimMismatch ?? []).map(f => `언급 안 된 편 ${f}`), ...(d.error ? [`검증 오류`] : []),
  ];
}
