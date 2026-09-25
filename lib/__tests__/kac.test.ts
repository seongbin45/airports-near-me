import { describe, expect, it, vi } from 'vitest';
import { DataGoKrError, normDate, normTime, parseResponse } from '../data/data-go-kr';
import { fetchKacByDate, fetchKacDomestic } from '../data/kac-schedule';
import { fetchTagoDay } from '../data/tago-flights';
import { addDaysIso, assertServiceRole, planOnDemand, planTagoDates } from '../server/flight-sync';
import { pickBestSource, type Flight } from '../recommend';

// 실제 응답(2026-09-25 호출)에서 가져온 형태
const kacItem = (no: string, dep: string, arr: string, days = 'YYYYYYY', purpose = '여객기') => ({
  airlinehomepageUrl: null, airlineKorean: '에어서울', airlineEnglish: 'AIR SEOUL', arrivalcity: '제주', arrivalcityCode: 'CJU',
  domesticArrivalTime: arr, domesticEddate: '2026-10-24T00:00:00', domesticNum: no, domesticStartTime: dep,
  domesticStdate: '2026-09-14T00:00:00', startcity: '서울/김포', startcityCode: 'GMP',
  ...Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => [`domestic${d}`, days[i] === 'Y' ? 'Y' : 'N'])),
  flightPurpose: purpose,
});
const kacPage = (items: object[], total = items.length, pageNo = 1) => JSON.stringify({
  response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { numOfRows: 100, pageNo, totalCount: total, items: { item: items } } },
});
const tagoPage = (items: object[]) => JSON.stringify({
  response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: { item: items }, numOfRows: 100, pageNo: 1, totalCount: items.length } },
});
const GW_KEY_ERROR = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } });
const ok = (body: string) => new Response(body, { status: 200 });

describe('data.go.kr 공통', () => {
  it('시각·날짜 정규화', () => {
    expect(normTime('0710')).toBe('07:10');
    expect(normTime('710')).toBe('07:10');
    expect(normTime(202610020630)).toBe('06:30');
    expect(normTime('2460')).toBeNull();
    expect(normDate('2026-10-24T00:00:00')).toBe('2026-10-24');
    expect(normDate(202610020630)).toBe('2026-10-02');
    expect(normDate('')).toBeNull();
  });

  it('빈 결과(items가 빈 문자열)와 1건(객체)', () => {
    const empty = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: '', totalCount: 0 } } });
    expect(parseResponse(empty).items).toEqual([]);
    const one = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: { a: 1 } }, totalCount: 1 } } });
    expect(parseResponse(one).items).toEqual([{ a: 1 }]);
  });

  it('게이트웨이 키 오류(JSON)와 구형 XML 키 오류 모두 치명 오류로', () => {
    expect(() => parseResponse(GW_KEY_ERROR)).toThrow(expect.objectContaining({ code: '30' }));
    const xml = '<?xml version="1.0"?><response><header><resultCode>99</resultCode><resultMsg>SERVICE KEY IS NOT REGISTERED ERROR.</resultMsg></header></response>';
    expect(() => parseResponse(xml)).toThrow(expect.objectContaining({ code: 'KEY' }));
  });
});

