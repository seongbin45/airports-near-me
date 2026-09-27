// 로그인 화면에 어떤 소셜 로그인 버튼을 그릴지 정한다.
//
// 왜 환경변수로 켜는가 — 참고한 visitholykorea 저장소가 남긴 기록 때문이다:
// Supabase 대시보드에서 제공자를 켜지 않은 채 버튼을 그려 두면, 누르는 순간 앱을 떠나
// `provider is not enabled` 400 JSON 화면으로 간다. 사용자 눈에는 "앱이 멈췄다"로 보인다.
// 그 저장소는 실제로 그 제보를 받고 버튼 목록을 빈 배열로 되돌렸다
// (visitholykorea src/features/auth/lib/providers.ts 의 주석 — "버튼 네 개가 전부 죽어 있었다").
// 그래서 여기서도 **켜져 있다고 확인된 것만** 그린다. 작동하지 않는 버튼은 더미 UI다.
//
// 켜는 법:
//   1) Supabase 대시보드 → Authentication → Providers 에서 카카오·구글을 켜고 키를 넣는다
//   2) 다음 배포에 NEXT_PUBLIC_OAUTH_PROVIDERS=kakao,google 를 넣는다
// NEXT_PUBLIC_*은 빌드 시점에 인라인된다 — 값을 바꾸면 다시 빌드해야 화면에 반영된다.

/** 이 서비스가 다루는 소셜 제공자. */
export const OAUTH_PROVIDERS = ['kakao', 'naver', 'google', 'facebook'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Supabase가 자체 제공자로 지원하는 것. **네이버는 여기 없다.** */
export type SupabaseOAuthProvider = Exclude<OAuthProvider, 'naver'>;

export const OAUTH_LABEL: Record<OAuthProvider, string> = {
  kakao: '카카오',
  naver: '네이버',
  google: '구글',
  facebook: '페이스북',
};

/**
 * 네이버는 Supabase 공식 제공자가 아니라 supabase/functions/naver-auth(Edge Function)가 처리한다.
 * 나머지는 supabase.auth.signInWithOAuth 로 보낸다.
 */
export function usesSupabaseProvider(p: OAuthProvider): p is SupabaseOAuthProvider {
  return p !== 'naver';
}

export function isOAuthProvider(v: string): v is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(v);
}

/**
 * `NEXT_PUBLIC_OAUTH_PROVIDERS`("kakao,google") → 목록.
 * 오타·미지원 값은 조용히 버린다 — 오타 하나 때문에 화면 전체가 죽으면 안 된다.
 * 아무것도 남지 않으면 버튼 구역 자체가 사라진다(작동하지 않는 버튼을 보여주지 않는다).
 */
export function enabledProviders(raw: string | undefined | null): OAuthProvider[] {
  const out: OAuthProvider[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const v = part.trim().toLowerCase();
    if (isOAuthProvider(v) && !out.includes(v)) out.push(v);
  }
  return out;
}
