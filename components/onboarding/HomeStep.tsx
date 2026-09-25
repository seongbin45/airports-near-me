'use client';

import { useMemo, useState } from 'react';
import { buildRegionTree, searchRegions, type RegionRow } from '@/lib/regions';
import { inputCls, pill } from '@/components/ui';

interface Props {
  regions: RegionRow[];
  regionId: number | null;
  onRegion: (id: number | null) => void;
  address: string;
  onAddress: (s: string) => void;
}

export default function HomeStep({ regions, regionId, onRegion, address, onAddress }: Props) {
  const tree = useMemo(() => buildRegionTree(regions), [regions]);
  const current = regions.find(r => r.id === regionId);
  const [sido, setSido] = useState(current?.sido ?? '');
  const [sgg, setSgg] = useState(current?.sigungu ?? '');
  const [q, setQ] = useState('');

  const sidoObj = tree.find(s => s.full === sido);
  const sggObj = sidoObj?.sggs.find(g => g.name === sgg);
  const results = useMemo(() => searchRegions(regions, q), [regions, q]);

  function pickSido(full: string) {
    setSido(full); setSgg('');
    onRegion(tree.find(s => s.full === full)?.id ?? null); // 세종처럼 시·군·구가 없으면 바로 확정
  }
  function pickSgg(name: string) {
    setSgg(name);
    onRegion(sidoObj?.sggs.find(g => g.name === name)?.id ?? null); // 구가 있는 시는 구까지 골라야 확정
  }
  function pickSearch(r: RegionRow) {
    setSido(r.sido); setSgg(r.sigungu ?? ''); setQ(''); onRegion(r.id);
  }

  const chip = 'min-h-11 rounded-full px-3.5 text-sm font-semibold';

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="동네 이름으로 찾기 (예: 영통, 해운대, 서귀포)"
          className="min-h-[50px] rounded-full border border-line-strong bg-surface px-[18px] text-[15px] outline-none focus:border-accent"
        />
        {q.trim() && (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
            {results.map((r, i) => (
              <button key={r.id} onClick={() => pickSearch(r)}
                className={`flex min-h-12 items-center justify-between gap-2.5 px-4 text-left text-sm ${i ? 'border-t border-divider' : ''}`}>
                <span className="font-semibold">{[r.sigungu, r.gu].filter(Boolean).join(' ') || r.sido}</span>
                <span className="flex-none text-xs text-muted">{r.sigungu ? r.sido : ''}</span>
              </button>
            ))}
            {!results.length && <div className="px-4 py-3.5 text-[13px] text-muted">일치하는 시·군·구가 없어요.</div>}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-ink-2">시·도 <span className="font-normal text-faint">{tree.length}개 중 선택</span></div>
        <div className="flex flex-wrap gap-2">
          {tree.map(s => (
            <button key={s.full} onClick={() => pickSido(s.full)} className={`${chip} ${pill(sido === s.full)}`}>{s.short}</button>
          ))}
        </div>
      </div>

      {!!sidoObj?.sggs.length && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-ink-2">{sidoObj.full} · 시·군·구 <span className="font-normal text-faint">{sidoObj.sggs.length}곳</span></div>
          <div className="flex flex-wrap gap-2">
            {sidoObj.sggs.map(g => (
              <button key={g.name} onClick={() => pickSgg(g.name)} className={`${chip} ${pill(sgg === g.name)}`}>{g.name}</button>
            ))}
          </div>
        </div>
      )}

      {!!sggObj?.gus.length && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold text-ink-2">{sgg} · 구</div>
          <div className="flex flex-wrap gap-2">
            {sggObj.gus.map(u => (
              <button key={u.id} onClick={() => onRegion(u.id)} className={`${chip} ${pill(regionId === u.id)}`}>{u.name}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold text-ink-2">상세 주소 <span className="font-normal text-faint">선택 · 공항까지 시간이 더 정확해져요</span></div>
        <input value={address} onChange={e => onAddress(e.target.value)} placeholder="예: 영통로 200" className={inputCls} />
      </div>

      <div className="flex flex-col gap-1 rounded-[14px] bg-sand px-3.5 py-3">
        <div className={`text-[15px] font-bold ${current ? 'text-ink' : 'text-faint'}`}>
          {current ? current.full_name + (address.trim() ? ` ${address.trim()}` : '') : sido ? '시·군·구를 골라주세요' : '시·도를 골라주세요'}
        </div>
        <div className="text-[11px] text-muted">행정안전부 행정구역 기준 · 2026년 9월 (인천 구 개편, 전남광주통합특별시, 화성시 4개 구 반영)</div>
      </div>
    </div>
  );
}
