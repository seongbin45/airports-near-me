// 한국공항공사_항공기 운항 스케줄 정보_GW (공공데이터포털 15158949)
// GET https://apis.data.go.kr/B551178/flight-schedule/dom
//   serviceKey, schDate(YYYYMMDD), schDeptCityCode, schArrvCityCode(IATA), pageNo, numOfRows, type=json
// 편마다 운항 요일과 유효 기간이 있어, 한 날짜로 조회하면 그 시즌의 정기 스케줄이 나온다. 인천 국내선도 포함.
// 실제 응답(2026-09 확인):
//   { airlineKorean, domesticNum:"RS901", startcityCode:"GMP", arrivalcityCode:"CJU", domesticStartTime:"0600",
//     domesticArrivalTime:"0715", domesticStdate:"2026-09-14T00:00:00", domesticEddate:"2026-10-24T00:00:00",
//     domesticMon…domesticSun:"Y"|"N", flightPurpose:"여객기" }

import { DataGoKrError, getAllItems, normDate, normTime, ymd } from './data-go-kr';
import type { FlightScheduleRecord } from './flight-schedule';

export const KAC_URL = 'https://apis.data.go.kr/B551178/flight-schedule/dom';
export const KAC_SOURCE = '한국공항공사';

/** 한국공항공사 국내선 운항 공항 14곳 + 인천 */
export const DOMESTIC_AIRPORTS = ['GMP', 'CJU', 'PUS', 'CJJ', 'TAE', 'KWJ', 'RSU', 'USN', 'KPO', 'MWX', 'YNY', 'HIN', 'KUV', 'WJU', 'ICN'];

const DAYS = ['domesticMon', 'domesticTue', 'domesticWed', 'domesticThu', 'domesticFri', 'domesticSat', 'domesticSun'];

/** 여객기가 아니면(화물 등) null */
export function parseKacItem(it: Record<string, unknown>, origin: string, dest: string): FlightScheduleRecord | null {
  if (it.flightPurpose != null && it.flightPurpose !== '여객기') return null;
  const dep = normTime(it.domesticStartTime), arr = normTime(it.domesticArrivalTime);
  const flightNo = String(it.domesticNum ?? '').replace(/\s+/g, '').toUpperCase();
  if (!flightNo || !dep || !arr) {
    throw new DataGoKrError(`한국공항공사 응답 형식이 예상과 달라요. 받은 필드: ${Object.keys(it).join(', ')}`, 'FORMAT', false);
  }
  return {
    flight_no: flightNo, airline: String(it.airlineKorean ?? '').trim(),
    origin: String(it.startcityCode || origin), dest: String(it.arrivalcityCode || dest),
    dep_time: dep, arr_time: arr,
    days_of_week: DAYS.flatMap((k, i) => (String(it[k] ?? '').trim().toUpperCase() === 'Y' ? [i + 1] : [])),
    valid_from: normDate(it.domesticStdate), valid_to: normDate(it.domesticEddate),
    source: KAC_SOURCE, economy_fare: null,
  };
}

export interface RouteQuery {
  serviceKey: string;
  date: string;
  origin: string;
  dest: string;
  fetchImpl?: typeof fetch;
}

export async function fetchKacDomestic({ serviceKey, date, origin, dest, fetchImpl }: RouteQuery): Promise<FlightScheduleRecord[]> {
  const items = await getAllItems({
    url: KAC_URL, fetchImpl,
    params: { serviceKey, schDate: ymd(date), schDeptCityCode: origin, schArrvCityCode: dest, type: 'json' },
  });
  return items.map(it => parseKacItem(it, origin, dest)).filter((r): r is FlightScheduleRecord => !!r);
}

/**
 * 한 날짜의 전 노선 스케줄 (노선 필터 없이 schDate만). 2026-09-25 기준 599건, 100건씩 6쪽.
 * 주의: 날짜 없이 조회하면 이력 일부만 섞여 나온다(김포→제주 현재 편 128건 중 42건만) — 전체 덤프로 쓰면 안 된다.
 */
export async function fetchKacByDate({ serviceKey, date, fetchImpl }: { serviceKey: string; date: string; fetchImpl?: typeof fetch }) {
  const items = await getAllItems({ url: KAC_URL, fetchImpl, params: { serviceKey, schDate: ymd(date), type: 'json' } });
  const known = new Set(DOMESTIC_AIRPORTS);
  const records: FlightScheduleRecord[] = [];
  for (const it of items) {
    const origin = String(it.startcityCode ?? ''), dest = String(it.arrivalcityCode ?? '');
    if (!known.has(origin) || !known.has(dest)) continue;
    const r = parseKacItem(it, origin, dest);
    if (r) records.push(r);
  }
  return records;
}
