// 구글 지도 타임라인 내보내기 파일(Timeline.json, 2024년 이후 기기 저장 형식) 요약.
// 방문 이유는 파일에 없으므로 대화에서 묻는다. 방문 도시 판별(역지오코딩)은 다음 단계.

export interface AirportPoint { code: string; name_ko: string; lat: number | null; lng: number | null }

export interface TimelineSummary {
  places: number;
  airportVisits: number;
  byAirport: Record<string, number>;
  from: string | null;
  to: string | null;
}

interface Segment {
  startTime?: string;
  visit?: { topCandidate?: { placeLocation?: { latLng?: string } } };
}

const AIRPORT_RADIUS_KM = 2.5;

export function parseLatLng(s: string): [number, number] | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)°?,\s*(-?\d+(?:\.\d+)?)°?/);
  return m ? [+m[1], +m[2]] : null;
}

function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function summarizeTimeline(json: unknown, airports: AirportPoint[]): TimelineSummary {
  const segments: Segment[] = Array.isArray((json as { semanticSegments?: unknown })?.semanticSegments)
    ? (json as { semanticSegments: Segment[] }).semanticSegments : [];
  if (!segments.length) throw new Error('타임라인 형식이 아니에요. 휴대폰에서 내보낸 Timeline.json을 올려주세요.');

  const byAirport: Record<string, number> = {};
  let places = 0, from: string | null = null, to: string | null = null;
  for (const s of segments) {
    const ll = s.visit?.topCandidate?.placeLocation?.latLng;
    if (!ll) continue;
    const p = parseLatLng(ll);
    if (!p) continue;
    places++;
    const day = s.startTime?.slice(0, 10) ?? null;
    if (day && (!from || day < from)) from = day;
    if (day && (!to || day > to)) to = day;
    const hit = airports.find(a => a.lat != null && a.lng != null && km(p, [a.lat, a.lng]) <= AIRPORT_RADIUS_KM);
    if (hit) byAirport[hit.code] = (byAirport[hit.code] ?? 0) + 1;
  }
  return { places, airportVisits: Object.values(byAirport).reduce((a, b) => a + b, 0), byAirport, from, to };
}
