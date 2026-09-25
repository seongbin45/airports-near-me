-- AI 제공자 예비 체계: 어느 회사·모델이 답했는지, 어떤 제공자를 몇 번 시도했는지 기록
alter table public.ai_calls
  add column provider text,
  add column model text,
  add column attempts jsonb;
