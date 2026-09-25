-- 이동 시간에 시각대를 붙인다.
--
-- 카카오모빌리티는 출발 시각을 지정하지 않으면 **호출 시각의 실시간 교통**으로 계산한다.
-- 2026-09-25 배치가 금요일 16~17시에 돌아 전국 값에 퇴근길 정체가 들어갔다
-- (예: 수원 영통구 → 김포 137분). 그 값을 "평균 소요시간"으로 쓰면 사용자가 실제로 겪는
-- 시간과 어긋난다.
--
-- 그래서 행마다 어느 시각대 기준인지 남긴다.
--   any         출발 시각 미지정 — 제공자가 호출 시점 실시간 교통으로 계산한 값 (기존 행 전부)
--   weekday_am  평일 아침 (08:00 출발 가정)
--   weekday_day 평일 낮   (13:00)
--   weekday_pm  평일 저녁 (18:00)
--   weekend     주말 낮   (13:00)
--
-- 기존 행은 전부 'any'가 된다. 지우지 않는다 — 시각대 값을 못 구한 지역의 최후 fallback으로 쓴다.
-- 다만 추천 화면은 정확히 맞는 시각대가 없을 때만 'any'를 쓰고, 그 사실을 함께 보여준다(accessBandMatched).
alter table public.access_times
  add column depart_band text not null default 'any';

alter table public.access_times
  add constraint access_times_depart_band_check
  check (depart_band in ('any', 'weekday_am', 'weekday_day', 'weekday_pm', 'weekend'));

-- 기존 unique (region_id, airport, mode)를 시각대까지 포함하도록 바꾼다.
-- 제약 이름은 Postgres가 붙인 이름이라 환경마다 다를 수 있어, 컬럼 구성으로 찾아 지운다.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.access_times'::regclass and contype = 'u'
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(conkey) as k(attnum) join pg_attribute a on a.attrelid = conrelid and a.attnum = k.attnum
      ) = array['airport', 'mode', 'region_id']
  loop
    execute format('alter table public.access_times drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.access_times
  add constraint access_times_region_airport_mode_band_key
  unique (region_id, airport, mode, depart_band);

comment on column public.access_times.depart_band is
  'any=출발 시각 미지정(호출 시점 실시간 교통). 나머지는 그 시각대 기준으로 다시 계산한 값';
