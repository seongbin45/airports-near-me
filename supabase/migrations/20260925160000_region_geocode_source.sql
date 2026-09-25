-- 지도 API 예비 체계: 행정구역 좌표를 어느 제공자가 줬는지 (카카오 로컬 / 네이버 Geocoding / Nominatim)
alter table public.regions add column geocode_source text;
