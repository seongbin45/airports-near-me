-- 운항 스케줄 동기화 기록
-- 1) flight_fetch_log: 노선·날짜 단위 조회 기록. 사용자 요청 때 "이미 물어봤는지(결과가 0건이어도)" 판단해 같은 조회를 반복하지 않는다.
create table public.flight_fetch_log (
  source text not null,
  origin text not null,
  dest text not null,
  query_date date not null,
  fetched_at timestamptz not null default now(),
  result_count integer not null default 0,
  error text,
  primary key (source, origin, dest, query_date)
);

-- 2) sync_runs: 주기 전체 동기화 실행 기록 (GitHub Actions·수동 실행 모니터링, 화면의 "마지막 동기화" 표시)
create table public.sync_runs (
  id bigint generated always as identity primary key,
  job text not null,                 -- 'kac-full' | 'tago-horizon'
  trigger text not null,             -- 'schedule' | 'manual' | 'on-demand'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  report jsonb
);
create index sync_runs_job_started_idx on public.sync_runs (job, started_at desc);

-- 둘 다 서버(service role)만 쓴다. 읽기는 누구나(마지막 동기화 시각 표시용).
alter table public.flight_fetch_log enable row level security;
alter table public.sync_runs enable row level security;
create policy "누구나 읽기" on public.flight_fetch_log for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.sync_runs for select to anon, authenticated using (true);
