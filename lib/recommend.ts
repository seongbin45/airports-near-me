import { fmtDur, hhmm, toMin } from './time';
import type { Band } from './data/access-bands';

export type Mode = 'car' | 'transit';

export const MODE_LABEL: Record<Mode, string> = { car: '차량', transit: '대중교통' };

/** 국내선은 출발 40분 전까지 공항 도착 */
export const DOMESTIC_BUFFER_MIN = 40;

export interface AccessTime {
  airport: string;
  airportName: string;
  /** 공항이 속한 도시 (airports.city). AI 문장 검증에서 도시 이름을 허용하려고 쓴다 */
  city?: string | null;
  minutes: number;
  source: string;
  /** 이 시간이 어느 시각대 기준인지 (access_times.depart_band) */
  band?: Band;
  /** 여정의 시각대와 정확히 맞는 행인지. false면 'any'(호출 시점 실시간) 값을 쓴 것 */
  bandMatched?: boolean;
}

export interface Flight {
  id: number;
  flight_no: string;
  origin: string;
  dep_time: string;
  arr_time: string;
  is_sample: boolean;
  source?: string;
  synced_at?: string | null;
  economy_fare?: number | null;
}

export interface RecommendRow {
  airport: string;
  airportName: string;
  /** 공항이 속한 도시 (airports.city). 예: 김포 → 서울 */
  airportCity: string | null;
  accessMin: number;
  accessSource: string;
  /** 이동 시간의 시각대. 시각대 데이터가 없어 'any'를 썼으면 bandMatched가 false */
  accessBand: Band | null;
  accessBandMatched: boolean;
  flightId: number;
  flightNo: string;
  dep: string;
  arr: string;
  slackMin: number;
  totalMin: number;
  isSample: boolean;
  source: string;
  /** 운항 스케줄을 마지막으로 API에서 확인한 시각 (샘플은 null) */
  syncedAt: string | null;
  /** 일반석 요금(원) — TAGO 날짜별 운항편에만 있다 */
  fare: number | null;
}

export interface Recommendation {
  rows: RecommendRow[];
  /** 접근 시간은 있는데 이 목적지로 가는 편이 DB에 없는 공항 */
  noRoute: string[];
  /** 편은 있지만 출발 시각까지 갈 수 있는 편이 없는 공항 */
  noFlightInTime: string[];
}

/**
 * 출발 가능 시각 + 공항까지 시간 → 공항에 {bufferMin}분 여유를 두고 탈 수 있는 첫 편 → 목적지 도착까지 총 소요 순 정렬.
 * DB에서 읽은 값만 쓴다. 추정하지 않는다.
 */
export function recommend(
  departure: string,
  access: AccessTime[],
  flights: Flight[],
  bufferMin = DOMESTIC_BUFFER_MIN,
): Recommendation {
  const start = toMin(departure);
  const rows: RecommendRow[] = [], noRoute: string[] = [], noFlightInTime: string[] = [];

  for (const a of access) {
    const list = flights
      .filter(f => f.origin === a.airport)
      .sort((x, y) => toMin(hhmm(x.dep_time)) - toMin(hhmm(y.dep_time)));
    if (!list.length) { noRoute.push(a.airportName); continue; }
    const atAirport = start + a.minutes;
    const f = list.find(x => toMin(hhmm(x.dep_time)) - bufferMin >= atAirport);
    if (!f) { noFlightInTime.push(a.airportName); continue; }
    const dep = hhmm(f.dep_time), arr = hhmm(f.arr_time);
    rows.push({
      airport: a.airport, airportName: a.airportName, airportCity: a.city ?? null, accessMin: a.minutes, accessSource: a.source,
      accessBand: a.band ?? null, accessBandMatched: a.bandMatched ?? true,
      flightId: f.id, flightNo: f.flight_no, dep, arr,
      slackMin: toMin(dep) - atAirport, totalMin: toMin(arr) - start, isSample: f.is_sample,
      source: f.source ?? '운항 스케줄 DB', syncedAt: f.synced_at ?? null, fare: f.economy_fare ?? null,
    });
  }
  rows.sort((x, y) => x.totalMin - y.totalMin);
  return { rows, noRoute, noFlightInTime };
}

/** 출처 우선순위: 날짜별 실제 운항(TAGO) > 정기 스케줄(한국공항공사) > 샘플 */
const RANK = (f: Flight) => (f.is_sample ? 0 : f.source === '국토교통부 TAGO' ? 2 : 1);

/** 출발 공항마다 가장 믿을 만한 출처 하나의 편만 남긴다 (같은 편이 출처별로 겹쳐 나오지 않게) */
export function pickBestSource(flights: Flight[]): Flight[] {
  const best = new Map<string, number>();
  for (const f of flights) best.set(f.origin, Math.max(best.get(f.origin) ?? 0, RANK(f)));
  return flights.filter(f => RANK(f) === best.get(f.origin));
}

/** 스케줄 확인 후 이 일수가 지나면 화면에 "항공사에서 다시 확인" 경고 */
export const STALE_DAYS = 7;

export { fmtDur };
