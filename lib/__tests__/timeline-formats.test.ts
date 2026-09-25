import { describe, expect, it } from 'vitest';
import {
  AIRPORT_RADIUS_KM, fromE7, inferTimelineTrips, localDate, parseAirportVisits, parseLatLng,
  parseTimelinePoints, summarizeTimeline, type AirportPoint,
} from '../data/timeline-import';

// 구글은 세 가지 형식을 내보낸다(휴대폰 / Takeout 시맨틱 / 섞인 배열). 실제 필드 이름과 좌표 표기를
// 그대로 넣어 파서가 어느 쪽에서도 동작하는지 고정한다.

const APTS: AirportPoint[] = [
  { code: 'GMP', name_ko: '김포국제공항', city: '서울', lat: 37.5583, lng: 126.7906 },
  { code: 'CJU', name_ko: '제주국제공항', city: '제주', lat: 33.5113, lng: 126.4930 },
  { code: 'PUS', name_ko: '김해국제공항', city: '부산', lat: 35.1795, lng: 128.9382 },
];

describe('parseLatLng / fromE7', () => {
  it('geo: 접두사, ° 기호, 소수점 문자열을 모두 받는다', () => {
    expect(parseLatLng('geo:37.558,126.790')).toEqual([37.558, 126.79]);
    expect(parseLatLng('37.558°, 126.790°')).toEqual([37.558, 126.79]);
    expect(parseLatLng('50.0506312, 14.3439906')).toEqual([50.0506312, 14.3439906]);
    expect(parseLatLng(' 33.511 , 126.493 ')).toEqual([33.511, 126.493]);
  });
  it('숫자가 아니거나 범위를 벗어나면 null', () => {
    expect(parseLatLng('제주')).toBeNull();
    expect(parseLatLng('200, 300')).toBeNull();
    expect(parseLatLng('37.5')).toBeNull();
  });
  it('E7 정수 좌표를 도로 바꾼다', () => {
    expect(fromE7(375583000, 1267906000)).toEqual([37.5583, 126.7906]);
    expect(fromE7(undefined, 126)).toBeNull();
    expect(fromE7(900000001, 0)).toBeNull();
  });
});

describe('localDate — 현지 날짜', () => {
  it('시각 문자열의 오프셋을 그대로 쓴다', () => {
    expect(localDate('2024-04-03T08:00:00.000+02:00')).toBe('2024-04-03');
  });
  it('UTC(Z)는 한국 시간으로 옮긴다 (문자열을 그냥 자르면 하루 어긋난다)', () => {
    expect(localDate('2026-09-20T08:10:00.000Z')).toBe('2026-09-20');
    expect(localDate('2026-09-20T20:10:00.000Z')).toBe('2026-09-21');
  });
  it('시간대 오프셋이 따로 있으면 그 값을 쓴다', () => {
    expect(localDate('2026-09-20T20:10:00.000Z', 120)).toBe('2026-09-20');
  });
  it('시각 형식이 아니면 null', () => {
    expect(localDate('어제')).toBeNull();
  });
});

describe('휴대폰 내보내기 (semanticSegments)', () => {
  const visit = (start: string, latLng: string, offsetMinutes = 540) => ({
    startTime: start, endTime: start, startTimeTimezoneUtcOffsetMinutes: offsetMinutes,
    visit: { hierarchyLevel: 0, probability: 0.85, topCandidate: { placeId: 'ChIJ', semanticType: 'UNKNOWN', probability: 0.45, placeLocation: { latLng } } },
  });

  it('방문의 latLng(° 기호 없는 문자열)을 읽는다', () => {
    const pts = parseTimelinePoints({ semanticSegments: [visit('2026-09-20T08:10:00.000+09:00', '37.5583, 126.7906')] });
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ date: '2026-09-20' });
    expect(pts[0].lat).toBeCloseTo(37.5583, 4);
  });
  it('UTC로 내보낸 파일도 현지 날짜가 하루 어긋나지 않는다', () => {
    const pts = parseTimelinePoints({ semanticSegments: [visit('2026-09-20T23:30:00.000Z', '37.5583, 126.7906', 540)] });
    expect(pts[0].date).toBe('2026-09-21'); // UTC 23:30 + 09:00 = 다음 날 08:30
  });
  it('이동 경로(timelinePath)와 이동 구간(activity)에서도 지점을 읽는다', () => {
    const pts = parseTimelinePoints({
      semanticSegments: [{
        startTime: '2026-09-20T08:00:00.000+09:00', endTime: '2026-09-20T10:30:00.000+09:00',
        timelinePath: [{ point: '37.5583, 126.7906', time: '2026-09-20T08:05:00.000+09:00' }],
        activity: { start: { latLng: '37.5583, 126.7906' }, end: { latLng: '33.5113, 126.4930' }, topCandidate: { type: 'IN_PASSENGER_VEHICLE' } },
      }],
    });
    expect(pts.map(p => `${p.date} ${p.lat}`)).toEqual(['2026-09-20 37.5583', '2026-09-20 37.5583', '2026-09-20 33.5113']);
  });
  it('같은 지점·시각이 겹쳐 오면 한 번만 센다', () => {
    const same = '37.5583, 126.7906';
    const pts = parseTimelinePoints({
      semanticSegments: [{
        startTime: '2026-09-20T08:00:00.000+09:00',
        timelinePath: [{ point: same, time: '2026-09-20T08:00:00.000+09:00' }],
        activity: { start: { latLng: same } },
      }],
    });
    expect(pts).toHaveLength(1);
  });
  it('주 후보에 좌표가 없으면 다른 후보를 쓴다', () => {
    const pts = parseTimelinePoints({
      semanticSegments: [{
        startTime: '2026-09-20T08:10:00.000+09:00',
        visit: { topCandidate: { placeLocation: {} }, otherCandidateLocations: [{ placeLocation: { latLng: '33.5113, 126.4930' } }] },
      }],
    });
    expect(pts[0].lat).toBeCloseTo(33.5113, 4);
  });
  it('정확도가 MAX_ACCURACY_M보다 나쁜 위치 신호는 버린다', () => {
    const signals = [
      { position: { LatLng: '37.5583, 126.7906', accuracyMeters: 18, timestamp: '2026-09-20T08:10:00.000+09:00' } },
      { position: { LatLng: '37.5583, 126.7906', accuracyMeters: 18000, timestamp: '2026-09-20T08:11:00.000+09:00' } },
    ];
    const pts = parseTimelinePoints({ rawSignals: signals });
    expect(pts).toHaveLength(1);
    expect(pts[0].at).toBe('2026-09-20T08:10:00.000+09:00');
  });
});

