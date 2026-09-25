// 주소 → 좌표 지오코딩 (카카오 로컬 API).
//
// regions의 시·도 / 시·군 / 구 이름을 그대로 질의해 대표 좌표를 채운다.
// 응답 파싱은 순수 함수(parseAddressSearch)로 떼어 테스트한다.
//
// 주의: 카카오는 x를 경도, y를 위도로 준다. 순서를 바꿔 쓰면 한국 밖 좌표가 나온다.
// (한국은 위도 33~38, 경도 124~132 범위라 서로 바꾸면 즉시 범위 밖이 된다 — 파서가 검사한다)

export class GeocodeError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
  }
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
  if (res.status === 401 || res.status === 403) {
    throw new GeocodeError('카카오 REST 키가 거부됐어요. KAKAO_REST_KEY를 확인하세요.', 'KEY', false);
  }
  if (res.status >= 500 || res.status === 429) {
    throw new GeocodeError(`카카오 로컬 API 오류 (HTTP ${res.status})`, String(res.status), true);
  }
  if (!res.ok) throw new GeocodeError(`카카오 로컬 API 오류 (HTTP ${res.status})`, String(res.status), false);
  return parseAddressSearch(await res.json());
}

/** regions 행의 질의 문자열. 구가 있으면 구까지 붙인다 ("경기도 수원시 영통구"). */
export function regionQuery(r: { sido: string; sigungu: string | null; gu: string | null }): string {
  return [r.sido, r.sigungu, r.gu].filter(Boolean).join(' ');
}
