import { describe, expect, it, vi } from 'vitest';
import {
  AccessTimeError, airportZone, buildAccessTimeSources, kakaoCarSource, osrmCarSource, parseKakaoDirections,
  parseNaverDriving, parseOsrmRoute, parseTmapRoute, planAccessTimes, regionZone,
} from '../data/access-time';
import { buildGeocoders, kakaoGeocoder, nominatimGeocoder, parseNaverGeocode, parseNominatim } from '../data/geocode';
import { createChain, MapApiError } from '../data/map-chain';
import { fetchAllRows } from '../server/paginate';

describe('buildAccessTimeSources — 우선순위와 키', () => {
  it('키가 있는 제공자만, 우선순위대로. 차량은 OSRM(키 없음)이 마지막 예비', () => {
    expect(buildAccessTimeSources({}).map(s => s.name)).toEqual(['OSRM(OpenStreetMap)']);
    expect(buildAccessTimeSources({ OSRM_URL: 'off' })).toEqual([]);
    expect(buildAccessTimeSources({ ODSAY_KEY: 'o', OSRM_URL: 'off' }).map(s => s.mode)).toEqual(['transit']);
    expect(buildAccessTimeSources({
      KAKAO_REST_KEY: 'k', TMAP_APP_KEY: 't', NAVER_MAP_CLIENT_ID: 'n', NAVER_MAP_CLIENT_SECRET: 's', ODSAY_KEY: 'o',
    }).map(s => s.name)).toEqual(['카카오모빌리티 길찾기', 'TMAP 자동차 경로', '네이버 Directions 5', 'OSRM(OpenStreetMap)', 'ODsay 대중교통']);
  });
  it('네이버는 ID·시크릿이 둘 다 있어야 들어간다', () => {
    expect(buildAccessTimeSources({ NAVER_MAP_CLIENT_ID: 'n', OSRM_URL: 'off' })).toEqual([]);
  });
  it('공용 OSRM만 호출 간격을 둔다 (자체 서버는 제한 없음)', () => {
    expect(osrmCarSource().minIntervalMs).toBe(1100);
    expect(osrmCarSource('http://osrm.local/').minIntervalMs).toBe(0);
  });
});

describe('다른 제공자 응답 파싱', () => {
  it('TMAP: features[0].properties.totalTime(초), 한도 오류는 소진', () => {
    expect(parseTmapRoute({ type: 'FeatureCollection', features: [{ properties: { totalTime: 1800, totalDistance: 25000 } }] })).toBe(30);
    try { parseTmapRoute({ error: { id: '429', code: 'QUOTA_EXCEEDED', message: '일일 한도 초과' } }); expect.unreachable(); }
    catch (e) { expect((e as MapApiError).kind).toBe('exhaust'); }
    expect(() => parseTmapRoute({ features: [] })).toThrow('totalTime');
  });
  it('네이버: duration은 밀리초, code != 0은 결과 없음', () => {
    expect(parseNaverDriving({ code: 0, route: { traoptimal: [{ summary: { duration: 1_800_000, distance: 25000 } }] } })).toBe(30);
    try { parseNaverDriving({ code: 3, message: '자동차 길찾기 결과를 제공할 수 없습니다.' }); expect.unreachable(); }
    catch (e) { expect((e as MapApiError).kind).toBe('nodata'); }
  });
  it('OSRM: routes[0].duration(초), NoRoute는 결과 없음', () => {
    expect(parseOsrmRoute({ code: 'Ok', routes: [{ duration: 1795.4, distance: 25000 }] })).toBe(30);
    try { parseOsrmRoute({ code: 'NoRoute', message: 'Impossible route between points' }); expect.unreachable(); }
    catch (e) { expect((e as MapApiError).kind).toBe('nodata'); }
  });
  it('형식이 바뀐 응답은 소진(그 제공자는 이번 실행에서 빼고 다음으로)', () => {
    try { parseKakaoDirections({}); expect.unreachable(); } catch (e) { expect((e as MapApiError).kind).toBe('exhaust'); }
  });
  it('네이버 Geocoding·Nominatim: 한국 밖 좌표는 버린다', () => {
    expect(parseNaverGeocode({ addresses: [{ roadAddress: '서울특별시 강서구', x: '126.849', y: '37.551' }] }))
      .toEqual({ lat: 37.551, lng: 126.849, matched: '서울특별시 강서구' });
    expect(parseNominatim([{ lat: '37.551', lon: '126.849', display_name: '강서구' }])).toEqual({ lat: 37.551, lng: 126.849, matched: '강서구' });
    expect(parseNominatim([{ lat: '48.85', lon: '2.35' }])).toBeNull();
    expect(parseNominatim({})).toBeNull();
  });
});

