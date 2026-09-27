import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { insertedId, existingClassNote, existingEvent, parseIcs, type IcsResult } from '../data/ics';

// 픽스처는 실제 내보내기 파일이 아니다 — RFC 5545와 구글 캘린더 내보내기의 알려진 형태(PRODID·VTIMEZONE·VALARM·
// RECURRENCE-ID)를 본떠 만든 것이다. 실제 파일을 받으면 개인정보를 지우고 fixtures/에 더한다.
const TODAY = '2026-09-27';
const fixture = readFileSync(join(__dirname, 'fixtures', 'semester.ics'), 'utf8');

const ok = (r: IcsResult) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const cal = (...body: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...body, 'END:VCALENDAR'].join('\r\n');
const ev = (...props: string[]) => ['BEGIN:VEVENT', ...props, 'END:VEVENT'].join('\r\n');
const parse = (text: string, extra = {}) => ok(parseIcs(text, { today: TODAY, ...extra }));

describe('parseIcs — 학기 시간표 픽스처', () => {
  const r = parse(fixture);

  it('주간 반복은 수업 후보가 되고, 장소의 이스케이프·접힌 줄을 푼다', () => {
    expect(r.classes).toEqual([
      { name: '운영체제', place: '공학관 301, 2층', days: ['월', '수'], start: '09:00', end: '10:15', cancelled: ['2026-10-05'] },
      { name: '데이터베이스 설계 및 구현 (분반 02)', place: '', days: ['목'], start: '10:30', end: '11:45', cancelled: [] },
    ]);
  });
  it('VALARM 안의 DURATION(알람 5분)을 수업 길이로 읽지 않는다', () => {
    expect(r.classes[0].end).toBe('10:15');
  });
  it('VTIMEZONE 안의 DTSTART·RRULE(시간대 정의)는 후보가 되지 않는다', () => {
    expect(r.classes).toHaveLength(2);
    expect(r.skipped).toEqual([]);
  });
  it('BYDAY 없는 FREQ=WEEKLY는 DTSTART의 요일(2026-09-03 목)을 쓴다', () => {
    expect(r.classes[1].days).toEqual(['목']);
  });
  it('EXDATE는 오늘 이후 것만 취소 회차로 남긴다 (패턴은 그대로 — 많게 잡는 쪽이 안전)', () => {
    expect(r.classes[0].cancelled).toEqual(['2026-10-05']);
  });
  it('옮겨진 회차(RECURRENCE-ID)는 원 패턴을 두고 일회성 수업 일정으로 더한다', () => {
    expect(r.events).toContainEqual({ kind: '수업', date: '2026-10-14', allDay: false, start: '13:00', end: '14:15', description: '운영체제', moved: true });
  });
  it('종일 일정은 시작 날짜만 쓴다 (DTEND는 배타적 — 10/9 하루짜리의 DTEND가 10/10)', () => {
    const allDay = r.events.filter(e => e.allDay);
    expect(allDay).toEqual([{ kind: '기타', date: '2026-10-09', allDay: true, start: '', end: '', description: '한글날', moved: false }]);
  });
  it('UTC(Z) 시각은 한국 시각으로 바꾼다 — 06:00Z → 15:00', () => {
    expect(r.events).toContainEqual({ kind: '기타', date: '2026-10-20', allDay: false, start: '15:00', end: '16:30', description: '운영체제 중간고사', moved: false });
  });
});

describe('parseIcs — 시각', () => {
  it('Z 변환은 날짜·요일까지 바꾼다: 월 16:00Z = 화 01:00 KST', () => {
    const r = parse(cal(ev('DTSTART:20261005T160000Z', 'DTEND:20261005T170000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:새벽 세미나')));
    expect(r.classes[0]).toMatchObject({ days: ['화'], start: '01:00', end: '02:00' });
    const once = parse(cal(ev('DTSTART:20261005T160000Z', 'DTEND:20261005T170000Z', 'SUMMARY:회의')));
    expect(once.events[0]).toMatchObject({ date: '2026-10-06', start: '01:00' });
  });
  it('5분 단위로 맞출 때 시작은 이르게, 끝은 늦게만 (09:03–10:17 → 09:00–10:20)', () => {
    const r = parse(cal(ev('DTSTART;TZID=Asia/Seoul:20261001T090300', 'DTEND;TZID=Asia/Seoul:20261001T101700', 'SUMMARY:실험')));
    expect(r.events[0]).toMatchObject({ start: '09:00', end: '10:20' });
  });
  it('모르는 시간대는 추측하지 않고 사유를 남긴다', () => {
    const r = parse(cal(ev('DTSTART;TZID=America/New_York:20261001T090000', 'DTEND;TZID=America/New_York:20261001T100000', 'SUMMARY:뉴욕')));
    expect(r.events).toEqual([]);
    expect(r.skipped[0].reason).toContain('시간대 확인 필요');
  });
  it('자정을 넘기거나 끝이 시작보다 이르면 건너뛴다', () => {
    const r = parse(cal(
      ev('DTSTART:20261001T230000', 'DTEND:20261002T010000', 'SUMMARY:밤샘'),
      ev('DTSTART:20261001T100000', 'DTEND:20261001T090000', 'SUMMARY:거꾸로'),
    ));
    expect(r.events).toEqual([]);
    expect(r.skipped.map(s => s.summary)).toEqual(['밤샘', '거꾸로']);
  });
  it('DTEND와 DURATION이 함께 있으면 DTEND를 쓴다', () => {
    const r = parse(cal(ev('DTSTART:20261001T090000', 'DTEND:20261001T100000', 'DURATION:PT5M', 'SUMMARY:x')));
    expect(r.events[0].end).toBe('10:00');
  });
});

