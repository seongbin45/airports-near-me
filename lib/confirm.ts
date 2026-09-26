// 되돌릴 수 없는 동작(방문 기록 전체 삭제, 계정 삭제)의 "한 번 더 누르면 확정" 규칙.
// 모바일에서는 두 번 톡톡 치는 일이 흔해, 확인 문구를 읽기도 전에 두 번째 탭이 들어온다.
// 확인 상태가 된 뒤 이 시간 안에 온 두 번째 탭은 무시한다.
export const CONFIRM_MIN_MS = 1000;

/** armedAt: 확인 상태가 된 시각(ms). null이면 아직 확인 전. */
export function isDeliberateConfirm(armedAt: number | null, now: number, minMs = CONFIRM_MIN_MS): boolean {
  return armedAt != null && now - armedAt >= minMs;
}
