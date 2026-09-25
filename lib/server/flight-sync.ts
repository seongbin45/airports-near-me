import type { SupabaseClient } from '@supabase/supabase-js';
import { DataGoKrError, FATAL_CODES } from '../data/data-go-kr';
import type { FlightScheduleRecord } from '../data/flight-schedule';
import { fetchKacByDate, fetchKacDomestic, KAC_SOURCE } from '../data/kac-schedule';
import { fetchTagoDay, TAGO_SOURCE, TAGO_AIRPORT_ID } from '../data/tago-flights';

// 운항 스케줄 동기화 — 두 가지 방식
//
// 1) 주기 전체 동기화 (GitHub Actions / 수동): 특정 날짜로 한정하지 않는다.
//    - kac-full     한국공항공사: 오늘부터 하루씩 "그날 전 노선" 조회(노선 필터 없음). 7일 연속 0건이면 공개된 끝으로 보고 멈춤.
//                   새 시즌이 공개되면 날짜를 지정하지 않아도 자동 포함. 날짜 없는 조회는 이력 일부만 나와 쓰지 않는다.
//    - tago-horizon 한국공항공사 스케줄이 있는 노선마다, 그 노선 스케줄이 끝나는 날까지 모든 날짜의 TAGO 운항편.
//                   (범위는 데이터가 정한다. 고정된 "며칠 뒤"가 없다.)
// 2) 사용자 요청 시 채우기 (ensureFresh): 사용자가 고른 날짜·노선이 DB에 없거나 오래됐으면 그때 API를 불러 저장.
//    flight_fetch_log로 "이미 물어봤는지(0건이었어도)"를 기억해 같은 조회를 반복하지 않는다.
//
// 이 파일은 'server-only'를 import하지 않는다 — GitHub Actions의 순수 Node 스크립트(scripts/sync.mts)에서도 쓰기 때문.
// service role 클라이언트는 호출하는 쪽(서버 라우트·스크립트)이 만든다.

export type Job = 'kac-full' | 'tago-horizon';
export type Trigger = 'schedule' | 'manual' | 'on-demand';

const UPSERT_CHUNK = 500;
const ON_CONFLICT = 'source,flight_no,origin,dest,valid_from';

export interface JobReport {
  job: Job;
  ok: boolean;
  fetched: number;
  saved: number;
  removed: number;
  calls: number;
  failed: string[];
  aborted?: string;
  note?: string;
}

/**
 * service role 키인지 동기화 전에 확인한다. anon·publishable 키면 DB 쓰기가 RLS에 막혀 모든 노선이 실패하므로
 * API 호출을 낭비하기 전에 멈춘다. (2026-09-25 GitHub Actions 첫 실행: publishable 키로 42501 1,084건)
 */
export async function assertServiceRole(admin: SupabaseClient, key: string): Promise<string | null> {
  if (key.startsWith('sb_publishable_')) return 'SUPABASE_SERVICE_ROLE_KEY에 publishable 키(sb_publishable_…)가 들어 있어요. secret 키(sb_secret_…)를 넣어주세요.';
  if (key.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
      if (role !== 'service_role') return `SUPABASE_SERVICE_ROLE_KEY가 ${role} 키예요. service_role 또는 secret 키(sb_secret_…)를 넣어주세요.`;
    } catch { /* 아래 실제 호출로 확인 */ }
  }
  // 관리자 API는 service role만 부를 수 있다
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  return error ? `SUPABASE_SERVICE_ROLE_KEY로 관리자 권한 확인 실패: ${error.message}` : null;
}

/** DB 권한 오류(RLS 등) — 노선을 바꿔도 똑같이 실패하므로 즉시 멈춘다 */
const isFatalDbError = (e: unknown) => ['42501', 'PGRST301', 'PGRST302'].includes(String((e as { code?: string })?.code));

const errText = (e: unknown) => {
  const pe = e as { message?: string; code?: string; details?: string };
  return pe?.message ? [pe.message, pe.code, pe.details].filter(Boolean).join(' · ') : String(e);
};

