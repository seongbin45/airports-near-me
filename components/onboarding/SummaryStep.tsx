export default function SummaryStep({ rows, onFinish, saving }: { rows: { k: string; v: string }[]; onFinish: () => void; saving: boolean }) {
  return (
    <>
      <div className="flex flex-col rounded-2xl border border-line bg-surface">
        {rows.map((f, i) => (
          <div key={f.k} className={`flex justify-between gap-3 px-4 py-[13px] ${i ? 'border-t border-divider' : ''}`}>
            <div className="flex-none text-[13px] text-muted">{f.k}</div>
            <div className="text-right text-sm font-semibold">{f.v}</div>
          </div>
        ))}
      </div>
      <button onClick={onFinish} disabled={saving}
        className="flex min-h-[52px] items-center justify-center rounded-full bg-accent text-base font-bold text-white disabled:bg-disabled">
        {saving ? '저장 중…' : '대화로 공항 찾기'}
      </button>
    </>
  );
}
