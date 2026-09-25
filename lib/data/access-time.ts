// 집 → 공항 이동 시간 어댑터.
//   차량: 카카오모빌리티(KAKAO_REST_KEY) → TMAP(TMAP_APP_KEY) → 네이버 Directions 5(NAVER_MAP_CLIENT_ID/SECRET) → OSRM(키 없음)
//         앞 제공자의 한도가 다 되면 다음으로 넘어간다 (lib/data/map-chain.ts). 키가 없는 제공자는 빠진다.
//   대중교통: ODsay 대중교통 길찾기 (ODSAY_KEY)
//
// 좌표는 regions 대표 좌표(또는 profiles.lat/lng) → airports 좌표.
//
// 두 API 모두 좌표를 "경도,위도" 순서로 받는다 (Kakao는 x=경도, y=위도).
// 응답 파싱은 순수 함수로 떼어 테스트한다. 파싱이 실패하면 **추정값을 만들지 않는다** —
// 직선거리로 환산한 값은 그럴듯해 보이지만 추천 결과를 조용히 바꾸고, 사람이 알아채지 못한다.
// 값을 못 구하면 그 조합은 그냥 비워 두고 `npm run doctor`의 접근시간 게이트가 덮인 비율을 보여준다.

import type { Mode } from '../recommend';
import { httpErrorKind, MapApiError, type ErrorKind } from './map-chain';

export interface LatLng { lat: number; lng: number }

export interface AccessTimeSource {
  mode: Mode;
  /** access_times.source에 그대로 저장되는 이름 */
  name: string;
  /** 같은 제공자 호출 사이 최소 간격 (공용 서버 정책) */
  minIntervalMs?: number;
  /** 실패는 던진다. 배치는 조합 단위로 기록하고 계속 진행한다. */
  minutes(from: LatLng, to: LatLng, departAt: Date): Promise<number>;
}

/**
 * 길찾기 오류. 예비 체계가 쓰는 분류(kind)를 코드에서 정한다:
 * KEY·429·FORMAT(응답 형식 변경) → 이 제공자 사용 중지 / 재시도할 만한 오류 → 일시 / 그 외(경로 없음 등) → 결과 없음
 */
export class AccessTimeError extends MapApiError {
  constructor(message: string, code: string, retryable: boolean, kindOverride?: ErrorKind) {
    const kind: ErrorKind = kindOverride ?? (code === 'KEY' || code === '429' || code === 'FORMAT' ? 'exhaust' : retryable ? 'transient' : 'nodata');
    super(message, code, kind);
  }
}

/**
 * 카카오모빌리티 result_code 중 "좌표 주변 도로를 못 찾음·유고"는 이 제공자의 좌표 보정 문제라 다른 제공자는 풀 수 있다.
 * 101 경유지·102 출발지·103 도착지 주변 도로 탐색 불가, 105·106 출발·도착 주변 도로 유고 (2026-09-25 실측: 103)
 */
const KAKAO_SKIP_CODES = new Set([101, 102, 103, 105, 106]);

