// 행정구역 대표 좌표 채우기.
//   npm run geocode-regions -- [--all] [--limit 250] [--delay 120] [--dry]
//
// 좌표가 없는 유효 구역만 대상으로 한다 (--all이면 전부 다시).
// 카카오 로컬 API 주소 검색에 시·도/시·군/구 이름을 그대로 질의한다.
import { createClient } from '@supabase/supabase-js';
import { geocodeAddress, regionQuery } from '../lib/data/geocode';

const arg = (name: string) => process.argv.includes(`--${name}`);
const optNum = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const key = need('KAKAO_REST_KEY');

const all = arg('all'), dry = arg('dry');
const limit = optNum('limit', 250), delay = optNum('delay', 120);

let query = admin.from('regions').select('id, sido, sigungu, gu, full_name, lat, lng')
  .or(`valid_to.is.null,valid_to.gte.${today}`)
  .order('id');
if (!all) query = query.is('lat', null);

const { data: rows, error } = await query.limit(limit);
if (error) { console.error(`regions 조회 실패: ${error.message}`); process.exit(2); }
const targets = rows ?? [];
console.log(`대상 ${targets.length}곳 (오늘 ${today}, --all=${all})`);
if (!targets.length) process.exit(0);

let ok = 0, miss = 0, failed = 0;
for (const r of targets) {
  const q = regionQuery(r as { sido: string; sigungu: string | null; gu: string | null });
  try {
    const point = await geocodeAddress(q, { key });
    if (!point) { miss++; console.log(`  못 찾음  ${r.full_name}  ("${q}")`); continue; }
    if (dry) { ok++; console.log(`  [dry]    ${r.full_name} → ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}  (${point.matched || q})`); }
    else {
      const { error: upErr } = await admin.from('regions')
        .update({ lat: point.lat, lng: point.lng, geocoded_at: new Date().toISOString() }).eq('id', r.id);
      if (upErr) throw new Error(upErr.message);
      ok++;
      console.log(`  저장     ${r.full_name} → ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}  (${point.matched || q})`);
    }
  } catch (e) {
    failed++;
    console.error(`  오류     ${r.full_name}: ${(e as Error).message}`);
    // 키가 거부되면 나머지도 전부 실패한다 — 즉시 멈춘다
    if ((e as { code?: string }).code === 'KEY') break;
  }
  if (delay) await new Promise(r => setTimeout(r, delay));
}

console.log(`\n결과: 저장 ${ok} · 못 찾음 ${miss} · 오류 ${failed}`);
if (miss) console.log('못 찾은 구역은 이름이 행정구역 개편 전 표기이거나, 카카오 주소 DB에 없는 이름이에요. 그 구역은 좌표가 없어 접근 시간을 계산할 수 없어요.');
console.log('다음: npm run access-times 로 이동 시간을 채우고, npm run doctor 로 덮인 비율을 확인하세요.');