describe('권역 — 제주 ↔ 육지는 차로 갈 수 없다', () => {
  it('구역·공항 권역', () => {
    expect(regionZone({ sido: '제주특별자치도', sigungu: '제주시' })).toBe('jeju');
    expect(regionZone({ sido: '경상북도', sigungu: '울릉군' })).toBe('ulleung');
    expect(regionZone({ sido: '서울특별시', sigungu: '강서구' })).toBe('mainland');
    expect(airportZone('CJU')).toBe('jeju');
    expect(airportZone('GMP')).toBe('mainland');
  });
  it('다른 권역 조합은 계산하지 않고 unreachable로 센다', () => {
    const out = planAccessTimes({
      regions: [
        { id: 1, lat: 37.5, lng: 126.8, zone: 'mainland' }, { id: 2, lat: 33.5, lng: 126.5, zone: 'jeju' }, { id: 3, lat: 37.5, lng: 130.9, zone: 'ulleung' },
      ],
      airports: [{ code: 'GMP', lat: 37.55, lng: 126.79, zone: 'mainland' }, { code: 'CJU', lat: 33.5, lng: 126.49, zone: 'jeju' }],
      modes: ['car'], existing: [], refreshDays: 30, limit: 100, now: new Date('2026-09-25T00:00:00Z'),
    });
    expect(out.todo.map(t => `${t.region_id}-${t.airport}`)).toEqual(['1-GMP', '2-CJU']);
    expect(out.unreachable).toBe(4); // 1-CJU, 2-GMP, 3-GMP, 3-CJU
    expect(out.candidateTotal).toBe(2);
  });
});

