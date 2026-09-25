// 국토교통부_(TAGO)_국내항공운항정보 (공공데이터포털 15098526)
// GET https://apis.data.go.kr/1613000/DmstcFlightNvgInfo/GetFlightOpratInfoList
//   serviceKey, depAirportId, arrAirportId(NAARK…), depPlandTime(YYYYMMDD), pageNo, numOfRows, _type=json
// 특정 날짜에 실제로 뜨는 편과 일반석 요금. 정기 스케줄(한국공항공사)보다 그날 기준으로 정확하다.
// 실제 응답(2026-09 확인):
//   { airlineNm:"아시아나 항공", vihicleId:"OZ8901", depPlandTime:202610020630, arrPlandTime:202610020745, economyCharge:61900, prestigeCharge:0 }

import { DataGoKrError, getAllItems, normDate, normTime, ymd } from './data-go-kr';
import type { FlightScheduleRecord } from './flight-schedule';
import type { RouteQuery } from './kac-schedule';

export const TAGO_URL = 'https://apis.data.go.kr/1613000/DmstcFlightNvgInfo/GetFlightOpratInfoList';
export const TAGO_SOURCE = '국토교통부 TAGO';

/** IATA → TAGO 공항 ID (GetArprtList 응답, 2026-09 확인) */
export const TAGO_AIRPORT_ID: Record<string, string> = {
  GMP: 'NAARKSS', CJU: 'NAARKPC', PUS: 'NAARKPK', CJJ: 'NAARKTU', TAE: 'NAARKTN', KWJ: 'NAARKJJ', RSU: 'NAARKJY', USN: 'NAARKPU',
  KPO: 'NAARKTH', MWX: 'NAARKJB', YNY: 'NAARKNY', HIN: 'NAARKPS', KUV: 'NAARKJK', WJU: 'NAARKNW', ICN: 'NAARKSI',
};

const isoWeekday = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay() || 7; };

export function parseTagoItem(it: Record<string, unknown>, origin: string, dest: string, date: string): FlightScheduleRecord {
  const dep = normTime(it.depPlandTime), arr = normTime(it.arrPlandTime);
  const flightNo = String(it.vihicleId ?? '').replace(/\s+/g, '').toUpperCase();
  if (!flightNo || !dep || !arr) {
    throw new DataGoKrError(`TAGO 응답 형식이 예상과 달라요. 받은 필드: ${Object.keys(it).join(', ')}`, 'FORMAT', false);
  }
  const day = normDate(it.depPlandTime) ?? date;
  const fare = Number(it.economyCharge);
  return {
    flight_no: flightNo, airline: String(it.airlineNm ?? '').trim(), origin, dest, dep_time: dep, arr_time: arr,
    days_of_week: [isoWeekday(day)], valid_from: day, valid_to: day, source: TAGO_SOURCE,
    economy_fare: Number.isFinite(fare) && fare > 0 ? fare : null,
  };
}

export async function fetchTagoDay({ serviceKey, date, origin, dest, fetchImpl }: RouteQuery): Promise<FlightScheduleRecord[]> {
  const dep = TAGO_AIRPORT_ID[origin], arr = TAGO_AIRPORT_ID[dest];
  if (!dep || !arr) return [];
  const items = await getAllItems({
    url: TAGO_URL, fetchImpl,
    params: { serviceKey, depAirportId: dep, arrAirportId: arr, depPlandTime: ymd(date), _type: 'json' },
  });
  return items.map(it => parseTagoItem(it, origin, dest, date));
}
