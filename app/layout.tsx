import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '공항 찾기',
  description: '일정과 방문 기록으로 가장 알맞은 공항과 항공편을 찾아요.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fbf8f4',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
