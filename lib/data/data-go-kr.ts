// 공공데이터포털(apis.data.go.kr) 공통 호출: 페이지 넘김, JSON/XML 응답 파싱, 오류 분류, 재시도.

import { XMLParser } from 'fast-xml-parser';

export class DataGoKrError extends Error {
  /** code: 게이트웨이 returnReasonCode, 제공기관 resultCode, 또는 'KEY' | 'FORMAT' | HTTP 상태 */
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
  }
}

/** 키 미등록·만료, 서비스 없음, 응답 형식 불일치 — 다른 노선을 불러도 똑같이 실패하므로 즉시 중단할 오류 */
export const FATAL_CODES = new Set(['FORMAT', 'KEY', '12', '20', '30', '31', '32']);

const xml = new XMLParser({ parseTagValue: false, trimValues: true });

export interface Page { items: Record<string, unknown>[]; total: number }

export function parseResponse(text: string): Page {
  const t = text.trim();
  let doc: Record<string, unknown>;
  try {
    doc = t.startsWith('<') ? xml.parse(t) : JSON.parse(t);
  } catch {
    throw new DataGoKrError(`응답을 해석할 수 없어요: ${t.slice(0, 80)}`, 'FORMAT', false);
  }

  // 게이트웨이 오류 (키 미등록, 트래픽 초과 등)
  const gw = (doc.OpenAPI_ServiceResponse as { cmmMsgHeader?: Record<string, unknown> } | undefined)?.cmmMsgHeader;
  if (gw) {
    const code = String(gw.returnReasonCode ?? '');
    throw new DataGoKrError(`${gw.returnAuthMsg ?? gw.errMsg} (${code})`, code, code === '22' || code === '01'); // 22 트래픽 초과, 01 내부 오류
  }

  const res = doc.response as { header?: Record<string, unknown>; body?: Record<string, unknown> } | undefined;
  const code = String(res?.header?.resultCode ?? '');
  if (code !== '00' && code !== '0') {
    const msg = String(res?.header?.resultMsg ?? '알 수 없는 응답');
    throw new DataGoKrError(`${msg} (${code || '형식 오류'})`, /SERVICE\s*KEY/i.test(msg) ? 'KEY' : code || 'FORMAT', false);
  }
  const body = res?.body ?? {};
  // 결과가 없으면 items가 빈 문자열로 오기도 하고, 1건이면 배열이 아닌 객체로 온다
  const raw = (body.items as { item?: unknown } | '' | undefined) || {};
  const item = (raw as { item?: unknown }).item ?? [];
  return { items: (Array.isArray(item) ? item : [item]) as Record<string, unknown>[], total: Number(body.totalCount ?? 0) };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 오류 메시지·로그에 인증키가 남지 않게 지운다 (원본·URL 인코딩 모두) */
export function redactKey(text: string, key: string): string {
  if (!key) return text;
  return [key, encodeURIComponent(key)].reduce((t, k) => t.split(k).join('<KEY>'), text);
}

export interface GetOpts {
  url: string;
  params: Record<string, string>;
  fetchImpl?: typeof fetch;
  retries?: number;
  /** 공공데이터포털 게이트웨이는 100을 넘기면 HTTP_ERROR(04)를 준다 (2026-09 확인) */
  numOfRows?: number;
}

/** 한 페이지. 네트워크 오류·5xx·트래픽 초과는 1·2·4초 간격으로 재시도하고, 실패하면 키를 지운 오류를 던진다. */
export async function fetchPage({ url, params, fetchImpl = fetch, retries = 3, numOfRows = 100 }: GetOpts, pageNo: number): Promise<Page> {
  // serviceKey는 "일반 인증키(Decoding)" 값을 넣는다. URLSearchParams가 인코딩한다.
  const qs = new URLSearchParams({ ...params, pageNo: String(pageNo), numOfRows: String(numOfRows) });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(`${url}?${qs}`, { signal: AbortSignal.timeout(20000) });
      if (res.status >= 500) throw new DataGoKrError(`HTTP ${res.status}`, String(res.status), true);
      return parseResponse(await res.text());
    } catch (e) {
      const retryable = !(e instanceof DataGoKrError) || e.retryable;
      if (!retryable || attempt >= retries) {
        const key = params.serviceKey ?? '';
        if (e instanceof DataGoKrError) throw new DataGoKrError(redactKey(e.message, key), e.code, e.retryable);
        throw new DataGoKrError(redactKey(`네트워크 오류: ${(e as Error).message}${(e as Error).cause ? ` (${String((e as Error).cause)})` : ''}`, key), 'NETWORK', false);
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** 모든 페이지를 차례로 받아 item 배열로 */
export async function getAllItems(opts: GetOpts) {
  const out: Record<string, unknown>[] = [];
  const size = opts.numOfRows ?? 100;
  for (let pageNo = 1; ; pageNo++) {
    const page = await fetchPage(opts, pageNo);
    out.push(...page.items);
    if (!page.items.length || pageNo * size >= page.total) break;
  }
  return out;
}

/** "0710" / "07:10" / "710" / 202610020630(→ 뒤 4자리) → "07:10" */
export function normTime(v: unknown): string | null {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 12) d = d.slice(8);
  if (d.length < 3 || d.length > 4) return null;
  const h = +d.slice(0, -2), m = +d.slice(-2);
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
}

/** "20260901" / "2026-09-01" / "2026-09-01T00:00:00" / 202609010630 → "2026-09-01" */
export function normDate(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 8);
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
}

export const ymd = (iso: string) => iso.replaceAll('-', '');
