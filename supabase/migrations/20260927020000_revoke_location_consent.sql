-- 위치정보 동의 철회를 한 트랜잭션으로: 동의 행에 철회 시각 기록 + 방문 기록 + 확인 대기 후보(타임라인 위치 데이터) 삭제.
-- 전에는 브라우저가 차례로 지워서, 중간에 실패하면 한쪽(visit_candidates)이 남았다.
-- trips(대화 검색 기록)는 위치 데이터가 아니라 지우지 않는다.
-- security invoker: 호출한 사용자의 RLS가 그대로 걸린다. 조건도 user_id = auth.uid()로 한 번 더 좁힌다.
create function public.revoke_location_consent() returns json
language plpgsql security invoker set search_path = '' as $$
declare
  n_visits integer;
  n_candidates integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  update public.location_consents set revoked_at = now()
    where user_id = auth.uid() and revoked_at is null;
  delete from public.visits where user_id = auth.uid();
  get diagnostics n_visits = row_count;
  delete from public.visit_candidates where user_id = auth.uid();
  get diagnostics n_candidates = row_count;
  return json_build_object('visits', n_visits, 'candidates', n_candidates);
end $$;
revoke execute on function public.revoke_location_consent() from public, anon;
grant execute on function public.revoke_location_consent() to authenticated;
