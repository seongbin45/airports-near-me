import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseTimetableXml, PASTE_HEADER } from '../everytime/xml';
import { BOOKMARKLET } from '../everytime/bookmarklet';

// 공유 시간표 XML 구조는 every2cal·linker 두 공개 구현에서 교차 확인한 모양으로 픽스처를 만들었다.
// day 번호(0=월)는 실측 전이다 — docs/UNVERIFIED_VALUES.md.
const XML = readFileSync(new URL('./fixtures/everytime-friend.xml', import.meta.url), 'utf8');

describe('parseTimetableXml', () => {
  it('5분 단위 시각·요일·장소를 읽고 같은 과목은 요일을 합친다', () => {
    const r = parseTimetableXml(`${PASTE_HEADER}\n${XML}`);
    if (!r.ok) throw new Error(r.error);
    expect(r.semester).toBe('2026년 2학기');
    const timed = r.items.filter(i => !i.online).map(i => [i.name, i.days.join('·'), i.start, i.end, i.place]);
    expect(timed).toEqual([
      ['운영체제', '월·수', '09:00', '10:15', '공학관 301'],
      ['데이터베이스', '화·목', '13:05', '14:20', '공학관 204'],
      ['대학영어 & 글쓰기', '토', '10:00', '11:40', '인문관 112'],
    ]);
    expect(r.items.every(i => !i.needsTimeCheck)).toBe(true);
  });

  it('시간 없는 과목은 온라인(선택 불가), 일요일은 사유와 함께 뺀다', () => {
    const r = parseTimetableXml(XML);
    if (!r.ok) throw new Error(r.error);
    expect(r.items.filter(i => i.online).map(i => i.name)).toEqual(['온라인 교양: 미술의 이해']);
    expect(r.skipped).toEqual([expect.objectContaining({ name: '일요 특강', reason: expect.stringContaining('일요일') })]);
  });

  it('공유 링크 자체를 붙여넣으면 브라우저에서 열라고 안내한다', () => {
    const r = parseTimetableXml('https://everytime.kr/@AbCdEf123456');
    expect(r).toMatchObject({ ok: false, kind: 'link' });
  });

  it('시간표 XML이 아니면 형식 오류', () => {
    expect(parseTimetableXml('<html><body>로그인이 필요합니다</body></html>')).toMatchObject({ ok: false, kind: 'format' });
  });

  it('과목이 없으면(비공개·빈 시간표) 비공개 안내', () => {
    expect(parseTimetableXml('<response><table year="2026" semester="2"/></response>')).toMatchObject({ ok: false, kind: 'empty' });
    expect(parseTimetableXml('<response></response>')).toMatchObject({ ok: false, kind: 'empty' });
  });

  it('읽을 수 없는 시각 값은 추측하지 않고 뺀다', () => {
    const r = parseTimetableXml('<response><table><subject><name value="A"/><time><data day="0" starttime="x" endtime="300"/></time></subject></table></response>');
    expect(r).toMatchObject({ ok: false, kind: 'format' });
    if (!r.ok) expect(r.error).toContain('시각 값을 읽을 수 없어요');
  });
});

// 북마크 주소 문자열을 그대로 실행한다 — 직렬화되어 다른 페이지에서 도는 코드라 모듈 안에서가 아니라 문자열로 검사해야 한다.
function runBookmarklet(opts: { host: string; path: string; fetch: (url: string, init: RequestInit) => Promise<Response>; clipboardOk: boolean }) {
  const nodes: Record<string, unknown>[] = [];
  const el = () => {
    const n: Record<string, unknown> = { style: '', setAttribute(k: string, v: string) { n[k] = v; }, appendChild(c: unknown) { (n.children as unknown[]).push(c); }, children: [], remove() { n.removed = true; } };
    nodes.push(n);
    return n;
  };
  const document = { getElementById: () => null, createElement: el, body: el(), execCommand: vi.fn() };
  const clipboard = { writeText: vi.fn(() => (opts.clipboardOk ? Promise.resolve() : Promise.reject(new Error('denied')))) };
  const alert = vi.fn();
  const code = decodeURIComponent(BOOKMARKLET.slice('javascript:'.length));
  new Function('location', 'fetch', 'navigator', 'document', 'alert', code)(
    { hostname: opts.host, pathname: opts.path }, opts.fetch, { clipboard }, document, alert);
  return { nodes, clipboard, alert, body: document.body as { children: Record<string, unknown>[] } };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('BOOKMARKLET', () => {
  it('javascript: 주소이고 자기완결이다 (바깥 식별자 없이 실행된다)', () => {
    expect(BOOKMARKLET.startsWith('javascript:')).toBe(true);
    expect(BOOKMARKLET.length).toBeLessThan(6000);
  });

  it('공유 페이지에서 페이지와 같은 요청을 한 번 보내고, 받은 XML을 머리말과 함께 복사한다', async () => {
    const fetch = vi.fn(async () => new Response(XML, { status: 200 }));
    const r = runBookmarklet({ host: 'everytime.kr', path: '/@AbCdEf123456', fetch, clipboardOk: true });
    await flush(); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.everytime.kr/find/timetable/table/friend');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('identifier=AbCdEf123456&friendInfo=true');
    expect(init.headers).toBeUndefined(); // 헤더를 위조하지 않는다 — 브라우저가 붙이는 그대로
    expect(r.clipboard.writeText).toHaveBeenCalledWith(`ETX1\n${XML}`);
    expect(parseTimetableXml(String((r.clipboard.writeText.mock.calls[0] as unknown[])[0])).ok).toBe(true);
  });

  it('첫 요청이 막히면 쿠키를 실어 한 번만 더 시도한다', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(XML, { status: 200 }));
    runBookmarklet({ host: 'everytime.kr', path: '/@AbCdEf123456', fetch, clipboardOk: true });
    await flush(); await flush(); await flush();
    expect(fetch.mock.calls.map(c => (c[1] as RequestInit).credentials)).toEqual(['same-origin', 'include']);
  });

  it('클립보드가 막히면 화면에 복사 상자를 띄운다', async () => {
    const r = runBookmarklet({ host: 'everytime.kr', path: '/@AbCdEf123456', fetch: async () => new Response(XML), clipboardOk: false });
    await flush(); await flush(); await flush();
    const box = r.body.children[0] as { children: Record<string, unknown>[] };
    expect(box.children.find(c => typeof c.value === 'string')?.value).toBe(`ETX1\n${XML}`);
  });

  it('공유 페이지가 아니면 아무것도 요청하지 않는다', () => {
    const fetch = vi.fn();
    const r = runBookmarklet({ host: 'everytime.kr', path: '/timetable', fetch, clipboardOk: true });
    const r2 = runBookmarklet({ host: 'example.com', path: '/@AbCdEf123456', fetch, clipboardOk: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(r.alert).toHaveBeenCalled();
    expect(r2.alert).toHaveBeenCalled();
  });

  it('두 번 모두 실패하면 이유를 알린다', async () => {
    const r = runBookmarklet({ host: 'everytime.kr', path: '/@AbCdEf123456', fetch: async () => new Response('', { status: 403 }), clipboardOk: true });
    await flush(); await flush(); await flush();
    expect(r.alert).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });
});
