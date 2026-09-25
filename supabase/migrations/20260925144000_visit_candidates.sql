-- 타임라인·캘린더에서 넘어온 "확인 대기" 후보. visits로 들어가기 전까지는 기록이 아니다.
-- trips에서 오는 확인 대기(대화 여정)와 달리 파일에서 온 후보는 여정 테이블에 넣지 않는다.
-- trips는 대화에서 한 검색 기록이고 AI 기록 탭이 그와 연결되므로, 파일 가져오기로 채우면 그 연결이 흐려진다.
create table public.visit_candidates (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dest_city text not null check (length(trim(dest_city)) > 0),
  visited_on date not null,
  from_airport text references public.airports(code),
  reason text,
  source text not null check (source in ('google_timeline', 'google_calendar', 'ics')),
  -- 같은 파일을 두 번 올려도 후보가 늘지 않게 하는 키. 서버가 계산한다 (출발|도착|출발일)
  external_key text not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  unique (user_id, external_key),
  -- 출발일보다 귀국일이 빠를 수는 없다 (visited_on은 출발일)
  check (visited_on <= now()::date)
);
create index visit_candidates_user_idx on public.visit_candidates (user_id, visited_on desc);

alter table public.visit_candidates enable row level security;
-- 본인 행만 읽고 쓰고 지운다 (확인하면 후보 행을 지운다)
create policy "본인 행" on public.visit_candidates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
