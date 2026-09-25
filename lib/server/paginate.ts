// Supabase(PostgREST)는 한 번에 최대 1,000행만 돌려준다 (프로젝트 기본 max rows).
// .limit(100000)을 줘도 1,000에서 잘리므로, 전체가 필요하면 .range()로 끝까지 나눠 받는다.
// 이 파일은 'server-only'를 import하지 않는다 — scripts/*.mts에서도 쓴다.

export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * build(from, to)가 .range(from, to)까지 붙인 쿼리를 돌려주면 끝까지 모아 준다.
 * 정렬 없는 쿼리는 페이지 사이에 행이 섞일 수 있으니 build 안에서 .order()를 붙인다.
 */
export async function fetchAllRows<T>(build: (from: number, to: number) => Page<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message || JSON.stringify(error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
