-- 집 → 공항 이동 시간을 계산하려면 거주 지역의 좌표가 필요하다.
-- access-time.ts는 "regions 대표 좌표 기준"이라고 적혀 있었지만 regions에 좌표 컬럼이 없어
-- 계산 경로 자체가 막혀 있었다. 여기서 컬럼을 만들고, scripts/geocode-regions.mts가 채운다.
--
-- 좌표 기준: 카카오 로컬 API 주소 검색의 (x=경도, y=위도). 시·도/시·군·구 이름을 그대로 질의한다.
-- 구(區)가 있는 구역은 구 이름까지 붙여 질의하므로, 구가 없는 시·군은 시청 좌표가 잡힌다.
alter table public.regions
  add column lat double precision,
  add column lng double precision,
  add column geocoded_at timestamptz;

-- 좌표가 채워진 정도를 바로 세기 위한 인덱스 (doctor의 regions-coords 게이트가 쓴다)
create index regions_geocoded_idx on public.regions (geocoded_at) where geocoded_at is not null;

comment on column public.regions.lat is '대표 좌표 위도 (카카오 로컬 API 주소 검색)';
comment on column public.regions.lng is '대표 좌표 경도 (카카오 로컬 API 주소 검색)';

-- 좌표가 이미 있는데 is_sample인 접근 시간은 실측으로 덮어쓸 수 있어야 하므로,
-- 같은 (지역, 공항, 수단)에 샘플과 실측이 공존할 수 없다는 제약은 그대로 두고
-- 배치가 upsert로 is_sample을 false로 바꾼다 (unique (region_id, airport, mode) 활용).
