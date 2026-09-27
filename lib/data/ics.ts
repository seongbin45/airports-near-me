// .ics(iCalendar, RFC 5545) 파일에서 수업 시간표·일정 후보를 뽑는다. 브라우저에서 돌고 파일은 서버로 보내지 않는다.
// 필요한 부분만 읽는 작은 파서다 — 모르는 형식은 추측하지 않고 사유를 붙여 건너뛴다.
//
// 이 기능의 판단 기준은 하나의 비대칭이다:
//   수업이 실제보다 "많게" 잡히면 출발 가능 창이 좁아진다 → 가능한 항공편이 줄 뿐 (안전)
//   수업이 "빠지거나" 일찍 끝난다고 잡히면 창이 넓어진다 → 못 타는 항공편을 추천한다 (피해)
// 그래서 종료 시각은 늦은 쪽으로만 반올림하고, 수업 후보는 상한으로 자르지 않는다.
import { DAYS, type Day, type EventKind } from '../onboarding/validate';

export interface IcsClass {
  name: string;
  place: string;
  days: Day[];
  start: string;
  end: string;
  /** 오늘 이후의 취소된 회차(EXDATE). 주간 시간표에는 담을 수 없어 사용자에게 알린다. */
  cancelled: string[];
}

export interface IcsEvent {
  kind: EventKind;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  description: string;
  /** 반복 수업의 옮겨진 회차(RECURRENCE-ID)에서 왔는지 */
  moved: boolean;
}

export interface IcsSkip {
  summary: string;
  reason: string;
}

export type IcsResult =
  | { ok: true; classes: IcsClass[]; events: IcsEvent[]; skipped: IcsSkip[]; notices: string[] }
  | { ok: false; error: string };

export interface IcsOptions {
  /** KST 기준 오늘 "YYYY-MM-DD" */
  today: string;
  /** 일회성 일정을 가져올 기간(일) */
  horizonDays?: number;
  maxEvents?: number;
  maxClasses?: number;
}

export const ICS_MAX_BYTES = 1024 * 1024;

// ── 줄 단위 ────────────────────────────────────────────────

interface Prop { name: string; params: Record<string, string>; value: string }

/** 줄 접기(RFC 5545 3.1: CRLF 뒤 공백·탭은 이어지는 줄)를 풀고 속성으로 나눈다 */
function contentLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter(l => l.trim() !== '');
}

function parseLine(line: string): Prop | null {
  // 값 앞의 첫 ':' (따옴표 안의 ':'는 매개변수 값이다 — 예: TZID="…:…")
  let q = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === ':' && !q) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let q = false, cur = '';
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** TEXT 값의 이스케이프(\\ \; \, \n) */
function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
}

// ── 시각 ───────────────────────────────────────────────────

/** 한국 벽시계 시각. 날짜와 자정 기준 분. */
interface Wall { date: string; min: number; allDay: boolean }

const KST_TZIDS = new Set(['Asia/Seoul', 'Korea Standard Time', 'ROK']);
const UTC_TZIDS = new Set(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z']);

class TzError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * DATE / DATE-TIME 값을 한국 벽시계로 바꾼다.
 * - `…Z`(UTC)와 UTC 계열 TZID: **전체 타임스탬프**에 +9시간 — 날짜·요일도 바뀐다 (16:00Z → 다음 날 01:00)
 * - TZID=Asia/Seoul: 그대로
 * - TZID 없는 floating 시각: 벽시계 시각 그대로 한국 시각으로 본다 (기기 시간대로 옮기지 않는다 — 해외에서 열어도 같은 값)
 * - 그 밖의 TZID: 추측하지 않고 TzError
 */
function toWall(p: Prop): Wall {
  const v = p.value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d || p.params.VALUE === 'DATE') {
    if (!d) throw new TzError(`날짜 형식을 읽을 수 없어요 (${v})`);
    return { date: isoDate(+d[1], +d[2], +d[3]), min: 0, allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) throw new TzError(`시각 형식을 읽을 수 없어요 (${v})`);
  const [y, mo, da, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const tzid = p.params.TZID;
  if (m[7] === 'Z' || (tzid && UTC_TZIDS.has(tzid))) {
    const k = new Date(Date.UTC(y, mo - 1, da, h, mi) + 9 * 3600_000);
    return { date: isoDate(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate()), min: k.getUTCHours() * 60 + k.getUTCMinutes(), allDay: false };
  }
  if (tzid && !KST_TZIDS.has(tzid)) throw new TzError(`시간대 확인 필요 (${tzid}) — 한국 시간 일정만 가져와요`);
  return { date: isoDate(y, mo, da), min: h * 60 + mi, allDay: false };
}

const dayIndex = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=일
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** DURATION: PT#H#M(#S) · P#D · P#W 만. 그 밖은 null */
function durationMin(v: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === 'P' || v.trim().endsWith('T')) return null;
  const [w, d, h, mi, s] = m.slice(1).map(x => Number(x ?? 0));
  return w * 7 * 1440 + d * 1440 + h * 60 + mi + Math.ceil(s / 60);
}

// ── VEVENT 수집 ───────────────────────────────────────────

interface RawEvent { props: Map<string, Prop>; exdates: Prop[] }

/**
 * BEGIN/END 스택을 따라가며 VEVENT의 **직계** 속성만 모은다.
 * VEVENT 안 VALARM의 DURATION(알람 길이)이나 VTIMEZONE 안 STANDARD/DAYLIGHT의 DTSTART·RRULE(시간대 정의)을
 * 일정으로 읽지 않기 위해서다.
 */
function collectEvents(lines: string[]): RawEvent[] {
  const stack: string[] = [];
  const events: RawEvent[] = [];
  let cur: RawEvent | null = null;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const kind = p.value.trim().toUpperCase();
      stack.push(kind);
      if (kind === 'VEVENT') cur = { props: new Map(), exdates: [] };
      continue;
    }
    if (p.name === 'END') {
      const kind = stack.pop();
      if (kind === 'VEVENT' && cur) { events.push(cur); cur = null; }
      continue;
    }
    if (stack[stack.length - 1] !== 'VEVENT' || !cur) continue;
    if (p.name === 'EXDATE') cur.exdates.push(p);
    else if (!cur.props.has(p.name)) cur.props.set(p.name, p);
  }
  return events;
}

