// 주소 → 좌표 지오코딩.
//   카카오 로컬(KAKAO_REST_KEY) → 네이버 Geocoding(NAVER_MAP_CLIENT_ID/SECRET) → Nominatim(OpenStreetMap, 키 없음)
//   앞 제공자의 한도가 다 되거나 주소를 못 찾으면 다음으로 넘어간다 (lib/data/map-chain.ts).
//   (2026년 새 행정구역 이름은 한 곳에만 먼저 올라올 수 있어, 못 찾음도 다음 제공자에게 묻는다)
//
// regions의 시·도 / 시·군 / 구 이름을 그대로 질의해 대표 좌표를 채운다.
// 응답 파싱은 순수 함수(parseAddressSearch)로 떼어 테스트한다.
//
// 주의: 카카오는 x를 경도, y를 위도로 준다. 순서를 바꿔 쓰면 한국 밖 좌표가 나온다.
// (한국은 위도 33~38, 경도 124~132 범위라 서로 바꾸면 즉시 범위 밖이 된다 — 파서가 검사한다)

import { httpErrorKind, MapApiError, type ChainProvider } from './map-chain';

export class GeocodeError extends MapApiError {
  constructor(message: string, code: string, retryable: boolean) {
    super(message, code, code === 'KEY' || code === '429' ? 'exhaust' : retryable ? 'transient' : 'nodata');
  }
}

function httpError(api: string, status: number, keyHint: string): GeocodeError {
  if (status === 401 || status === 403) return new GeocodeError(`${api} 키가 거부됐어요. ${keyHint}를 확인하세요.`, 'KEY', false);
  if (status === 429) return new GeocodeError(`${api} 호출 한도를 넘었어요 (HTTP 429).`, '429', false);
  return new GeocodeError(`${api} 오류 (HTTP ${status})`, String(status), httpErrorKind(status) === 'transient');
}

export interface GeoPoint { lat: number; lng: number; matched: string }

/** 한국 영역 밖이면 좌표로 쓰지 않는다 (x·y를 바꿔 읽은 사고를 조기에 잡는다) */
export function inKorea(lat: number, lng: number): boolean {
  return lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132.5;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 카카오 로컬 주소 검색 응답 파싱.
 * 응답: { documents: [{ address_name, x, y, address?: {...}, road_address?: {...} }] }
 * 첫 후보가 시·군·구 단위가 아니면(예: "영통구" 질의가 다른 동으로 잡히면) 버린다.
 */
export function parseAddressSearch(body: unknown): GeoPoint | null {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs) || !docs.length) return null;
  for (const raw of docs) {
    const d = raw as Record<string, unknown>;
    const lng = num(d.x), lat = num(d.y);
    if (lat == null || lng == null) continue;
    if (!inKorea(lat, lng)) continue; // x·y를 뒤집었거나 해외 주소
    const matched = String(d.address_name ?? (d.road_address as { address_name?: string } | undefined)?.address_name ?? '');
    return { lat, lng, matched };
  }
  return null;
}

export interface GeocodeOpts {
  key: string;
  fetchImpl?: typeof fetch;
}

