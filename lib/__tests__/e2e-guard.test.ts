import { describe, expect, it } from 'vitest';
import { E2E_MARKER_NOTE, markerProblem } from '../server/e2e-guard';

// 이 판정이 틀리면 운영 DB의 계정을 지우게 된다. 그래서 "표식이 없을 때 통과"하는 쪽으로 절대 기울지 않는지 고정한다.
describe('E2E 표식 판정', () => {
  it('표식 값이 맞으면 통과', () => {
    expect(markerProblem(E2E_MARKER_NOTE)).toBeNull();
  });
  it('표식이 없으면(운영) 중단 사유를 돌려준다', () => {
    for (const v of [null, undefined, '', 'other', 0, false]) {
      expect(markerProblem(v), `${JSON.stringify(v)}는 막아야 한다`).not.toBeNull();
    }
  });
  it('비슷하게 생긴 값도 통과시키지 않는다 (공백·대소문자)', () => {
    expect(markerProblem(` ${E2E_MARKER_NOTE}`)).not.toBeNull();
    expect(markerProblem(E2E_MARKER_NOTE.toUpperCase())).not.toBeNull();
  });
  it('중단 사유에 받은 값을 남긴다', () => {
    expect(markerProblem('prod')).toContain('"prod"');
  });
});
