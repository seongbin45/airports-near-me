import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '공항 찾기',
    short_name: '공항 찾기',
    description: '일정과 방문 기록으로 가장 알맞은 공항과 항공편을 찾아요.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f1ea',
    theme_color: '#fbf8f4',
    lang: 'ko',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
