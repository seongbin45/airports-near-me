// 구글 지도 타임라인 내보내기 파일(Timeline.json, 2024년 이후 기기 저장 형식) 파싱.
// 방문 이유는 파일에 없으므로, 찾아낸 여정을 확인 대기로 넘기고 사용자가 이유를 채운다.
//
// 이 파일은 브라우저에서만 쓴다 — 파일을 서버로 올리지 않는다. 여기 있는 건 순수 함수뿐이라 테스트한다.
//
// 한계 (추정이므로 확인 대기로만 넘긴다):
//  - 공항 반경 2.5km 안에 든 지점을 "공항에 있었다"로 본다. 경유지·주차장도 걸릴 수 있다.
//  - 여정은 연속한 공항 방문에서 추정한다: 다른 공항으로 옮긴 구간이 여정, 그 뒤 원래 공항으로
//    돌아온 구간이 귀국. 국내선 기준으로 같은 여정의 출발·도착은 MAX_HOP_DAYS 안에 있다고 본다.
//  - 도착 공항의 도시를 방문 도시로 본다. 환승(예: 김포→제주)은 구분하지 못한다.

export interface AirportPoint { code: string; name_ko: string; /** 없으면 타임라인 추정에서 도시를 못 찾아 그 구간을 후보에서 뺀다 */ city?: string; lat: number | null; lng: number | null }

/** 타임라인에서 찾은 방문 지점 */
export interface TimelinePoint { at: string; date: string; lat: number; lng: number }

/** 그중 공항 반경 안에 든 것 */
export interface AirportVisit { at: string; date: string; code: string; name_ko: string }

/** 파일에서 추정한 여정 한 건. 확인 대기로 넘어간다 */
export interface TimelineTrip {
  from_airport: string;
  dest_airport: string;
  dest_city: string;
  depart_on: string;
  return_on: string | null;
}

export interface TimelineSummary {
  places: number;
  airportVisits: number;
  byAirport: Record<string, number>;
  from: string | null;
  to: string | null;
}

export const AIRPORT_RADIUS_KM = 2.5;
/** 출발 공항과 도착 공항을 같은 여정으로 보는 최대 날짜 차이. 국내선은 당일~다음 날이다 */
export const MAX_HOP_DAYS = 2;
/** 도착지에서 출발 공항으로 돌아온 것을 같은 여정의 귀국으로 보는 최대 날짜 차이 */
export const MAX_STAY_DAYS = 30;

interface Segment {
  startTime?: string;
  visit?: { topCandidate?: { placeLocation?: { latLng?: string } } };
}

/** "35.1795°, 128.9382°" → [35.1795, 128.9382] */
export function parseLatLng(s: string): [number, number] | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)°?,\s*(-?\d+(?:\.\d+)?)°?/);
  return m ? [+m[1], +m[2]] : null;
}

function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** "2026-09-20" 사이의 날짜 차이 (b - a) */
export function daysBetween(a: string, b: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(b) - d(a)) / 86400_000);
}

function segmentsOf(json: unknown): Segment[] {
  const raw = (json as { semanticSegments?: unknown })?.semanticSegments;
  return Array.isArray(raw) ? (raw as Segment[]) : [];
}

/** semanticSegments의 방문 지점을 시간순으로. */
export function parseTimelinePoints(json: unknown): TimelinePoint[] {
  const segments = segmentsOf(json);
  if (!segments.length) throw new Error('타임라인 형식이 아니에요. 휴대폰에서 내보낸 Timeline.json을 올려주세요.');
  const out: TimelinePoint[] = [];
  for (const s of segments) {
    const ll = s.visit?.topCandidate?.placeLocation?.latLng;
    if (!ll || !s.startTime) continue;
    const p = parseLatLng(ll);
    if (!p) continue;
    out.push({ at: s.startTime, date: s.startTime.slice(0, 10), lat: p[0], lng: p[1] });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 방문 지점 중 공항 반경 안에 든 것만, 시간순. */
export function parseAirportVisits(json: unknown, airports: AirportPoint[]): AirportVisit[] {
  const usable = airports.filter(a => a.lat != null && a.lng != null);
  const out: AirportVisit[] = [];
  for (const p of parseTimelinePoints(json)) {
    const hit = usable.find(a => km([p.lat, p.lng], [a.lat!, a.lng!]) <= AIRPORT_RADIUS_KM);
    if (hit) out.push({ at: p.at, date: p.date, code: hit.code, name_ko: hit.name_ko });
  }
  return out;
}

export interface InferOpts { maxHopDays?: number; maxStayDays?: number }

/**
 * 연속한 공항 방문에서 여정을 추정한다.
 * 다른 공항으로 옮긴 구간이 여정, 그 뒤 처음 공항으로 돌아온 구간이 귀국이다(그 3개는 한 건으로 묶는다).
 * 도착 공항의 도시를 모르면(공항 목록에 없으면) 도시를 말할 수 없으므로 후보에서 뺀다.
 */
export function inferTimelineTrips(visits: AirportVisit[], airports: AirportPoint[], opts: InferOpts = {}): TimelineTrip[] {
  const maxHop = opts.maxHopDays ?? MAX_HOP_DAYS;
  const maxStay = opts.maxStayDays ?? MAX_STAY_DAYS;
  const byCode = new Map(airports.map(a => [a.code, a]));
  const sorted = [...visits].sort((a, b) => a.at.localeCompare(b.at));
  const out: TimelineTrip[] = [];
  const seen = new Set<string>();

  for (let i = 0; i + 1 < sorted.length;) {
    const a = sorted[i], b = sorted[i + 1];
    const hop = daysBetween(a.date, b.date);
    if (a.code === b.code || hop < 0 || hop > maxHop) { i++; continue; } // 국내선은 당일 출발·도착(hop 0)이 정상이다

    const city = byCode.get(b.code)?.city;
    const back = sorted[i + 2];
    const isReturn = !!back && back.code === a.code && daysBetween(b.date, back.date) <= maxStay;

    if (city) {
      const key = `${a.code}|${b.code}|${a.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          from_airport: a.code, dest_airport: b.code, dest_city: city,
          depart_on: a.date, return_on: isReturn ? back!.date : null,
        });
      }
    }
    i += isReturn ? 3 : 2;
  }
  return out.sort((x, y) => y.depart_on.localeCompare(x.depart_on));
}

/** 화면에 보여줄 요약 (파일 전체 기준) */
export function summarizeTimeline(json: unknown, airports: AirportPoint[]): TimelineSummary {
  const points = parseTimelinePoints(json);
  const airportVisits = parseAirportVisits(json, airports);
  const byAirport: Record<string, number> = {};
  for (const v of airportVisits) byAirport[v.code] = (byAirport[v.code] ?? 0) + 1;
  return {
    places: points.length,
    airportVisits: airportVisits.length,
    byAirport,
    from: points[0]?.date ?? null,
    to: points.at(-1)?.date ?? null,
  };
}
