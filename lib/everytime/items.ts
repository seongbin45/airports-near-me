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

/**
 * 두 AI가 같은 캡처를 읽은 결과를 대조한 표시 (CloneUp expiry_ocr의 두 엔진 일치 판정을 가져온 것)
 * both: 두 AI가 같게 읽음 · differ: 과목은 같고 시각이 다름(넓은 쪽으로 잡음) · one: 한 AI만 읽음 · single: AI가 하나뿐이라 대조 못 함
 */
export type Agreement = 'both' | 'differ' | 'one' | 'single';

export interface EtItem {
  agreement?: Agreement;
  /** differ일 때 두 AI의 읽기 ("09:00–10:15 / 09:05–10:15") */
  alt?: string;
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

/**
 * AI가 쓴 시각 문자열을 "HH:MM"으로 맞춘다. 프롬프트로 형식을 정해도 "9:00"·"9시 30분"·"0930"처럼 올 수 있다
 * (CloneUp이 OCR 결과에서 날짜를 여러 표기로 받아 준 방식). 알아볼 수 없으면 그대로 돌려 normalizeBlocks가 사유와 함께 뺀다.
 */
export function normTime(raw: string): string {
  const t = (raw ?? '').trim().replace(/\s+/g, '');
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(t) ?? /^(\d{1,2})시(?:(\d{1,2})분)?$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) return raw;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return raw;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const nameKey = (s: string) => s.replace(/[\s·.,:;()[\]\-_/]/g, '').toLowerCase();
const slotKey = (i: EtItem) => `${nameKey(i.name)}|${i.days.join('')}`;

/**
 * 두 AI의 읽기를 대조한다. 같은 과목(이름·요일)을 찾아
 *   시각까지 같으면 both, 시각이 다르면 differ — 시작은 이른 쪽, 종료는 늦은 쪽(안전한 쪽)으로 잡고 두 읽기를 alt에 남긴다,
 *   한쪽에만 있으면 one(지우지 않고 보여준다 — 한 AI가 놓쳤을 수도, 다른 AI가 지어냈을 수도 있다).
 * 두 번째 읽기가 없으면(AI 하나뿐) 모두 single.
 */
export function crossCheck(a: EtItem[], b: EtItem[] | null): EtItem[] {
  const timedA = a.filter(i => !i.online), onlineA = a.filter(i => i.online);
  if (!b) return [...timedA.map(i => ({ ...i, agreement: 'single' as const })), ...onlineA];

  const rest = b.filter(i => !i.online);
  const out: EtItem[] = [];
  for (const x of timedA) {
    const j = rest.findIndex(y => slotKey(y) === slotKey(x));
    if (j < 0) { out.push({ ...x, agreement: 'one' }); continue; }
    const [y] = rest.splice(j, 1);
    if (x.start === y.start && x.end === y.end) { out.push({ ...x, agreement: 'both' }); continue; }
    out.push({
      ...x,
      start: toMin(x.start) <= toMin(y.start) ? x.start : y.start,
      end: toMin(x.end) >= toMin(y.end) ? x.end : y.end,
      agreement: 'differ', alt: `${x.start}–${x.end} / ${y.start}–${y.end}`,
    });
  }
  out.push(...rest.map(y => ({ ...y, agreement: 'one' as const })));
  out.sort((x, y) => DAYS.indexOf(x.days[0]) - DAYS.indexOf(y.days[0]) || toMin(x.start) - toMin(y.start));

  const timedNames = new Set(out.map(i => nameKey(i.name)));
  const online = new Map<string, EtItem>();
  for (const i of [...onlineA, ...b.filter(i => i.online)]) {
    if (!timedNames.has(nameKey(i.name)) && !online.has(nameKey(i.name))) online.set(nameKey(i.name), i);
  }
  return [...out, ...online.values()];
}

/** 대조 결과 요약 (ai_calls 기록과 내 데이터 AI 기록 표시에 쓴다) */
export function agreementCounts(items: EtItem[]) {
  const n = (k: Agreement) => items.filter(i => i.agreement === k).length;
  return { both: n('both'), differ: n('differ'), one: n('one') };
}
