-- 내 데이터(/me) 화면: AI 사용 동의 스위치, 본인 계정 삭제

-- 끄면 /api/ai가 호출을 거절하고, 대화에서는 DB 결과 표만 보여준다.
alter table public.profiles add column ai_enabled boolean not null default true;

-- 본인 계정과 모든 데이터 삭제. auth.users 삭제가 모든 사용자 테이블로 cascade 된다.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
