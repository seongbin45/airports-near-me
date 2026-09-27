// 에브리타임 시간표를 가져온 결과(공유 링크 XML, 캡처 인식)를 수업 시간표 후보로 정리한다.
// 두 경로가 이 함수 하나를 거친다 — 어디서 왔든 같은 규칙으로 걸러야 미리보기가 같은 뜻을 가진다.
//
// 판단 기준은 .ics 가져오기(lib/data/ics.ts)와 같은 비대칭이다:
//   수업이 "빠지거나 일찍 끝나게" 잡히면 출발 가능 창이 넓어져 못 타는 항공편을 추천한다(피해).
// 그래서 시작은 5분 단위로 내리고 종료는 5분 단위로 올린다. 읽지 못한 것은 추측하지 않고 사유를 붙여 보여준다.
import { DAYS, type Day } from '../onboarding/validate';
import { toMin } from '../time';

/** 한 요일의 수업 블록 하나 (에브리타임은 요일마다 블록을 따로 둔다) */
export interface EtBlock { name: string; place: string; day: string; start: string; end: string }

export interface EtItem {
  name: string;
  place: string;
  days: Day[];
  start: string;
  end: string;
  /** 시간이 없는 과목(온라인 강의 등). 출발 시각 계산에 쓸 수 없어 고를 수 없다 */
  online: boolean;
  /** 사람이 원본과 시각을 대조해야 하는 값인가 (캡처 인식) */
  needsTimeCheck: boolean;
}

export interface EtSkip { name: string; reason: string }

export const EARLIEST = 6 * 60;
export const LATEST = 23 * 60 + 55;
const MIN_LEN = 20, MAX_LEN = 6 * 60;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isHhmm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** 5분 단위 안전 반올림: 시작은 내리고 종료는 올린다 (이미 5분 단위면 그대로) */
export function safeSnap(start: string, end: string): { start: string; end: string } {
  return { start: hhmm(Math.floor(toMin(start) / 5) * 5), end: hhmm(Math.min(Math.ceil(toMin(end) / 5) * 5, LATEST)) };
}

export function normalizeBlocks(
  blocks: EtBlock[], online: string[], opts: { needsTimeCheck: boolean },
): { items: EtItem[]; skipped: EtSkip[] } {
  const skipped: EtSkip[] = [];
  const merged = new Map<string, EtItem>();

  for (const b of blocks) {
    const name = (b.name ?? '').trim(), place = (b.place ?? '').trim(), day = (b.day ?? '').trim();
    const label = name || '(이름 없음)';
    if (!name) { skipped.push({ name: label, reason: '과목명이 없어요' }); continue; }
    if (day === '일') { skipped.push({ name, reason: '일요일 수업은 시간표에 넣을 수 없어요(월–토만). 그날은 일정으로 직접 넣어 주세요.' }); continue; }
    if (!(DAYS as readonly string[]).includes(day)) { skipped.push({ name, reason: `요일을 알 수 없어요(${day || '빈 값'})` }); continue; }
    if (!isHhmm(b.start) || !isHhmm(b.end)) { skipped.push({ name, reason: `시각 형식이 맞지 않아요(${b.start}–${b.end})` }); continue; }
    const t = safeSnap(b.start, b.end);
    const a = toMin(t.start), z = toMin(t.end);
    if (z <= a) { skipped.push({ name, reason: `끝나는 시각이 시작보다 빨라요(${b.start}–${b.end})` }); continue; }
    if (a < EARLIEST || z > LATEST) { skipped.push({ name, reason: `06:00–23:55 밖의 시각이에요(${b.start}–${b.end})` }); continue; }
    if (z - a < MIN_LEN || z - a > MAX_LEN) { skipped.push({ name, reason: `수업 길이가 이상해요(${b.start}–${b.end})` }); continue; }

    const key = [name, place, t.start, t.end].join('|');
    const cur = merged.get(key);
    if (cur) { if (!cur.days.includes(day as Day)) cur.days.push(day as Day); }
    else merged.set(key, { name, place, days: [day as Day], start: t.start, end: t.end, online: false, needsTimeCheck: opts.needsTimeCheck });
  }

  const items = [...merged.values()].map(i => ({ ...i, days: DAYS.filter(d => i.days.includes(d)) }));
  items.sort((x, y) => DAYS.indexOf(x.days[0]) - DAYS.indexOf(y.days[0]) || toMin(x.start) - toMin(y.start));

  // 시간이 있는 블록이 하나라도 있으면 그 과목은 온라인 목록에서 뺀다 (같은 과목이 두 번 나오지 않게)
  const timed = new Set(items.map(i => i.name));
  const onlineNames = [...new Set(online.map(n => n.trim()).filter(Boolean))].filter(n => !timed.has(n));
  for (const name of onlineNames) {
    items.push({ name, place: '', days: [], start: '', end: '', online: true, needsTimeCheck: false });
  }
  return { items, skipped };
}