/**
 * 같은 편(출처·편명·노선·시작일)이 두 번 오면 하나만 남긴다.
 * TAGO는 같은 날 같은 편명이 시각만 5분쯤 다르게 두 번 오기도 한다(예: OZ8963 15:05/15:10, 2026-09 확인).
 * 어느 쪽이 맞는지 모르므로 더 이른 출발을 남긴다 — 늦게 알려주는 것보다 안전하다.
 */
export function dedupe(records: FlightScheduleRecord[]) {
  const m = new Map<string, FlightScheduleRecord>();
  for (const r of records) {
    const k = `${r.source}|${r.flight_no}|${r.origin}|${r.dest}|${r.valid_from ?? ''}`;
    const prev = m.get(k);
    if (!prev || r.dep_time < prev.dep_time) m.set(k, r);
  }
  return [...m.values()];
}

async function upsert(admin: SupabaseClient, records: FlightScheduleRecord[], syncedAt: string) {
  const rows = dedupe(records).map(r => ({ ...r, is_sample: false, synced_at: syncedAt }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await admin.from('flight_schedules').upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: ON_CONFLICT });
    if (error) throw error;
  }
  return rows.length;
}

async function logFetch(admin: SupabaseClient, source: string, origin: string, dest: string, date: string, count: number, error?: string) {
  await admin.from('flight_fetch_log').upsert(
    { source, origin, dest, query_date: date, fetched_at: new Date().toISOString(), result_count: count, error: error ?? null },
    { onConflict: 'source,origin,dest,query_date' },
  );
}

async function recordRun<T extends JobReport>(admin: SupabaseClient | null, job: Job, trigger: Trigger, run: () => Promise<T>): Promise<T> {
  const started = new Date().toISOString();
  const { data } = admin ? await admin.from('sync_runs').insert({ job, trigger, started_at: started }).select('id').single() : { data: null };
  let report: T;
  try {
    report = await run();
  } catch (e) {
    report = { job, ok: false, fetched: 0, saved: 0, removed: 0, calls: 0, failed: [], aborted: errText(e) } as unknown as T;
  }
  if (admin && data) await admin.from('sync_runs').update({ finished_at: new Date().toISOString(), ok: report.ok, report }).eq('id', data.id);
  return report;
}

