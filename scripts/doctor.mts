// 데이터 상태 점검 — 로그를 뒤지지 않고 서비스가 지금 어떤 상태인지 본다.
//   npm run doctor
// 필요한 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (로컬은 .env.local, Actions는 Secrets)
import { createClient } from '@supabase/supabase-js';
import { dataHealth, formatHealth, type RunStats, type ScheduleStats } from '../lib/server/data-health';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
};

// ── 운항 스케줄
const { data: schedRows, error: schedErr } = await admin.from('flight_schedules')
  .select('source, is_sample, valid_from, valid_to, synced_at')
  .limit(100000);
if (schedErr) { console.error(`flight_schedules 조회 실패: ${schedErr.message}`); process.exit(2); }
const rows = schedRows ?? [];
const covers = (r: { valid_from: string | null; valid_to: string | null }) =>
  (!r.valid_from || r.valid_from <= today) && (!r.valid_to || r.valid_to >= today);
const real = rows.filter(r => !r.is_sample);
const schedules: ScheduleStats = {
  total: rows.length,
  real: real.length,
  sample: rows.length - real.length,
  bySource: real.reduce<Record<string, number>>((m, r) => ({ ...m, [r.source]: (m[r.source] ?? 0) + 1 }), {}),
  coveringToday: real.filter(covers).length,
  lastSyncedAt: real.map(r => r.synced_at).filter(Boolean).sort().at(-1) ?? null,
  publishedUntil: real.map(r => r.valid_to).filter(Boolean).sort().at(-1) ?? null,
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

// ── 접근 시간 / 행정구역
const { count: accessRows } = await admin.from('access_times').select('id', { count: 'exact', head: true });
const { data: accessRefs } = await admin.from('access_times').select('region_id, airport, is_sample').limit(100000);
const access = {
  rows: accessRows ?? 0,
  regions: new Set((accessRefs ?? []).map(a => a.region_id)).size,
  airports: new Set((accessRefs ?? []).map(a => a.airport)).size,
  sample: (accessRefs ?? []).filter(a => a.is_sample).length,
};
const { data: regionRows } = await admin.from('regions').select('id, valid_to, lat, lng').or(`valid_to.is.null,valid_to.gte.${today}`).limit(10000);
const regions = {
  active: (regionRows ?? []).length,
  withCoords: (regionRows ?? []).filter(r => r.lat != null && r.lng != null).length,
};

// ── 최근 조회 로그
const since = new Date(Date.now() - 24 * 3600_000).toISOString();
const fetchStats = {
  errors: await count(admin.from('flight_fetch_log').select('id', { count: 'exact', head: true }).gte('fetched_at', since).not('error', 'is', null)),
  empty: await count(admin.from('flight_fetch_log').select('id', { count: 'exact', head: true }).gte('fetched_at', since).eq('result_count', 0)),
};

const { gates, exitCode } = dataHealth({ schedules, runs, access, regions, fetch: fetchStats, today });
console.log(formatHealth(gates, today));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 데이터 상태 점검\n\n${gates.map(g => `- ${g.ok ? '✅' : g.critical ? '❌' : '⚠️'} **${g.id}** — ${g.headline}${g.ok ? '' : `\n  - ${g.detail}`}`).join('\n')}\n`);
}
process.exit(exitCode);
