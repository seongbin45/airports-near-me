// 지도 API 예비 체계 — 한 제공자의 한도가 다 되면 다음 제공자로 자동으로 넘어간다.
//
// 오류를 네 가지로 나눠 다르게 다룬다.
//   exhaust   한도 초과(429)·키 거부(401/403)·응답 형식 변경 → 이 제공자는 이번 실행 동안 다시 부르지 않는다
//   transient 5xx·네트워크·타임아웃 → 같은 제공자로 몇 번 재시도, 그래도 안 되면 그 조합만 다음 제공자로
//   nodata    경로 없음·주소 못 찾음 → 제공자 문제가 아니다. 체인 설정(fallThroughOnNoData)에 따라 다음 제공자에게 묻거나 멈춘다
//   skip      이 조합만 이 제공자로 못 푼다(예: 좌표 주변 도로를 못 찾음 — 제공자마다 좌표를 도로에 붙이는 방식이 다르다)
//             → 재시도 없이 다음 제공자에게. 제공자는 계속 쓴다
//   (그 외 예외는 transient로 본다)
//
// 공용 서버(OSRM·Nominatim)는 minIntervalMs로 호출 간격을 지킨다 (둘 다 초당 1회 정책).

export type ErrorKind = 'exhaust' | 'transient' | 'nodata' | 'skip';

/** 지도 API 오류. kind가 체인의 동작을 정한다. */
export class MapApiError extends Error {
  constructor(message: string, readonly code: string, readonly kind: ErrorKind) {
    super(message);
  }
  /** 예전 코드 호환: 재시도할 만한 오류인가 */
  get retryable() { return this.kind === 'transient'; }
}

/** HTTP 상태 → 오류 분류 (제공자 공통) */
export function httpErrorKind(status: number): ErrorKind {
  if (status === 401 || status === 403 || status === 429) return 'exhaust';
  if (status >= 500 || status === 408) return 'transient';
  return 'nodata';
}

export function classify(e: unknown): ErrorKind {
  if (e instanceof MapApiError) return e.kind;
  return 'transient'; // fetch 네트워크 오류(TypeError)·AbortError 등
}

export interface ChainProvider<I, O> {
  name: string;
  /** 같은 제공자 호출 사이 최소 간격 (공용 서버 정책) */
  minIntervalMs?: number;
  call(input: I): Promise<O>;
}

export type ChainResult<O> =
  | { ok: true; value: O; provider: string }
  | { ok: false; reason: 'nodata' | 'failed' | 'exhausted'; provider?: string; error: string };

export interface ChainOptions {
  /** transient 오류에서 같은 제공자로 재시도할 횟수 */
  retries?: number;
  /** nodata면 다음 제공자에게도 물어볼지 (지오코딩: 새 행정구역 이름이 한 곳에만 있을 수 있어 true, 길찾기: false) */
  fallThroughOnNoData?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface MapChain<I, O> {
  run(input: I): Promise<ChainResult<O>>;
  /** 이번 실행에서 소진된 제공자와 이유 */
  exhausted(): Record<string, string>;
  /** 아직 쓸 수 있는 제공자 이름 */
  available(): string[];
  /** 제공자별 성공 수 */
  usage(): Record<string, number>;
}

export function createChain<I, O>(providers: ChainProvider<I, O>[], o: ChainOptions = {}): MapChain<I, O> {
  const retries = o.retries ?? 1;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const now = o.now ?? (() => Date.now());
  const exhausted = new Map<string, string>();
  // 다음 호출을 할 수 있는 시각. 병렬로 불려도 제공자별 간격이 지켜지도록 자리를 먼저 잡는다.
  const nextSlot = new Map<string, number>();
  const used: Record<string, number> = {};

  async function throttle(p: ChainProvider<I, O>) {
    if (!p.minIntervalMs) return;
    const t = now();
    const at = Math.max(t, nextSlot.get(p.name) ?? -Infinity);
    nextSlot.set(p.name, at + p.minIntervalMs);
    if (at > t) await sleep(at - t);
  }

  return {
    exhausted: () => Object.fromEntries(exhausted),
    available: () => providers.filter(p => !exhausted.has(p.name)).map(p => p.name),
    usage: () => ({ ...used }),

    async run(input) {
      let lastError = '';
      let lastProvider: string | undefined;
      let sawNoData = false, sawTransient = false;
      for (const p of providers) {
        if (exhausted.has(p.name)) continue;
        lastProvider = p.name;
        for (let attempt = 0; ; attempt++) {
          await throttle(p);
          try {
            const value = await p.call(input);
            used[p.name] = (used[p.name] ?? 0) + 1;
            return { ok: true, value, provider: p.name };
          } catch (e) {
            const kind = classify(e);
            lastError = `${p.name}: ${(e as Error).message}`;
            if (kind === 'exhaust') {
              exhausted.set(p.name, (e as Error).message);
              o.log?.(`${p.name} 사용 중지 → 다음 제공자로 (${(e as Error).message})`);
              break;
            }
            if (kind === 'skip') { sawNoData = true; break; }
            if (kind === 'nodata') {
              sawNoData = true;
              if (o.fallThroughOnNoData) break;
              return { ok: false, reason: 'nodata', provider: p.name, error: lastError };
            }
            if (attempt >= retries) { sawTransient = true; break; } // transient: 이 조합은 다음 제공자로
            await sleep(500 * 2 ** attempt);
          }
        }
      }
      if (providers.every(p => exhausted.has(p.name))) {
        return { ok: false, reason: 'exhausted', provider: lastProvider, error: lastError || '쓸 수 있는 제공자가 없어요' };
      }
      // 어느 제공자도 일시 오류 없이 "없음"만 답했으면 nodata, 일시 오류가 끼었으면 다음 실행에서 다시 시도할 failed
      return { ok: false, reason: sawNoData && !sawTransient ? 'nodata' : 'failed', provider: lastProvider, error: lastError };
    },
  };
}
