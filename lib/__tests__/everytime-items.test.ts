import { describe, expect, it } from 'vitest';
import { agreementCounts, crossCheck, markCutOff, normalizeBlocks, normTime, safeSnap, type EtItem } from '../everytime/items';

// 에브리타임 가져오기의 공통 정리 규칙. 수업이 빠지거나 일찍 끝나게 잡히면 못 타는 편을 추천하므로
// 시각은 안전한 쪽으로만 움직이고, 읽지 못한 블록은 사유와 함께 남긴다.

const b = (name: string, day: string, start: string, end: string, place = '') => ({ name, place, day, start, end });

describe('safeSnap — 5분 단위 안전 반올림', () => {
  it('시작은 내리고 종료는 올린다', () => {
    expect(safeSnap('09:03', '10:12')).toEqual({ start: '09:00', end: '10:15' });
  });
  it('이미 5분 단위면 그대로', () => {
    expect(safeSnap('13:05', '14:20')).toEqual({ start: '13:05', end: '14:20' });
  });
});

describe('normalizeBlocks', () => {
  it('같은 과목·장소·시각의 블록은 요일을 합친다 (월·수)', () => {
    const { items, skipped } = normalizeBlocks(
      [b('운영체제', '수', '09:00', '10:15', '공학관 301'), b('운영체제', '월', '09:00', '10:15', '공학관 301')], [], { needsTimeCheck: false });
    expect(skipped).toEqual([]);
    expect(items).toEqual([{ name: '운영체제', place: '공학관 301', days: ['월', '수'], start: '09:00', end: '10:15', online: false, needsTimeCheck: false }]);
  });

  it('시각이 다르면 따로 둔다', () => {
    const { items } = normalizeBlocks([b('영어', '월', '09:00', '10:00'), b('영어', '수', '11:00', '12:00')], [], { needsTimeCheck: false });
    expect(items.map(i => `${i.days.join('')} ${i.start}`)).toEqual(['월 09:00', '수 11:00']);
  });

  it('일요일·알 수 없는 요일·형식 오류·역순·범위 밖·이상한 길이는 사유와 함께 뺀다', () => {
    const { items, skipped } = normalizeBlocks([
      b('일요특강', '일', '10:00', '12:00'),
      b('이상한요일', 'Mon', '10:00', '12:00'),
      b('형식', '월', '9시', '10:00'),
      b('역순', '월', '12:00', '10:00'),
      b('새벽', '화', '05:00', '06:30'),
      b('짧음', '수', '10:00', '10:10'),
      b('김', '목', '09:00', '16:00'),
      b('', '금', '10:00', '11:00'),
    ], [], { needsTimeCheck: true });
    expect(items).toEqual([]);
    expect(skipped.map(s => s.name)).toEqual(['일요특강', '이상한요일', '형식', '역순', '새벽', '짧음', '김', '(이름 없음)']);
    expect(skipped[0].reason).toContain('일요일');
  });

  it('온라인 강의는 시간 없이 고를 수 없는 항목으로, 시간이 있는 과목과 겹치면 빼고, 중복은 한 번만', () => {
    const { items } = normalizeBlocks([b('캡스톤', '금', '10:30', '12:45')], ['미술의 이해', '미술의 이해', '캡스톤', ' '], { needsTimeCheck: false });
    expect(items.map(i => [i.name, i.online])).toEqual([['캡스톤', false], ['미술의 이해', true]]);
  });

  it('캡처 인식 결과에는 시각 확인 표시를 붙인다', () => {
    const { items } = normalizeBlocks([b('DB', '화', '13:02', '14:13')], [], { needsTimeCheck: true });
    expect(items[0]).toMatchObject({ start: '13:00', end: '14:15', needsTimeCheck: true });
  });

  it('요일 → 시작 시각 순으로 정렬한다', () => {
    const { items } = normalizeBlocks([b('B', '화', '09:00', '10:00'), b('A', '월', '13:00', '14:00'), b('C', '월', '09:00', '10:00')], [], { needsTimeCheck: false });
    expect(items.map(i => i.name)).toEqual(['C', 'A', 'B']);
  });
});

// CloneUp(app/util/expiry_ocr.py)에서 가져온 두 가지: 여러 표기를 받아 주는 정규화, 두 엔진 대조.

describe('normTime — AI가 쓴 여러 시각 표기', () => {
  it.each([['9:00', '09:00'], ['09:00', '09:00'], ['9.30', '09:30'], ['9시', '09:00'], ['9시 30분', '09:30'], ['0930', '09:30'], [' 13:05 ', '13:05']])('%s → %s', (a, b) => {
    expect(normTime(a)).toBe(b);
  });
  it('알아볼 수 없거나 범위 밖이면 그대로 둔다 (normalizeBlocks가 사유와 함께 뺀다)', () => {
    expect(normTime('오전')).toBe('오전');
    expect(normTime('25:00')).toBe('25:00');
  });
});

