// 집 → 공항 이동 시간 어댑터.
//   차량: 카카오모빌리티 자동차 길찾기 (KAKAO_REST_KEY)
//   대중교통: ODsay 대중교통 길찾기 (ODSAY_KEY)
//
// 좌표는 regions 대표 좌표(또는 profiles.lat/lng) → airports 좌표.
//
// 두 API 모두 좌표를 "경도,위도" 순서로 받는다 (Kakao는 x=경도, y=위도).
// 응답 파싱은 순수 함수로 떼어 테스트한다. 파싱이 실패하면 **추정값을 만들지 않는다** —
// 직선거리로 환산한 값은 그럴듯해 보이지만 추천 결과를 조용히 바꾸고, 사람이 알아채지 못한다.
// 값을 못 구하면 그 조합은 그냥 비워 두고 `npm run doctor`의 접근시간 게이트가 덮인 비율을 보여준다.

import type { Mode } from '../recommend';

export interface LatLng { lat: number; lng: number }

export interface AccessTimeSource {
  mode: Mode;
  /** access_times.source에 그대로 저장되는 이름 */
  name: string;
  /** 실패는 던진다. 배치는 조합 단위로 기록하고 계속 진행한다. */
  minutes(from: LatLng, to: LatLng, departAt: Date): Promise<number>;
}

export class AccessTimeError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
  }
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
    throw new AccessTimeError(`길찾기 실패(${code}): ${String(route?.result_msg ?? '')}`.trim(), String(code), false);
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
      if (res.status === 401 || res.status === 403) {
        throw new AccessTimeError('카카오모빌리티 키가 거부됐어요. KAKAO_REST_KEY를 확인하세요.', 'KEY', false);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new AccessTimeError(`길찾기 API 오류 (HTTP ${res.status})`, String(res.status), true);
      }
      if (!res.ok) throw new AccessTimeError(`길찾기 API 오류 (HTTP ${res.status})`, String(res.status), false);
      return parseKakaoDirections(await res.json()).minutes;
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
      if (res.status === 429 || res.status >= 500) {
        throw new AccessTimeError(`ODsay API 오류 (HTTP ${res.status})`, String(res.status), true);
      }
      if (!res.ok) throw new AccessTimeError(`ODsay API 오류 (HTTP ${res.status})`, String(res.status), false);
      return parseOdsayPath(await res.json()).minutes;
    },
  };
}

/** 키가 있는 수단만. 키가 없으면 그 수단은 채우지 않는다 (0으로 채우면 추천이 조용히 틀어진다). */
export function buildAccessTimeSources(env: { KAKAO_REST_KEY?: string; ODSAY_KEY?: string }): AccessTimeSource[] {
  const out: AccessTimeSource[] = [];
  if (env.KAKAO_REST_KEY) out.push(kakaoCarSource(env.KAKAO_REST_KEY));
  if (env.ODSAY_KEY) out.push(odsayTransitSource(env.ODSAY_KEY));
  return out;
}

// ───────────── 배치 대상 선정 (순수 함수) ─────────────

export interface PlanRow { region_id: number; airport: string; mode: Mode }
export interface ExistingRow { region_id: number; airport: string; mode: string; fetched_at: string; is_sample: boolean }

export interface PlanInput {
  regions: { id: number; lat: number | null; lng: number | null }[];
  airports: { code: string; lat: number | null; lng: number | null }[];
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
  /** 대상 전체(좌표가 있는 조합) */
  candidateTotal: number;
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
  let fresh = 0;
  const candidateTotal = regions.length * airports.length * i.modes.length;
  const noCoords = i.regions.length * i.airports.length * i.modes.length - candidateTotal;

  for (const r of regions) {
    for (const a of airports) {
      for (const mode of i.modes) {
        const row = existing.get(`${r.id}|${a.code}|${mode}`);
        if (row && !row.is_sample && Date.parse(row.fetched_at) >= freshBefore) { fresh++; continue; }
        todo.push({ region_id: r.id, airport: a.code, mode });
      }
    }
  }
  todo.sort((x, y) => x.region_id - y.region_id || x.airport.localeCompare(y.airport) || x.mode.localeCompare(y.mode));
  return { todo: todo.slice(0, i.limit), noCoords, fresh, candidateTotal };
}
