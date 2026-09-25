interface Field { label: string; value?: string | null; src: string }

/** 980px 이상은 오른쪽 고정 패널, 그보다 좁으면 헤더 버튼으로 여는 하단 시트 */
export default function InfoPanel({ fields, aiCalls, aiEnabled, open, onClose }: { fields: Field[]; aiCalls: number; aiEnabled: boolean; open: boolean; onClose: () => void }) {
  return (
    <aside
      className={`${open ? 'flex' : 'hidden'} fixed inset-x-0 bottom-0 z-10 max-h-full flex-col gap-3.5 overflow-y-auto rounded-t-[20px] bg-bar px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-[0_-8px_30px_rgba(60,40,20,.15)]
        min-[980px]:static min-[980px]:flex min-[980px]:w-[340px] min-[980px]:flex-none min-[980px]:rounded-none min-[980px]:border-l min-[980px]:border-[#e8dfd4] min-[980px]:shadow-none`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold">수집된 정보</div>
        <button onClick={onClose} className="min-h-10 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] min-[980px]:hidden">닫기</button>
      </div>
      <div className="text-xs leading-normal text-muted text-pretty">모든 값은 입력하신 내용이나 계정 DB에서 가져옵니다. 추정한 값은 넣지 않습니다.</div>
      <div className="flex flex-col rounded-2xl border border-line bg-surface">
        {fields.map((f, i) => (
          <div key={f.label} className={`flex flex-col gap-0.5 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
            <div className="flex justify-between gap-2">
              <div className="text-xs text-muted">{f.label}</div>
              <div className="text-right text-[11px] text-[#8a8077]">{f.value ? f.src : ''}</div>
            </div>
            <div className={`text-sm font-semibold ${f.value ? 'text-ink' : 'text-[#b3a99f]'}`}>{f.value || '아직 없음'}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-[#f1eadf] p-3.5">
        <div className="text-xs font-bold text-ink-2">AI 사용</div>
        <div className="text-[13px] leading-normal text-ink-2 text-pretty">{aiEnabled ? '자동 호출 없음. 버튼을 눌렀을 때만 호출되고, 답에 나온 편명·시각은 DB 값과 대조한 뒤에만 보여줍니다.' : '꺼져 있음. DB 결과 표만 보여드려요. 내 데이터 → 개인정보에서 켤 수 있어요.'}</div>
        <div className="text-[13px] font-semibold">이번 대화 AI 호출 {aiCalls}회</div>
      </div>
    </aside>
  );
}
