// 구글 지도 타임라인 내보내기 파일(Timeline.json / location-history.json) 파싱.
//
// 구글은 서로 다른 세 가지 형식을 내보낸다. 이 파일은 셋 다 받는다.
//   1) 휴대폰 내보내기   — { semanticSegments[], rawSignals[], userLocationProfile }
//      좌표는 "50.0506312, 14.3439906" 같은 문자열(때로 geo: 접두사나 ° 기호가 붙는다).
//      startTimeTimezoneUtcOffsetMinutes가 있어 현지 날짜를 정확히 알 수 있다.
//   2) Takeout 시맨틱     — { timelineObjects[] } 의 placeVisit/activitySegment.
//      좌표는 E7 정수(latitudeE7 = 도 × 10^7).
//   3) 위 둘이 섞인 배열 변형 — 항목이 visit.topCandidate 또는 activity.start를 가진 배열.
//
// 방문 이유는 파일에 없으므로, 찾아낸 여정을 확인 대기로 넘기고 사용자가 채운다.
// 이 파일은 브라우저에서만 쓴다 — 파일을 서버로 올리지 않는다. 순수 함수뿐이라 테스트한다.
//
// 한계 (추정이므로 확인 대기로만 넘긴다):
//  - 공항 반경 AIRPORT_RADIUS_KM 안에 든 지점을 "공항에 있었다"로 본다. 정확도가 나쁜 지점은 버린다.
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
/** 정확도가 이보다 나쁜 지점은 공항 판정에 쓰지 않는다 (기지국 측위는 km 단위로 틀린다) */
export const MAX_ACCURACY_M = 500;
/** 시각에 시간대가 없을 때 현지 날짜 계산에 쓰는 기준 (국내선 대상 서비스) */
export const FALLBACK_UTC_OFFSET_MIN = 9 * 60;

