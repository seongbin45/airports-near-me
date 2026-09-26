import { describe, expect, it } from 'vitest';
import {
  AccessTimeError, buildAccessTimeSources, parseKakaoDirections, parseOdsayPath, planAccessTimes,
} from '../data/access-time';
import { geocodeAddress, inKorea, parseAddressSearch, regionQuery } from '../data/geocode';

// 카카오모빌리티 길찾기 응답은 개발자 문서의 예시 본문을 그대로 쓴다.
// https://developers.kakaomobility.com/guide/navi-api/directions
const KAKAO_OK = {
  trans_id: '01948280a50d700d945a8ec5c132709d',
  routes: [{
    result_code: 0, result_msg: '길찾기 성공',
    summary: { priority: 'RECOMMEND', fare: { taxi: 22200, toll: 0 }, distance: 19032, duration: 3494 },
  }],
};

describe('parseKakaoDirections', () => {
  it('duration(초)을 분으로 바꾼다 — 문서 예시 3494초 ≈ 58분', () => {
    expect(parseKakaoDirections(KAKAO_OK)).toEqual({ minutes: 58, distanceMeters: 19032, taxiFare: 22200 });
  });
  it('result_code가 0이 아니면 실패 사유를 그대로 알려준다', () => {
    const bad = { routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가깝습니다.' }] };
    expect(() => parseKakaoDirections(bad)).toThrow(/104/);
    try { parseKakaoDirections(bad); } catch (e) { expect((e as AccessTimeError).retryable).toBe(false); }
  });
  it('routes도 summary.duration도 없으면 형식 오류 (추정하지 않는다)', () => {
    expect(() => parseKakaoDirections({})).toThrow('routes');
    expect(() => parseKakaoDirections({ routes: [{ result_code: 0, summary: {} }] })).toThrow('duration');
  });
  it('1분 미만은 1분으로 둔다 (schema의 minutes > 0)', () => {
    expect(parseKakaoDirections({ routes: [{ result_code: 0, summary: { duration: 12 } }] }).minutes).toBe(1);
  });
});

describe('parseOdsayPath', () => {
  const OK = { result: { path: [{ pathType: 1, info: { totalTime: 62, payment: 1550, busTransitCount: 1, subwayTransitCount: 2, totalWalk: 430 } }] } };
  it('info.totalTime(분)을 쓴다', () => {
    expect(parseOdsayPath(OK)).toEqual({ minutes: 62, payment: 1550, transfers: 3 });
  });
  it('오류 응답은 코드와 메시지를 남긴다', () => {
    try { parseOdsayPath({ error: { code: -8, message: '필수 입력값 형식 및 범위 오류' } }); }
    catch (e) { expect((e as Error).message).toContain('필수 입력값'); expect((e as AccessTimeError).code).toBe('-8'); }
    expect(() => parseOdsayPath({ error: { code: 500, message: '서버 내부 오류' } })).toThrow();
  });
  it('totalTime을 못 찾으면 받은 키를 알려준다 (키를 받아보고 고칠 수 있게)', () => {
    try { parseOdsayPath({ result: { path: [{ info: { totallyDifferent: 1 } }] } }); expect.unreachable(); }
    catch (e) { expect((e as Error).message).toContain('totallyDifferent'); }
    expect(() => parseOdsayPath({ result: { somethingElse: 1 } })).toThrow('path 없음');
  });
  it('경로가 없으면(result.path 없음) 형식 오류', () => {
    expect(() => parseOdsayPath({ result: {} })).toThrow('path 없음');
  });
  it('배열로 오는 오류도 읽는다 — 인증 실패가 "result가 없어요"로 뭉개지지 않게', () => {
    // 실제 응답 형식: {"error":[{"code":"500","message":"[ApiKeyAuthFailed] ApiKey authentication failed."}]}
    // (lab.odsay.com 개발자포럼 seq=596·657 에서 확인)
    const body = { error: [{ code: '500', message: '[ApiKeyAuthFailed] ApiKey authentication failed.' }] };
    try {
      parseOdsayPath(body);
      expect.unreachable();
    } catch (e) {
      // 원인을 사용자에게 그대로 보여준다 — 예전에는 "result가 없어요"만 나와 IP 문제를 알 수 없었다
      expect((e as Error).message).toContain('ApiKeyAuthFailed');
      expect((e as AccessTimeError).code).toBe('KEY');
      expect((e as AccessTimeError).kind).toBe('exhaust'); // 그 실행 동안 제공자를 뺀다
    }
  });
  it('배열 오류라도 인증 문제가 아니면 코드를 그대로 남긴다', () => {
    try {
      parseOdsayPath({ error: [{ code: '-8', message: '필수 입력값 형식 및 범위 오류' }] });
      expect.unreachable();
    } catch (e) {
      expect((e as AccessTimeError).code).toBe('-8');
      expect((e as AccessTimeError).kind).toBe('nodata');
    }
  });
});

describe('buildAccessTimeSources', () => {
  it('키가 있는 수단만 만든다 (키 없이 0분으로 채우지 않는다) — OSRM을 끄면 키 없는 수단은 없다', () => {
    expect(buildAccessTimeSources({ OSRM_URL: 'off' }).map(s => s.mode)).toEqual([]);
    expect(buildAccessTimeSources({ KAKAO_REST_KEY: 'k', OSRM_URL: 'off' }).map(s => s.mode)).toEqual(['car']);
    expect(buildAccessTimeSources({ ODSAY_KEY: 'o', OSRM_URL: 'off' }).map(s => s.mode)).toEqual(['transit']);
    expect(buildAccessTimeSources({ KAKAO_REST_KEY: 'k', ODSAY_KEY: 'o', OSRM_URL: 'off' }).map(s => s.name))
      .toEqual(['카카오모빌리티 길찾기', 'ODsay 대중교통']);
  });
});

describe('planAccessTimes — 이번 실행에서 무엇을 계산할지', () => {
  const now = new Date('2026-09-25T06:00:00Z');
  const base = {
    regions: [{ id: 1, lat: 37.25, lng: 127.02 }, { id: 2, lat: null, lng: null }],
    airports: [{ code: 'GMP', lat: 37.55, lng: 126.79 }, { code: 'CJU', lat: null, lng: null }],
    modes: ['car', 'transit'] as const,
    existing: [], refreshDays: 30, limit: 100, now,
  };
  it('좌표가 없는 지역·공항은 대상에서 빼고 사유를 센다', () => {
    const out = planAccessTimes({ ...base, modes: [...base.modes] });
    expect(out.candidateTotal).toBe(2);      // 지역 1 × 공항 1 × 수단 2
    expect(out.noCoords).toBe(6);            // (2×2×2) − 2
    expect(out.todo.map(t => `${t.airport}/${t.mode}`)).toEqual(['GMP/car', 'GMP/transit']);
  });
  it('최근에 받은 실측은 건너뛰고, 샘플·오래된 실측은 다시 계산한다', () => {
    const out = planAccessTimes({
      ...base, modes: [...base.modes],
      existing: [
        { region_id: 1, airport: 'GMP', mode: 'car', fetched_at: '2026-09-24T00:00:00Z', is_sample: false },
        { region_id: 1, airport: 'GMP', mode: 'transit', fetched_at: '2026-06-01T00:00:00Z', is_sample: false },
      ],
    });
    expect(out.fresh).toBe(1);
    expect(out.todo.map(t => t.mode)).toEqual(['transit']);
  });
  it('샘플 행은 최근이어도 다시 계산한다 (실측으로 바꿔야 한다)', () => {
    const out = planAccessTimes({
      ...base, modes: [...base.modes],
      existing: [{ region_id: 1, airport: 'GMP', mode: 'car', fetched_at: '2026-09-25T05:00:00Z', is_sample: true }],
    });
    expect(out.fresh).toBe(0);                        // 샘플은 최근이어도 '실측'으로 세지 않는다
    expect(out.todo.map(t => t.mode)).toEqual(['car', 'transit']); // 샘플 car + 아직 없는 transit
  });
  it('limit으로 이번 실행 호출 수를 자른다', () => {
    const out = planAccessTimes({ ...base, modes: [...base.modes], limit: 1 });
    expect(out.todo).toHaveLength(1);
    expect(out.candidateTotal).toBe(2);
  });
});

describe('geocode — 카카오 로컬 주소 검색', () => {
  it('x=경도, y=위도를 바꿔 읽지 않는다', () => {
    const body = { documents: [{ address_name: '경기도 수원시 영통구', x: '127.046', y: '37.259' }] };
    expect(parseAddressSearch(body)).toEqual({ lat: 37.259, lng: 127.046, matched: '경기도 수원시 영통구' });
  });
  it('한국 밖 좌표(뒤바뀐 값 포함)는 버린다', () => {
    expect(inKorea(37.5, 127)).toBe(true);
    expect(inKorea(127, 37.5)).toBe(false);
    expect(parseAddressSearch({ documents: [{ x: '37.259', y: '127.046' }] })).toBeNull();
  });
  it('검색 결과가 없으면 null', () => {
    expect(parseAddressSearch({ documents: [] })).toBeNull();
    expect(parseAddressSearch({})).toBeNull();
  });
  it('구가 있으면 질의에 구까지 붙인다', () => {
    expect(regionQuery({ sido: '경기도', sigungu: '수원시', gu: '영통구' })).toBe('경기도 수원시 영통구');
    expect(regionQuery({ sido: '세종특별자치시', sigungu: null, gu: null })).toBe('세종특별자치시');
  });
  it('키가 거부되면 그 사실을 코드로 알려준다', async () => {
    const fake = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(geocodeAddress('서울', { key: 'bad', fetchImpl: fake })).rejects.toThrow('KAKAO_REST_KEY');
  });
});
