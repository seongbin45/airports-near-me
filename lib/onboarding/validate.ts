import { toMin } from '../time';

export const DAYS = ['월', '화', '수', '목', '금', '토'] as const;
export type Day = (typeof DAYS)[number];

export interface ClassItem {
  id?: number;
  name: string;
  place: string;
  days: Day[];
  start: string;
  end: string;
}

export const EVENT_KINDS = ['수업', '시험', '회의', '약속', '기타'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventDraft {
  kind: EventKind;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
}

export type Tone = 'muted' | 'error' | 'warn';

export interface Check {
  ok: boolean;
  msg: string;
  tone: Tone;
}

/** 수업: 과목명·요일·시간 필수, 종료>시작. 다른 수업과 겹치면 경고만 하고 저장은 허용한다. */
export function checkClass(cf: ClassItem, classes: ClassItem[]): Check {
  const miss: string[] = [];
  if (!cf.name.trim()) miss.push('과목명');
  if (!cf.days.length) miss.push('요일');
  if (!cf.start || !cf.end) miss.push('시간');
  if (miss.length) return { ok: false, msg: `${miss.join(', ')}을(를) 입력하면 저장할 수 있어요.`, tone: 'muted' };
  const a = toMin(cf.start), b = toMin(cf.end);
  if (b <= a) return { ok: false, msg: '끝나는 시간이 시작 시간보다 늦어야 해요.', tone: 'error' };
  const clash = classes.find(c => c.id !== cf.id && c.days.some(d => cf.days.includes(d)) && toMin(c.start) < b && a < toMin(c.end));
  if (clash) return { ok: true, msg: `${clash.name}(${clash.start}–${clash.end})과 시간이 겹쳐요. 그래도 저장할 수 있어요.`, tone: 'warn' };
  return { ok: true, msg: '', tone: 'muted' };
}

/** 일정: 날짜·설명 필수, 하루 종일이 아니면 시간도 필수이고 종료>시작. */
export function checkEvent(ef: EventDraft): Check {
  const miss: string[] = [];
  if (!ef.date) miss.push('날짜');
  if (!ef.allDay && (!ef.start || !ef.end)) miss.push('시간');
  if (!ef.description.trim()) miss.push('설명');
  if (miss.length) return { ok: false, msg: `${miss.join(', ')}이(가) 필요해요.`, tone: 'warn' };
  if (!ef.allDay && toMin(ef.end) <= toMin(ef.start)) return { ok: false, msg: '끝나는 시간이 시작 시간보다 늦어야 해요.', tone: 'warn' };
  return { ok: true, msg: '', tone: 'muted' };
}
