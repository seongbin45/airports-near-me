import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// AI 제공자 예비 체계 (reference/…/generate/client.py·draft.py의 폴백 체인을 이 서비스에 맞춘 것)
// - 순서: AI_PROVIDERS (기본 claude,openai,gemini,xai). 키와 모델 id가 모두 있는 제공자만 쓴다.
// - 모델 id는 env로 받는다(Claude만 기본값 claude-opus-5). 모델 이름을 코드에 박지 않는다.
// - 일시 오류(408/409/425/429/5xx/네트워크)는 AI_HTTP_RETRIES회 재시도 후 다음 제공자로.
// - 형식이 틀린 답(JSON 아님)도 다음 제공자로. 거절(refusal)은 다른 회사로 넘기지 않고 멈춘다.
// - 어느 제공자든 답은 같은 JSON 형식이고, 같은 DB 대조(verifyAgainstDb)를 통과해야만 보인다.

import type { ProviderId } from './providers-meta';
export { PROVIDER_LABEL, type ProviderId } from './providers-meta';

export interface Provider { id: ProviderId; apiKey: string; model: string }

export interface AiJson { text: string; used_flight_nos: string[] }

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    used_flight_nos: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'used_flight_nos'],
  additionalProperties: false,
};

// Gemini responseSchema는 OpenAPI 부분집합 (additionalProperties 없음, 대문자 타입)
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: { text: { type: 'STRING' }, used_flight_nos: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['text', 'used_flight_nos'],
};

const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export class ProviderError extends Error {
  constructor(message: string, readonly transient: boolean, readonly status?: number) { super(message); }
}
class RefusedError extends Error {}
class ParseError extends Error {}

type Env = Record<string, string | undefined>;

/** env에서 쓸 수 있는 제공자 목록(순서대로) */
export function configuredProviders(env: Env = process.env): Provider[] {
  const order = (env.AI_PROVIDERS ?? 'claude,openai,gemini,xai').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const table: Record<ProviderId, { key?: string; model?: string }> = {
    claude: { key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-opus-5' },
    openai: { key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
    // 공식 클라이언트와 같게: 둘 다 있으면 GOOGLE_API_KEY
    gemini: { key: env.GOOGLE_API_KEY || env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
    xai: { key: env.XAI_API_KEY, model: env.XAI_MODEL },
  };
  const out: Provider[] = [];
  for (const id of order) {
    if (!(id in table) || out.some(p => p.id === id)) continue;
    const { key, model } = table[id as ProviderId];
    if (key && model) out.push({ id: id as ProviderId, apiKey: key, model });
  }
  return out;
}

function parseJson(raw: string): AiJson {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  try {
    const o = JSON.parse(s) as Partial<AiJson>;
    if (typeof o.text === 'string' && o.text.trim() && Array.isArray(o.used_flight_nos)) {
      return { text: o.text.trim(), used_flight_nos: o.used_flight_nos.map(String) };
    }
  } catch { /* 아래에서 형식 오류 */ }
  throw new ParseError('정해진 JSON 형식이 아님');
}

interface Call { system: string; user: string; fetchImpl: typeof fetch; retries: number }

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown) {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  } catch (e) {
    throw new ProviderError(`네트워크 오류: ${(e as Error).message}`, true);
  }
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, TRANSIENT.has(res.status), res.status);
  return res.json() as Promise<Record<string, unknown>>;
}

async function callClaude(p: Provider, c: Call): Promise<string> {
  // SDK 자체 재시도는 끄고 이 파일의 재시도 규칙을 쓴다
  const client = new Anthropic({ apiKey: p.apiKey, maxRetries: 0, fetch: c.fetchImpl });
  try {
    const response = await client.beta.messages.create({
      model: p.model,
      max_tokens: 16000,
      // Claude 안에서 거절 시 같은 회사의 다른 모델로 넘기는 서버 측 fallback
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: c.system,
      messages: [{ role: 'user', content: c.user }],
    });
    if (response.stop_reason === 'refusal') throw new RefusedError('refusal');
    return response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
  } catch (e) {
    if (e instanceof RefusedError) throw e;
    if (e instanceof Anthropic.APIError) throw new ProviderError(`HTTP ${e.status ?? '?'} ${e.message}`, e.status == null || TRANSIENT.has(e.status), e.status);
    throw new ProviderError(`네트워크 오류: ${(e as Error).message}`, true);
  }
}

