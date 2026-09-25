export interface RegionRow {
  id: number;
  sido_short: string;
  sido: string;
  sigungu: string | null;
  gu: string | null;
  full_name: string;
}

export interface Sgg { name: string; gus: { name: string; id: number }[]; id: number | null }
export interface Sido { short: string; full: string; sggs: Sgg[]; id: number | null }

/** DB 행(현재 유효한 구역) → 시·도 / 시·군·구 / 구 트리. id는 그 단계에서 선택이 끝나는 행의 id. */
export function buildRegionTree(rows: RegionRow[]): Sido[] {
  const sidos: Sido[] = [];
  for (const r of rows) {
    let s = sidos.find(x => x.full === r.sido);
    if (!s) sidos.push(s = { short: r.sido_short, full: r.sido, sggs: [], id: null });
    if (!r.sigungu) { s.id = r.id; continue; }
    let g = s.sggs.find(x => x.name === r.sigungu);
    if (!g) s.sggs.push(g = { name: r.sigungu, gus: [], id: null });
    if (r.gu) g.gus.push({ name: r.gu, id: r.id });
    else g.id = r.id;
  }
  return sidos;
}

/** 부분 이름 검색 ("영통", "해운대") — 최대 8개 */
export function searchRegions(rows: RegionRow[], q: string): RegionRow[] {
  const t = q.trim().replace(/\s+/g, '');
  if (!t) return [];
  return rows.filter(r => [r.sigungu, r.gu].filter(Boolean).join('').includes(t) || (!r.sigungu && r.sido.includes(t))).slice(0, 8);
}
