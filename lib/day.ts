import { fromMin, hhmm, toMin, weekdayKo } from './time';

export interface DayItem {
  time: string;
  title: string;
  source: '수업 시간표' | '일정';
  endMin: number | null;
}

export interface ClassRow { name: string; days: string[]; start_time: string; end_time: string }
export interface ScheduleRow { kind: string; all_day: boolean; start_time: string | null; end_time: string | null; description: string }

/** 그날의 수업·일정을 모으고, 마지막 일정이 끝나는 시각을 출발 가능 시각으로 본다. 일정이 없으면 null. */
export function dayPlan(date: string, classes: ClassRow[], schedules: ScheduleRow[]) {
  const wd = weekdayKo(date);
  const items: DayItem[] = [
    ...classes.filter(c => c.days.includes(wd)).map(c => ({
      time: `${hhmm(c.start_time)}–${hhmm(c.end_time)}`, title: c.name, source: '수업 시간표' as const, endMin: toMin(hhmm(c.end_time)),
    })),
    ...schedules.map(s => ({
      time: s.all_day ? '하루 종일' : `${hhmm(s.start_time!)}–${hhmm(s.end_time!)}`,
      title: s.description, source: '일정' as const, endMin: s.all_day ? null : toMin(hhmm(s.end_time!)),
    })),
  ].sort((a, b) => (a.endMin ?? -1) - (b.endMin ?? -1));
  const ends = items.map(i => i.endMin).filter((n): n is number => n != null);
  return { items, earliest: ends.length ? fromMin(Math.max(...ends)) : null };
}
