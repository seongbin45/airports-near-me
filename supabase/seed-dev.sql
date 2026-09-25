-- 개발용 테스트 계정 + 샘플 방문 기록. 운영 DB에는 실행하지 않는다.
-- :email / :password 를 바꿔서 실행 (비밀번호는 .env.local의 DEV_TEST_PASSWORD).
do $$
declare
  v_email text := 'dev@airports-near-me.test';
  v_password text := 'CHANGE_ME';
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', v_email), 'email', now(), now(), now());

  update public.profiles set display_name = '민지' where id = v_id;

  insert into public.visits (user_id, dest_city, visited_on, reason, from_airport, source, is_sample) values
    (v_id, '제주', '2025-10-03', '추석 고향 방문', 'GMP', 'manual', true),
    (v_id, '제주', '2025-02-10', '현장 강의 수강', 'CJJ', 'manual', true),
    (v_id, '제주', '2024-09-15', '추석 고향 방문', 'GMP', 'manual', true),
    (v_id, '부산', '2025-06-20', '네트워킹 참여', 'GMP', 'manual', true);
end $$;
