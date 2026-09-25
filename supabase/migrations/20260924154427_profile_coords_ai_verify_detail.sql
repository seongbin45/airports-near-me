-- 상세 주소를 지오코딩한 좌표. 있으면 구 단위 access_times 대신 좌표 기준으로 공항까지 시간을 계산한다.
alter table public.profiles
  add column lat double precision,
  add column lng double precision,
  add column geocoded_at timestamptz;

-- AI 문장 검증 내역: 무엇을 대조했고 무엇이 어긋났는지
-- 예: {"flights": {"checked": ["A 1203"], "mismatched": []}, "times": {"checked": ["15:40"], "mismatched": []}}
alter table public.ai_calls
  add column verify_detail jsonb;