async function callOpenAiCompatible(base: string, p: Provider, c: Call, strictSchema: boolean): Promise<string> {
  const body = await postJson(c.fetchImpl, `${base}/chat/completions`, { authorization: `Bearer ${p.apiKey}` }, {
    model: p.model,
    messages: [{ role: 'system', content: c.system }, { role: 'user', content: c.user }],
    response_format: strictSchema
      ? { type: 'json_schema', json_schema: { name: 'answer', schema: OUTPUT_SCHEMA, strict: true } }
      : { type: 'json_object' },
  });
  const choice = (body.choices as { message?: { content?: string; refusal?: string } }[] | undefined)?.[0]?.message;
  if (choice?.refusal) throw new RefusedError('refusal');
  if (typeof choice?.content !== 'string') throw new ParseError('빈 응답');
  return choice.content;
}

async function callGemini(p: Provider, c: Call): Promise<string> {
  // 키는 URL이 아니라 헤더로 보낸다 (로그에 URL이 남아도 키가 새지 않게)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`;
  const body = await postJson(c.fetchImpl, url, { 'x-goog-api-key': p.apiKey }, {
    systemInstruction: { parts: [{ text: c.system }] },
    contents: [{ role: 'user', parts: [{ text: c.user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
  });
  const cand = (body.candidates as { finishReason?: string; content?: { parts?: { text?: string }[] } }[] | undefined)?.[0];
  if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new RefusedError('refusal');
  const text = cand?.content?.parts?.map(x => x.text ?? '').join('');
  if (!text) throw new ParseError('빈 응답');
  return text;
}

function callOnce(p: Provider, c: Call): Promise<string> {
  switch (p.id) {
    case 'claude': return callClaude(p, c);
    case 'openai': return callOpenAiCompatible('https://api.openai.com/v1', p, c, true);
    case 'xai': return callOpenAiCompatible('https://api.x.ai/v1', p, c, false);
    case 'gemini': return callGemini(p, c);
  }
}

export interface Attempt { provider: ProviderId; model: string; tries: number; error?: string }

export interface ChainResult {
  output: AiJson | null;
  provider: ProviderId | null;
  model: string | null;
  refused: boolean;
  /** 모든 제공자가 형식이 틀린 답을 줬다 */
  parseError: boolean;
  attempts: Attempt[];
}

const redact = (msg: string, providers: Provider[]) => providers.reduce((m, p) => m.split(p.apiKey).join('<KEY>'), msg);

/** 제공자 순서대로 시도해 첫 번째로 형식이 맞는 JSON 답을 돌려준다. */
export async function completeWithFallback(
  system: string, user: string,
  opts: { providers?: Provider[]; fetchImpl?: typeof fetch; retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ChainResult> {
  const providers = opts.providers ?? configuredProviders();
  const retries = opts.retries ?? Number(process.env.AI_HTTP_RETRIES ?? 2);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const call: Call = { system, user, fetchImpl: opts.fetchImpl ?? fetch, retries };
  const attempts: Attempt[] = [];
  let sawParseError = false;

  for (const p of providers) {
    const a: Attempt = { provider: p.id, model: p.model, tries: 0 };
    attempts.push(a);
    for (;;) {
      a.tries++;
      try {
        const output = parseJson(await callOnce(p, call));
        return { output, provider: p.id, model: p.model, refused: false, parseError: false, attempts };
      } catch (e) {
        if (e instanceof RefusedError) {
          a.error = '거절';
          return { output: null, provider: p.id, model: p.model, refused: true, parseError: false, attempts };
        }
        if (e instanceof ParseError) { a.error = e.message; sawParseError = true; break; }
        const pe = e as ProviderError;
        a.error = redact(pe.message, providers);
        if (!pe.transient || a.tries > retries) break;
        await sleep(1000 * 2 ** (a.tries - 1));
      }
    }
  }
  return { output: null, provider: null, model: null, refused: false, parseError: sawParseError, attempts };
}
