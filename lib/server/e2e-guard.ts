// E2E를 **테스트 전용 프로젝트에서만** 돌게 하는 표식 판정.
//
// URL·키·ref가 전부 틀려도 운영 DB에는 이 표식이 없으므로 운영 데이터를 건드리지 않는다.
// (URL에 ref가 들어 있는지 보는 검사는 보조일 뿐이다 — 키만 틀린 경우를 못 막는다.)
// 판정만 순수 함수로 떼어 두고, 스크립트가 표식을 읽어 넣는다.
export const E2E_MARKER_NOTE = 'e2e-test-project';

/** 표식이 없거나 값이 다르면 사람이 읽을 중단 사유를, 맞으면 null을 돌려준다. */
export function markerProblem(note: unknown): string | null {
  if (note === E2E_MARKER_NOTE) return null;
  return `e2e_marker의 note가 '${E2E_MARKER_NOTE}'가 아니에요(받은 값: ${JSON.stringify(note ?? null)}).`
    + ' 운영 DB에는 이 표식이 없습니다 — 테스트 전용 프로젝트에서 실행하세요.';
}