describe('parseIcs — 반복 규칙', () => {
  const weekly = (rrule: string, summary = '수업') => cal(ev('DTSTART:20260901T090000', 'DTEND:20260901T100000', `RRULE:${rrule}`, `SUMMARY:${summary}`));

  it('격주(INTERVAL=2)는 주간으로 접지 않고 건너뛴다 (없는 주에 수업을 만들지 않게)', () => {
    const r = parse(weekly('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'));
    expect(r.classes).toEqual([]);
    expect(r.skipped[0].reason).toContain('격주');
    expect(parse(weekly('FREQ=WEEKLY;INTERVAL=1;BYDAY=TU')).classes).toHaveLength(1);
  });
  it('매일·매월 반복은 사유와 함께 건너뛴다', () => {
    expect(parse(weekly('FREQ=DAILY')).skipped[0].reason).toContain('DAILY');
  });
  it('UNTIL이 지났으면 건너뛰고, UTC UNTIL은 KST로 바꿔 비교한다', () => {
    expect(parse(weekly('FREQ=WEEKLY;UNTIL=20260920T145959Z')).skipped[0].reason).toContain('끝난');
    // 09-26T15:00Z = 09-27 00:00 KST → 오늘(09-27) 회차가 남아 있다
    expect(parse(weekly('FREQ=WEEKLY;UNTIL=20260926T150000Z')).classes).toHaveLength(1);
    // 09-26T14:59Z = 09-26 23:59 KST → 끝났다 (UTC 날짜 그대로 비교하면 같은 결과지만, 경계를 고정해 둔다)
    expect(parse(weekly('FREQ=WEEKLY;UNTIL=20260926T145900Z')).classes).toHaveLength(0);
  });
  it('COUNT로 이미 끝난 반복은 건너뛴다', () => {
    expect(parse(weekly('FREQ=WEEKLY;COUNT=2;BYDAY=TU')).classes).toEqual([]);
    expect(parse(weekly('FREQ=WEEKLY;COUNT=16;BYDAY=TU')).classes).toHaveLength(1);
  });
  it('끝이 없는 반복(UNTIL·COUNT 없음)은 주간 패턴으로 가져온다', () => {
    expect(parse(weekly('FREQ=WEEKLY;BYDAY=TU,TH')).classes[0].days).toEqual(['화', '목']);
  });
  it('일요일은 담을 수 없다 — 일요일만이면 건너뛰고, 섞여 있으면 나머지만 가져오며 알린다', () => {
    const only = parse(weekly('FREQ=WEEKLY;BYDAY=SU'));
    expect(only.classes).toEqual([]);
    expect(only.skipped[0].reason).toContain('일요일');
    const mixed = parse(weekly('FREQ=WEEKLY;BYDAY=SA,SU'));
    expect(mixed.classes[0].days).toEqual(['토']);
    expect(mixed.skipped[0].reason).toContain('일요일');
  });
  it('취소된 일정(STATUS:CANCELLED)은 건너뛴다', () => {
    const r = parse(cal(ev('DTSTART:20261001T090000', 'DTEND:20261001T100000', 'STATUS:CANCELLED', 'SUMMARY:휴강')));
    expect(r.events).toEqual([]);
    expect(r.skipped[0].reason).toContain('취소');
  });
  it('같은 과목·시간의 반복 여러 개는 요일을 합친다', () => {
    const r = parse(cal(
      ev('DTSTART:20260901T090000', 'DTEND:20260901T100000', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'SUMMARY:영어', 'UID:a'),
      ev('DTSTART:20260903T090000', 'DTEND:20260903T100000', 'RRULE:FREQ=WEEKLY;BYDAY=TH', 'SUMMARY:영어', 'UID:b'),
    ));
    expect(r.classes).toHaveLength(1);
    expect(r.classes[0].days).toEqual(['화', '목']);
  });
  it('원 반복과 옮겨진 회차는 UID를 공유한다 — UID+RECURRENCE-ID로 한 번만 더한다', () => {
    const moved = ev('DTSTART:20261014T130000', 'DTEND:20261014T140000', 'RECURRENCE-ID:20261013T090000', 'UID:u', 'SUMMARY:영어');
    const r = parse(cal(ev('DTSTART:20260901T090000', 'DTEND:20260901T100000', 'RRULE:FREQ=WEEKLY;BYDAY=TU', 'UID:u', 'SUMMARY:영어'), moved, moved));
    expect(r.classes).toHaveLength(1);
    expect(r.events).toEqual([{ kind: '수업', date: '2026-10-14', allDay: false, start: '13:00', end: '14:00', description: '영어', moved: true }]);
  });
});

