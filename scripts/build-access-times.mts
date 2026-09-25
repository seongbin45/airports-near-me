// 집 → 공항 이동 시간 채우기.
//   npm run access-times -- [--mode car|transit] [--region 123] [--limit 200] [--refresh-days 30] [--delay 200] [--dry]
//
// 좌표가 있는 지역 × 좌표가 있는 공항 조합을 계산해 access_times에 넣는다.
// 실측 행을 refreshDays 안에 받았으면 건너뛰고, 화면용 샘플과 빈 조합을 먼저 채운다.
// --limit이 이번 실행의 API 호출 상한이다 (Kakao Mobility·ODsay 모두 일일 한도가 있다).
// 값을 못 구한 조합은 비워 두고 다음 실행에서 다시 시도한다. 추정값으로 채우지 않는다.
import { createClient } from '@supabase/supabase-js';
import { buildAccessTimeSources, planAccessTimes, type ExistingRow } from '../lib/data/access-time';
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
const dry = arg('dry'), delay = optNum('delay', 200);
const keyMode = opt('mode') as Mode | undefined;
const regionFilter = opt('region') ? Number(opt('region')) : null;

const sources = buildAccessTimeSources({ KAKAO_REST_KEY: process.env.KAKAO_REST_KEY, ODSAY_KEY: process.env.ODSAY_KEY })
  .filter(s => !keyMode || s.mode === keyMode);
if (!sources.length) {
  console.error('계산할 수단이 없어요. KAKAO_REST_KEY(차량) 또는 ODSAY_KEY(대중교통)를 설정하세요.');
  process.exit(2);
}

const [regions, airports, access] = await Promise.all([
  admin.from('regions').select('id, full_name, lat, lng').not('lat', 'is', null).not('lng', 'is', null).limit(1000),
  admin.from('airports').select('code, name_ko, lat, lng').not('lat', 'is', null).not('lng', 'is', null).limit(100),
  admin.from('access_times').select('region_id, airport, mode, fetched_at, is_sample').limit(100000),
]);
for (const r of [regions, airports, access]) {
  if (r.error) { console.error(`조회 실패: ${r.error.message}`); process.exit(2); }
}

const regionRows = (regions.data ?? []).filter(r => !regionFilter || r.id === regionFilter);
if (!regionRows.length) { console.error(regionFilter ? `지역 ${regionFilter}을(를) 찾지 못했어요(좌표가 있는 지역만).` : '좌표가 있는 지역이 없어요. 먼저 npm run geocode-regions 를 돌리세요.'); process.exit(1); }

const plan = planAccessTimes({
  regions: regionRows.map(r => ({ id: r.id as number, lat: r.lat as number, lng: r.lng as number })),
  airports: (airports.data ?? []).map(a => ({ code: a.code as string, lat: a.lat as number, lng: a.lng as number })),
  modes: sources.map(s => s.mode),
  existing: (access.data ?? []) as ExistingRow[],
  refreshDays: optNum('refresh-days', 30),
  limit: optNum('limit', 200),
  now: new Date(),
});

const label = new Map((regions.data ?? []).map(r => [r.id as number, r.full_name as string]));
const byCode = new Map((airports.data ?? []).map(a => [a.code as string, { name: a.name_ko as string, lat: a.lat as number, lng: a.lng as number }]));

console.log(`대상: 좌표 있는 조합 ${plan.candidateTotal}개 중 ${plan.todo.length}개를 이번에 계산 (최근 실측 ${plan.fresh}개 건너뜀, 좌표 없음 ${plan.noCoords}개 제외)`);
if (!plan.todo.length) { console.log('계산할 것이 없어요.'); process.exit(0); }

let saved = 0, failed = 0;
const errors: string[] = [];
for (const [idx, row] of plan.todo.entries()) {
  const region = regionRows.find(r => r.id === row.region_id)!;
  const airport = byCode.get(row.airport);
  if (!airport) continue;
  const source = sources.find(s => s.mode === row.mode)!;
  try {
    const minutes = await source.minutes(
      { lat: region.lat as number, lng: region.lng as number },
      { lat: airport.lat, lng: airport.lng },
      new Date(),
    );
    if (dry) console.log(`  [dry] ${label.get(row.region_id)} → ${airport.name} ${row.mode} ${minutes}분`);
    else {
      const { error } = await admin.from('access_times').upsert({
        region_id: row.region_id, airport: row.airport, mode: row.mode,
        minutes, source: source.name, fetched_at: new Date().toISOString(), is_sample: false,
      }, { onConflict: 'region_id,airport,mode' });
      if (error) throw new Error(error.message);
      console.log(`  저장  ${label.get(row.region_id)} → ${airport.name} ${row.mode} ${minutes}분  (${source.name})`);
    }
    saved++;
  } catch (e) {
    failed++;
    const msg = `${label.get(row.region_id)} → ${airport.name} ${row.mode}: ${(e as Error).message}`;
    errors.push(msg);
    console.error(`  오류  ${msg}`);
    if ((e as { code?: string }).code === 'KEY') { console.error('키가 거부돼 중단합니다.'); break; }
  }
  if (delay) await new Promise(r => setTimeout(r, delay));
  if ((idx + 1) % 25 === 0) console.log(`  … ${idx + 1}/${plan.todo.length}`);
}

console.log(`\n결과: 계산 ${saved} · 오류 ${failed} · 남은 조합 약 ${Math.max(0, plan.candidateTotal - plan.fresh - plan.todo.length)}`);
if (errors.length) console.log(`오류 예시: ${errors[0]}`);
console.log('다음: npm run doctor 로 접근 시간이 얼마나 덮였는지 확인하세요.');
