-- E2E 전용 표식 테이블 — **테스트 프로젝트에서만** 실행한다.
--
-- 왜 필요한가: scripts/e2e-reset.mts 는 무언가를 지우고 쓰기 **전에** 이 표식을 확인하고,
-- 표식이 없으면(조회 오류 포함) 즉시 멈춘다. 그래서 URL·키가 운영 프로젝트를 가리켜도
-- 운영 데이터를 건드리지 않는다. 운영 프로젝트에는 이 표식이 **없어야** 안전하다.
--
-- 실행할 곳: 테스트 전용 프로젝트 → SQL Editor 에 아래를 붙여 넣고 Run (1회면 충분하다. 다시 실행해도 안전).
-- 운영 프로젝트에서는 **절대 실행하지 않는다.** 그러면 표식이 생겨 보호가 무력해진다.
--
-- 2026-09-27: 이 단계가 빠져 e2e-data 워크플로가 `Could not find the table 'public.e2e_marker'` 로 멈췄다.

create table if not exists public.e2e_marker (
  id int primary key,
  note text not null
);

insert into public.e2e_marker (id, note) values (1, 'e2e-test-project')
  on conflict (id) do update set note = excluded.note;

-- RLS를 켜고 **정책을 만들지 않는다** = anon·authenticated 는 읽지 못하고 service_role 만 읽는다.
-- (표식은 앱이 쓰지 않는다. 서버 스크립트 전용이다.)
alter table public.e2e_marker enable row level security;

-- 확인: select * from public.e2e_marker;   → 1 | e2e-test-project
