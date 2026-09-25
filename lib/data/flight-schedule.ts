// 운항 스케줄 수집 공통 타입.
// 출처는 공식 오픈API만 쓴다. 항공사·예약 사이트를 브라우저로 긁어오지 않는다.
//   - 한국공항공사 정기 스케줄 (lib/data/kac-schedule.ts): 시즌 단위, 요일별
//   - 국토교통부 TAGO (lib/data/tago-flights.ts): 날짜별 실제 운항편 + 일반석 요금

export interface FlightScheduleRecord {
  flight_no: string;
  airline: string;
  origin: string;
  dest: string;
  dep_time: string;
  arr_time: string;
  /** ISO 요일 1=월 … 7=일 */
  days_of_week: number[];
  valid_from: string | null;
  valid_to: string | null;
  source: string;
  economy_fare: number | null;
}
