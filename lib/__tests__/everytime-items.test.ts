import { describe, expect, it } from 'vitest';
import { normalizeBlocks, safeSnap } from '../everytime/items';

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
