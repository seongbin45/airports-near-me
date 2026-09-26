// 로그인 왕복에 쓰는 주소를 만든다. 순수 함수만 둔다 — 리디렉션 대상은 보안에 직결된다.

/**
 * OAuth·매직링크·비밀번호 재설정이 돌아올 주소.
 *
 * `origin`을 그대로 쓰면 안 된다. 브라우저 클라이언트(@supabase/ssr)는 PKCE 코드 검증값을
 * 브라우저에 두고, 돌아온 `?code=`를 **서버에서** 세션으로 바꿔야 한다. 그 일을 하는 곳이
 * app/auth/callback 이다. origin으로 보내면 code가 아무 데서도 교환되지 않아 화면만
 * 로그인 전으로 돌아온다 — 참고한 visitholykorea는 Vite SPA라 origin으로 보내도 됐지만,
 * Next.js 서버 라우트를 쓰는 이 저장소에서는 그대로 옮기면 로그인이 안 된다.
 */
export function callbackUrl(origin: string, next?: string | null): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/**
 * 로그인 뒤 돌아갈 경로 — **열린 리디렉션을 막는다.**
 * `//evil.com`은 브라우저가 프로토콜 상대 URL로 읽어 다른 사이트로 보낸다. `/\evil.com`도 같다.
 * `/`로 시작하면서 다음 글자가 `/`나 `\`가 아닌 것만 받고, 나머지는 `/`로 되돌린다.
 * (`javascript:` 같은 스킴은 `/`로 시작하지 않으므로 여기서 함께 걸린다.)
 */
export function safeNext(next: string | null | undefined): string {
  const s = String(next ?? '').trim();
  if (!s.startsWith('/')) return '/';
  if (s.startsWith('//') || s.startsWith('/\\')) return '/';
  return s;
}

/** 네이버는 Supabase 제공자가 아니라 Edge Function이 처리한다. */
export function naverLoginUrl(supabaseUrl: string | undefined | null): string | null {
  const base = String(supabaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/functions/v1/naver-auth/login`;
}
