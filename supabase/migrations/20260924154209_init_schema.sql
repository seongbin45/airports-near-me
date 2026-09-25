-- 공항 찾기: 초기 스키마
-- 공용 참조 데이터(국가·행정구역·공항·운항 스케줄·접근 시간)는 누구나 읽기만 가능하고,
-- 사용자 데이터는 본인 행만 읽고 쓸 수 있다(RLS).

-- ───────────── 공용 참조 데이터 ─────────────

create table public.countries (
  code text primary key,
  name_ko text not null,
  enabled boolean not null default false, -- 관리자 승인 전에는 false ("승인 대기")
  sort smallint not null default 0
);

create table public.regions (
  id bigint generated always as identity primary key,
  sido_short text not null,               -- 칩에 보이는 짧은 이름 (예: 경기)
  sido text not null,                     -- 경기도
  sigungu text,                           -- 수원시 (세종처럼 없으면 null)
  gu text,                                -- 영통구 (구가 없는 시·군이면 null)
  full_name text not null,
  adm_code text unique,                   -- 행정안전부 행정표준코드 (공식 데이터 반영 시 채움)
  valid_from date,
  valid_to date,                          -- 폐지·개편된 구역은 종료일을 넣고 남겨둔다
  unique nulls not distinct (sido, sigungu, gu)
);

create table public.airports (
  code text primary key,                  -- IATA
  name_ko text not null,
  city text not null,                     -- 목적지 검색용 (예: 제주)
  lat double precision,
  lng double precision
);

create table public.flight_schedules (
  id bigint generated always as identity primary key,
  flight_no text not null,
  airline text,
  origin text not null references public.airports(code),
  dest text not null references public.airports(code),
  dep_time time not null,
  arr_time time not null,
  days_of_week smallint[] not null default '{1,2,3,4,5,6,7}', -- ISO 요일 1=월 … 7=일
  valid_from date,
  valid_to date,
  source text not null,
  is_sample boolean not null default false
);
create index flight_schedules_route_idx on public.flight_schedules (origin, dest, dep_time);
create index flight_schedules_dest_idx on public.flight_schedules (dest);

create table public.access_times (
  id bigint generated always as identity primary key,
  region_id bigint not null references public.regions(id),
  airport text not null references public.airports(code),
  mode text not null check (mode in ('car', 'transit')),
  minutes integer not null check (minutes > 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  is_sample boolean not null default false,
  unique (region_id, airport, mode)
);
create index access_times_airport_idx on public.access_times (airport);

-- ───────────── 사용자 데이터 ─────────────

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  country text not null default 'KR' references public.countries(code),
  region_id bigint references public.regions(id),
  address text,
  user_type text check (user_type in ('대학생', '직장인', '지방 거주자', '출장 잦음')),
  onboarding_step smallint not null default 0,
  onboarding_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_region_idx on public.profiles (region_id);
create index profiles_country_idx on public.profiles (country);

create table public.class_timetable (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  place text,
  days text[] not null check (cardinality(days) > 0 and days <@ array['월','화','수','목','금','토']),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index class_timetable_user_idx on public.class_timetable (user_id);

create table public.schedules (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('수업', '시험', '회의', '약속', '기타')),
  date date not null,
  all_day boolean not null default false,
  start_time time,
  end_time time,
  description text not null check (length(trim(description)) > 0), -- 기획서: 상세 설명 필수
  source text not null default 'manual' check (source in ('manual', 'google_calendar', 'ics')),
  created_at timestamptz not null default now(),
  check (
    (all_day and start_time is null and end_time is null)
    or (not all_day and start_time is not null and end_time is not null and end_time > start_time)
  )
);
create index schedules_user_date_idx on public.schedules (user_id, date);

create table public.location_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  version text not null,
  consented_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index location_consents_user_idx on public.location_consents (user_id);

create table public.visits (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dest_city text not null,
  visited_on date not null,
  reason text,                             -- 타임라인 파일에는 없으므로 대화에서 채운다
  from_airport text references public.airports(code),
  source text not null default 'manual' check (source in ('manual', 'google_timeline')),
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index visits_user_dest_idx on public.visits (user_id, dest_city);
create index visits_from_airport_idx on public.visits (from_airport);

create table public.trips (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dest_city text not null,
  trip_date date not null,
  reason text not null,
  earliest_departure time,
  mode text check (mode in ('car', 'transit')),
  chosen_flight_id bigint references public.flight_schedules(id),
  created_at timestamptz not null default now()
);
create index trips_user_idx on public.trips (user_id);
create index trips_flight_idx on public.trips (chosen_flight_id);

create table public.ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id bigint references public.trips(id) on delete set null,
  kind text not null check (kind in ('summary', 'question')),
  prompt text not null,
  response text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_calls_user_idx on public.ai_calls (user_id);
create index ai_calls_trip_idx on public.ai_calls (trip_id);

-- ───────────── 트리거 ─────────────

-- 승인되지 않은 국가로는 프로필을 저장할 수 없다.
create function public.enforce_enabled_country() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.countries c where c.code = new.country and c.enabled) then
    raise exception '아직 서비스되지 않는 국가입니다: %', new.country;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_country_check before insert or update on public.profiles
  for each row execute function public.enforce_enabled_country();

-- 가입하면 빈 프로필을 만든다.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''));
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── RLS ─────────────

alter table public.countries enable row level security;
alter table public.regions enable row level security;
alter table public.airports enable row level security;
alter table public.flight_schedules enable row level security;
alter table public.access_times enable row level security;

create policy "누구나 읽기" on public.countries for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.regions for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.airports for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.flight_schedules for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.access_times for select to anon, authenticated using (true);

alter table public.profiles enable row level security;
create policy "본인 프로필 읽기" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "본인 프로필 수정" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.class_timetable enable row level security;
alter table public.schedules enable row level security;
alter table public.location_consents enable row level security;
alter table public.visits enable row level security;
alter table public.trips enable row level security;
alter table public.ai_calls enable row level security;

create policy "본인 행만" on public.class_timetable for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 행만" on public.schedules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 행만" on public.visits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 행만" on public.trips for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 동의 이력과 AI 호출 기록은 지우거나 고치지 못하게 읽기·추가만 허용 (철회는 revoked_at 갱신)
create policy "본인 행 읽기" on public.location_consents for select to authenticated using (user_id = (select auth.uid()));
create policy "본인 행 추가" on public.location_consents for insert to authenticated with check (user_id = (select auth.uid()));
create policy "본인 동의 철회" on public.location_consents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "본인 행 읽기" on public.ai_calls for select to authenticated using (user_id = (select auth.uid()));
create policy "본인 행 추가" on public.ai_calls for insert to authenticated with check (user_id = (select auth.uid()));
