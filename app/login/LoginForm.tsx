'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge, BotLine, TopBar, inputCls } from '@/components/ui';
import { OAUTH_LABEL, usesSupabaseProvider, type OAuthProvider } from '@/lib/auth/providers';
import { authMessage } from '@/lib/auth/messages';
import { callbackUrl, naverLoginUrl } from '@/lib/auth/oauth';

type Busy = null | 'email' | 'link' | 'reset' | 'oauth';

export default function LoginForm({ linkError, errorCode, providers, devPassword }: {
  linkError: boolean;
  errorCode: string | null;
  providers: OAuthProvider[];
  devPassword: boolean;
}) {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState(errorCode ? authMessage(errorCode) : '');
  const [notice, setNotice] = useState(linkError ? authMessage('link') : '');

  const client = () => createClient();

  async function withEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setNotice('');
    setBusy('email');
    if (signup) {
      const { data, error } = await client().auth.signUp({
        email, password, options: { emailRedirectTo: callbackUrl(location.origin, '/') },
      });
      setBusy(null);
      if (error) return setMsg(authMessage(error.message));
      // 메일 확인이 켜진 프로젝트면 세션이 아직 없다 — 그때는 메일함을 보라고 해야 한다.
      if (!data.session) return setNotice(`${email}로 확인 메일을 보냈어요. 메일함에서 링크를 눌러주세요.`);
      router.replace('/');
      return;
    }
    const { error } = await client().auth.signInWithPassword({ email, password });
    setBusy(null);
    if (error) return setMsg(authMessage(error.message));
    router.replace('/');
  }

  async function sendLink() {
    setMsg(''); setNotice('');
    setBusy('link');
    const { error } = await client().auth.signInWithOtp({
      email, options: { emailRedirectTo: callbackUrl(location.origin, '/') },
    });
    setBusy(null);
    if (error) return setMsg(authMessage(error.message));
    setNotice(`${email}로 로그인 링크를 보냈어요. 메일함에서 링크를 눌러주세요.`);
  }

  async function resetPassword() {
    setMsg(''); setNotice('');
    if (!email) return setMsg('먼저 이메일을 적어주세요. 그 주소로 재설정 링크를 보내드려요.');
    setBusy('reset');
    const { error } = await client().auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl(location.origin, '/auth/update-password'),
    });
    setBusy(null);
    if (error) return setMsg(authMessage(error.message));
    setNotice(`${email}로 비밀번호 재설정 링크를 보냈어요.`);
  }

  async function social(p: OAuthProvider) {
    setMsg(''); setNotice('');
    if (!usesSupabaseProvider(p)) {
      const url = naverLoginUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
      if (!url) return setMsg('네이버 로그인이 설정되지 않았어요.');
      // 대입(location.href = url)은 react-hooks/immutability 규칙에 걸린다 — 이동은 메서드로 한다
      window.location.assign(url);
      return;
    }
    setBusy('oauth');
    // 제공자가 Supabase 대시보드에서 꺼져 있으면 오류가 돌아온다. 그대로 두면 사용자는
    // 앱을 떠난 뒤 영어 JSON을 본다 — 여기서 잡아 한국어로 보여준다.
    const { error } = await client().auth.signInWithOAuth({
      provider: p, options: { redirectTo: callbackUrl(location.origin, '/') },
    });
    setBusy(null);
    if (error) setMsg(authMessage(error.message));
  }

  const title = notice || (signup ? '처음이시군요.' : '이메일로 시작해요.');
  const sub = notice
    ? '메일이 안 보이면 스팸함도 확인해 주세요.'
    : signup
      ? '이메일과 비밀번호로 계정을 만들어요. 입력한 일정과 기록은 계정별로 따로 저장돼요.'
      : '비밀번호로 로그인하거나, 메일로 받은 링크로 로그인할 수 있어요.';

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <Badge />
        <div className="flex-1 text-base font-bold">공항 찾기</div>
      </TopBar>
      <main className="flex flex-1 justify-center px-4 pt-7 pb-6">
        <div className="flex w-full max-w-[480px] flex-col gap-5">
          <BotLine title={title} sub={sub} />

          {providers.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {providers.map(p => (
                <button
                  key={p} type="button" onClick={() => void social(p)} disabled={busy !== null}
                  className="min-h-[52px] rounded-full border border-line-strong bg-surface text-base font-semibold disabled:bg-disabled"
                >
                  {OAUTH_LABEL[p]}로 계속하기
                </button>
              ))}
              <div className="text-center text-[13px] text-muted">또는</div>
            </div>
          )}

          <form onSubmit={withEmailPassword} className="flex flex-col gap-2.5">
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" className={inputCls}
            />
            <input
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              placeholder={signup ? '비밀번호 (6자 이상)' : '비밀번호'}
              autoComplete={signup ? 'new-password' : 'current-password'} className={inputCls}
            />
            <button
              type="submit" disabled={busy !== null}
              className="min-h-[52px] rounded-full bg-accent text-base font-bold text-white disabled:bg-disabled"
            >
              {busy === 'email' ? '처리 중…' : signup ? '가입하고 시작하기' : '로그인'}
            </button>

            {!signup && (
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <button type="button" onClick={() => void sendLink()} disabled={busy !== null}
                  className="text-muted underline">
                  비밀번호 없이 로그인 링크 받기
                </button>
                <button type="button" onClick={() => void resetPassword()} disabled={busy !== null}
                  className="text-muted underline">
                  비밀번호를 잊었어요
                </button>
              </div>
            )}

            {devPassword && password && (
              <button
                type="button"
                onClick={async () => {
                  setMsg('');
                  const { error } = await client().auth.signInWithPassword({ email, password });
                  if (error) return setMsg(authMessage(error.message));
                  router.replace('/');
                }}
                className="min-h-12 rounded-full border border-line-strong bg-surface text-sm font-semibold"
              >
                (개발용) 비밀번호로 로그인
              </button>
            )}

            {msg && <div className="text-[13px] leading-normal text-danger">{msg}</div>}
          </form>

          <button
            type="button"
            onClick={() => { setSignup(!signup); setMsg(''); setNotice(''); }}
            className="text-[13px] font-semibold text-muted underline"
          >
            {signup ? '이미 계정이 있어요 — 로그인' : '처음이세요? 계정 만들기'}
          </button>
        </div>
      </main>
    </div>
  );
}
