import { describe, expect, it, vi } from 'vitest';
import { checkImageInput, MAX_IMAGE_BYTES, PER_DAY, PER_MINUTE, rateLimitError, sniffImage } from '../everytime/image-input';
import { parseTimetableAnswer, TIMETABLE_SCHEMA } from '../ai/timetable';
import { completeWithFallback, type Provider } from '../ai/providers';
import { normalizeBlocks } from '../everytime/items';

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString('base64');
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0];

describe('캡처 입력 검사', () => {
  it('매직 바이트로 실제 형식을 본다', () => {
    expect(sniffImage(Uint8Array.from(JPEG))).toBe('image/jpeg');
    expect(sniffImage(Uint8Array.from(PNG))).toBe('image/png');
    expect(sniffImage(Uint8Array.from(WEBP))).toBe('image/webp');
    expect(sniffImage(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
  });

  it('선언한 형식과 실제 형식이 다르면 거절한다', () => {
    expect(checkImageInput({ image: b64(PNG), mediaType: 'image/jpeg' })).toMatchObject({ ok: false });
    expect(checkImageInput({ image: b64(JPEG), mediaType: 'image/jpeg' })).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
    expect(checkImageInput({ image: `data:image/png;base64,${b64(PNG)}`, mediaType: 'image/png' })).toMatchObject({ ok: true });
  });

  it('형식 밖·base64 아님·너무 큼·빈 요청은 거절', () => {
    expect(checkImageInput({ image: b64(JPEG), mediaType: 'image/gif' })).toMatchObject({ ok: false });
    expect(checkImageInput({ image: '!!!', mediaType: 'image/jpeg' })).toMatchObject({ ok: false });
    expect(checkImageInput(null)).toMatchObject({ ok: false });
    const big = b64(JPEG) + 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3));
    expect(checkImageInput({ image: big, mediaType: 'image/jpeg' })).toMatchObject({ ok: false, error: expect.stringContaining('4MB') });
  });

  it('호출 제한: 1분 3번, 하루 20번', () => {
    expect(rateLimitError(PER_MINUTE - 1, PER_DAY - 1)).toBeNull();
    expect(rateLimitError(PER_MINUTE, 0)).toContain('1분');
    expect(rateLimitError(0, PER_DAY)).toContain('하루');
  });
});

describe('parseTimetableAnswer — 답의 모양만 본다', () => {
  it('모양이 맞으면 문자열로 정리하고, 값의 타당성은 normalizeBlocks에 맡긴다', () => {
    const a = parseTimetableAnswer('```json\n{"semester":"2026년 2학기","blocks":[{"name":"운영체제","place":"공학관","day":"월","start":"09:02","end":"10:13"},{"name":"X","day":7}],"online":["미술"]}\n```');
    expect(a.semester).toBe('2026년 2학기');
    expect(a.blocks[1]).toEqual({ name: 'X', place: '', day: '', start: '', end: '' });
    const r = normalizeBlocks(a.blocks, a.online, { needsTimeCheck: true });
    expect(r.items.map(i => [i.name, i.start, i.end, i.needsTimeCheck])).toEqual([['운영체제', '09:00', '10:15', true], ['미술', '', '', false]]);
    expect(r.skipped).toHaveLength(1);
  });

  it('모양이 틀리면 형식 오류(다음 제공자로)', () => {
    expect(() => parseTimetableAnswer('{"text":"시간표예요"}')).toThrow();
    expect(() => parseTimetableAnswer('시간표를 읽었어요')).toThrow();
  });

  it('스키마는 엄격 모드 규칙을 지킨다 (모든 속성 required, additionalProperties false)', () => {
    const j = TIMETABLE_SCHEMA.json as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    expect(j.additionalProperties).toBe(false);
    expect(j.required.sort()).toEqual(Object.keys(j.properties).sort());
  });
});

describe('completeWithFallback — 이미지 전달', () => {
  const img = { mediaType: 'image/jpeg' as const, base64: b64(JPEG) };
  const answer = JSON.stringify({ semester: '', blocks: [], online: [] });
  const P: Record<string, Provider> = {
    claude: { id: 'claude', apiKey: 'k', model: 'claude-test' },
    openai: { id: 'openai', apiKey: 'k', model: 'gpt-test' },
    gemini: { id: 'gemini', apiKey: 'k', model: 'gemini-test' },
    xai: { id: 'xai', apiKey: 'k', model: 'grok-test' },
  };
  const reply: Record<string, unknown> = {
    claude: { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
    openai: { choices: [{ message: { content: answer } }] },
    xai: { choices: [{ message: { content: answer } }] },
    gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: answer }] } }] },
  };

  it.each(['claude', 'openai', 'gemini', 'xai'])('%s: 이미지와 시간표 스키마를 요청에 싣는다', async id => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const req = input instanceof Request ? input : null;
      sent = JSON.parse(req ? await req.text() : String(init?.body));
      return new Response(JSON.stringify(reply[id]), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await completeWithFallback('s', 'u', { providers: [P[id]], fetchImpl, images: [img], schema: TIMETABLE_SCHEMA, parse: parseTimetableAnswer });
    expect(r.output).toEqual({ semester: '', visibleUntil: null, blocks: [], online: [] });
    const body = JSON.stringify(sent);
    expect(body).toContain(img.base64);
    // 시간표 스키마가 실렸다(문장 답 스키마가 아니라). xAI는 스키마 대신 json_object — 모양은 SYSTEM 문장에 적혀 있다
    if (id === 'xai') expect(body).toContain('"json_object"');
    else expect(body).toContain('"online"');
    if (id === 'claude') expect(body).toContain('"media_type":"image/jpeg"');
    if (id === 'openai' || id === 'xai') expect(body).toContain('data:image/jpeg;base64,');
    if (id === 'gemini') expect(body).toContain('"inline_data"');
  });
});

describe('readTimetableImage — 두 AI 대조 읽기', () => {
  const img = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };
  const P2: Provider[] = [{ id: 'openai', apiKey: 'k', model: 'gpt-test' }, { id: 'xai', apiKey: 'k', model: 'grok-test' }];
  const ok = (blocks: unknown[]) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ semester: '', blocks, online: [] }) } }] }), { status: 200 });

  it('AI가 둘이면 서로 다른 AI가 동시에 읽는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
      ok([{ name: 'A', place: '', day: '월', start: String(input).includes('x.ai') ? '9:05' : '9:00', end: '10:00' }]));
    const { readTimetableImage } = await import('../ai/timetable');
    const r = await readTimetableImage(img, P2);
    expect([r.first.provider, r.second?.provider]).toEqual(['openai', 'xai']);
    expect(r.first.output?.blocks[0].start).toBe('09:00'); // "9:00" → "09:00"
    expect(r.second?.output?.blocks[0].start).toBe('09:05');
    fetchSpy.mockRestore();
  });

  it('첫째가 실패해 둘째 제공자로 넘어가면 같은 AI라 대조하지 않는다', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input =>
      (String(input).includes('openai') ? new Response('', { status: 400 }) : ok([])));
    const { readTimetableImage } = await import('../ai/timetable');
    const r = await readTimetableImage(img, P2);
    expect(r.first.provider).toBe('xai');
    expect(r.second).toBeNull();
    fetchSpy.mockRestore();
  });
});
