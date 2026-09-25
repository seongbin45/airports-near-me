-- 한국공항공사 운항 스케줄 동기화

-- 마지막으로 API에서 확인한 시각. 동기화 때 이번 실행에서 안 보인 편(운항 중단 등)을 지우는 기준이자, 화면의 "N일 전 갱신" 표시용.
alter table public.flight_schedules add column synced_at timestamptz;

-- upsert 키: 같은 출처·편명·노선·시작일이면 같은 스케줄
alter table public.flight_schedules
  add constraint flight_schedules_source_key unique nulls not distinct (source, flight_no, origin, dest, valid_from);

-- 한국공항공사 국내선 운항 공항 중 아직 없던 곳 (좌표는 공항 기준점 근사)
insert into public.airports (code, name_ko, city, lat, lng) values
  ('TAE', '대구국제공항', '대구', 35.8941, 128.6589),
  ('KWJ', '광주공항', '광주', 35.1264, 126.8089),
  ('RSU', '여수공항', '여수', 34.8423, 127.6169),
  ('USN', '울산공항', '울산', 35.5935, 129.3518),
  ('KPO', '포항경주공항', '포항', 35.9879, 129.4204),
  ('MWX', '무안국제공항', '무안', 34.9914, 126.3828),
  ('YNY', '양양국제공항', '양양', 38.0613, 128.6692),
  ('HIN', '사천공항', '사천', 35.0885, 128.0704),
  ('KUV', '군산공항', '군산', 35.9038, 126.6158),
  ('WJU', '원주공항', '원주', 37.4381, 127.9604)
on conflict (code) do nothing;
