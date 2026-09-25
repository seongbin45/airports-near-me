-- 1) trips가 고른 편을 참조하고 있어도 운항 스케줄 동기화가 편을 지울 수 있게: FK를 on delete set null로.
--    고른 편의 편명·출발 공항·시각은 trips에 따로 남겨 기록이 사라지지 않게 한다.
alter table public.trips drop constraint trips_chosen_flight_id_fkey;
alter table public.trips add constraint trips_chosen_flight_id_fkey
  foreign key (chosen_flight_id) references public.flight_schedules(id) on delete set null;

alter table public.trips
  add column chosen_flight_no text,
  add column chosen_origin text,
  add column chosen_dep time,
  add column chosen_arr time;

update public.trips t
set chosen_flight_no = f.flight_no, chosen_origin = f.origin, chosen_dep = f.dep_time, chosen_arr = f.arr_time
from public.flight_schedules f
where f.id = t.chosen_flight_id;

-- 2) 한국공항공사·TAGO 실제 스케줄이 들어왔으므로 화면용 샘플 편을 지운다.
--    (샘플이 남아 있으면 실제 편이 없는 요일에 가짜 편이 추천될 수 있다. 예: 인천→제주는 월요일만 운항)
delete from public.flight_schedules where is_sample;
