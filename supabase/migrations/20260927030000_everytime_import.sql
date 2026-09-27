-- 에브리타임 시간표 불러오기 (docs/EVERYTIME.md)
-- 1) class_timetable.source에 'everytime' — 공유 링크 XML·캡처 인식으로 가져온 수업
-- 2) ai_calls.kind에 'timetable_image' — 캡처 인식 AI 호출 기록 (호출 제한도 이 행을 센다)
--
-- 기본 이름(<table>_<column>_check)에 기대지 않고, 그 컬럼만 참조하는 CHECK를 찾아 바꾼다.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'c' and array_length(c.conkey, 1) = 1
      and ((c.conrelid = 'public.class_timetable'::regclass and a.attname = 'source')
        or (c.conrelid = 'public.ai_calls'::regclass and a.attname = 'kind'))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.class_timetable add constraint class_timetable_source_check
  check (source in ('manual', 'google_calendar', 'ics', 'everytime'));
alter table public.ai_calls add constraint ai_calls_kind_check
  check (kind in ('summary', 'question', 'timetable_image'));

-- 호출 제한(1분·하루 횟수)을 셀 때 쓰는 조회
create index if not exists ai_calls_user_kind_time_idx on public.ai_calls (user_id, kind, created_at);
