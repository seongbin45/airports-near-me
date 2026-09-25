// 시각은 "HH:MM" 문자열 또는 자정 기준 분(number)으로 다룬다.

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fromMin(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Postgres time("15:40:00") → "15:40" */
export function hhmm(t: string): string {
  return t.slice(0, 5);
}

export function fmtDur(n: number): string {
  const h = Math.floor(n / 60), m = n % 60;
  return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
}

const WEEK = '일월화수목금토';

/** "2026-10-02" → "10/2(금)" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

/** "2026-10-02" → "금" */
export function weekdayKo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEK[new Date(y, m - 1, d).getDay()];
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 오늘·내일·다음 주 월·2주 뒤 바로가기 (프로토타입의 날짜 칩) */
export function dateShortcuts(today = new Date()): { label: string; iso: string }[] {
  const nextMon = addDays(today, ((8 - today.getDay()) % 7) || 7);
  return [
    ['오늘', today],
    ['내일', addDays(today, 1)],
    ['다음 주 월', nextMon],
    ['2주 뒤', addDays(today, 14)],
  ].map(([label, d]) => ({ label: `${label} ${fmtDate(isoDate(d as Date))}`, iso: isoDate(d as Date) }));
}

/** 사용자가 직접 친 날짜: "2026-10-02", "10/2", "10.2", "10월 2일" */
export function parseDate(text: string, today = new Date()): string | null {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?/);
  if (!m) return null;
  const month = +m[1], day = +m[2];
  let year = today.getFullYear();
  // 이미 지난 날짜면 내년으로 본다
  if (new Date(year, month - 1, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) year += 1;
  return valid(year, month, day);
}

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? isoDate(dt) : null;
}
