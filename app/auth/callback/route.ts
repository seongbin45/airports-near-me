import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/oauth';

// OAuth·매직링크·비밀번호 재설정이 돌아오는 곳. `?code=`를 세션으로 바꾼다.
//   ?next=/auth/update-password  → 재설정 뒤 새 비밀번호 화면으로
// 실패하면 이유를 `?error=`에 붙여 /login으로 돌려보낸다 — 조용히 삼키면 사용자는 아무 설명도 못 듣는다.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  // 제공자가 사용자 거절·만료로 돌려보낸 경우 error / error_code 가 붙어 온다
  const denied = searchParams.get('error_code') ?? searchParams.get('error');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // 서버에 남는 흔적이 없으면 원인을 못 찾는다 (영어 원문이라도 붙여 둔다)
    console.error('auth callback 실패:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.code ?? error.message)}`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(denied ?? 'oauth')}`);
}
