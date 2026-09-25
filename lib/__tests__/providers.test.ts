import { describe, expect, it, vi } from 'vitest';
import { completeWithFallback, configuredProviders, type Provider } from '../ai/providers';

const answer = { text: '김포에서 16:10 A 1207편을 타면 돼요.', used_flight_nos: ['A 1207'] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const claudeMsg = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'text', text }], stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
});
const openaiMsg = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] });
const geminiMsg = (text: string, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

const P: Record<string, Provider> = {
  claude: { id: 'claude', apiKey: 'sk-ant-SECRET', model: 'claude-opus-5' },
  openai: { id: 'openai', apiKey: 'sk-openai-SECRET', model: 'gpt-test' },
  gemini: { id: 'gemini', apiKey: 'gm-SECRET', model: 'gemini-test' },
  xai: { id: 'xai', apiKey: 'xai-SECRET', model: 'grok-test' },
};
const noSleep = async () => {};

/** URL로 제공자를 구분해 응답을 돌려주는 가짜 fetch */
function router(handlers: Partial<Record<'claude' | 'openai' | 'gemini' | 'xai', () => Response | Promise<Response>>>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const id = url.includes('anthropic') ? 'claude' : url.includes('openai') ? 'openai' : url.includes('googleapis') ? 'gemini' : 'xai';
    const h = handlers[id];
    if (!h) throw new Error(`unexpected call ${id}`);
    return h();
  });
}

describe('configuredProviders', () => {
  it('키와 모델이 모두 있는 제공자만, AI_PROVIDERS 순서대로', () => {
    const ps = configuredProviders({
      AI_PROVIDERS: 'gemini,claude,openai,xai',
      ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', /* OPENAI_MODEL 없음 */
      GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'gg', GEMINI_MODEL: 'gm',
    });
    expect(ps.map(p => [p.id, p.model, p.apiKey])).toEqual([['gemini', 'gm', 'gg'], ['claude', 'claude-opus-5', 'a']]);
  });
});

describe('completeWithFallback', () => {
  it('Claude가 먼저 답하면 그걸 쓴다', async () => {
    const fetchImpl = router({ claude: () => json(claudeMsg(JSON.stringify(answer))) });
    const r = await completeWithFallback('s', 'u', { providers: [P.claude, P.openai], fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ provider: 'claude', output: answer, refused: false });
  });

  it('Claude 529 과부하 → 재시도 소진 → OpenAI', async () => {
    const fetchImpl = router({
      claude: () => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529),
      openai: () => json(openaiMsg(JSON.stringify(answer))),
    });
    const r = await completeWithFallback('s', 'u', { providers: [P.claude, P.openai], fetchImpl, retries: 2, sleep: noSleep });
    expect(r.provider).toBe('openai');
    expect(r.attempts).toMatchObject([{ provider: 'claude', tries: 3 }, { provider: 'openai', tries: 1 }]);
  });

  it('401 같은 영구 오류는 재시도 없이 다음 제공자로', async () => {
    const fetchImpl = router({
      openai: () => json({ error: 'bad key' }, 401),
      gemini: () => json(geminiMsg(JSON.stringify(answer))),
    });
    const r = await completeWithFallback('s', 'u', { providers: [P.openai, P.gemini], fetchImpl, sleep: noSleep });
    expect(r.provider).toBe('gemini');
    expect(r.attempts[0]).toMatchObject({ provider: 'openai', tries: 1, error: 'HTTP 401' });
  });

  it('형식이 틀린 답은 버리고 다음 제공자로', async () => {
    const fetchImpl = router({
      openai: () => json(openaiMsg('그냥 문장으로 답했어요')),
      xai: () => json(openaiMsg('```json\n' + JSON.stringify(answer) + '\n```')),
    });
    const r = await completeWithFallback('s', 'u', { providers: [P.openai, P.xai], fetchImpl, sleep: noSleep });
    expect(r.provider).toBe('xai');
    expect(r.output).toEqual(answer);
  });

  it('모두 형식 오류면 parseError', async () => {
    const fetchImpl = router({ openai: () => json(openaiMsg('{}')), xai: () => json(openaiMsg('nope')) });
    const r = await completeWithFallback('s', 'u', { providers: [P.openai, P.xai], fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ output: null, parseError: true, refused: false });
  });

  it('거절은 다른 회사로 넘기지 않고 멈춘다', async () => {
    const fetchImpl = router({ gemini: () => json(geminiMsg('', 'SAFETY')), openai: () => json(openaiMsg(JSON.stringify(answer))) });
    const r = await completeWithFallback('s', 'u', { providers: [P.gemini, P.openai], fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ refused: true, provider: 'gemini', output: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Gemini 키는 URL이 아니라 헤더로, 오류 기록에 키가 남지 않는다', async () => {
    const fetchImpl = router({ gemini: () => { throw new TypeError(`connect failed key=${P.gemini.apiKey}`); } });
    const r = await completeWithFallback('s', 'u', { providers: [P.gemini], fetchImpl, retries: 0, sleep: noSleep });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain(P.gemini.apiKey);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(P.gemini.apiKey);
    expect(r.attempts[0].error).not.toContain(P.gemini.apiKey);
    expect(r).toMatchObject({ output: null, parseError: false, refused: false });
  });
});
