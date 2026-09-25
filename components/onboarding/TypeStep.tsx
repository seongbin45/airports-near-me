export const USER_TYPES = [
  ['대학생', '수업 시간표 + 개인 일정'],
  ['직장인', '회사 일정 · 출장'],
  ['지방 거주자', '연휴마다 고향 방문'],
  ['출장 잦음', '짧은 일정 여러 번'],
] as const;

export type UserType = (typeof USER_TYPES)[number][0];

export default function TypeStep({ value, onChange }: { value: UserType | null; onChange: (t: UserType) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
      {USER_TYPES.map(([label, desc]) => (
        <button
          key={label}
          onClick={() => onChange(label)}
          className={`flex min-h-[76px] flex-col items-start justify-center gap-1 rounded-2xl px-[18px] py-3 text-left ${
            value === label ? 'border-[1.5px] border-accent bg-accent-soft' : 'border border-line-strong bg-surface'
          }`}
        >
          <div className="text-[15px] font-bold">{label}</div>
          <div className="text-xs text-muted">{desc}</div>
        </button>
      ))}
    </div>
  );
}
