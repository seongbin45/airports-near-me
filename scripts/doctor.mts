// 데이터 상태 점검 — 로그를 뒤지지 않고 서비스가 지금 어떤 상태인지 본다.
//   npm run doctor
// 필요한 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (로컬은 .env.local, Actions는 Secrets)
import { createClient } from '@supabase/supabase-js';
import { dataHealth, formatHealth, type RunStats, type ScheduleStats } from '../lib/server/data-health';
import { fetchAllRows } from '../lib/server/paginate';
import { KAC_SOURCE } from '../lib/data/kac-schedule';
import { TAGO_SOURCE } from '../lib/data/tago-flights';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// 오류 객체의 message가 비어 있을 때도 원인을 남긴다 (예: 없는 컬럼 select → 빈 메시지)
const errText = (e: { message?: string; code?: string; details?: string; hint?: string }) =>
  e.message || [e.code, e.details, e.hint].filter(Boolean).join(' · ') || JSON.stringify(e);

type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }>;
const count = async (q: CountQuery) => {
  const { count: n, error } = await q;
  if (error) throw new Error(errText(error));
  return n ?? 0;
};
const head = () => ({ count: 'exact' as const, head: true });

// ── 운항 스케줄 — 행을 받지 않고 DB에서 센다 (Supabase는 한 번에 1,000행까지만 준다)
const sched = () => admin.from('flight_schedules').select('id', head());
const bySource: Record<string, number> = {};
for (const src of [KAC_SOURCE, TAGO_SOURCE]) bySource[src] = await count(sched().eq('is_sample', false).eq('source', src));
const lastSynced = await admin.from('flight_schedules').select('synced_at').eq('is_sample', false).not('synced_at', 'is', null)
  .order('synced_at', { ascending: false }).limit(1).maybeSingle();
const lastValid = await admin.from('flight_schedules').select('valid_to').eq('is_sample', false).not('valid_to', 'is', null)
  .order('valid_to', { ascending: false }).limit(1).maybeSingle();
const total = await count(sched());
const real = await count(sched().eq('is_sample', false));
const schedules: ScheduleStats = {
  total,
  real,
  sample: total - real,
  bySource,
  // 오늘 이후에도 유효한(=추천에 쓸 수 있는) 실제 편
  coveringToday: await count(sched().eq('is_sample', false).or(`valid_to.is.null,valid_to.gte.${today}`)),
  lastSyncedAt: (lastSynced.data?.synced_at as string | undefined) ?? null,
  publishedUntil: (lastValid.data?.valid_to as string | undefined) ?? null,
};

// ── 동기화 실행 이력 (서버만 읽는다)
const { data: runRows, error: runErr } = await admin.from('sync_runs')
  .select('job, trigger, ok, started_at, finished_at, report').order('started_at', { ascending: false }).limit(10);
const runs: RunStats[] = (runErr ? [] : runRows ?? []).map(r => {
  const rep = (r.report ?? {}) as { aborted?: string; failed?: unknown[]; note?: string };
  return {
    job: String(r.job), ok: r.ok as boolean | null, startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    aborted: rep.aborted ?? null, failed: rep.failed?.length ?? 0, note: rep.note ?? null,
  };
});

// ── 접근 시간 / 행정구역 (전부 받아야 하는 곳은 페이지로 나눠 받는다)
const accessRefs = await fetchAllRows<{ region_id: number; airport: string; mode: string; source: string; is_sample: boolean }>(
  (f, t) => admin.from('access_times').select('region_id, airport, mode, source, is_sample').order('id').range(f, t));
const access = {
  rows: accessRefs.length,
  regions: new Set(accessRefs.map(a => a.region_id)).size,
  airports: new Set(accessRefs.map(a => a.airport)).size,
  sample: accessRefs.filter(a => a.is_sample).length,
};
const regionRows = await fetchAllRows<{ id: number; lat: number | null; lng: number | null; geocode_source: string | null }>(
  (f, t) => admin.from('regions').select('id, lat, lng, geocode_source').or(`valid_to.is.null,valid_to.gte.${today}`).order('id').range(f, t));
const regions = {
  active: regionRows.length,
  withCoords: regionRows.filter(r => r.lat != null && r.lng != null).length,
};

// ── 최근 조회 로그
const since = new Date(Date.now() - 24 * 3600_000).toISOString();
const fetchStats = {
  // flight_fetch_log에는 id 컬럼이 없다 (기본키가 source·origin·dest·query_date)
  errors: await count(admin.from('flight_fetch_log').select('source', head()).gte('fetched_at', since).not('error', 'is', null)),
  empty: await count(admin.from('flight_fetch_log').select('source', head()).gte('fetched_at', since).eq('result_count', 0)),
};

const { gates, exitCode } = dataHealth({ schedules, runs, access, regions, fetch: fetchStats, today });
console.log(formatHealth(gates, today));

// 지도 API 예비 체계: 값이 어느 제공자에서 왔는지 (교통 반영 여부가 제공자마다 다르다)
const tally = (xs: (string | null)[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x ?? '(없음)']: (m[x ?? '(없음)'] ?? 0) + 1 }), {}))
  .map(([k, n]) => `${k} ${n}`).join(' · ');
const byMode = (m: string) => accessRefs.filter(a => a.mode === m);
console.log(`
접근 시간 출처 — 차량: ${tally(byMode('car').map(a => a.source)) || '없음'} / 대중교통: ${tally(byMode('transit').map(a => a.source)) || '없음'}`);
console.log(`행정구역 좌표 출처: ${tally(regionRows.filter(r => r.lat != null).map(r => r.geocode_source)) || '없음'}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 데이터 상태 점검\n\n${gates.map(g => `- ${g.ok ? '✅' : g.critical ? '❌' : '⚠️'} **${g.id}** — ${g.headline}${g.ok ? '' : `\n  - ${g.detail}`}`).join('\n')}\n`);
}
process.exit(exitCode);
