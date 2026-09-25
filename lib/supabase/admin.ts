import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * service role 클라이언트 — RLS를 우회한다. 공용 참조 데이터(운항 스케줄 등) 동기화에만 쓴다.
 * 키는 Supabase 대시보드 → Project Settings → API Keys의 secret key. 절대 NEXT_PUBLIC_으로 노출하지 않는다.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았어요.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
}