/** 주소 문자열 하나를 좌표로. 못 찾으면 null. */
export async function geocodeAddress(query: string, o: GeocodeOpts): Promise<GeoPoint | null> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
  url.searchParams.set('query', query);
  url.searchParams.set('size', '1');

  const res = await fetchImpl(url.toString(), {
    headers: { Authorization: `KakaoAK ${o.key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw httpError('카카오 로컬', res.status, 'KAKAO_REST_KEY');
  return parseAddressSearch(await res.json());
}

// ───────────── 네이버 클라우드 Geocoding ─────────────

/**
 * 응답: { status: 'OK', addresses: [{ roadAddress, jibunAddress, x(경도), y(위도) }] }
 * (문서 기준 — 키로 실측 전. docs/UNVERIFIED_VALUES.md)
 */
export function parseNaverGeocode(body: unknown): GeoPoint | null {
  const list = (body as { addresses?: unknown })?.addresses;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const d = raw as Record<string, unknown>;
    const lng = num(d.x), lat = num(d.y);
    if (lat == null || lng == null || !inKorea(lat, lng)) continue;
    return { lat, lng, matched: String(d.roadAddress || d.jibunAddress || '') };
  }
  return null;
}

// ───────────── Nominatim (OpenStreetMap, 키 없음) ─────────────

/** 응답(format=jsonv2): [{ lat, lon, display_name, addresstype, … }] — 위도·경도가 문자열 */
export function parseNominatim(body: unknown): GeoPoint | null {
  if (!Array.isArray(body)) return null;
  for (const raw of body) {
    const d = raw as Record<string, unknown>;
    const lat = num(d.lat), lng = num(d.lon);
    if (lat == null || lng == null || !inKorea(lat, lng)) continue;
    return { lat, lng, matched: String(d.display_name ?? '') };
  }
  return null;
}

// ───────────── 예비 체계용 제공자 ─────────────

export type Geocoder = ChainProvider<string, GeoPoint>;

const notFound = (api: string, q: string) => new GeocodeError(`${api}에서 "${q}"을(를) 못 찾았어요.`, 'NOT_FOUND', false);

export function kakaoGeocoder(key: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return {
    name: '카카오 로컬',
    async call(q) {
      const p = await geocodeAddress(q, { key, fetchImpl });
      if (!p) throw notFound('카카오 로컬', q);
      return p;
    },
  };
}

export function naverGeocoder(clientId: string, secret: string, fetchImpl: typeof fetch = fetch, base = 'https://maps.apigw.ntruss.com'): Geocoder {
  return {
    name: '네이버 Geocoding',
    async call(q) {
      const res = await fetchImpl(`${base}/map-geocode/v2/geocode?${new URLSearchParams({ query: q })}`, {
        headers: { 'x-ncp-apigw-api-key-id': clientId, 'x-ncp-apigw-api-key': secret, accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw httpError('네이버 Geocoding', res.status, 'NAVER_MAP_CLIENT_ID/SECRET');
      const p = parseNaverGeocode(await res.json());
      if (!p) throw notFound('네이버 Geocoding', q);
      return p;
    },
  };
}

export const NOMINATIM_PUBLIC = 'https://nominatim.openstreetmap.org';

/** 공용 서버 정책: 초당 1회 이하, 앱을 알아볼 수 있는 User-Agent, 가능하면 연락 이메일 */
export function nominatimGeocoder(opts: { baseUrl?: string; email?: string; fetchImpl?: typeof fetch } = {}): Geocoder {
  const base = (opts.baseUrl || NOMINATIM_PUBLIC).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: 'Nominatim(OpenStreetMap)',
    minIntervalMs: base === NOMINATIM_PUBLIC ? 1100 : 0,
    async call(q) {
      const qs = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'kr', limit: '1', 'accept-language': 'ko' });
      if (opts.email) qs.set('email', opts.email);
      const res = await fetchImpl(`${base}/search?${qs}`, {
        headers: { 'user-agent': 'airports-near-me/0.1 (+https://github.com/seongbin45/airports-near-me)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw httpError('Nominatim', res.status, 'NOMINATIM_URL');
      const p = parseNominatim(await res.json());
      if (!p) throw notFound('Nominatim', q);
      return p;
    },
  };
}

export interface GeocoderEnv {
  KAKAO_REST_KEY?: string;
  NAVER_MAP_CLIENT_ID?: string;
  NAVER_MAP_CLIENT_SECRET?: string;
  /** 'off'면 쓰지 않는다. 비우면 공용 서버 */
  NOMINATIM_URL?: string;
  NOMINATIM_EMAIL?: string;
}

/** 키가 있는 제공자를 우선순위대로. Nominatim(키 없음)이 마지막 예비. */
export function buildGeocoders(env: GeocoderEnv, fetchImpl: typeof fetch = fetch): Geocoder[] {
  const out: Geocoder[] = [];
  if (env.KAKAO_REST_KEY) out.push(kakaoGeocoder(env.KAKAO_REST_KEY, fetchImpl));
  if (env.NAVER_MAP_CLIENT_ID && env.NAVER_MAP_CLIENT_SECRET) out.push(naverGeocoder(env.NAVER_MAP_CLIENT_ID, env.NAVER_MAP_CLIENT_SECRET, fetchImpl));
  if (env.NOMINATIM_URL !== 'off') out.push(nominatimGeocoder({ baseUrl: env.NOMINATIM_URL, email: env.NOMINATIM_EMAIL, fetchImpl }));
  return out;
}

/** regions 행의 질의 문자열. 구가 있으면 구까지 붙인다 ("경기도 수원시 영통구"). */
export function regionQuery(r: { sido: string; sigungu: string | null; gu: string | null }): string {
  return [r.sido, r.sigungu, r.gu].filter(Boolean).join(' ');
}
