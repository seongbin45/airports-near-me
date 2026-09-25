export interface CountryRow { code: string; name_ko: string; enabled: boolean }

export default function CountryStep({ countries, value, onChange }: { countries: CountryRow[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {countries.map(c => {
        const on = value === c.code;
        return (
          <button
            key={c.code}
            disabled={!c.enabled}
            onClick={() => onChange(c.code)}
            className={`flex min-h-[60px] items-center gap-3 rounded-2xl px-[18px] text-left ${
              !c.enabled ? 'cursor-not-allowed border border-line-strong bg-[#f1ebe2] text-[#a39889]'
                : on ? 'border-[1.5px] border-accent bg-accent-soft' : 'border border-line-strong bg-surface'
            }`}
          >
            <div className="w-10 text-[13px] font-bold tracking-wider">{c.code}</div>
            <div className="flex-1 text-[15px] font-semibold">{c.name_ko}</div>
            <div className={`text-xs ${c.enabled ? 'text-accent' : ''}`}>{c.enabled ? '이용 가능' : '승인 대기'}</div>
          </button>
        );
      })}
      <div className="text-xs leading-normal text-muted text-pretty">다른 국가는 서비스가 안정화된 뒤 관리자 승인을 거쳐 순서대로 열립니다.</div>
    </div>
  );
}
