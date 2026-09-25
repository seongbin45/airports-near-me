// 프로토타입(design/공항 찾기 시작하기.dc.html)의 REGIONS 목록을 regions 시드 SQL로 바꾼다.
// 공식 행정표준코드로 교체하기 전까지 쓰는 임시 데이터.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../design/공항 찾기 시작하기.dc.html', import.meta.url), 'utf8');
const block = html.match(/const REGIONS = (\[[\s\S]*?\n\])/)[1];
const rows = Function(`return ${block}`)();

const q = s => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const values = [];
for (const [short, full, raw] of rows) {
  if (!raw) { values.push([short, full, null, null]); continue; }
  for (const item of raw.split(',')) {
    const m = item.match(/^(.+?)\((.+)\)$/);
    if (m) m[2].split('/').forEach(gu => values.push([short, full, m[1], gu]));
    else values.push([short, full, item, null]);
  }
}
console.log('insert into public.regions (sido_short, sido, sigungu, gu, full_name) values');
console.log(values.map(([s, f, g, u]) => `  (${q(s)}, ${q(f)}, ${q(g)}, ${q(u)}, ${q([f, g, u].filter(Boolean).join(' '))})`).join(',\n') + ';');
