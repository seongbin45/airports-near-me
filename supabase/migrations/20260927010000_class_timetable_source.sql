-- 수업 시간표가 어디서 왔는지 남긴다 (.ics 가져오기). schedules.source와 같은 값 집합.
-- not null default 상수라 PG11+에서는 테이블을 다시 쓰지 않는 메타데이터 변경이고, 이 컬럼을 모르는 옛 코드와도 호환된다.
alter table public.class_timetable
  add column source text not null default 'manual' check (source in ('manual', 'google_calendar', 'ics'));
