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

/**
 * Supabase 프로젝트 URL → 호스트. 못 읽으면 null.
 * 끝의 `/`나 경로가 붙어 있어도 같은 호스트로 본다.
 */
export function projectHost(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * 두 URL이 **같은 프로젝트**를 가리키는가. 둘 다 읽히고 호스트가 같으면 true.
 *
 * 표식 검사보다 이걸 먼저 보는 이유: 표식 테이블이 없는 건 "운영 프로젝트라서"일 수도 있고
 * "표식 만들기를 잊어서"일 수도 있다. 앞의 경우라면 사용자가 안내대로 표식을 만들려다
 * **운영 DB에 표식을 심어 보호를 무력화**하게 된다. 그래서 운영 URL을 알 때는 그 전에 막는다.
 *
 * 한쪽이라도 못 읽으면 false(=막지 않음)다. 판정 불가는 막는 사유로 쓰지 않는다 —
 * URL 형식이 달라도 표식 검사가 여전히 뒤에서 지킨다.
 */
export function sameProject(a: string | null | undefined, b: string | null | undefined): boolean {
  const ha = projectHost(a);
  const hb = projectHost(b);
  return !!ha && !!hb && ha === hb;
}
