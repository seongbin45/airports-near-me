// 대화 단계: 목적지 → 날짜 → 출발 시각 → 방문 이유 → 결과
export type Step = 0 | 1 | 2 | 3 | 4;

export interface Visit { dest_city: string; visited_on: string; reason: string | null; from_airport: string | null }

export const DEFAULT_REASONS = ['연휴 고향 방문', '현장 강의 수강', '네트워킹 참여', '출장', '여행'];

const KEYWORDS = ['고향', '강의', '수업', '네트워킹', '출장', '여행', '결혼', '가족', '면접', '학회'];

/** 같은 이유로 볼지: 완전히 같거나 핵심 낱말을 공유 */
export function sameReason(a: string, b: string) {
  const x = a.replace(/\s+/g, ''), y = b.replace(/\s+/g, '');
  return x === y || KEYWORDS.some(k => x.includes(k) && y.includes(k));
}

/** 이번 방문 이유를 지난 기록과 대조한 문장. 기록에 있는 사실만 말한다. */
export function reasonCrossCheck(reason: string, visits: Visit[], airportName: (code: string) => string) {
  const same = visits.filter(v => v.reason && sameReason(v.reason, reason));
  if (!same.length) return visits.length ? '지난 기록 중 같은 이유로 간 적은 없어요.' : '';
  const from = [...new Set(same.map(v => v.from_airport).filter(Boolean) as string[])];
  if (from.length === 1) return `지난 기록 중 같은 이유로 간 ${same.length}번은 모두 ${airportName(from[0])}에서 출발하셨어요.`;
  return `지난 기록 중 같은 이유로 간 ${same.length}번은 ${from.map(airportName).join('·')}에서 출발하셨어요.`;
}

/** "15:00", "15시", "오후 3시 30분" → "15:00" */
export function parseTime(text: string): string | null {
  const t = text.replace(/\s+/g, '');
  let m = t.match(/^(\d{1,2}):(\d{2})/);
  let h: number, min: number;
  if (m) { h = +m[1]; min = +m[2]; }
  else {
    m = t.match(/^(오전|오후)?(\d{1,2})시(?:(\d{1,2})분|반)?/);
    if (!m) return null;
    h = +m[2]; min = t.includes('반') ? 30 : m[3] ? +m[3] : 0;
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
  }
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}


// ───────────── 방문 이유 입력 규칙 ─────────────

/** 방문 이유 최대 길이 */
export const REASON_MAX = 60;

/**
 * 방문 이유에 쓸 수 없는 표현. 이유는 그대로 AI에게 넘어가고, AI가 그 값을 되받아 쓰면
 * verify.ts의 금지 규칙(금액·연락처·링크)에 걸린다. 그러면 그 여정은 계속 답을 못 받으므로 입구에서 막는다.
 */
const REASON_FORBIDDEN = /\d[\d,]*\s*원|\d+\s*만\s*원|https?:\/\/|0\d{1,2}-?\d{3,4}-?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/;

/** 저장 가능한 방문 이유인지. 문제가 있으면 화면에 보여줄 문장을 돌려준다. */
export function checkReason(reason: string): string | null {
  const t = reason.trim();
  if (!t) return '방문 이유를 입력해 주세요.';
  if (t.length > REASON_MAX) return `방문 이유는 ${REASON_MAX}자까지 쓸 수 있어요.`;
  if (REASON_FORBIDDEN.test(t)) return '방문 이유에는 금액·연락처·링크를 쓸 수 없어요.';
  return null;
}