describe('Takeout 시맨틱 (timelineObjects, E7 좌표)', () => {
  it('placeVisit.location의 E7 정수를 읽는다', () => {
    const pts = parseTimelinePoints({
      timelineObjects: [{
        placeVisit: {
          location: { latitudeE7: 375583000, longitudeE7: 1267906000, placeId: 'ChIJ', name: '김포국제공항', semanticType: 'TYPE_AIRPORT' },
          duration: { startTimestamp: '2026-09-20T08:10:00.000+09:00', endTimestamp: '2026-09-20T09:40:00.000+09:00' },
        },
      }],
    });
    expect(pts).toHaveLength(1);
    expect(pts[0].lat).toBeCloseTo(37.5583, 4);
    expect(pts[0].date).toBe('2026-09-20');
  });
  it('activitySegment의 시작·끝을 읽는다', () => {
    const pts = parseTimelinePoints({
      timelineObjects: [{
        activitySegment: {
          startLocation: { latitudeE7: 375583000, longitudeE7: 1267906000 },
          endLocation: { latitudeE7: 335113000, longitudeE7: 1264930000 },
          duration: { startTimestamp: '2026-09-20T08:10:00.000+09:00', endTimestamp: '2026-09-20T09:30:00.000+09:00' },
        },
      }],
    });
    expect(pts.map(p => p.lat)).toEqual([expect.closeTo(37.5583, 4), expect.closeTo(33.5113, 4)]);
  });
  it('섞인 배열 변형도 같은 규칙으로 읽는다', () => {
    const pts = parseTimelinePoints([
      { startTime: '2026-09-20T08:10:00.000+09:00', visit: { topCandidate: { placeLocation: { latLng: '37.5583, 126.7906' } } } },
      { startTime: '2026-09-20T10:30:00.000+09:00', visit: { topCandidate: { placeLocation: { latLng: '33.5113, 126.4930' } } } },
    ]);
    expect(pts).toHaveLength(2);
  });
  it('어느 형식도 아니면 무엇을 올려야 하는지 알려준다', () => {
    expect(() => parseTimelinePoints({ foo: 1 })).toThrow('타임라인 형식');
  });
});

describe('Takeout 파일로 여정 추정', () => {
  const e7 = (lat: number, lng: number) => ({ latitudeE7: Math.round(lat * 1e7), longitudeE7: Math.round(lng * 1e7) });
  const visit = (at: string, lat: number, lng: number) => ({ placeVisit: { location: e7(lat, lng), duration: { startTimestamp: at } } });
  it('김포 → 제주 왕복을 한 건으로 묶는다', () => {
    const json = { timelineObjects: [
      visit('2026-09-20T08:10:00.000+09:00', 37.5583, 126.7906),
      visit('2026-09-20T10:30:00.000+09:00', 33.5113, 126.4930),
      visit('2026-09-23T19:00:00.000+09:00', 37.5583, 126.7906),
    ] };
    expect(inferTimelineTrips(parseAirportVisits(json, APTS), APTS))
      .toEqual([{ from_airport: 'GMP', dest_airport: 'CJU', dest_city: '제주', depart_on: '2026-09-20', return_on: '2026-09-23' }]);
  });
  it('요약은 방문 지점·공항 방문·기간을 준다', () => {
    const json = { timelineObjects: [
      visit('2026-09-20T08:10:00.000+09:00', 37.5583, 126.7906),
      visit('2026-09-20T10:30:00.000+09:00', 33.5113, 126.4930),
    ] };
    expect(summarizeTimeline(json, APTS)).toMatchObject({ places: 2, airportVisits: 2, from: '2026-09-20', to: '2026-09-20' });
  });
  it(`공항 판정 반경은 ${AIRPORT_RADIUS_KM}km`, () => {
    const justOutside = visit('2026-09-20T08:10:00.000+09:00', 37.5583 + 0.03, 126.7906); // 약 3.3km
    expect(parseAirportVisits({ timelineObjects: [justOutside] }, APTS)).toEqual([]);
  });
});
