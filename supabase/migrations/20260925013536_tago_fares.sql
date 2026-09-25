-- 국토교통부 TAGO 날짜별 운항편: 일반석 요금 (원). 한국공항공사 정기 스케줄·샘플은 null.
alter table public.flight_schedules add column economy_fare integer check (economy_fare > 0);

-- TAGO 행은 valid_from = valid_to = 운항일. 지난 날짜 정리·날짜 조회용
create index flight_schedules_source_valid_to_idx on public.flight_schedules (source, valid_to);