describe('crossCheck — 두 AI의 읽기 대조', () => {
  const it_ = (name: string, days: EtItem['days'], start: string, end: string, online = false): EtItem =>
    ({ name, place: '', days, start, end, online, needsTimeCheck: true });

  it('같으면 both, 시각이 다르면 넓은 쪽(시작 이른·종료 늦은)으로 differ, 한쪽만 있으면 one', () => {
    const a = [it_('운영체제', ['월', '수'], '09:00', '10:15'), it_('데이터베이스', ['화'], '13:00', '14:15'), it_('헛것', ['금'], '10:00', '11:00')];
    const b = [it_('운영 체제', ['월', '수'], '09:00', '10:15'), it_('데이터베이스', ['화'], '13:05', '14:30'), it_('영어', ['목'], '15:00', '16:00')];
    const r = crossCheck(a, b);
    expect(r.map(i => [i.name, i.agreement, i.start, i.end])).toEqual([
      ['운영체제', 'both', '09:00', '10:15'],
      ['데이터베이스', 'differ', '13:00', '14:30'],
      ['영어', 'one', '15:00', '16:00'],
      ['헛것', 'one', '10:00', '11:00'],
    ]);
    expect(r[1].alt).toBe('13:00–14:15 / 13:05–14:30');
    expect(agreementCounts(r)).toEqual({ both: 1, differ: 1, one: 2 });
  });

  it('두 번째 읽기가 없으면 single, 온라인 강의는 한 번만', () => {
    const r = crossCheck([it_('A', ['월'], '09:00', '10:00'), it_('온라인', [], '', '', true)], null);
    expect(r.map(i => [i.name, i.agreement])).toEqual([['A', 'single'], ['온라인', undefined]]);
    const r2 = crossCheck([it_('온라인', [], '', '', true)], [it_('온라인', [], '', '', true), it_('A', ['월'], '09:00', '10:00')]);
    expect(r2.filter(i => i.online)).toHaveLength(1);
  });
});

// 실제 캡처(2026-09-27)에서: 목 16:10 수업의 아래가 캡처 밖으로 잘렸는데 AI가 화면 끝 시각 17:00을 종료로 적었다.
// 종료가 실제보다 이르면 출발 가능 창이 넓어진다(피해 방향) — 끝을 모르는 채로 두고 사용자가 채우게 한다.
describe('markCutOff — 캡처 아래에서 잘린 블록', () => {
  const blk = (end: string, cut_off = false) => ({ name: '생명과학의이해', place: '인문관-11', day: '목', start: '16:10', end, cut_off });

  it('AI가 cut_off를 켜지 않아도 종료가 화면 끝 시각이면 잘린 것으로 본다', () => {
    expect(markCutOff([blk('17:00')], '17:00')[0]).toMatchObject({ end: '', cutOff: true });
    expect(markCutOff([blk('16:55')], '17:00')[0]).toMatchObject({ end: '', cutOff: true });
  });

  it('AI가 cut_off를 켜면 그대로 따른다, 화면 끝보다 충분히 이르면 그대로 둔다', () => {
    expect(markCutOff([blk('17:00', true)], null)[0]).toMatchObject({ cutOff: true });
    expect(markCutOff([blk('16:00')], '17:00')[0]).toEqual({ name: '생명과학의이해', place: '인문관-11', day: '목', start: '16:10', end: '16:00' });
  });

  it('잘린 블록은 빼지 않고 끝 모름(endUnknown)으로 남긴다', () => {
    const { items, skipped } = normalizeBlocks(markCutOff([blk('17:00')], '17:00'), [], { needsTimeCheck: true });
    expect(skipped).toEqual([]);
    expect(items[0]).toMatchObject({ days: ['목'], start: '16:10', end: '', endUnknown: true, needsTimeCheck: true });
  });

  it('대조: 한쪽이라도 끝을 모르면 끝은 비워 둔다 (한 AI가 17:00을 지어내도 쓰지 않는다)', () => {
    const known: EtItem = { name: '생명과학의이해', place: '', days: ['목'], start: '16:10', end: '17:00', online: false, needsTimeCheck: true };
    const cut: EtItem = { ...known, end: '', endUnknown: true };
    expect(crossCheck([known], [cut])[0]).toMatchObject({ end: '', endUnknown: true, agreement: 'both' });
  });
});
