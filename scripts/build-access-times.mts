// 집 → 공항 이동 시간 채우기.
//   npm run access-times -- [--mode car|transit] [--region 123] [--limit 4000] [--refresh-days 30] [--max-fail 5] [--concurrency 4] [--dry]
//
// 좌표가 있는 지역 × 좌표가 있는 공항 중 **같은 권역**(제주 ↔ CJU, 육지 ↔ 육지 공항) 조합을 계산해 access_times에 넣는다.
// 실측 행을 refreshDays 안에 받았으면 건너뛰고, 화면용 샘플과 빈 조합을 먼저 채운다.
// 차량 제공자 순서: 카카오모빌리티 → TMAP → 네이버 → OSRM(키 없음). 한도가 다 되면 다음 제공자로 넘어간다.
// 값을 못 구한 조합은 비워 두고 다음 실행에서 다시 시도한다. 추정값으로 채우지 않는다.
import { createClient } from '@supabase/supabase-js';
import {
  airportZone, buildAccessTimeSources, planAccessTimes, regionZone, type AccessTimeSource, type ExistingRow, type LatLng, type SourceEnv,
} from '../lib/data/access-time';
import { createChain, type MapChain } from '../lib/data/map-chain';
import { fetchAllRows } from '../lib/server/paginate';
import type { Mode } from '../lib/recommend';

const arg = (name: string) => process.argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const optNum = (name: string, fallback: number) => {
  const v = Number(opt(name));
  return Number.isFinite(v) ? v : fallback;
};

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const dry = arg('dry');
const keyMode = opt('mode') as Mode | undefined;
const regionFilter = opt('region') ? Number(opt('region')) : null;
const maxFail = optNum('max-fail', 5);
// 동시에 계산할 조합 수. 공용 서버(OSRM)는 체인이 제공자별 간격을 따로 지킨다.
const concurrency = Math.max(1, optNum('concurrency', 4));

const sources = buildAccessTimeSources(process.env as SourceEnv).filter(s => !keyMode || s.mode === keyMode);
if (!sources.length) {
  console.error('계산할 수단이 없어요. 차량은 OSRM_URL=off가 아니면 항상 있고, 대중교통은 ODSAY_KEY가 필요해요.');
  process.exit(2);
}

// 수단마다 제공자 체인 하나
type Pair = { from: LatLng; to: LatLng };
const chains = new Map<Mode, MapChain<Pair, number>>();
for (const mode of [...new Set(sources.map(s => s.mode))]) {
  const list = sources.filter(s => s.mode === mode);
  console.log(`${mode === 'car' ? '차량' : '대중교통'} 제공자 순서: ${list.map(s => s.name).join(' → ')}`);
  chains.set(mode, createChain<Pair, number>(
    list.map((s: AccessTimeSource) => ({ name: s.name, minIntervalMs: s.minIntervalMs, call: ({ from, to }) => s.minutes(from, to, new Date()) })),
    { retries: 1, fallThroughOnNoData: false, log: m => console.log(`  ⚠ ${m}`) },
  ));
}

type RegionRow = { id: number; full_name: string; sido: string; sigungu: string | null; lat: number; lng: number };
const [regions, airports, access] = await Promise.all([
  fetchAllRows<RegionRow>((f, t) => admin.from('regions').select('id, full_name, sido, sigungu, lat, lng')
    .not('lat', 'is', null).not('lng', 'is', null).order('id').range(f, t)),
  admin.from('airports').select('code, name_ko, lat, lng').not('lat', 'is', null).not('lng', 'is', null),
  fetchAllRows<ExistingRow>((f, t) => admin.from('access_times').select('region_id, airport, mode, fetched_at, is_sample').order('id').range(f, t)),
]);
if (airports.error) { console.error(`airports 조회 실패: ${airports.error.message}`); process.exit(2); }

const regionRows = regions.filter(r => !regionFilter || r.id === regionFilter);
if (!regionRows.length) {
  console.error(regionFilter ? `지역 ${regionFilter}을(를) 찾지 못했어요(좌표가 있는 지역만).` : '좌표가 있는 지역이 없어요. 먼저 npm run geocode-regions 를 돌리세요.');
  process.exit(1);
}

