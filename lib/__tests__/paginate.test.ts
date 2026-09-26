import { describe, expect, it } from 'vitest';
import { fetchAllRows } from '../server/paginate';

// PostgREST는 한 번에 1,000행까지만 준다. 내보내기·doctor가 여기 기대를 걸고 있으므로
// 페이지 경계에서 멈추는 규칙과 오류 처리를 고정한다.

describe('fetchAllRows — PostgREST 행 상한 우회', () => {
  it('덜 찬 페이지가 나올 때까지 이어 받는다', async () => {
    const total = 2500;
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<number>(async (f, t) => {
      calls.push([f, t]);
      const n = Math.max(0, Math.min(t + 1, total) - f);
      return { data: Array.from({ length: n }, (_, i) => f + i), error: null };
    });
    expect(rows).toHaveLength(total);
    expect(rows[0]).toBe(0);
    expect(rows[total - 1]).toBe(total - 1);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('딱 나누어떨어지면 한 번 더 물어보고 0행에서 멈춘다', async () => {
    const calls: [number, number][] = [];
    const rows = await fetchAllRows<number>(async (f, t) => {
      calls.push([f, t]);
      return { data: f === 0 ? [1, 2] : [], error: null };
    }, 2);
    expect(rows).toEqual([1, 2]);
    expect(calls).toEqual([[0, 1], [2, 3]]);
  });
  it('오류는 던진다 — 조용히 일부만 돌려주지 않는다', async () => {
    await expect(fetchAllRows<number>(async () => ({ data: null, error: { message: 'nope' } }))).rejects.toThrow('nope');
  });
});