describe('parseIcs — 파일·상한', () => {
  it('BOM이 있어도 읽는다', () => {
    expect(parse('﻿' + fixture).classes).toHaveLength(2);
  });
  it('캘린더 파일이 아니면 파일 단위로 거부한다 (후보 0건 + 사유 수십 개가 되지 않게)', () => {
    const r = parseIcs('이름,요일\n운영체제,월', { today: TODAY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('인코딩');
  });
  it('LF 줄바꿈도 읽는다', () => {
    expect(parse(fixture.replace(/\r\n/g, '\n')).classes).toHaveLength(2);
  });
  it('일정 상한은 일정에만 — 파일 끝의 수업은 잘리지 않는다', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`DTSTART:202610${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}0000`, `DTEND:202610${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}3000`, `SUMMARY:일정${i}`));
    const r = parse(cal(...many, ev('DTSTART:20260901T090000', 'DTEND:20260901T100000', 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'SUMMARY:마지막 수업')), { maxEvents: 10 });
    expect(r.events).toHaveLength(10);
    expect(r.classes.map(c => c.name)).toEqual(['마지막 수업']);
    expect(r.notices.join()).toContain('상한');
  });
  it('수업 후보가 비정상적으로 많으면 파일 전체를 받지 않는다', () => {
    const many = Array.from({ length: 5 }, (_, i) => ev('DTSTART:20260901T090000', 'DTEND:20260901T100000', 'RRULE:FREQ=WEEKLY', `SUMMARY:과목${i}`));
    const r = parseIcs(cal(...many), { today: TODAY, maxClasses: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('일정도 함께');
  });
  it('기간 밖(지난·너무 먼) 일정은 개수만 알린다', () => {
    const r = parse(cal(ev('DTSTART:20260101T090000', 'DTEND:20260101T100000', 'SUMMARY:옛날'), ev('DTSTART:20280101T090000', 'DTEND:20280101T100000', 'SUMMARY:먼 미래')));
    expect(r.events).toEqual([]);
    expect(r.notices.join()).toContain('2건');
  });
  it('설명이 빈 일정도 후보로 남긴다 (화면에서 채워야 추가할 수 있다)', () => {
    const r = parse(cal(ev('DTSTART:20261001T090000', 'DTEND:20261001T100000')));
    expect(r.events[0].description).toBe('');
  });
});

describe('이미 있는 것과 비교', () => {
  const classes = [{ name: '운영체제', days: ['월', '수'], start: '09:00' }];
  it('같은 이름·요일·시작이면 이미 있음, 시간만 바뀌었으면 같은 이름 경고', () => {
    expect(existingClassNote({ name: '운영체제', days: ['월'], start: '09:00' }, classes)).toBe('이미 시간표에 있어요');
    expect(existingClassNote({ name: '운영체제', days: ['수'], start: '10:30' }, classes)).toBe('같은 이름의 수업이 이미 있어요');
    expect(existingClassNote({ name: '운영체제', days: ['금'], start: '09:00' }, classes)).toBeNull();
  });
  it('일정은 날짜+시작+설명이 같으면 이미 있음', () => {
    const events = [{ date: '2026-10-20', start: '15:00', description: '운영체제 중간고사' }];
    expect(existingEvent({ date: '2026-10-20', start: '15:00', description: '운영체제 중간고사' }, events)).toBe(true);
    expect(existingEvent({ date: '2026-10-20', start: '16:00', description: '운영체제 중간고사' }, events)).toBe(false);
  });
});

// 저장은 성공했는데 insert().select('id') 응답이 null인 경우 — 여기서 크래시하면 저장된 행이 화면에 안 보인다.
describe('insertedId', () => {
  it('정상 응답이면 그 행의 id', () => {
    expect(insertedId([{ id: 7 }, { id: 8 }], 1)).toBe(8);
  });
  it('data가 null·undefined면 -1 (크래시 대신)', () => {
    expect(insertedId(null, 0)).toBe(-1);
    expect(insertedId(undefined, 3)).toBe(-1);
  });
  it('응답이 요청보다 짧아도 -1', () => {
    expect(insertedId([{ id: 7 }], 2)).toBe(-1);
  });
  it('id 0을 -1로 뭉개지 않는다', () => {
    expect(insertedId([{ id: 0 }], 0)).toBe(0);
  });
});