const plan = planAccessTimes({
  regions: regionRows.map(r => ({ id: r.id, lat: r.lat, lng: r.lng, zone: regionZone(r) })),
  airports: (airports.data ?? []).map(a => ({ code: a.code as string, lat: a.lat as number, lng: a.lng as number, zone: airportZone(a.code as string) })),
  modes: [...chains.keys()],
  existing: access,
  refreshDays: optNum('refresh-days', 30),
  limit: optNum('limit', 4000),
  now: new Date(),
});

const label = new Map(regionRows.map(r => [r.id, r.full_name]));
const byCode = new Map((airports.data ?? []).map(a => [a.code as string, { name: a.name_ko as string, lat: a.lat as number, lng: a.lng as number }]));

console.log(`대상: 도달 가능한 조합 ${plan.candidateTotal}개 중 ${plan.todo.length}개를 이번에 계산 `
  + `(최근 실측 ${plan.fresh}개 건너뜀, 권역이 달라 길 없음 ${plan.unreachable}개·좌표 없음 ${plan.noCoords}개 제외)`);
if (!plan.todo.length) { console.log('계산할 것이 없어요.'); process.exit(0); }

let saved = 0, noRoute = 0, failed = 0, streak = 0, done = 0, stop = '';
const errors: string[] = [];
const started = Date.now();
let cursor = 0;

async function work(row: (typeof plan.todo)[number]) {
  const region = regionRows.find(r => r.id === row.region_id)!;
  const airport = byCode.get(row.airport);
  if (!airport) return;
  const res = await chains.get(row.mode)!.run({ from: { lat: region.lat, lng: region.lng }, to: { lat: airport.lat, lng: airport.lng } });
  const name = `${label.get(row.region_id)} → ${airport.name} ${row.mode}`;

  if (res.ok) {
    streak = 0;
    if (dry) console.log(`  [dry] ${name} ${res.value}분  (${res.provider})`);
    else {
      const { error } = await admin.from('access_times').upsert({
        region_id: row.region_id, airport: row.airport, mode: row.mode,
        minutes: res.value, source: res.provider, fetched_at: new Date().toISOString(), is_sample: false,
      }, { onConflict: 'region_id,airport,mode' });
      if (error) { failed++; errors.push(`${name}: 저장 실패 ${error.message}`); return; }
    }
    saved++;
  } else if (res.reason === 'exhausted') {
    stop = `${row.mode} 제공자를 모두 쓸 수 없어 멈춥니다: ${res.error}`;
  } else if (res.reason === 'nodata') {
    // 경로 없음(너무 가까움·섬 등)은 조합의 사실이지 제공자 문제가 아니다
    noRoute++;
    errors.push(`${name}: ${res.error}`);
  } else {
    failed++; streak++;
    errors.push(`${name}: ${res.error}`);
    console.error(`  오류  ${name}: ${res.error}`);
    if (streak >= maxFail * concurrency) stop = `연속 ${streak}번 실패해 멈춥니다 (예비 제공자로도 못 구함).`;
  }
}

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (!stop && cursor < plan.todo.length) {
    await work(plan.todo[cursor++]);
    if (++done % 100 === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`  … ${done}/${plan.todo.length} (${mins}분) 저장 ${saved} · 경로 없음 ${noRoute} · 오류 ${failed}`);
    }
  }
}));
if (stop) console.error(`\n${stop}`);

console.log(`\n결과: 계산 ${saved} · 경로 없음 ${noRoute} · 오류 ${failed}`);
for (const [mode, chain] of chains) {
  const usage = Object.entries(chain.usage()).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음';
  const gone = Object.entries(chain.exhausted()).map(([k, why]) => `${k}(${why})`).join(', ');
  console.log(`${mode} 제공자별 성공: ${usage}${gone ? ` · 사용 중지: ${gone}` : ''}`);
}
if (errors.length) console.log(`예시: ${errors.slice(0, 3).join(' / ')}`);
console.log('다음: npm run doctor 로 접근 시간이 얼마나 덮였는지 확인하세요.');
