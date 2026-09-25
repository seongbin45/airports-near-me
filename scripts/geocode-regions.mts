// 행정구역 대표 좌표 채우기.
//   npm run geocode-regions -- [--all] [--limit 300] [--dry]
//
// 좌표가 없는 유효 구역만 대상으로 한다 (--all이면 전부 다시).
// 시·도/시·군/구 이름을 그대로 질의한다. 제공자 순서: 카카오 로컬 → 네이버 Geocoding → Nominatim(키 없음).
// 한 제공자의 한도가 다 되거나 주소를 못 찾으면 다음 제공자에게 묻는다 (lib/data/map-chain.ts).
import { createClient } from '@supabase/supabase-js';
import { buildGeocoders, regionQuery, type GeocoderEnv, type GeoPoint } from '../lib/data/geocode';
import { createChain } from '../lib/data/map-chain';
import { fetchAllRows } from '../lib/server/paginate';

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

const all = arg('all'), dry = arg('dry');
const limit = optNum('limit', 300);

const geocoders = buildGeocoders(process.env as GeocoderEnv);
console.log(`제공자 순서: ${geocoders.map(g => g.name).join(' → ')}`);
const chain = createChain<string, GeoPoint>(geocoders, {
  retries: 1,
  fallThroughOnNoData: true,
  log: m => console.log(`  ⚠ ${m}`),
});

type RegionRow = { id: number; sido: string; sigungu: string | null; gu: string | null; full_name: string };
const rows = await fetchAllRows<RegionRow>((from, to) => {
  let q = admin.from('regions').select('id, sido, sigungu, gu, full_name')
    .or(`valid_to.is.null,valid_to.gte.${today}`).order('id');
  if (!all) q = q.is('lat', null);
  return q.range(from, to);
});
const targets = rows.slice(0, limit);
console.log(`대상 ${targets.length}곳 (좌표 없는 유효 구역 ${rows.length}곳 중, 오늘 ${today}, --all=${all})`);
if (!targets.length) process.exit(0);

let ok = 0, miss = 0, failed = 0;
for (const r of targets) {
  const q = regionQuery(r);
  const res = await chain.run(q);
  if (res.ok) {
    const p = res.value;
    if (dry) console.log(`  [dry]    ${r.full_name} → ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}  (${res.provider}: ${p.matched || q})`);
    else {
      const { error } = await admin.from('regions')
        .update({ lat: p.lat, lng: p.lng, geocoded_at: new Date().toISOString(), geocode_source: res.provider }).eq('id', r.id);
      if (error) { failed++; console.error(`  저장 실패 ${r.full_name}: ${error.message}`); continue; }
      console.log(`  저장     ${r.full_name} → ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}  (${res.provider})`);
    }
    ok++;
  } else if (res.reason === 'exhausted') {
    console.error(`\n모든 제공자를 쓸 수 없어 멈춥니다: ${res.error}`);
    break;
  } else if (res.reason === 'nodata') {
    miss++;
    console.log(`  못 찾음  ${r.full_name}  ("${q}")`);
  } else {
    failed++;
    console.error(`  오류     ${r.full_name}: ${res.error}`);
  }
}

const usage = Object.entries(chain.usage()).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음';
const gone = Object.entries(chain.exhausted()).map(([k, why]) => `${k}(${why})`).join(', ');
console.log(`\n결과: 저장 ${ok} · 못 찾음 ${miss} · 오류 ${failed}`);
console.log(`제공자별: ${usage}${gone ? ` · 이번 실행에서 사용 중지: ${gone}` : ''}`);
if (miss) console.log('못 찾은 구역은 어느 제공자에도 없는 이름이에요(개편 직후 이름 등). 그 구역은 좌표가 없어 접근 시간을 계산할 수 없어요.');
console.log('다음: npm run access-times 로 이동 시간을 채우고, npm run doctor 로 덮인 비율을 확인하세요.');
