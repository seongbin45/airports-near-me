-- 방문 기록(visits)을 만들 주체를 추가한다.
-- 지금까지 visits에 쓰는 코드가 없어서(시드 SQL만) 대화의 "같은 이유로 간 N번은 모두 김포에서" 기능이
-- 실제 사용자에게는 항상 "같은 이유로 간 적은 없어요"로만 나왔다.
--
-- 자동 승격은 하지 않는다. 날짜가 지난 여정(trips)을 그냥 방문 기록으로 옮기면, 취소한 여정도
-- 기록으로 남고 그 가짜 기록이 이유 대조와 다음 추천의 근거가 된다. 그래서 지난 여정은 "확인 대기"로
-- 보여주고, 사용자가 [다녀왔어요]를 눌렀을 때만 visits에 들어간다.

-- 1) 어느 여정에서 온 기록인지. 같은 여정이 두 번 들어가지 않게 unique.
alter table public.visits
  add column trip_id bigint unique references public.trips(id) on delete set null;

-- 2) source에 대화에서 확인한 기록('trip')을 추가한다.
alter table public.visits drop constraint if exists visits_source_check;
alter table public.visits add constraint visits_source_check
  check (source in ('manual', 'trip', 'google_timeline', 'google_calendar', 'ics'));

-- 3) 같은 날 같은 목적지는 한 번의 방문이다. (같은 여정을 두 번 검색하면 trips는 2건이 된다)
--    기존 데이터에 중복이 있으면 남기고 나머지를 지운 뒤에 건다.
delete from public.visits v
using public.visits keep
where v.id > keep.id
  and v.user_id = keep.user_id
  and v.dest_city = keep.dest_city
  and v.visited_on = keep.visited_on;

create unique index visits_user_dest_day_key on public.visits (user_id, dest_city, visited_on);

-- 4) "안 갔어요"를 기억한다. 이게 없으면 확인 대기 목록에서 지워도 다음 방문에 다시 나타난다.
alter table public.trips add column visit_dismissed_at timestamptz;
create index trips_pending_idx on public.trips (user_id, trip_date desc)
  where visit_dismissed_at is null;