/** "geo:37.558,126.790" / "37.558°, 126.790°" / "50.0506312, 14.3439906" → [37.558, 126.79] */
export function parseLatLng(s: string): [number, number] | null {
  const t = s.replace(/^geo:/i, '').replace(/[°]/g, '');
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/** E7 정수 좌표(도 × 10^7) → 도 */
export function fromE7(latE7: unknown, lngE7: unknown): [number, number] | null {
  if (typeof latE7 !== 'number' || typeof lngE7 !== 'number') return null;
  const lat = latE7 / 1e7, lng = lngE7 / 1e7;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
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

/**
 * ISO 시각을 현지 날짜("YYYY-MM-DD")로.
 *  - 오프셋이 주어지면(휴대폰 내보내기의 startTimeTimezoneUtcOffsetMinutes) 그것으로,
 *  - 시각 문자열 자체에 +09:00 같은 오프셋이 있으면 그대로,
 *  - UTC(Z)거나 오프셋이 없으면 한국 시간으로 본다.
 * 문자열을 그냥 잘라 쓰면 UTC로 내보낸 파일에서 하루가 어긋난다.
 */
export function localDate(iso: string, offsetMinutes?: number | null): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  const explicit = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  const off = typeof offsetMinutes === 'number' ? offsetMinutes
    : explicit ? (explicit[1] === '-' ? -1 : 1) * (Number(explicit[2]) * 60 + Number(explicit[3]))
    : FALLBACK_UTC_OFFSET_MIN;
  return new Date(t + off * 60_000).toISOString().slice(0, 10);
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

interface RawPoint { at: string | null; lat: number; lng: number }

/** 한 형식의 항목에서 (시각, 좌표)를 뽑아낸다. 못 뽑으면 null. */
function pointFromLatLng(latLng: unknown, at: string | null): RawPoint | null {
  const s = str(latLng);
  if (!s) return null;
  const p = parseLatLng(s);
  return p ? { at, lat: p[0], lng: p[1] } : null;
}

function pointsFromSemanticSegments(segments: unknown[]): RawPoint[] {
  const out: RawPoint[] = [];
  for (const raw of segments) {
    const s = obj(raw);
    if (!s) continue;
    const start = str(s.startTime), end = str(s.endTime);

    // 1) 방문 (휴대폰 내보내기)
    const visit = obj(s.visit);
    const top = obj(visit?.topCandidate);
    const place = obj(top?.placeLocation);
    const visitPoint = pointFromLatLng(place?.latLng, start);
    if (visitPoint) out.push(visitPoint);
    // 주 후보에 좌표가 없으면 다른 후보를 쓴다 (구글도 이렇게 한다)
    if (!visitPoint) {
      for (const alt of arr(visit?.otherCandidateLocations)) {
        const altPoint = pointFromLatLng(obj(alt)?.placeLocation && obj(obj(alt)?.placeLocation)?.latLng, start);
        if (altPoint) { out.push(altPoint); break; }
      }
    }

    // 2) 이동 경로의 지점들
    for (const p of arr(s.timelinePath)) {
      const o = obj(p);
      const q = pointFromLatLng(o?.point, str(o?.time) ?? start);
      if (q) out.push(q);
    }

    // 3) 이동 구간의 시작·끝 (방문 기록이 없는 이동만 있는 파일도 있다)
    const activity = obj(s.activity);
    for (const [key, at] of [['start', start], ['end', end]] as const) {
      const leg = obj(activity?.[key]);
      const q = pointFromLatLng(leg?.latLng, at);
      if (q) out.push(q);
    }
  }
  return out;
}

function pointsFromTimelineObjects(objects: unknown[]): RawPoint[] {
  const out: RawPoint[] = [];
  for (const raw of objects) {
    const o = obj(raw);
    if (!o) continue;
    // Takeout 시맨틱: E7 정수 좌표
    const visit = obj(o.placeVisit);
    if (visit) {
      const loc = obj(visit.location);
      const p = fromE7(loc?.latitudeE7, loc?.longitudeE7) ?? fromE7(loc?.centerLatE7, loc?.centerLngE7);
      const at = str(obj(visit.duration)?.startTimestamp);
      if (p) out.push({ at, lat: p[0], lng: p[1] });
      continue;
    }
    const seg = obj(o.activitySegment);
    if (seg) {
      for (const [key, atKey] of [['startLocation', 'startTimestamp'], ['endLocation', 'endTimestamp']] as const) {
        const loc = obj(seg[key]);
        const p = fromE7(loc?.latitudeE7, loc?.longitudeE7);
        const at = str(obj(seg.duration)?.[atKey]);
        if (p) out.push({ at, lat: p[0], lng: p[1] });
      }
    }
  }
  return out;
}

function pointsFromRawSignals(signals: unknown[]): RawPoint[] {
  const out: RawPoint[] = [];
  for (const raw of signals) {
    const o = obj(raw);
    const pos = obj(o?.position);
    if (!pos) continue;
    const accuracy = num(pos.accuracyMeters);
    if (accuracy != null && accuracy > MAX_ACCURACY_M) continue; // 기지국 측위는 공항 판정에 쓸 수 없다
    const q = pointFromLatLng(pos.LatLng ?? pos.latLng, str(pos.timestamp));
    if (q) out.push(q);
  }
  return out;
}

/** 어떤 형식의 파일인지 알아내 방문 지점을 뽑는다. 시각이 있는 지점만, 시간순. */
export function parseTimelinePoints(json: unknown): TimelinePoint[] {
  const root = obj(json);
  const segments = arr(root?.semanticSegments);
  const signals = arr(root?.rawSignals);
  const objects = arr(root?.timelineObjects);
  const legacyArray = arr(json);

  let raws: RawPoint[];
  if (segments.length) raws = pointsFromSemanticSegments(segments);
  else if (signals.length) raws = pointsFromRawSignals(signals);
  else if (objects.length) raws = pointsFromTimelineObjects(objects);
  else if (legacyArray.length) raws = pointsFromSemanticSegments(legacyArray);
  else throw new Error('타임라인 형식이 아니에요. 휴대폰에서 내보낸 Timeline.json이나 구글 Takeout의 위치 기록 파일을 올려주세요.');

  const offsets = new Map<string, number | null>();
  for (const raw of segments) {
    const s = obj(raw);
    const t = str(s?.startTime);
    if (t) offsets.set(t, num(s?.startTimeTimezoneUtcOffsetMinutes));
  }

  const seen = new Set<string>();
  const out: TimelinePoint[] = [];
  for (const r of raws) {
    if (!r.at) continue;
    const date = localDate(r.at, offsets.get(r.at) ?? null);
    if (!date) continue;
    const key = `${r.at}|${r.lat.toFixed(5)}|${r.lng.toFixed(5)}`;
    if (seen.has(key)) continue; // timelinePath와 activity가 같은 지점을 두 번 준다
    seen.add(key);
    out.push({ at: r.at, date, lat: r.lat, lng: r.lng });
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
