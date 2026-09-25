// 데이터 상태 점검 — "동기화가 조용히 실패한 것"을 로그를 뒤지지 않고 바로 보이게 한다.
//
// 2026-09-25 GitHub Actions 첫 실행에서 publishable 키로 1,084건이 RLS(42501)에 막혔는데,
// 워크플로는 실패로 끝났지만 "그래서 지금 서비스가 어떤 상태인지"는 어디에도 없었다.
// 여기서는 DB에서 직접 세어 게이트(통과/실패)로 판정한다. 판정 규칙은 순수 함수라 테스트한다.

export interface ScheduleStats {
  total: number;
  /** is_sample = false — 실제 데이터 */
  real: number;
  sample: number;
  bySource: Record<string, number>;
  /** 오늘 이후를 덮는(=추천에 쓸 수 있는) 실제 편 수 */
  coveringToday: number;
  lastSyncedAt: string | null;
  /** 스케줄이 공개된 마지막 날 (valid_to 최댓값) */
  publishedUntil: string | null;
}

export interface RunStats {
  job: string;
  ok: boolean | null;
  startedAt: string;
  finishedAt: string | null;
  aborted: string | null;
  failed: number;
  note: string | null;
}

export interface AccessStats {
  rows: number;
  /** 접근 시간이 있는 거주 지역 수 */
  regions: number;
  airports: number;
  sample: number;
}

export interface RegionStats {
  /** 오늘 유효한 행정구역 수 (valid_to 없거나 오늘 이후) */
  active: number;
  /** 그중 좌표(lat·lng)가 채워진 수 — 접근 시간 계산의 전제 */
  withCoords: number;
}

export interface FetchStats {
  /** 최근 24시간 조회 중 오류가 난 건수 */
  errors: number;
  /** 최근 24시간 조회 중 결과 0건 (없는 날짜를 다시 묻지 않기 위한 기록) */
  empty: number;
}

export interface HealthInput {
  schedules: ScheduleStats;
  runs: RunStats[];
  access: AccessStats;
  regions: RegionStats;
  fetch: FetchStats;
  today: string;
}

export interface Gate {
  id: string;
  ok: boolean;
  /** 한 줄 요약 (로그·화면에 그대로 쓴다) */
  headline: string;
  detail: string;
  /** 이 게이트가 실패하면 종료 코드 1 */
  critical: boolean;
}

/** 마지막 성공 실행이 이 시간 안이어야 정상으로 본다 (매일 03:00 KST 실행 기준) */
export const SYNC_OK_HOURS = 30;

const hoursSince = (iso: string | null, today: string) => {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  // today는 "YYYY-MM-DD"라 시각 정보가 없다. 실행 시각 자체와 현재 시각의 차이만 본다.
  return (Date.now() - t) / 3600_000;
};

/** 게이트 판정. 실패 이유를 문장으로 남긴다 (사람이 읽고 바로 조치할 수 있게). */
export function dataHealth(i: HealthInput): { gates: Gate[]; exitCode: number } {
  const lastOk = i.runs.find(r => r.ok === true) ?? null;
  const lastRun = i.runs[0] ?? null;
  const lastOkAge = lastOk ? hoursSince(lastOk.finishedAt ?? lastOk.startedAt, i.today) : Infinity;

  const gates: Gate[] = [
    {
      id: 'schedules-real',
      ok: i.schedules.real > 0 && i.schedules.coveringToday > 0,
      headline: `실제 운항 스케줄 ${i.schedules.real}건 · 오늘 이후 커버 ${i.schedules.coveringToday}건`,
      detail: i.schedules.real === 0
        ? '실제 스케줄이 0건이에요. 화면은 전부 샘플 데이터로 돌아가고 있어요. SUPABASE_SERVICE_ROLE_KEY가 secret 키(sb_secret_… 또는 service_role JWT)인지, 공공데이터포털 키가 살아 있는지 확인하세요.'
        : i.schedules.coveringToday === 0
          ? `스케줄이 오늘(${i.today}) 이후를 덮지 않아요. 공개된 끝: ${i.schedules.publishedUntil ?? '없음'}`
          : `샘플 ${i.schedules.sample}건은 화면 표시용이고, 출처별로는 ${Object.entries(i.schedules.bySource).map(([s, n]) => `${s} ${n}`).join(' · ')}`,
      critical: true,
    },
    {
      id: 'sync-recent',
      ok: lastOkAge <= SYNC_OK_HOURS,
      headline: lastOk ? `마지막 성공 동기화 ${Math.floor(lastOkAge)}시간 전 (${lastOk.job})` : '성공한 동기화 기록이 없어요',
      detail: lastRun && lastRun.ok === false
        ? `마지막 실행은 실패: ${lastRun.aborted ?? `실패 ${lastRun.failed}건`}`
        : i.schedules.lastSyncedAt ? `DB에 기록된 마지막 저장 시각: ${i.schedules.lastSyncedAt}` : 'flight_schedules.synced_at이 비어 있어요',
      critical: true,
    },
    {
      id: 'access-times',
      ok: i.access.rows > 0 && i.access.regions > 0,
      headline: `접근 시간 ${i.access.rows}건 · 지역 ${i.access.regions}곳 · 공항 ${i.access.airports}곳`,
      detail: i.access.rows === 0
        ? '집에서 공항까지 걸리는 시간이 DB에 없어요. 이 서비스의 핵심 계산이라, 없으면 거주지가 등록된 사용자도 추천을 받을 수 없어요.'
        : `샘플 ${i.access.sample}건 포함 · 아직 전국을 덮지 못했어요`,
      critical: true,
    },
    {
      id: 'regions-coords',
      ok: i.regions.active > 0 && i.regions.withCoords === i.regions.active,
      headline: `행정구역 좌표 ${i.regions.withCoords}/${i.regions.active}`,
      detail: i.regions.withCoords < i.regions.active
        ? `좌표가 없는 구역 ${i.regions.active - i.regions.withCoords}곳은 접근 시간을 계산할 수 없어요. 지오코딩 배치를 돌리세요.`
        : '모든 구역에 좌표가 있어요.',
      critical: false,
    },
    {
      id: 'fetch-errors',
      ok: i.fetch.errors === 0,
      headline: `최근 24시간 조회 오류 ${i.fetch.errors}건 · 결과 0건 ${i.fetch.empty}건`,
      detail: i.fetch.errors
        ? 'flight_fetch_log에 오류가 남았어요. 응답 오류가 반복되면 그 노선은 계속 빈손으로 돌아옵니다.'
        : '조회 오류가 없어요.',
      critical: false,
    },
  ];

  return { gates, exitCode: gates.some(g => g.critical && !g.ok) ? 1 : 0 };
}

/** 로그에 쓰기 좋은 여러 줄 문자열 */
export function formatHealth(gates: Gate[], today: string): string {
  const mark = (g: Gate) => (g.ok ? '통과' : g.critical ? '실패' : '주의');
  const lines = [`데이터 상태 점검 (${today})`];
  for (const g of gates) {
    lines.push(`[${mark(g)}] ${g.id} — ${g.headline}`);
    if (!g.ok || g.critical) lines.push(`        ${g.detail}`);
  }
  return lines.join('\n');
}
