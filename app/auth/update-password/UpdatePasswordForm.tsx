'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge, BotLine, TopBar, inputCls } from '@/components/ui';
import { authMessage } from '@/lib/auth/messages';

export default function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg(authMessage(error.message));
    setDone(true);
    setTimeout(() => router.replace('/'), 1200);
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
            title={done ? '비밀번호를 바꿨어요.' : '새 비밀번호를 정해주세요.'}
            sub={done
              ? '잠시 뒤 첫 화면으로 이동해요.'
              : '재설정 링크를 연 브라우저에서만 바꿀 수 있어요. 다른 기기에서 열었다면 그 기기에서 다시 받아주세요.'}
          />
          {!done && (
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              <input
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="새 비밀번호 (6자 이상)" autoComplete="new-password" className={inputCls}
              />
              <button
                type="submit" disabled={busy}
                className="min-h-[52px] rounded-full bg-accent text-base font-bold text-white disabled:bg-disabled"
              >
                {busy ? '바꾸는 중…' : '비밀번호 바꾸기'}
              </button>
              {msg && <div className="text-[13px] leading-normal text-danger">{msg}</div>}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
