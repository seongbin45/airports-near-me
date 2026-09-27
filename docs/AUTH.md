# 로그인 (이메일·비밀번호 + 소셜)

## 지금 되는 것

| 방법 | 코드 | 준비 |
|---|---|---|
| 이메일 + 비밀번호 로그인 | ✓ | 없음 |
| 이메일 + 비밀번호 **회원가입** | ✓ | 없음 |
| 비밀번호 재설정 메일 | ✓ | Supabase SMTP(기본 제공) |
| 비밀번호 없이 로그인 링크(매직링크) | ✓ | 없음 (기존 기능) |
| 카카오·구글·페이스북 | ✓ (코드) | Supabase 대시보드에서 제공자를 켜야 **보인다** |
| 네이버 | ✓ (코드) | `naver-auth` Edge Function 배포 + 네이버 앱 등록 |

## 원칙: 작동하지 않는 버튼은 그리지 않는다

**로그인 화면의 소셜 버튼은 `NEXT_PUBLIC_OAUTH_PROVIDERS` 에 적힌 것만 나온다.**

참고한 `visitholykorea` 저장소는 이걸 하지 않아서 사고가 났다 — 그쪽 기록
(`src/features/auth/lib/providers.ts`):

> 2026-09-04 실측: Supabase `/auth/v1/settings` 의 external 이 비어 있고 카카오·구글·페이스북은
> 전부 "provider is not enabled" 400 을 돌려준다. 네이버 Edge Function 도 404(미배포).
> 즉 **버튼 네 개가 전부 죽어 있었다.** 누르면 앱을 떠나 오류 JSON 화면으로 가버리는데,
> 사용자 눈에는 그냥 "앱이 멈췄다"로 보인다. 실제로 그렇게 제보를 받았다.

그래서 그 저장소는 목록을 **빈 배열로 되돌렸다**. 즉 그 코드를 그대로 가져오면 소셜 버튼이
0개다. 여기서는 그 교훈만 가져오고, 켤 수 있는 구조를 남겼다.

## 켜는 순서

### 1) 소셜 제공자 (카카오·구글·페이스북)

1. Supabase 대시보드 → Authentication → Providers → 해당 제공자 Enable, 클라이언트 ID·시크릿 입력
2. 그 제공자 콘솔의 **Redirect URI** 에 다음을 등록
   ```
   https://<프로젝트ref>.supabase.co/auth/v1/callback
   ```
3. 배포 환경변수에 켠 것만 적는다. 쉼표로 구분.
   ```
   NEXT_PUBLIC_OAUTH_PROVIDERS=kakao,google
   ```
4. **다시 빌드**한다. `NEXT_PUBLIC_*` 는 빌드 시점에 인라인된다.

### 2) 네이버 (Edge Function)

Supabase 공식 제공자가 아니라 직접 배포해야 한다.

```bash
supabase secrets set NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... APP_URL=https://<배포주소>
supabase functions deploy naver-auth --no-verify-jwt
```

- 네이버 개발자센터 콜백 URL: `https://<프로젝트ref>.supabase.co/functions/v1/naver-auth/callback`
- 네이버 앱 설정에서 **이메일을 필수 제공**으로 켠다. 안 켜면 `naver_no_email` 로 끝난다.
- 배포한 뒤에 `NEXT_PUBLIC_OAUTH_PROVIDERS=kakao,naver` 처럼 **추가한다**.

### 3) 비밀번호 재설정 메일이 오게 하려면

Supabase 대시보드 → Authentication → URL Configuration:

- **Site URL**: 배포 주소
- **Redirect URLs** 에 추가: `https://<배포주소>/auth/callback`

`/auth/callback` 이 목록에 없으면 재설정·매직링크·OAuth 가 전부 실패한다.

## 왜 `/auth/callback` 을 거치는가

OAuth·매직링크·재설정은 전부 **`?code=`** 를 달고 돌아온다. 그 code 를 세션으로 바꾸는
(`exchangeCodeForSession`) 곳이 `app/auth/callback/route.ts` 이고, 서버에서만 할 수 있다
(`@supabase/ssr` 의 PKCE 는 코드 검증값을 브라우저에 두고 서버에서 교환한다).

참고한 저장소는 Vite SPA라 `redirectTo: window.location.origin` 으로 보내도 됐다(전역
`onAuthStateChange` 가 URL 을 직접 읽는다). **이 저장소에서 그대로 옮기면 로그인이 안 된다** —
code 가 아무 데서도 교환되지 않고 화면만 로그인 전으로 돌아온다. 그래서 `callbackUrl()` 이
`/auth/callback` 을 강제한다(`lib/auth/oauth.ts`).

### 알려진 한계
- PKCE 라서 **재설정 메일을 요청한 브라우저에서 링크를 열어야** 한다. 다른 기기·다른 브라우저에서
  열면 코드 검증값이 없어 실패한다. 화면이 그 사실을 안내한다.
- 이메일 확인(`Confirm email`)을 켠 프로젝트에서는 가입 직후 세션이 없다. 화면은 그때
  "확인 메일을 보냈어요"로 안내하고, 켜지 않은 프로젝트에서는 바로 로그인된다. 두 경우 모두 처리한다.

## 환경변수 정리

| 변수 | 어디에 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_OAUTH_PROVIDERS` | 호스팅 **빌드** 환경 | 위 참고 |
| `NEXT_PUBLIC_SUPABASE_URL` | 호스팅 빌드+런타임, 로컬 | 네이버 함수 주소도 여기서 만든다 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 호스팅 빌드+런타임, 로컬 | 로그인 자체에 필요 |
| `SUPABASE_SERVICE_ROLE_KEY` | 호스팅 런타임 | 앱·동기화. **브라우저에 내보내지 않는다** |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` / `APP_URL` | Supabase Edge Function 시크릿 | 네이버만 |
| `CRON_SECRET` | 호스팅 런타임 | 로그인과 무관 (동기화 라우트 인증) |

## 보안 메모

- **열린 리디렉션**: `?next=` 는 `safeNext()` 를 거친다. `//evil.com`·`/\evil.com`·`javascript:` 는
  전부 `/` 로 되돌린다(테스트로 고정).
- **자동 계정 연결 금지**: 네이버로 로그인할 때 같은 이메일의 기존 계정이 **다른 방법**으로
  만들어졌으면 거절한다(`account_exists_other_provider`). 이메일만 같다고 같은 사람이라 단정하지 않는다.
- **state CSRF**: 네이버 인증의 `state` 를 HttpOnly 쿠키와 대조한다.
