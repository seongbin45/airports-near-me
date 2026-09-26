// 네이버 로그인 — Supabase Edge Function (Deno).
//
// Supabase Auth는 네이버를 공식 제공자로 지원하지 않는다(카카오·구글·페이스북은 지원한다).
// 그래서 이 함수가 네이버 OAuth를 직접 처리하고, 확인된 사용자에게 Supabase 세션을 발급한다.
//
// 흐름:
//   GET /naver-auth/login    → 네이버 인증 페이지로 (state를 HttpOnly 쿠키에 묶는다)
//   GET /naver-auth/callback → code→token→프로필 → 사용자 확인/생성 → 세션 발급
//
// 배포:
//   supabase secrets set NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... APP_URL=https://<배포주소>
//   supabase functions deploy naver-auth --no-verify-jwt
//   네이버 개발자센터에 등록할 콜백 URL: https://<프로젝트>.supabase.co/functions/v1/naver-auth/callback
//   네이버 앱 설정에서 이메일을 **필수 제공**으로 켜야 한다 — 아니면 naver_no_email로 끝난다.
//
// 세션을 여는 방법: 서비스 키로 매직링크를 만들어 그 verify 주소로 보낸다. 비밀번호를 만들지 않으므로
// 사용자는 나중에 로그인 화면의 "비밀번호를 잊었어요"로 자기 비밀번호를 정할 수 있다.
//
// 참고한 visitholykorea의 같은 함수에서 **고쳐 온 것 두 가지**:
//   1) 그쪽은 같은 이메일의 기존 계정을 profiles.email 로 찾았다. 이 저장소의 profiles에는
//      email 컬럼이 없다(20260924154209_init_schema.sql). 그대로 옮기면 조회가 빈손으로 돌아와
//      검사가 조용히 건너뛰어진다 — 그래서 generateLink가 함께 돌려주는 user 로 판정한다.
//   2) 실패를 전부 앱 루트로만 보내면 원인을 못 찾는다. 여기서는 상태 코드와 함께 돌려보낸다.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const NAVER_CLIENT_ID = Deno.env.get('NAVER_CLIENT_ID');
const NAVER_CLIENT_SECRET = Deno.env.get('NAVER_CLIENT_SECRET');
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:3000';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function callbackUrl(req: Request): string {
  return `${new URL(req.url).origin}/functions/v1/naver-auth/callback`;
}

/** 실패는 앱으로 돌려보내며 이유를 남긴다. 코드 문자열은 lib/auth/messages.ts 의 CODES 와 짝이다. */
function fail(reason: string): Response {
  const to = new URL(APP_URL);
  to.searchParams.set('error', reason);
  return Response.redirect(to.toString(), 302);
}

Deno.serve(async (req) => {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return new Response('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 시크릿이 설정되지 않았습니다.', { status: 500 });
  }

  const url = new URL(req.url);

  // ── 1단계: 네이버 인증 페이지로 ───────────────────────────
  if (url.pathname.endsWith('/login')) {
    const state = crypto.randomUUID();
    const authorize = new URL('https://nid.naver.com/oauth2.0/authorize');
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', NAVER_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', callbackUrl(req));
    authorize.searchParams.set('state', state);
    // state 를 브라우저 쿠키에 묶는다. 콜백에서 쿼리 state 와 대조해, 공격자가 만든 콜백 URL 을
    // 피해자에게 열게 하는 로그인 CSRF 를 막는다 (visitholykorea 보안 진단 M-01 과 같은 조치).
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        'set-cookie': `naver_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // ── 2단계: 콜백 처리 ─────────────────────────────────────
  if (url.pathname.endsWith('/callback')) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return fail('naver_denied');

    const cookieState = (req.headers.get('cookie') ?? '')
      .split(';').map((c) => c.trim())
      .find((c) => c.startsWith('naver_oauth_state='))
      ?.slice('naver_oauth_state='.length);
    if (!cookieState || cookieState !== state) return fail('naver_state');

    // code → access_token
    const tokenUrl = new URL('https://nid.naver.com/oauth2.0/token');
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('client_id', NAVER_CLIENT_ID);
    tokenUrl.searchParams.set('client_secret', NAVER_CLIENT_SECRET);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('state', state);
    const token = await (await fetch(tokenUrl)).json();
    if (!token.access_token) return fail('naver_token');

    // access_token → 프로필. 이메일은 네이버 앱 설정에서 "필수 제공"을 켜야 온다.
    const profile = await (await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })).json();
    const naver = profile?.response;
    if (!naver?.email) return fail('naver_no_email');

    // 매직링크 생성은 "사용자가 있으면 그 정보를 함께", "없으면 오류"를 돌려준다.
    // 이 한 번의 호출로 존재 확인과 신원 확인을 같이 한다.
    let link = await admin.auth.admin.generateLink({
      type: 'magiclink', email: naver.email, options: { redirectTo: APP_URL },
    });
    if (link.error) {
      const { error: createError } = await admin.auth.admin.createUser({
        email: naver.email, email_confirm: true,
        user_metadata: { name: naver.name ?? naver.nickname ?? '', provider: 'naver' },
      });
      const already = !!createError && /already|registered|exists/i.test(`${createError.message}`);
      if (createError && !already) return fail('naver_create');
      link = await admin.auth.admin.generateLink({
        type: 'magiclink', email: naver.email, options: { redirectTo: APP_URL },
      });
    }
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) return fail('naver_link');

    // 이메일만 같다고 같은 사람이라 단정하지 않는다 — 다른 방법으로 만든 계정에 동의 없이 들어가게 두면
    // 계정 탈취 통로가 된다 (visitholykorea 보안 진단 M-02). provider 를 못 읽으면 통과시키는데,
    // 여기서 막으면 metadata 가 비어 있는 정상 네이버 계정이 재로그인을 못 하게 되기 때문이다.
    const maker = link.data?.user?.user_metadata?.provider ?? link.data?.user?.app_metadata?.provider;
    if (maker && maker !== 'naver') return fail('account_exists_other_provider');

    const verify = new URL(`${SUPABASE_URL}/auth/v1/verify`);
    verify.searchParams.set('token', hashed);
    verify.searchParams.set('type', 'magiclink');
    verify.searchParams.set('redirect_to', APP_URL);
    return Response.redirect(verify.toString(), 302);
  }

  return new Response('Not Found', { status: 404 });
});
