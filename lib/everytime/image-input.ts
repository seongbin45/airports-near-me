// 시간표 캡처 인식 라우트(app/api/import/everytime-image)의 입력 검사와 호출 제한. 순수 함수라 테스트에서 바로 부른다.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** 브라우저가 1600px JPEG로 줄여 보내므로 보통 수백 KB다. 이보다 크면 줄이지 않은 원본이다 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 1분·하루 호출 상한 (비용·남용 방지). ai_calls의 kind='timetable_image' 행을 센다 */
export const PER_MINUTE = 3;
export const PER_DAY = 20;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** 파일 앞부분(매직 바이트)으로 실제 형식을 본다 — 확장자·선언된 형식만 믿지 않는다 */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export type ImageCheck = { ok: true; mediaType: ImageType; base64: string; bytes: number } | { ok: false; error: string };

export function checkImageInput(body: unknown): ImageCheck {
  const o = body as { image?: unknown; mediaType?: unknown } | null;
  if (typeof o?.image !== 'string' || typeof o.mediaType !== 'string') return { ok: false, error: '요청이 잘못됐어요.' };
  if (!(IMAGE_TYPES as readonly string[]).includes(o.mediaType)) return { ok: false, error: 'PNG·JPEG·WEBP 이미지만 읽을 수 있어요.' };
  const base64 = o.image.replace(/^data:[^,]*,/, '');
  // 크기를 먼저 본다 — 큰 문자열에 정규식을 돌리기 전에 거른다
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: '이미지가 너무 커요(4MB 초과). 시간표 부분만 캡처해 주세요.' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: '이미지를 읽을 수 없어요.' };
  const head = Uint8Array.from(atob(base64.slice(0, 24)), c => c.charCodeAt(0));
  const real = sniffImage(head);
  if (!real || real !== o.mediaType) return { ok: false, error: '이미지 형식이 맞지 않아요. 캡처 이미지를 그대로 올려 주세요.' };
  return { ok: true, mediaType: real, base64, bytes };
}

/** 최근 1분·오늘 호출 수로 막을지 정한다 (null이면 통과) */
export function rateLimitError(lastMinute: number, today: number): string | null {
  if (lastMinute >= PER_MINUTE) return '잠시 뒤 다시 시도해 주세요(1분에 3번까지).';
  if (today >= PER_DAY) return `캡처 인식은 하루 ${PER_DAY}번까지예요. 내일 다시 시도하거나 공유 링크 방식을 써 주세요.`;
  return null;
}