describe('한국공항공사 정기 스케줄', () => {
  it('요일·유효기간 변환, 화물기 제외, 요청 파라미터', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok(kacPage([kacItem('RS901', '0600', '0715', 'YNYNYNN'), kacItem('KE9999', '0100', '0200', 'YYYYYYY', '화물기')])));
    const rows = await fetchKacDomestic({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl });
    expect(rows).toEqual([{
      flight_no: 'RS901', airline: '에어서울', origin: 'GMP', dest: 'CJU', dep_time: '06:00', arr_time: '07:15',
      days_of_week: [1, 3, 5], valid_from: '2026-09-14', valid_to: '2026-10-24', source: '한국공항공사', economy_fare: null,
    }]);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe('/B551178/flight-schedule/dom');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ schDate: '20261002', schDeptCityCode: 'GMP', schArrvCityCode: 'CJU', type: 'json' });
  });

  it('여러 페이지를 끝까지 받는다', async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => kacItem(`KE${1000 + i}`, '0700', '0810'));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(ok(kacPage(p1, 101, 1)))
      .mockResolvedValueOnce(ok(kacPage([kacItem('KE2000', '0900', '1010')], 101, 2)));
    expect(await fetchKacDomestic({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl })).toHaveLength(101);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('필드 이름이 다르면 받은 필드를 알려주며 실패', async () => {
    const fetchImpl = async () => ok(kacPage([{ flightNo: 'KE1', std: '0700' }]));
    await expect(fetchKacDomestic({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl }))
      .rejects.toThrow('받은 필드: flightNo, std');
  });

  it('키 오류는 재시도 없이, 5xx·네트워크 오류는 재시도', async () => {
    const bad = vi.fn<typeof fetch>(async () => ok(GW_KEY_ERROR));
    const err = await fetchKacDomestic({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl: bad }).catch(e => e);
    expect(err).toBeInstanceOf(DataGoKrError);
    expect(bad).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const flaky = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok(kacPage([kacItem('RS901', '0600', '0715')])));
    const p = fetchKacDomestic({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl: flaky });
    await vi.runAllTimersAsync();
    expect(await p).toHaveLength(1);
    expect(flaky).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe('TAGO 날짜별 운항편', () => {
  it('공항 ID 변환, 운항일·요금', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok(tagoPage([
      { airlineNm: '아시아나 항공', arrAirportNm: '제주국제공항', arrPlandTime: 202610020745, depAirportNm: '김포국제공항', depPlandTime: 202610020630, economyCharge: 61900, prestigeCharge: 0, vihicleId: 'OZ8901' },
      { airlineNm: '대한항공', arrPlandTime: 202610020800, depPlandTime: 202610020700, economyCharge: 0, vihicleId: 'KE1203' },
    ])));
    const rows = await fetchTagoDay({ serviceKey: 'k', date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl });
    expect(rows[0]).toEqual({
      flight_no: 'OZ8901', airline: '아시아나 항공', origin: 'GMP', dest: 'CJU', dep_time: '06:30', arr_time: '07:45',
      days_of_week: [5], valid_from: '2026-10-02', valid_to: '2026-10-02', source: '국토교통부 TAGO', economy_fare: 61900,
    });
    expect(rows[1].economy_fare).toBeNull(); // 요금 0은 "정보 없음"
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe('/1613000/DmstcFlightNvgInfo/GetFlightOpratInfoList');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ depAirportId: 'NAARKSS', arrAirportId: 'NAARKPC', depPlandTime: '20261002', _type: 'json' });
  });
});

describe('한국공항공사 날짜별 전 노선', () => {
  it('노선 필터 없이 schDate만, 화물기·모르는 공항은 뺀다', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const u = new URL(String(url));
      expect(u.searchParams.get('schDate')).toBe('20260925');
      expect(u.searchParams.get('schDeptCityCode')).toBeNull();
      return ok(kacPage([kacItem('RS901', '0600', '0715'), kacItem('CARGO1', '0100', '0200', 'YYYYYYY', '화물기'),
        { ...kacItem('JL91', '0900', '1100'), arrivalcityCode: 'HND' }]));
    });
    const r = await fetchKacByDate({ serviceKey: 'k', date: '2026-09-25', fetchImpl });
    expect(r.map(x => x.flight_no)).toEqual(['RS901']);
  });
});

