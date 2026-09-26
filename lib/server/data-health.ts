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
  /** 실측 행의 시각대 분포 (depart_band → 건수). is_sample 행은 세지 않는다 */
  byBand: Record<string, number>;
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

/** 마지막 성공 실행이 이 시간 안이어야 정상으로 본다 (매일 11:00 KST 실행 기준) */
export const SYNC_OK_HOURS = 30;

/**
 * 이 시간을 넘도록 끝나지 않은 실행은 중단된 것으로 본다.
 * 워크플로 timeout(60분)과 스크립트 내부 데드라인(45분)보다 넉넉해야 정상 실행을 오해하지 않는다.
 */
export const SYNC_PENDING_HOURS = 2;

const hoursSince = (iso: string | null) => {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  // 실행 시각과 지금의 차이만 본다. today("YYYY-MM-DD")에는 시각 정보가 없다.
  return (Date.now() - t) / 3600_000;
};

/** 게이트 판정. 실패 이유를 문장으로 남긴다 (사람이 읽고 바로 조치할 수 있게). */
export function dataHealth(i: HealthInput): { gates: Gate[]; exitCode: number } {
  const lastOk = i.runs.find(r => r.ok === true) ?? null;
  const lastRun = i.runs[0] ?? null;
  const lastOkAge = lastOk ? hoursSince(lastOk.finishedAt ?? lastOk.startedAt) : Infinity;
  // 끝나지 않은 실행 — cancelled·timeout으로 죽으면 finished_at이 null로 남고, sync-recent는 ok===true만 세므로
  // "성공"으로 오인되진 않지만 "중단됐다"고 알려주지도 않는다. 그 조용함을 여기서 깬다.
  const stuck = i.runs.filter(r => !r.finishedAt && hoursSince(r.startedAt) > SYNC_PENDING_HOURS);

  const realAccess = i.access.rows - i.access.sample;
  const bandedAccess = Object.entries(i.access.byBand).filter(([b]) => b !== 'any').reduce((n, [, c]) => n + c, 0);

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
      id: 'sync-pending',
      ok: stuck.length === 0,
      headline: stuck.length === 0 ? '끝나지 않은 동기화 실행 없음' : `끝나지 않은 동기화 실행 ${stuck.length}건`,
      detail: stuck.length === 0
        ? `최근 실행 ${i.runs.length}건이 모두 끝났어요.`
        : stuck.map(r => `${r.job} (${r.startedAt} 시작, ${Math.floor(hoursSince(r.startedAt))}시간째)`).join(' · ')
          + ' — 워크플로 timeout이나 러너 중단으로 끝난 실행이에요. 성공으로 세지 않으므로 데이터는 그대로 낡고, 그 사실은 sync-recent가 알려줍니다. 워크플로 로그에서 cancelled 여부를 보세요.',
      critical: false,
    },
    {
      id: 'access-times',
      // 화면용 샘플만 있으면 통과가 아니다 — 실측이 한 건이라도 있어야 한다
      ok: i.access.rows - i.access.sample > 0 && i.access.regions > 0,
      headline: `접근 시간 ${i.access.rows}건(실측 ${i.access.rows - i.access.sample}) · 지역 ${i.access.regions}곳 · 공항 ${i.access.airports}곳`,
      detail: i.access.rows === 0
        ? '집에서 공항까지 걸리는 시간이 DB에 없어요. 이 서비스의 핵심 계산이라, 없으면 거주지가 등록된 사용자도 추천을 받을 수 없어요.'
        : i.access.rows === i.access.sample
          ? `화면용 샘플 ${i.access.sample}건뿐이에요. npm run access-times 로 실측을 채우세요.`
          : `샘플 ${i.access.sample}건 포함`,
      critical: true,
    },
    {
      id: 'access-bands',
      // 시각대 값이 하나도 없으면 추천은 전부 'any'(호출 시점 실시간 교통)로 물러선다.
      // 실측이 아예 없으면 access-times 게이트가 잡으므로 여기서는 통과로 둔다.
      ok: realAccess === 0 || bandedAccess > 0,
      headline: realAccess === 0
        ? '이동 시간 시각대 — 실측 없음'
        : `이동 시간 시각대 — 실측 ${realAccess}건 중 시각대 지정 ${bandedAccess}건`,
      detail: realAccess === 0
        ? '실측 접근 시간이 없어 시각대도 없어요.'
        : bandedAccess === 0
          ? `실측 ${realAccess}건이 모두 출발 시각 미지정(호출 시점 실시간 교통)이에요. 그 값은 계산한 시각의 교통을 반영하므로 "평균 소요시간"으로 쓰면 어긋납니다. 추천 화면은 물러선 사실을 표시하지만, 값을 채우려면: npm run access-times -- --bands weekday_am,weekday_day,weekday_pm,weekend`
          : `시각대 지정 ${bandedAccess}건 · 나머지 ${realAccess - bandedAccess}건은 정확히 맞는 시각대가 없을 때만 쓰는 fallback이에요.`,
      critical: false,
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
