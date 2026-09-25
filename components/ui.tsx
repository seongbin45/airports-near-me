import type { ReactNode } from 'react';

export function Badge({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex flex-none items-center justify-center bg-accent font-bold text-white"
      style={{ width: size, height: size, borderRadius: size / 3, fontSize: size * 0.42 }}
    >
      공
    </div>
  );
}

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="pt-safe flex flex-none items-center gap-3 border-b border-[#e8dfd4] bg-bar px-5 pb-3">
      {children}
    </header>
  );
}

/** 선택 칩 스타일 (프로토타입 pill) */
export function pill(on: boolean) {
  return on
    ? 'border-[1.5px] border-accent bg-accent-soft text-accent-ink'
    : 'border border-line-strong bg-surface text-ink';
}

export function BotLine({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Badge size={30} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="rounded-[4px_18px_18px_18px] border border-line bg-surface px-4 py-3 text-base leading-relaxed font-semibold text-pretty">
          {title}
        </div>
        {sub && <div className="pl-1 text-[13px] leading-normal text-muted text-pretty">{sub}</div>}
      </div>
    </div>
  );
}

export function SampleTag() {
  return <span className="flex-none rounded-lg bg-warn-soft px-2 py-0.5 text-[11px] whitespace-nowrap text-warn">화면용 샘플 데이터</span>;
}

export const inputCls =
  'min-h-12 rounded-[14px] border border-line-strong bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-accent';