// ── RRULE ──────────────────────────────────────────────────

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

// ── 본체 ──────────────────────────────────────────────────

export function parseIcs(raw: string, opts: IcsOptions): IcsResult {
  const { today, horizonDays = 120, maxEvents = 500, maxClasses = 100 } = opts;
  // BOM이 있으면 첫 줄이 "﻿BEGIN:VCALENDAR"가 되어 형식 확인이 어긋난다
  const text = raw.replace(/^﻿/, '');
  const lines = contentLines(text);
  if (lines[0]?.trim().toUpperCase() !== 'BEGIN:VCALENDAR') {
    // 다른 인코딩(UTF-16·CP949)도 여기서 걸린다 — 후보 0건 + 알 수 없는 사유 수십 개가 되지 않게 파일 단위로 거부
    return { ok: false, error: '캘린더(.ics) 파일이 아니거나 인코딩이 달라요. 캘린더 앱에서 내보낸 .ics 파일을 그대로 올려 주세요.' };
  }

  const raws = collectEvents(lines);
  const skipped: IcsSkip[] = [];
  const notices: string[] = [];
  const horizonEnd = addDays(today, horizonDays);
  const classMap = new Map<string, IcsClass>();
  const classUids = new Set<string>();
  const events: IcsEvent[] = [];
  const seenOverride = new Set<string>();
  const moved: { uid: string; ev: IcsEvent }[] = [];
  let outOfWindow = 0;

  for (const r of raws) {
    const get = (n: string) => r.props.get(n);
    const summary = get('SUMMARY') ? unescapeText(get('SUMMARY')!.value) : '';
    const label = summary || '(제목 없음)';
    const skip = (reason: string) => skipped.push({ summary: label, reason });
    const uid = get('UID')?.value.trim() ?? '';

    if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') { skip('취소된 일정이에요'); continue; }
    const dtstart = get('DTSTART');
    if (!dtstart) { skip('시작 시각이 없어요'); continue; }

    let start: Wall, end: Wall | null = null;
    try {
      start = toWall(dtstart);
      // DTEND와 DURATION이 함께 있으면(RFC상 무효) DTEND를 쓴다
      const dtend = get('DTEND');
      if (dtend) end = toWall(dtend);
      else if (get('DURATION')) {
        const dm = durationMin(get('DURATION')!.value);
        if (dm === null) { skip(`길이(DURATION) 형식을 읽을 수 없어요 (${get('DURATION')!.value})`); continue; }
        if (!start.allDay) {
          const t = start.min + dm;
          end = { date: addDays(start.date, Math.floor(t / 1440)), min: t % 1440, allDay: false };
        }
      }
    } catch (e) {
      skip(e instanceof TzError ? e.message : '시각을 읽을 수 없어요');
      continue;
    }

    const rrule = get('RRULE');
    const recurrenceId = get('RECURRENCE-ID');

    // 종일 일정: 시작 날짜만 저장한다. (VALUE=DATE의 DTEND는 배타적 — 10/1 하루짜리의 DTEND는 10/2.
    // 여기서는 종료 날짜를 쓰지 않으므로 손해가 없다. 기간을 계산하게 되면 반드시 DTEND − 1일.)
    if (start.allDay) {
      if (rrule) { skip('종일 반복 일정은 주간 시간표에 담을 수 없어요'); continue; }
      if (start.date < today || start.date >= horizonEnd) { outOfWindow++; continue; }
      events.push({ kind: '기타', date: start.date, allDay: true, start: '', end: '', description: summary, moved: false });
      continue;
    }

    if (!end) { skip('끝나는 시각이 없어요'); continue; }
    if (end.date !== start.date) { skip('자정을 넘기는 일정은 담을 수 없어요'); continue; }
    if (end.min <= start.min) { skip('끝나는 시각이 시작보다 늦지 않아요'); continue; }
    // 5분 단위(우리 입력 단위)로 맞출 때 시작은 이르게, 끝은 늦게만 반올림한다.
    // 끝을 이르게 잡으면 수업이 끝나기 전에 출발할 수 있다고 계산해 항공편을 놓치게 된다.
    const s5 = Math.floor(start.min / 5) * 5;
    const e5 = Math.min(Math.ceil(end.min / 5) * 5, 1435);
    if (e5 <= s5) { skip('끝나는 시각이 시작보다 늦지 않아요'); continue; }

    // 반복 수업의 옮겨진 회차: 원래 패턴은 그대로 두고(보수적) 그 회차를 일회성 일정으로 더한다.
    // 원 VEVENT와 같은 UID를 쓰므로 중복 키는 UID + RECURRENCE-ID.
    if (recurrenceId) {
      const key = `${uid}|${recurrenceId.value.trim()}`;
      if (seenOverride.has(key)) continue;
      seenOverride.add(key);
      if (start.date < today || start.date >= horizonEnd) { outOfWindow++; continue; }
      moved.push({ uid, ev: { kind: '기타', date: start.date, allDay: false, start: hm(s5), end: hm(e5), description: summary, moved: true } });
      continue;
    }

    if (!rrule) {
      if (start.date < today || start.date >= horizonEnd) { outOfWindow++; continue; }
      events.push({ kind: '기타', date: start.date, allDay: false, start: hm(s5), end: hm(e5), description: summary, moved: false });
      continue;
    }

    // ── 주간 반복 → 수업 후보 ──
    const rule = Object.fromEntries(rrule.value.split(';').map(kv => {
      const [k, ...v] = kv.split('=');
      return [k.trim().toUpperCase(), v.join('=').trim()];
    }));
    if (rule.FREQ?.toUpperCase() !== 'WEEKLY') { skip(`매주 반복이 아닌 반복 일정(${rule.FREQ ?? '?'})은 주간 시간표에 담을 수 없어요`); continue; }
    // 격주 등: 주간으로 접으면 없는 주에도 수업이 생긴다. EXDATE와 달리 패턴 자체가 달라 "많게 잡으면 안전"이 성립하지 않는다.
    if (rule.INTERVAL && Number(rule.INTERVAL) !== 1) { skip('격주 일정은 주간 시간표에 담을 수 없어요 — 직접 입력해 주세요'); continue; }
    if (rule.UNTIL) {
      // UNTIL은 보통 UTC(…Z)로 온다. KST로 바꾼 뒤 비교한다 (그대로 비교하면 하루 어긋날 수 있다)
      let until: Wall;
      try { until = toWall({ name: 'UNTIL', params: dtstart.params.TZID && !rule.UNTIL.endsWith('Z') ? { TZID: dtstart.params.TZID } : {}, value: rule.UNTIL }); }
      catch { skip('반복 종료일(UNTIL)을 읽을 수 없어요'); continue; }
      if (until.date < today) { skip('이미 끝난 반복 일정이에요'); continue; }
    }

    // BYDAY가 없으면 DTSTART의 요일(RFC 5545). 있으면 원래 시간대 기준 요일이므로, UTC→KST로 날짜가 바뀐 만큼 옮긴다.
    const shift = daysBetween(`${dtstart.value.slice(0, 4)}-${dtstart.value.slice(4, 6)}-${dtstart.value.slice(6, 8)}`, start.date);
    let idx: number[];
    if (rule.BYDAY) {
      const tokens = rule.BYDAY.split(',').map((t: string) => t.trim().toUpperCase());
      if (tokens.some((t: string) => !(t in BYDAY))) { skip(`요일 규칙(BYDAY=${rule.BYDAY})을 읽을 수 없어요`); continue; }
      idx = tokens.map((t: string) => (BYDAY[t] + shift + 7) % 7);
    } else {
      idx = [dayIndex(start.date)];
    }

    if (rule.COUNT) {
      // COUNT회로 끝나는 반복: 마지막 회차가 있는 주의 끝(넉넉히)이 오늘보다 전이면 끝난 것
      const weeks = Math.ceil(Number(rule.COUNT) / idx.length);
      if (Number.isFinite(weeks) && addDays(start.date, weeks * 7 + 6) < today) { skip('이미 끝난 반복 일정이에요'); continue; }
    }
    // UNTIL도 COUNT도 없으면 끝이 없는 반복 — class_timetable에는 기간이 없으므로 주간 패턴 그대로 저장한다.

    if (idx.includes(0)) {
      skip(idx.length === 1 ? '일요일 수업은 주간 시간표에 담을 수 없어요 — 일정으로 직접 추가해 주세요'
        : '일요일 회차는 주간 시간표에 담을 수 없어요 — 나머지 요일만 가져와요');
    }
    const days = DAYS.filter(d => idx.some(i => KO[i] === d));
    if (!days.length) continue;

    const cancelled = [...new Set(r.exdates.flatMap(p => p.value.split(',').map(v => {
      try { return toWall({ ...p, value: v }).date; } catch { return null; }
    })).filter((d): d is string => !!d && d >= today))].sort();

    const place = get('LOCATION') ? unescapeText(get('LOCATION')!.value) : '';
    const key = `${summary}|${place}|${s5}|${e5}`;
    const prev = classMap.get(key);
    if (prev) {
      prev.days = DAYS.filter(d => prev.days.includes(d) || days.includes(d));
      prev.cancelled = [...new Set([...prev.cancelled, ...cancelled])].sort();
    } else {
      classMap.set(key, { name: summary, place, days, start: hm(s5), end: hm(e5), cancelled });
    }
    if (uid) classUids.add(uid);
  }

  // 옮겨진 회차는 원 반복이 수업으로 들어간 경우에만 '수업' 일정으로 표시한다
  for (const m of moved) events.push({ ...m.ev, kind: classUids.has(m.uid) ? '수업' : '기타' });

  const classes = [...classMap.values()];
  if (classes.length > maxClasses) {
    // 수업은 자르지 않는다(빠진 수업 = 위험한 쪽). 비정상적으로 많으면 파일 전체를 받지 않는다.
    return { ok: false, error: `수업 후보가 비정상적으로 많아요(${classes.length}개) — 일정도 함께 불러오지 않았어요. 수업 시간표만 담긴 캘린더를 내보내 주세요.` };
  }

  const seen = new Set<string>();
  const unique = events
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .filter(e => {
      const k = `${e.date}|${e.start}|${e.description}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // 상한은 일정에만 건다 (가까운 날짜부터 남긴다)
  if (unique.length > maxEvents) notices.push(`일정 ${unique.length - maxEvents}건은 상한(${maxEvents}건)을 넘어 제외했어요. 가까운 날짜부터 가져왔어요.`);
  if (outOfWindow) notices.push(`지난 일정이나 ${horizonDays}일 뒤의 일정 ${outOfWindow}건은 가져오지 않았어요.`);

  return { ok: true, classes, events: unique.slice(0, maxEvents), skipped, notices };
}

// ── 이미 있는 것과 비교 ───────────────────────────────────

interface ExistingClass { name: string; days: readonly string[]; start: string }
interface ExistingEvent { date: string; start: string; description: string }

/** 같은 과목이 이미 시간표에 있으면 이유를 돌려준다 (없으면 null). 시간이 바뀐 뒤 다시 가져와도 걸리도록 이름+요일로 넓게 본다. */
export function existingClassNote(c: Pick<IcsClass, 'name' | 'days' | 'start'>, classes: ExistingClass[]): string | null {
  const same = classes.filter(x => x.name.trim() === c.name.trim() && x.days.some(d => (c.days as string[]).includes(d)));
  if (!same.length) return null;
  return same.some(x => x.start.slice(0, 5) === c.start) ? '이미 시간표에 있어요' : '같은 이름의 수업이 이미 있어요';
}

export function existingEvent(e: Pick<IcsEvent, 'date' | 'start' | 'description'>, events: ExistingEvent[]): boolean {
  return events.some(x => x.date === e.date && (x.start ?? '').slice(0, 5) === e.start && x.description.trim() === e.description.trim());
}

/**
 * `insert(...).select('id')` 응답에서 화면 상태에 쓸 id를 꺼낸다.
 *
 * 저장이 성공했는데 data가 null로 오는 경우가 있다(응답 본문이 비었거나 행 단위 권한으로 select가 걸린 경우).
 * 그때 `data[i].id`는 크래시다 — 저장은 이미 끝났는데 화면만 죽는다.
 * id는 나중에 그 행을 고치거나 지울 때만 쓰므로, 못 받으면 -1(실재하지 않는 값)을 넣어
 * "목록에는 보이지만 DB 조작은 안 되는 행"으로 남긴다. 없는 id를 지우려 해도 매칭되는 행이 없어 무해하다.
 */
export function insertedId(rows: { id: number }[] | null | undefined, i: number): number {
  return rows?.[i]?.id ?? -1;
}