/** 동시에 N개씩 실행 */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export function addDaysIso(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 노선별로 오늘부터 그 노선 정기 스케줄이 끝나는 날(valid_to 최댓값)까지의 날짜들. 최대 maxDays일. */
export function planTagoDates(kacRows: { origin: string; dest: string; valid_to: string | null }[], today: string, maxDays = 400) {
  const until = new Map<string, string>();
  for (const r of kacRows) {
    if (!TAGO_AIRPORT_ID[r.origin] || !TAGO_AIRPORT_ID[r.dest]) continue;
    const key = `${r.origin}-${r.dest}`;
    const end = r.valid_to ?? addDaysIso(today, maxDays);
    if (!until.has(key) || end > until.get(key)!) until.set(key, end);
  }
  const cap = addDaysIso(today, maxDays);
  const plan: { origin: string; dest: string; date: string }[] = [];
  for (const [key, end] of until) {
    const [origin, dest] = key.split('-');
    for (let d = today; d <= end && d <= cap; d = addDaysIso(d, 1)) plan.push({ origin, dest, date: d });
  }
  return plan;
}

// ───────────── 1) 주기 전체 동기화 ─────────────

export interface FullSyncOpts {
  serviceKey: string;
  today: string;
  trigger?: Trigger;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  log?: (msg: string) => void;
}

/** 이 일수 연속으로 0건이면 공개된 스케줄의 끝으로 본다 */
export const KAC_EMPTY_STREAK = 7;

/** 새로 받은 양이 기존의 이 비율보다 적으면 삭제하지 않는다 */
export const MASS_DELETE_RATIO = 0.5;

/** 한국공항공사: 오늘부터 날짜별 전 노선 조회 → 전부 저장, 이번에 안 보인 편 삭제 */
export function syncKacFull(admin: SupabaseClient | null, o: FullSyncOpts & { maxDays?: number }) {
  return recordRun(o.dryRun ? null : admin, 'kac-full', o.trigger ?? 'manual', async (): Promise<JobReport & { preview?: FlightScheduleRecord[] }> => {
    const runAt = new Date().toISOString();
    const all: FlightScheduleRecord[] = [];
    let calls = 0, empty = 0, d = o.today, last = o.today;
    for (let i = 0; i < (o.maxDays ?? 400) && empty < KAC_EMPTY_STREAK; i++, d = addDaysIso(d, 1)) {
      const recs = await fetchKacByDate({ serviceKey: o.serviceKey, date: d, fetchImpl: o.fetchImpl });
      calls += Math.max(1, Math.ceil(recs.length / 100));
      if (recs.length) { empty = 0; last = d; all.push(...recs); } else empty++;
      if (i % 7 === 0) o.log?.(`한국공항공사 ${d} ${recs.length}편`);
    }
    const records = dedupe(all);
    const base = { job: 'kac-full' as const, ok: true, fetched: records.length, calls, failed: [], note: `${o.today}~${last} (그 뒤 ${KAC_EMPTY_STREAK}일 연속 0건)` };
    if (!records.length) throw new Error('한국공항공사 스케줄이 0건이에요. 기존 데이터를 지우지 않고 멈춥니다.');
    if (o.dryRun || !admin) return { ...base, saved: 0, removed: 0, preview: records.slice(0, 3) };
    // 대량 삭제 방지: 이번에 받은 편이 지금 DB에 있는 유효 편의 절반도 안 되면 응답 이상으로 본다
    // (2026-09-25 날짜 없는 조회가 2건만 돌려줘 565건이 지워진 사고 이후 추가)
    // 저장을 먼저 하면 기존 편이 남은 채 새 편만 더해져 그날 추천에 유령 편이 섞인다. 그래서 저장도 함께 건너뛴다.
    const { count: existing } = await admin.from('flight_schedules').select('id', { count: 'exact', head: true })
      .eq('source', KAC_SOURCE).gte('valid_to', o.today);
    if ((existing ?? 0) > 0 && records.length < (existing ?? 0) * MASS_DELETE_RATIO) {
      return { ...base, ok: false, saved: 0, removed: 0, aborted: `받은 편 ${records.length}건이 기존 ${existing}건의 ${MASS_DELETE_RATIO * 100}% 미만이라 저장·삭제를 건너뜀 (확인 필요)` };
    }
    const saved = await upsert(admin, records, runAt);
    // 모든 날짜를 문제없이 받았을 때만: 이번에 안 보인 편(운항 종료·변경)은 지운다
    const { error, count } = await admin.from('flight_schedules').delete({ count: 'exact' }).eq('source', KAC_SOURCE).lt('synced_at', runAt);
    if (error) throw error;
    return { ...base, saved, removed: count ?? 0 };
  });
}

/** TAGO: 노선마다 정기 스케줄이 끝나는 날까지 모든 날짜 */
export function syncTagoHorizon(admin: SupabaseClient, o: FullSyncOpts) {
  return recordRun(o.dryRun ? null : admin, 'tago-horizon', o.trigger ?? 'manual', async (): Promise<JobReport> => {
    const runAt = new Date().toISOString();
    const { data: kac, error } = await admin.from('flight_schedules').select('origin, dest, valid_to').eq('source', KAC_SOURCE).or(`valid_to.is.null,valid_to.gte.${o.today}`);
    if (error) throw error;
    const plan = planTagoDates(kac, o.today);
    const report: JobReport = { job: 'tago-horizon', ok: true, fetched: 0, saved: 0, removed: 0, calls: 0, failed: [] };
    const lastDate = plan.reduce((m, p) => (p.date > m ? p.date : m), o.today);
    report.note = `${new Set(plan.map(p => p.origin + p.dest)).size}개 노선 × ${o.today}~${lastDate}`;
    let done = 0, lastPct = -1;

    await pool(plan, o.concurrency ?? 4, async ({ origin, dest, date }) => {
      if (report.aborted) return;
      report.calls++;
      try {
        const recs = await fetchTagoDay({ serviceKey: o.serviceKey, date, origin, dest, fetchImpl: o.fetchImpl });
        report.fetched += recs.length;
        if (!o.dryRun) {
          const { count: before } = await admin.from('flight_schedules').select('id', { count: 'exact', head: true })
            .eq('source', TAGO_SOURCE).eq('origin', origin).eq('dest', dest).eq('valid_from', date);
          // 응답이 의심스러우면 저장도 삭제도 하지 않는다 (저장을 먼저 하면 유령 편이 섞인다).
          // 조회 기록도 남기지 않아 다음 실행에서 다시 시도한다.
          if ((before ?? 0) > 0 && recs.length < (before ?? 0) * MASS_DELETE_RATIO) {
            report.failed.push(`${origin}-${dest} ${date}: 받은 ${recs.length}편, 기존 ${before}편 — 응답이 의심스러워 저장·삭제를 건너뜀`);
            return;
          }
          // 주의: `report.saved += await …`는 await 전에 값을 읽어 병렬 실행 시 합계가 틀린다 — 먼저 받아서 더한다
          const saved = recs.length ? await upsert(admin, recs, runAt) : 0;
          report.saved += saved;
          const { count } = await admin.from('flight_schedules').delete({ count: 'exact' })
            .eq('source', TAGO_SOURCE).eq('origin', origin).eq('dest', dest).eq('valid_from', date).lt('synced_at', runAt);
          report.removed += count ?? 0;
          await logFetch(admin, TAGO_SOURCE, origin, dest, date, recs.length);
        }
      } catch (e) {
        report.failed.push(`${origin}-${dest} ${date}: ${errText(e)}`);
        if ((e instanceof DataGoKrError && FATAL_CODES.has(e.code)) || isFatalDbError(e)) report.aborted = errText(e);
      }
      const pct = Math.floor((++done / plan.length) * 10) * 10;
      if (pct !== lastPct) { lastPct = pct; o.log?.(`TAGO ${done}/${plan.length}`); }
    });

    if (!o.dryRun) {
      const { count } = await admin.from('flight_schedules').delete({ count: 'exact' }).eq('source', TAGO_SOURCE).lt('valid_to', o.today);
      report.removed += count ?? 0;
    }
    report.ok = !report.aborted && !report.failed.length;
    return report;
  });
}

// ───────────── 2) 사용자 요청 시 채우기 ─────────────

/** 같은 조회를 다시 하기까지의 간격 */
export const REFETCH_HOURS = { [KAC_SOURCE]: 24, [TAGO_SOURCE]: 6 } as const;

export interface EnsureOpts {
  serviceKey: string;
  origins: string[];
  dests: string[];
  date: string;
  fetchImpl?: typeof fetch;
  /** 이 시간 안에 못 끝내면 DB에 있는 것으로 추천한다 */
  budgetMs?: number;
}

export interface EnsureResult { fetched: { source: string; route: string; count: number }[]; skipped: number; errors: string[]; timedOut: boolean }

/** 판단만 하는 순수 함수: 어떤 (출처, 노선)을 지금 불러와야 하나 */
export function planOnDemand(
  routes: { origin: string; dest: string }[],
  covered: { source: string; origin: string; dest: string }[],
  logs: { source: string; origin: string; dest: string; fetched_at: string }[],
  now: Date,
) {
  const recent = (source: string, origin: string, dest: string) => logs.some(l =>
    l.source === source && l.origin === origin && l.dest === dest &&
    now.getTime() - new Date(l.fetched_at).getTime() < REFETCH_HOURS[source as keyof typeof REFETCH_HOURS] * 3600_000);
  const has = (source: string, origin: string, dest: string) => covered.some(c => c.source === source && c.origin === origin && c.dest === dest);
  const todo: { source: string; origin: string; dest: string }[] = [];
  for (const { origin, dest } of routes) {
    // 정기 스케줄: 그날을 덮는 편이 없을 때만 (새 시즌이 막 공개됐을 수 있다)
    if (!has(KAC_SOURCE, origin, dest) && !recent(KAC_SOURCE, origin, dest)) todo.push({ source: KAC_SOURCE, origin, dest });
    // 날짜별 운항: 최근에 물어본 적이 없으면 (결과 0건도 기록되므로 없는 날짜를 반복 조회하지 않는다)
    if (TAGO_AIRPORT_ID[origin] && TAGO_AIRPORT_ID[dest] && !recent(TAGO_SOURCE, origin, dest)) todo.push({ source: TAGO_SOURCE, origin, dest });
  }
  return todo;
}

export async function ensureFresh(admin: SupabaseClient, o: EnsureOpts): Promise<EnsureResult> {
  const routes = o.origins.flatMap(origin => o.dests.filter(d => d !== origin).map(dest => ({ origin, dest })));
  const result: EnsureResult = { fetched: [], skipped: 0, errors: [], timedOut: false };
  if (!routes.length) return result;

  const [covered, logs] = await Promise.all([
    admin.from('flight_schedules').select('source, origin, dest')
      .in('origin', o.origins).in('dest', o.dests).lte('valid_from', o.date).gte('valid_to', o.date),
    admin.from('flight_fetch_log').select('source, origin, dest, fetched_at')
      .in('origin', o.origins).in('dest', o.dests).eq('query_date', o.date),
  ]);
  const todo = planOnDemand(routes, covered.data ?? [], logs.data ?? [], new Date());
  result.skipped = routes.length * 2 - todo.length;
  if (!todo.length) return result;

  const runAt = new Date().toISOString();
  // 사용자 한 명이 요청할 때마다 공공데이터포털 일일 쿼터를 태우지 않게 동시 실행 수를 묶는다
  const work = pool(todo, 4, async ({ source, origin, dest }) => {
    try {
      const q = { serviceKey: o.serviceKey, date: o.date, origin, dest, fetchImpl: o.fetchImpl };
      const recs = source === KAC_SOURCE ? await fetchKacDomestic(q) : await fetchTagoDay(q);
      if (source === TAGO_SOURCE) {
        // 주기 전체 동기화와 같은 안전장치: 그날 편이 있었는데 이번 응답이 절반 미만이면 쓰지도 지우지도 않는다
        const { count: before } = await admin.from('flight_schedules').select('id', { count: 'exact', head: true })
          .eq('source', TAGO_SOURCE).eq('origin', origin).eq('dest', dest).eq('valid_from', o.date);
        if ((before ?? 0) > 0 && recs.length < (before ?? 0) * MASS_DELETE_RATIO) {
          result.errors.push(`${TAGO_SOURCE} ${origin}-${dest}: 받은 ${recs.length}편이 기존 ${before}편의 절반 미만이라 쓰기를 건너뜀`);
          return;
        }
      }
      if (recs.length) await upsert(admin, recs, runAt);
      if (source === TAGO_SOURCE) {
        await admin.from('flight_schedules').delete().eq('source', TAGO_SOURCE).eq('origin', origin).eq('dest', dest).eq('valid_from', o.date).lt('synced_at', runAt);
      }
      await logFetch(admin, source, origin, dest, o.date, recs.length);
      result.fetched.push({ source, route: `${origin}-${dest}`, count: recs.length });
    } catch (e) {
      result.errors.push(`${source} ${origin}-${dest}: ${errText(e)}`);
      await logFetch(admin, source, origin, dest, o.date, 0, errText(e)).catch(() => {});
    }
  });
  const budget = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), o.budgetMs ?? 8000));
  result.timedOut = (await Promise.race([work.then(() => 'done' as const), budget])) === 'timeout';
  return result;
}
