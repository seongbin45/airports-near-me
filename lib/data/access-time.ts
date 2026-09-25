// 집 → 공항 이동 시간 어댑터 (다음 단계에서 구현).
// 차량: 카카오모빌리티 길찾기 (KAKAO_REST_KEY). 대중교통: ODsay (ODSAY_KEY).
// 구글 지도는 국내 자동차 경로를 지원하지 않는다.
// profiles.lat/lng(상세 주소 지오코딩)가 있으면 좌표 기준, 없으면 regions 대표 좌표 기준으로 계산해 access_times에 캐시한다.

import type { Mode } from '../recommend';

export interface AccessTimeSource {
  mode: Mode;
  name: string;
  minutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }, departAt: Date): Promise<number>;
}

export const accessTimeSources: AccessTimeSource[] = [];