describe('지도 API 예비 체계 (map-chain)', () => {
  const noSleep = async () => {};
  const ok = (name: string, value: number) => ({ name, call: vi.fn(async () => value) });
  const fail = (name: string, err: Error) => ({ name, call: vi.fn(async () => { throw err; }) });

  it('한도 초과면 그 제공자를 이번 실행에서 빼고 다음 제공자로 — 이후 호출도 바로 다음 제공자', async () => {
    const kakao = fail('카카오', new AccessTimeError('한도 초과', '429', false));
    const osrm = ok('OSRM', 42);
    const chain = createChain([kakao, osrm], { sleep: noSleep });
    expect(await chain.run(1)).toEqual({ ok: true, value: 42, provider: 'OSRM' });
    expect(await chain.run(2)).toEqual({ ok: true, value: 42, provider: 'OSRM' });
    expect(kakao.call).toHaveBeenCalledTimes(1); // 소진된 뒤엔 다시 부르지 않는다
    expect(chain.exhausted()).toHaveProperty('카카오');
    expect(chain.usage()).toEqual({ OSRM: 2 });
  });

  it('일시 오류는 같은 제공자로 재시도 후, 그 조합만 다음 제공자로 (소진 아님)', async () => {
    const flaky = fail('카카오', new AccessTimeError('HTTP 503', '503', true));
    const chain = createChain([flaky, ok('OSRM', 10)], { sleep: noSleep, retries: 2 });
    expect((await chain.run(1)).ok).toBe(true);
    expect(flaky.call).toHaveBeenCalledTimes(3);
    expect(chain.available()).toEqual(['카카오', 'OSRM']);
  });

  it('길찾기: 경로 없음이면 다른 제공자에게 묻지 않는다', async () => {
    const osrm = ok('OSRM', 1);
    const chain = createChain([fail('카카오', new AccessTimeError('너무 가까움', '104', false)), osrm], { sleep: noSleep });
    expect(await chain.run(1)).toMatchObject({ ok: false, reason: 'nodata' });
    expect(osrm.call).not.toHaveBeenCalled();
  });

  it('지오코딩: 못 찾음이면 다음 제공자에게도 묻는다 (새 행정구역 이름)', async () => {
    const chain = createChain([fail('카카오', new MapApiError('못 찾음', 'NOT_FOUND', 'nodata')), ok('Nominatim', 7)],
      { sleep: noSleep, fallThroughOnNoData: true });
    expect(await chain.run('인천광역시 제물포구')).toEqual({ ok: true, value: 7, provider: 'Nominatim' });
  });

  it('카카오 103(도착지 주변 도로 없음)은 재시도 없이 다음 제공자에게 — 카카오는 계속 쓴다', async () => {
    const kakaoFail = (() => {
      try { parseKakaoDirections({ routes: [{ result_code: 103, result_msg: '도착 지점 주변의 도로를 탐색할 수 없음' }] }); }
      catch (e) { return e as Error; }
      throw new Error('unreachable');
    })();
    expect((kakaoFail as MapApiError).kind).toBe('skip');
    const kakao = fail('카카오', kakaoFail);
    const chain = createChain([kakao, ok('OSRM', 88)], { sleep: noSleep, retries: 2 });
    expect(await chain.run(1)).toEqual({ ok: true, value: 88, provider: 'OSRM' });
    expect(kakao.call).toHaveBeenCalledTimes(1);
    expect(chain.available()).toEqual(['카카오', 'OSRM']);
  });

  it('모든 제공자가 소진되면 exhausted로 알려 배치를 멈추게 한다', async () => {
    const chain = createChain([fail('A', new MapApiError('키', 'KEY', 'exhaust')), fail('B', new MapApiError('429', '429', 'exhaust'))], { sleep: noSleep });
    expect(await chain.run(1)).toMatchObject({ ok: false, reason: 'exhausted' });
  });

  it('네트워크 예외(TypeError)는 일시 오류 — 소진으로 보지 않는다', async () => {
    const chain = createChain([fail('A', new TypeError('fetch failed'))], { sleep: noSleep, retries: 0 });
    expect(await chain.run(1)).toMatchObject({ ok: false, reason: 'failed' });
    expect(chain.available()).toEqual(['A']);
  });

  it('공용 서버는 호출 간격(minIntervalMs)을 지킨다', async () => {
    let t = 0;
    const waits: number[] = [];
    const chain = createChain([{ name: 'OSRM', minIntervalMs: 1100, call: async () => 1 }], {
      now: () => t, sleep: async ms => { waits.push(ms); t += ms; },
    });
    await chain.run(1);
    t += 100;
    await chain.run(2);
    expect(waits).toEqual([1000]);
  });

  it('실제 HTTP 흐름: 카카오 429 → OSRM', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).includes('kakaomobility')
      ? new Response('{"code":-10,"msg":"API limit has been exceeded."}', { status: 429 })
      : new Response(JSON.stringify({ code: 'Ok', routes: [{ duration: 1500 }] }), { status: 200 }));
    const sources = [kakaoCarSource('k', fetchImpl), osrmCarSource('http://osrm.local', fetchImpl)];
    const chain = createChain(sources.map(s => ({
      name: s.name, call: () => s.minutes({ lat: 37.5, lng: 127 }, { lat: 37.55, lng: 126.79 }, new Date()),
    })), { sleep: noSleep });
    expect(await chain.run(0)).toEqual({ ok: true, value: 25, provider: 'OSRM(OpenStreetMap)' });
  });

  it('지오코더 순서와 Nominatim 요청 형식', async () => {
    expect(buildGeocoders({ KAKAO_REST_KEY: 'k' }).map(g => g.name)).toEqual(['카카오 로컬', 'Nominatim(OpenStreetMap)']);
    expect(buildGeocoders({ NOMINATIM_URL: 'off' })).toEqual([]);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ lat: '37.4', lon: '126.6', display_name: '제물포구' }])));
    const g = nominatimGeocoder({ baseUrl: 'http://nom.local', email: 'a@b.c', fetchImpl });
    expect(await g.call('인천광역시 제물포구')).toMatchObject({ lat: 37.4, lng: 126.6 });
    const u = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ q: '인천광역시 제물포구', format: 'jsonv2', countrycodes: 'kr', email: 'a@b.c' });
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>)['user-agent']).toContain('airports-near-me');
  });

  it('카카오 지오코더: 못 찾으면 nodata 오류 (다음 제공자로 넘기기 위해)', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ documents: [] }))) as unknown as typeof fetch;
    await expect(kakaoGeocoder('k', fetchImpl).call('없는 곳')).rejects.toMatchObject({ kind: 'nodata' });
  });
});

describe('fetchAllRows — Supabase 1,000행 제한 넘기기', () => {
  it('마지막 페이지가 덜 찰 때까지 range로 받는다', async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<number>(async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
    expect(rows).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('오류 메시지가 비어도 원인을 남긴다', async () => {
    await expect(fetchAllRows(async () => ({ data: null, error: { message: '', code: '42703' } as unknown as { message: string } })))
      .rejects.toThrow('42703');
  });
});