/** HTTP 오류 응답을 AccessTimeError로 */
function httpError(api: string, status: number, keyHint: string): AccessTimeError {
  if (status === 401 || status === 403) return new AccessTimeError(`${api} 키가 거부됐어요. ${keyHint}를 확인하세요.`, 'KEY', false);
  if (status === 429) return new AccessTimeError(`${api} 호출 한도를 넘었어요 (HTTP 429).`, '429', false);
  return new AccessTimeError(`${api} 오류 (HTTP ${status})`, String(status), httpErrorKind(status) === 'transient');
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** 분 단위로. 1분 미만은 1분으로 둔다 (0분은 schema의 minutes > 0에 걸린다) */
const toMinutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

// ───────────── 카카오모빌리티 자동차 길찾기 ─────────────

export interface CarRoute { minutes: number; distanceMeters: number | null; taxiFare: number | null }

/**
 * 응답: { trans_id, routes: [{ result_code: 0, result_msg, summary: { distance(m), duration(초), fare:{taxi} } }] }
 * result_code가 0이 아니면 실패 응답이다 (예: 출발·도착이 너무 가까움).
 */
export function parseKakaoDirections(body: unknown): CarRoute {
  const routes = arr(obj(body)?.routes);
  if (!routes.length) throw new AccessTimeError('길찾기 응답에 routes가 없어요.', 'FORMAT', false);
  const route = obj(routes[0]);
  const code = numOrNull(route?.result_code);
  if (code != null && code !== 0) {
    throw new AccessTimeError(`길찾기 실패(${code}): ${String(route?.result_msg ?? '')}`.trim(), String(code), false,
      KAKAO_SKIP_CODES.has(code) ? 'skip' : undefined);
  }
  const summary = obj(route?.summary);
  const duration = numOrNull(summary?.duration);
  if (duration == null) throw new AccessTimeError('길찾기 응답에 summary.duration이 없어요.', 'FORMAT', false);
  return {
    minutes: toMinutes(duration),
    distanceMeters: numOrNull(summary?.distance),
    taxiFare: numOrNull(obj(summary?.fare)?.taxi),
  };
}

export function kakaoCarSource(key: string, fetchImpl: typeof fetch = fetch): AccessTimeSource {
  return {
    mode: 'car',
    name: '카카오모빌리티 길찾기',
    async minutes(from, to) {
      // origin/destination은 "경도,위도". priority=RECOMMEND(기본), summary=true로 요약만 받는다.
      const qs = new URLSearchParams({
        origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`,
        priority: 'RECOMMEND', summary: 'true', alternatives: 'false',
      });
      const res = await fetchImpl(`https://apis-navi.kakaomobility.com/v1/directions?${qs}`, {
        headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw httpError('카카오모빌리티', res.status, 'KAKAO_REST_KEY');
      return parseKakaoDirections(await res.json()).minutes;
    },
  };
}

// ───────────── TMAP 자동차 경로안내 (SK open API) ─────────────

/**
 * 응답(GeoJSON): { type: 'FeatureCollection', features: [{ properties: { totalTime(초), totalDistance(m), taxiFare, … } }, …] }
 * 첫 feature의 properties에 요약이 있다. 오류는 { error: { id, category, code, message } }.
 * (문서 기준 — 키로 실측 전. docs/UNVERIFIED_VALUES.md)
 */
export function parseTmapRoute(body: unknown): number {
  const err = obj(obj(body)?.error);
  if (err) {
    const code = String(err.code ?? err.id ?? 'ERROR');
    const quota = /QUOTA|LIMIT/i.test(code) || /한도|초과/.test(String(err.message ?? ''));
    throw new AccessTimeError(`TMAP 오류(${code}): ${String(err.message ?? '')}`.trim(), quota ? '429' : code, false);
  }
  const props = obj(obj(arr(obj(body)?.features)[0])?.properties);
  const total = numOrNull(props?.totalTime);
  if (total == null) throw new AccessTimeError('TMAP 응답에 features[0].properties.totalTime이 없어요.', 'FORMAT', false);
  return toMinutes(total);
}

export function tmapCarSource(appKey: string, fetchImpl: typeof fetch = fetch): AccessTimeSource {
  return {
    mode: 'car',
    name: 'TMAP 자동차 경로',
    async minutes(from, to) {
      const res = await fetchImpl('https://apis.openapi.sk.com/tmap/routes?version=1', {
        method: 'POST',
        headers: { appKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          startX: String(from.lng), startY: String(from.lat), endX: String(to.lng), endY: String(to.lat),
          reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw httpError('TMAP', res.status, 'TMAP_APP_KEY');
      return parseTmapRoute(await res.json());
    },
  };
}

// ───────────── 네이버 클라우드 Directions 5 ─────────────

/**
 * 응답: { code: 0, message, route: { traoptimal: [{ summary: { duration(밀리초), distance(m) } }] } }
 * code != 0 은 경로를 못 찾은 경우 (1 출발=도착, 2 도로 주변 아님, 3 자동차 길찾기 결과 없음 …).
 * (문서 기준 — 키로 실측 전)
 */
export function parseNaverDriving(body: unknown): number {
  const b = obj(body);
  const code = numOrNull(b?.code);
  if (code != null && code !== 0) {
    throw new AccessTimeError(`네이버 길찾기 결과 없음(${code}): ${String(b?.message ?? '')}`.trim(), String(code), false);
  }
  const route = obj(b?.route);
  const first = obj(arr(route?.traoptimal)[0]);
  const ms = numOrNull(obj(first?.summary)?.duration);
  if (ms == null) throw new AccessTimeError('네이버 응답에 route.traoptimal[0].summary.duration이 없어요.', 'FORMAT', false);
  return toMinutes(ms / 1000);
}

export const NAVER_MAP_BASE = 'https://maps.apigw.ntruss.com';

export function naverCarSource(clientId: string, secret: string, fetchImpl: typeof fetch = fetch, base = NAVER_MAP_BASE): AccessTimeSource {
  return {
    mode: 'car',
    name: '네이버 Directions 5',
    async minutes(from, to) {
      const qs = new URLSearchParams({ start: `${from.lng},${from.lat}`, goal: `${to.lng},${to.lat}`, option: 'traoptimal' });
      const res = await fetchImpl(`${base}/map-direction/v1/driving?${qs}`, {
        headers: { 'x-ncp-apigw-api-key-id': clientId, 'x-ncp-apigw-api-key': secret },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw httpError('네이버 Directions', res.status, 'NAVER_MAP_CLIENT_ID/SECRET');
      return parseNaverDriving(await res.json());
    },
  };
}

// ───────────── OSRM (OpenStreetMap, 키 없음) ─────────────

/**
 * 응답: { code: 'Ok', routes: [{ duration(초), distance(m) }] }. code가 'NoRoute' 등이면 경로 없음.
 * 실시간 교통을 반영하지 않는다(도로 속도 기준). 공용 서버는 초당 1회·대량 사용 금지 → 예비용.
 */
export function parseOsrmRoute(body: unknown): number {
  const b = obj(body);
  const code = String(b?.code ?? '');
  if (code && code !== 'Ok') throw new AccessTimeError(`OSRM 경로 없음(${code}): ${String(b?.message ?? '')}`.trim(), code, false);
  const duration = numOrNull(obj(arr(b?.routes)[0])?.duration);
  if (duration == null) throw new AccessTimeError('OSRM 응답에 routes[0].duration이 없어요.', 'FORMAT', false);
  return toMinutes(duration);
}

export const OSRM_PUBLIC = 'https://router.project-osrm.org';
const USER_AGENT = 'airports-near-me/0.1 (+https://github.com/seongbin45/airports-near-me)';

export function osrmCarSource(baseUrl: string = OSRM_PUBLIC, fetchImpl: typeof fetch = fetch): AccessTimeSource {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    mode: 'car',
    name: 'OSRM(OpenStreetMap)',
    minIntervalMs: base === OSRM_PUBLIC ? 1100 : 0,
    async minutes(from, to) {
      const url = `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      // OSRM은 경로 없음도 400 + { code: 'NoRoute' } 로 준다 — 본문을 먼저 본다
      if (res.status === 400) return parseOsrmRoute(await res.json());
      if (!res.ok) throw httpError('OSRM', res.status, 'OSRM_URL');
      return parseOsrmRoute(await res.json());
    },
  };
}

// ───────────── ODsay 대중교통 길찾기 ─────────────

export interface TransitRoute { minutes: number; payment: number | null; transfers: number | null }

/**
 * 응답: { result: { path: [ { info: { totalTime(분), payment, busTransitCount, subwayTransitCount, … } } ] } }
 * 오류는 { error: { code, message } } 로 온다 (예: -8 필수값 형식 오류, -9 필수값 누락, 500 서버 오류).
 * 응답 본문의 세부 필드는 실제 키를 받아 확인해야 하므로, 못 찾으면 받은 키를 오류 메시지에 넣는다.
 */
export function parseOdsayPath(body: unknown): TransitRoute {
  const err = obj(obj(body)?.error);
  if (err) {
    const code = String(err.code ?? 'ERROR');
    throw new AccessTimeError(`ODsay 오류(${code}): ${String(err.message ?? '')}`.trim(), code, code === '500');
  }
  const root = obj(obj(body)?.result);
  if (!root) throw new AccessTimeError('ODsay 응답에 result가 없어요.', 'FORMAT', false);
  const first = obj(arr(root.path)[0]);
  const info = obj(first?.info);
  const total = numOrNull(info?.totalTime);
  if (total == null || total <= 0) {
    const seen = info ? Object.keys(info).slice(0, 12).join(', ') : `${Object.keys(root).slice(0, 12).join(', ')} (path 없음)`;
    throw new AccessTimeError(`ODsay 응답에서 info.totalTime을 찾지 못했어요. 받은 키: ${seen}`, 'FORMAT', false);
  }
  const transfers = (numOrNull(info?.busTransitCount) ?? 0) + (numOrNull(info?.subwayTransitCount) ?? 0);
  return { minutes: Math.max(1, Math.round(total)), payment: numOrNull(info?.payment), transfers };
}

export function odsayTransitSource(key: string, fetchImpl: typeof fetch = fetch): AccessTimeSource {
  return {
    mode: 'transit',
    name: 'ODsay 대중교통',
    async minutes(from, to) {
      // SX·SY = 출발 경도·위도, EX·EY = 도착 경도·위도. OPT=0 추천순, SearchPathType=0 지하철+버스.
      const qs = new URLSearchParams({
        SX: String(from.lng), SY: String(from.lat), EX: String(to.lng), EY: String(to.lat),
        OPT: '0', SearchPathType: '0', apiKey: key,
      });
      const res = await fetchImpl(`https://api.odsay.com/v1/api/searchPubTransPathT?${qs}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw httpError('ODsay', res.status, 'ODSAY_KEY');
      return parseOdsayPath(await res.json()).minutes;
    },
  };
}

export interface SourceEnv {
  KAKAO_REST_KEY?: string;
  TMAP_APP_KEY?: string;
  NAVER_MAP_CLIENT_ID?: string;
  NAVER_MAP_CLIENT_SECRET?: string;
  /** OSRM 서버 주소. 'off'면 OSRM을 쓰지 않는다. 비우면 공용 데모 서버 */
  OSRM_URL?: string;
  ODSAY_KEY?: string;
}

/**
 * 쓸 수 있는 제공자를 우선순위대로. 키가 없는 제공자는 빠진다 (0분으로 채우면 추천이 조용히 틀어진다).
 * 차량은 키가 하나도 없어도 OSRM(키 없음)이 마지막 예비로 남는다 — OSRM_URL=off로 끌 수 있다.
 */
export function buildAccessTimeSources(env: SourceEnv, fetchImpl: typeof fetch = fetch): AccessTimeSource[] {
  const out: AccessTimeSource[] = [];
  if (env.KAKAO_REST_KEY) out.push(kakaoCarSource(env.KAKAO_REST_KEY, fetchImpl));
  if (env.TMAP_APP_KEY) out.push(tmapCarSource(env.TMAP_APP_KEY, fetchImpl));
  if (env.NAVER_MAP_CLIENT_ID && env.NAVER_MAP_CLIENT_SECRET) {
    out.push(naverCarSource(env.NAVER_MAP_CLIENT_ID, env.NAVER_MAP_CLIENT_SECRET, fetchImpl));
  }
  if (env.OSRM_URL !== 'off') out.push(osrmCarSource(env.OSRM_URL || OSRM_PUBLIC, fetchImpl));
  if (env.ODSAY_KEY) out.push(odsayTransitSource(env.ODSAY_KEY, fetchImpl));
  return out;
}

// ───────────── 도달 가능 여부 ─────────────

/** 육로로 이어진 권역. 다른 권역의 공항은 차량·대중교통으로 갈 수 없다. */
export type Zone = 'mainland' | 'jeju' | 'ulleung';

export function regionZone(r: { sido: string; sigungu: string | null }): Zone {
  if (r.sido === '제주특별자치도') return 'jeju';
  if (r.sigungu === '울릉군') return 'ulleung';
  return 'mainland';
}

export function airportZone(code: string): Zone {
  return code === 'CJU' ? 'jeju' : 'mainland';
}

// ───────────── 배치 대상 선정 (순수 함수) ─────────────

export interface PlanRow { region_id: number; airport: string; mode: Mode }
export interface ExistingRow { region_id: number; airport: string; mode: string; fetched_at: string; is_sample: boolean }

export interface PlanInput {
  /** zone이 있으면 같은 권역의 공항만 계산한다 (제주 ↔ 육지는 길이 없다) */
  regions: { id: number; lat: number | null; lng: number | null; zone?: Zone }[];
  airports: { code: string; lat: number | null; lng: number | null; zone?: Zone }[];
  modes: Mode[];
  existing: ExistingRow[];
  /** 실측 행을 이 일수 안에 받았으면 다시 묻지 않는다 */
  refreshDays: number;
  /** 이번 실행에서 호출할 최대 조합 수 (API 일일 한도 보호) */
  limit: number;
  now: Date;
}

export interface PlanOut {
  todo: PlanRow[];
  /** 좌표가 없어 계산할 수 없는 조합 수 */
  noCoords: number;
  /** 최근에 이미 받아 둔 실측 조합 수 */
  fresh: number;
  /** 대상 전체(좌표가 있고 도달 가능한 조합) */
  candidateTotal: number;
  /** 권역이 달라 길이 없는 조합 수 (예: 제주 구역 → 김포) */
  unreachable: number;
}

/**
 * 무엇을 지금 계산할지 정한다.
 *  - 좌표가 없는 지역·공항은 대상에서 뺀다 (사유를 세어 보고한다).
 *  - 실측이고 refreshDays 안에 받은 행은 건너뛴다.
 *  - 화면용 샘플(is_sample)과 아직 없는 조합을 먼저 채운다.
 *  - limit으로 자른다 (남은 수는 candidateTotal로 알 수 있다).
 */
export function planAccessTimes(i: PlanInput): PlanOut {
  const regions = i.regions.filter(r => r.lat != null && r.lng != null);
  const airports = i.airports.filter(a => a.lat != null && a.lng != null);
  const freshBefore = i.now.getTime() - i.refreshDays * 86400_000;

  const existing = new Map(i.existing.map(e => [`${e.region_id}|${e.airport}|${e.mode}`, e]));
  const todo: PlanRow[] = [];
  let fresh = 0, unreachable = 0;
  const withCoords = regions.length * airports.length * i.modes.length;
  const noCoords = i.regions.length * i.airports.length * i.modes.length - withCoords;

  for (const r of regions) {
    for (const a of airports) {
      if (r.zone && a.zone && r.zone !== a.zone) { unreachable += i.modes.length; continue; }
      for (const mode of i.modes) {
        const row = existing.get(`${r.id}|${a.code}|${mode}`);
        if (row && !row.is_sample && Date.parse(row.fetched_at) >= freshBefore) { fresh++; continue; }
        todo.push({ region_id: r.id, airport: a.code, mode });
      }
    }
  }
  todo.sort((x, y) => x.region_id - y.region_id || x.airport.localeCompare(y.airport) || x.mode.localeCompare(y.mode));
  return { todo: todo.slice(0, i.limit), noCoords, fresh, candidateTotal: withCoords - unreachable, unreachable };
}
