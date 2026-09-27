// 에브리타임 공유 시간표 XML(사용자 브라우저가 받아 붙여넣은 것)을 수업 후보로 바꾼다.
// 서버는 에브리타임에 접속하지 않는다 — 이 파서는 브라우저에서 붙여넣은 텍스트만 읽는다(docs/EVERYTIME.md).
//
// 구조(공개 구현 두 곳 every2cal·linker에서 교차 확인, 실측 전):
//   <subject><name value="…"/><professor value="…"/><time><data day="0" starttime="108" endtime="123" place="…"/></time></subject>
//   starttime·endtime은 5분 단위 정수(108 × 5분 = 09:00). day는 0=월 … 6=일로 보인다(UNVERIFIED — docs/UNVERIFIED_VALUES.md).
import { normalizeBlocks, type EtBlock, type EtItem, type EtSkip } from './items';

/** 북마클릿이 붙이는 머리말. 무엇을 붙여넣었는지 알아보려고 쓴다 */
export const PASTE_HEADER = 'ETX1';

/** 시안의 공유 링크 형식 — 링크 자체를 붙여넣었을 때 안내에 쓴다 */
export const SHARE_URL = /^(https?:\/\/)?(www\.)?everytime\.kr\/@[A-Za-z0-9]{8,}\/?$/;

const DAY_BY_INDEX = ['월', '화', '수', '목', '금', '토', '일'];

export type XmlResult =
  | { ok: true; semester: string | null; items: EtItem[]; skipped: EtSkip[] }
  | { ok: false; kind: 'link' | 'format' | 'empty'; error: string };

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  for (const m of tag.matchAll(/([A-Za-z_][\w-]*)\s*=\s*'([^']*)'/g)) out[m[1]] ??= decode(m[2]);
  return out;
}

/** 5분 단위 정수 → "HH:MM". 0–287(00:00–23:55) 밖이면 null */
function slot(v: string | undefined): string | null {
  if (v == null || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  if (n < 0 || n > 287) return null;
  const m = n * 5;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function parseTimetableXml(raw: string): XmlResult {
  let text = raw.trim();
  if (SHARE_URL.test(text)) {
    return { ok: false, kind: 'link', error: '링크 자체는 여기서 읽을 수 없어요. 이 링크를 브라우저에서 열고, 북마크 [에브리타임 → 공항 찾기]를 누른 뒤 복사된 내용을 붙여넣어 주세요.' };
  }
  if (text.startsWith(PASTE_HEADER)) text = text.slice(PASTE_HEADER.length).trim();
  if (!/<response[\s>/]/.test(text)) {
    return { ok: false, kind: 'format', error: '에브리타임 시간표 내용이 아니에요. 북마크를 누른 뒤 복사된 내용을 그대로 붙여넣어 주세요.' };
  }

  const tableTag = /<table\b[^>]*>/.exec(text)?.[0];
  const t = tableTag ? attrs(tableTag) : {};
  const semester = t.year && t.semester ? `${t.year}년 ${t.semester}학기` : null;

  const blocks: EtBlock[] = [], online: string[] = [], skipped: EtSkip[] = [];
  const subjects = [...text.matchAll(/<subject\b[^>]*>([\s\S]*?)<\/subject>/g)].map(m => m[1]);
  for (const body of subjects) {
    const nameTag = /<name\b[^>]*\/?>/.exec(body)?.[0];
    const name = nameTag ? (attrs(nameTag).value ?? '').trim() : '';
    const datas = [...body.matchAll(/<data\b[^>]*\/?>/g)].map(m => attrs(m[0]));
    if (!datas.length) { online.push(name); continue; }
    for (const d of datas) {
      const start = slot(d.starttime), end = slot(d.endtime);
      const day = DAY_BY_INDEX[Number(d.day)] ?? (d.day ?? '');
      if (!start || !end) { skipped.push({ name: name || '(이름 없음)', reason: `시각 값을 읽을 수 없어요(${d.starttime ?? '-'}–${d.endtime ?? '-'})` }); continue; }
      blocks.push({ name, place: d.place ?? '', day, start, end });
    }
  }

  const r = normalizeBlocks(blocks, online, { needsTimeCheck: false });
  const allSkipped = [...skipped, ...r.skipped];
  if (!r.items.length) {
    return subjects.length
      ? { ok: false, kind: 'format', error: `과목 ${subjects.length}개를 찾았지만 시간표에 넣을 수 있는 수업이 없어요. ${allSkipped.map(s => `${s.name}: ${s.reason}`).join(' / ')}` }
      : { ok: false, kind: 'empty', error: '시간표가 비어 있거나 비공개예요. 에브리타임에서 공개 범위를 "전체 공개"로 바꾼 뒤 다시 시도해 주세요.' };
  }
  return { ok: true, semester, items: r.items, skipped: allSkipped };
}
