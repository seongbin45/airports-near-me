'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge, BotLine, TopBar, inputCls } from '@/components/ui';

export default function LoginForm({ linkError, devPassword }: { linkError: boolean; devPassword: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [msg, setMsg] = useState(linkError ? '로그인 링크가 만료됐거나 잘못됐어요. 다시 받아주세요.' : '');

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setState('idle'); setMsg(error.message); return; }
    setState('sent');
    setMsg('');
  }

  async function passwordLogin() {
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) { setMsg(error.message); return; }
    router.replace('/');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar>
        <Badge />
        <div className="flex-1 text-base font-bold">공항 찾기</div>
      </TopBar>
      <main className="flex flex-1 justify-center px-4 pt-7 pb-6">
        <div className="flex w-full max-w-[480px] flex-col gap-5">
          <BotLine
            title={state === 'sent' ? `${email}로 로그인 링크를 보냈어요.` : '이메일로 시작해요.'}
            sub={state === 'sent'
              ? '메일의 링크를 누르면 이 화면으로 돌아와요. 입력한 일정과 기록은 계정별로 따로 저장돼요.'
              : '비밀번호 없이, 메일로 받은 링크로 로그인해요.'}
          />
          <form onSubmit={sendLink} className="flex flex-col gap-2.5">
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" className={inputCls}
            />
            {devPassword && (
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="(개발용) 비밀번호" autoComplete="current-password" className={inputCls}
              />
            )}
            <button
              type="submit" disabled={state === 'sending'}
              className="min-h-[52px] rounded-full bg-accent text-base font-bold text-white disabled:bg-disabled"
            >
              {state === 'sending' ? '보내는 중…' : state === 'sent' ? '링크 다시 보내기' : '로그인 링크 받기'}
            </button>
            {devPassword && password && (
              <button type="button" onClick={passwordLogin}
                className="min-h-12 rounded-full border border-line-strong bg-surface text-sm font-semibold">
                (개발용) 비밀번호로 로그인
              </button>
            )}
            {msg && <div className="text-[13px] leading-normal text-danger">{msg}</div>}
          </form>
        </div>
      </main>
    </div>
  );
}
