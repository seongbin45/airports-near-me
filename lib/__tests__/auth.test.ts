import { describe, expect, it } from 'vitest';
import { enabledProviders, OAUTH_LABEL, usesSupabaseProvider, type OAuthProvider } from '../auth/providers';
import { authMessage } from '../auth/messages';
import { callbackUrl, naverLoginUrl, safeNext } from '../auth/oauth';

describe('enabledProviders', () => {
  it('빈 값이면 아무 버튼도 그리지 않는다 (작동하지 않는 버튼을 보여주지 않는다)', () => {
    expect(enabledProviders(undefined)).toEqual([]);
    expect(enabledProviders('')).toEqual([]);
    expect(enabledProviders('   ')).toEqual([]);
    expect(enabledProviders(',,')).toEqual([]);
  });
  it('쉼표 목록을 순서대로, 공백·대소문자를 정리해서 읽는다', () => {
    expect(enabledProviders('kakao, google')).toEqual(['kakao', 'google']);
    expect(enabledProviders(' KAKAO ,Naver ')).toEqual(['kakao', 'naver']);
  });
  it('모르는 이름은 버리고, 중복은 한 번만', () => {
    expect(enabledProviders('kakao,naver,kako,kakao')).toEqual(['kakao', 'naver']);
    expect(enabledProviders('twitter,line')).toEqual([]);
  });
  it('네이버는 Supabase 제공자가 아니다 — Edge Function으로 보낸다', () => {
    expect(usesSupabaseProvider('naver')).toBe(false);
    for (const p of ['kakao', 'google', 'facebook'] as OAuthProvider[]) {
      expect(usesSupabaseProvider(p)).toBe(true);
    }
  });
  it('네 제공자 모두 한국어 이름이 있다', () => {
    expect(Object.values(OAUTH_LABEL).every(v => v.length > 0)).toBe(true);
  });
});

describe('safeNext', () => {
  it('사이트 안 경로는 그대로 둔다', () => {
    expect(safeNext('/me')).toBe('/me');
    expect(safeNext('/auth/update-password')).toBe('/auth/update-password');
    expect(safeNext('/me?tab=trips')).toBe('/me?tab=trips');
  });
  it('다른 사이트로 보내는 값은 / 로 되돌린다', () => {
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext('me')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
  });
  it('역슬래시를 섞은 우회도 막는다 (브라우저가 // 로 읽는다)', () => {
    expect(safeNext('/\\evil.com')).toBe('/');
    expect(safeNext('/\\/evil.com')).toBe('/');
  });
});

describe('callbackUrl', () => {
  it('세션 교환은 서버 라우트에서 해야 하므로 /auth/callback 으로 보낸다', () => {
    expect(callbackUrl('https://a.test', '/me')).toBe('https://a.test/auth/callback?next=%2Fme');
  });
  it('next가 없거나 수상하면 루트로', () => {
    expect(callbackUrl('https://a.test')).toBe('https://a.test/auth/callback?next=%2F');
    expect(callbackUrl('https://a.test', '//evil.com')).toBe('https://a.test/auth/callback?next=%2F');
  });
});

describe('naverLoginUrl', () => {
  it('Edge Function 주소를 만든다', () => {
    expect(naverLoginUrl('https://x.supabase.co')).toBe('https://x.supabase.co/functions/v1/naver-auth/login');
    expect(naverLoginUrl('https://x.supabase.co/')).toBe('https://x.supabase.co/functions/v1/naver-auth/login');
  });
  it('URL을 모르면 null (버튼을 눌러도 아무 일도 없게 두지 않는다)', () => {
    expect(naverLoginUrl(undefined)).toBeNull();
    expect(naverLoginUrl('')).toBeNull();
  });
});

describe('authMessage', () => {
  it('아는 영어 오류는 한국어로 바꾼다', () => {
    expect(authMessage('Invalid login credentials')).toContain('비밀번호');
    expect(authMessage('Email not confirmed')).toContain('인증 링크');
    expect(authMessage('User already registered')).toContain('이미 가입된');
    expect(authMessage('Password should be at least 6 characters.')).toContain('6자 이상');
  });
  it('콜백이 붙이는 짧은 코드도 바꾼다', () => {
    expect(authMessage('link')).toContain('만료');
    expect(authMessage('naver_no_email')).toContain('이메일');
    expect(authMessage('account_exists_other_provider')).toContain('다른 방법');
  });
  it('모르는 오류는 원문을 그대로 보여준다 (뭉개면 원인을 못 찾는다)', () => {
    expect(authMessage('some_new_provider_failure')).toBe('some_new_provider_failure');
    expect(authMessage(null)).toBe('');
  });
});