describe('TAGO 조회 범위 (데이터가 정함)', () => {
  it('노선마다 정기 스케줄 마지막 날까지', () => {
    const plan = planTagoDates([
      { origin: 'GMP', dest: 'CJU', valid_to: '2026-09-27' },
      { origin: 'GMP', dest: 'CJU', valid_to: '2026-09-26' },
      { origin: 'CJJ', dest: 'CJU', valid_to: '2026-09-25' },
      { origin: 'GMP', dest: 'NRT', valid_to: '2026-12-31' }, // TAGO 공항 ID 없음
    ], '2026-09-25');
    expect(plan.map(p => `${p.origin}-${p.dest} ${p.date}`)).toEqual([
      'GMP-CJU 2026-09-25', 'GMP-CJU 2026-09-26', 'GMP-CJU 2026-09-27', 'CJJ-CJU 2026-09-25',
    ]);
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('사용자 요청 시 채우기 판단', () => {
  const now = new Date('2026-12-01T03:00:00Z');
  it('DB에 없고 최근에 물어본 적도 없으면 불러온다', () => {
    const todo = planOnDemand([{ origin: 'GMP', dest: 'CJU' }], [], [], now);
    expect(todo).toEqual([{ source: '한국공항공사', origin: 'GMP', dest: 'CJU' }, { source: '국토교통부 TAGO', origin: 'GMP', dest: 'CJU' }]);
  });
  it('정기 스케줄이 그날을 덮고, TAGO는 1시간 전에 물어봤으면(0건이었어도) 건너뛴다', () => {
    const todo = planOnDemand(
      [{ origin: 'GMP', dest: 'CJU' }],
      [{ source: '한국공항공사', origin: 'GMP', dest: 'CJU' }],
      [{ source: '국토교통부 TAGO', origin: 'GMP', dest: 'CJU', fetched_at: '2026-12-01T02:00:00Z' }],
      now,
    );
    expect(todo).toEqual([]);
  });
  it('TAGO 조회가 6시간보다 오래됐으면 다시', () => {
    const todo = planOnDemand([{ origin: 'GMP', dest: 'CJU' }], [{ source: '한국공항공사', origin: 'GMP', dest: 'CJU' }],
      [{ source: '국토교통부 TAGO', origin: 'GMP', dest: 'CJU', fetched_at: '2026-11-30T20:00:00Z' }], now);
    expect(todo).toEqual([{ source: '국토교통부 TAGO', origin: 'GMP', dest: 'CJU' }]);
  });
});

describe('pickBestSource', () => {
  const f = (id: number, origin: string, is_sample: boolean, source?: string): Flight =>
    ({ id, flight_no: `X${id}`, origin, dep_time: '10:00', arr_time: '11:00', is_sample, source });
  it('출발 공항마다 TAGO > 한국공항공사 > 샘플 중 하나만', () => {
    const flights = [
      f(1, 'GMP', true), f(2, 'GMP', false, '한국공항공사'), f(3, 'GMP', false, '국토교통부 TAGO'),
      f(4, 'CJJ', true), f(5, 'CJJ', false, '한국공항공사'),
      f(6, 'ICN', true),
    ];
    expect(pickBestSource(flights).map(x => x.id)).toEqual([3, 5, 6]);
  });
});

describe('redactKey', () => {
  it('네트워크 오류 메시지에 URL이 섞여도 키가 남지 않는다', async () => {
    const key = 'abc+/=123';
    const fetchImpl = vi.fn<typeof fetch>(async (url) => { throw new TypeError(`connect failed ${String(url)}`); });
    vi.useFakeTimers();
    const p = fetchKacDomestic({ serviceKey: key, date: '2026-10-02', origin: 'GMP', dest: 'CJU', fetchImpl }).catch(e => e);
    await vi.runAllTimersAsync();
    const err = await p;
    vi.useRealTimers();
    expect(err).toBeInstanceOf(DataGoKrError);
    expect(err.message).not.toContain(key);
    expect(err.message).not.toContain(encodeURIComponent(key));
    expect(err.message).toContain('<KEY>');
  });
});

describe('assertServiceRole', () => {
  const fakeAdmin = (error: { message: string } | null) =>
    ({ auth: { admin: { listUsers: async () => ({ data: null, error }) } } }) as unknown as Parameters<typeof assertServiceRole>[0];
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
  it('publishable·anon 키는 호출 전에 막는다', async () => {
    expect(await assertServiceRole(fakeAdmin(null), 'sb_publishable_abc')).toContain('publishable');
    expect(await assertServiceRole(fakeAdmin(null), jwt('anon'))).toContain('anon 키');
  });
  it('secret 키는 관리자 API로 확인', async () => {
    expect(await assertServiceRole(fakeAdmin(null), 'sb_secret_abc')).toBeNull();
    expect(await assertServiceRole(fakeAdmin({ message: 'Invalid API key' }), 'sb_secret_bad')).toContain('Invalid API key');
  });
});
