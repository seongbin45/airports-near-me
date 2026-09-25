-- AI 기록(AI log)이 "어느 모델이 답했는지"를 정확히 남기게 한다.
-- provider/model은 체인에서 고른(요청한) 제공자·모델이고, 실제로 답을 만든 모델은 응답의 최상위 model 필드에만 있다.
-- (Anthropic 서버 측 폴백은 응답의 model에 서빙 모델을, usage.iterations에 fallback_message를 남긴다)
alter table public.ai_calls
  add column served_model text,
  add column usage jsonb;
