import { describe, expect, it } from 'vitest';
import { AccessTimeError, bandsForMode, buildAccessTimeSources, parseTmapTransit } from '../data/access-time';

// TMAP 대중교통 — 문서(transit.tmapmobility.com/guide/procedure, 2026-09-27 확인) 기준.
// 아직 키로 실측하지 못했으므로, 문서에 적힌 세 형태(성공·결과 없음·서버 오류)를 여기서 고정한다.

const okBody = (totalTime: number) => ({
  metaData: {
    plan: {
      itineraries: [{
        totalTime, transferCount: 0, totalWalkTime: 276, pathType: 2,
        fare: { regular: { totalFare: 1200, currency: { currencyCode: 'KRW' } } },
        legs: [{ mode: 'WALK', sectionTime: 110 }],
      }],
    },
  },
});

const kindOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as AccessTimeError).kind; }
  throw new Error('오류가 나야 하는데 나지 않았다');
};

describe('parseTmapTransit', () => {
  it('totalTime은 초 — 986초는 16분 (ODsay의 분 정수와 혼동하면 60배 틀어진다)', () => {
    expect(parseTmapTransit(200, okBody(986)).minutes).toBe(16);
    expect(parseTmapTransit(200, okBody(60)).minutes).toBe(1);
    expect(parseTmapTransit(200, okBody(30)).minutes).toBe(1); // 1분 미만도 1분 (schema: minutes > 0)
  });
  it('요금·환승 횟수도 함께 읽는다', () => {
    const r = parseTmapTransit(200, okBody(986));
    expect(r.payment).toBe(1200);
    expect(r.transfers).toBe(0);
  });
  it('status 14(검색 결과가 없음)는 결과 없음 — 재시도 대상이 아니다', () => {
    expect(kindOf(() => parseTmapTransit(400, { result: { message: '검색 결과가 없음', status: 14 } }))).toBe('nodata');
  });
  it('500(일정 시간 응답이 없음)은 일시 오류 — 재시도 가치가 있다', () => {
    expect(kindOf(() => parseTmapTransit(500, { result: { message: '일정 시간 응답이 없음', status: 31 } }))).toBe('transient');
  });
  it('400인데 요청·인증 오류면 그 실행에서 이 제공자를 뺀다 (nodata로 뭉개면 조용히 묻힌다)', () => {
    expect(kindOf(() => parseTmapTransit(400, { result: { message: '필수 파라미터 누락', status: 11 } }))).toBe('exhaust');
  });
  it('본문이 아예 다르면 받은 키를 메시지에 남긴다 (형식 변경을 바로 알아채게)', () => {
    try { parseTmapTransit(200, { unexpected: 1, other: 2 }); throw new Error('던져야 한다'); }
    catch (e) { expect(String((e as Error).message)).toContain('unexpected'); }
  });
  it('5xx인데 본문에 metaData가 없으면 서버 오류로 본다 (형식 오류로 오해하지 않게)', () => {
    expect(kindOf(() => parseTmapTransit(502, { whatever: true }))).toBe('transient');
  });
  it('plan은 있는데 경로가 0건이면 결과 없음', () => {
    expect(kindOf(() => parseTmapTransit(200, { metaData: { plan: { itineraries: [] } } }))).toBe('nodata');
  });
});

describe('대중교통 제공자 체인', () => {
  const names = buildAccessTimeSources({ ODSAY_KEY: 'o', TMAP_APP_KEY: 't' }, fetch)
    .filter(s => s.mode === 'transit').map(s => s.name);
  it('ODsay(무료)가 1차, TMAP(유료)이 예비', () => {
    expect(names).toEqual(['ODsay 대중교통', 'TMAP 대중교통']);
  });
  it('둘 다 시각대 배치(departuresOnly)에는 들어가지 않는다', () => {
    const dep = buildAccessTimeSources({ ODSAY_KEY: 'o', TMAP_APP_KEY: 't', KAKAO_REST_KEY: 'k' }, fetch, { departuresOnly: true });
    expect(dep.some(s => s.mode === 'transit')).toBe(false);
  });
});

describe('bandsForMode', () => {
  const transit = { realtime: true, departure: false };
  it('출발 시각을 반영하지 않는 수단은 any만 계획한다 (호출이 시각대 수만큼 늘지 않게)', () => {
    expect(bandsForMode(['weekday_am', 'weekday_pm', 'any'] as never, transit)).toEqual(['any']);
  });
  it('any 없이 시각대만 요청하면 그 수단은 아예 빠진다 — 호출 0건', () => {
    expect(bandsForMode(['weekday_am', 'weekday_pm'] as never, transit)).toEqual([]);
  });
  it('출발 시각을 반영하는 수단은 요청한 시각대를 그대로 쓴다', () => {
    expect(bandsForMode(['weekday_am', 'any'] as never, { realtime: true, departure: true })).toEqual(['weekday_am', 'any']);
  });
});
