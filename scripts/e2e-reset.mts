// E2E 준비 — 검사에 쓸 DB가 **테스트 전용 프로젝트**인지 먼저 증명하고, 개발 계정을 처음 상태로 되돌리고,
// 검사할 날짜를 골라 `.e2e-date`에 남긴다.
//
//   1) 표식 확인: public.e2e_marker의 id=1 note가 'e2e-test-project'가 아니면(조회 오류 포함) 즉시 중단한다.
//      URL·키·ref가 전부 틀려도 운영 DB에는 이 표식이 없으므로 운영 데이터를 건드리지 않는다.
//      (URL에 ref가 들어 있는지 보는 검사는 보조일 뿐이다 — 키가 틀린 경우를 못 막는다.)
//   2) 계정 초기화: 개발 계정을 지우고 다시 만든 뒤 seed-dev.sql과 같은 상태로 맞춘다
//      (이름 '민지', 샘플 방문 4건, 가입 미완료). auth.users를 지우면 나머지는 cascade로 함께 사라진다.
//   3) 날짜 고르기: 운항 스케줄이 실제로 덮는 범위 안에서 오늘+2일(KST) 이후 첫 금요일을 고른다.
//      금요일인 이유는 검사 흐름이 금요일 수업(금 10:30–11:45)을 넣고 그날 일정으로 추천을 받기 때문이다.
//      범위 안에 금요일이 없으면 이유를 남기고 실패한다(임의의 날짜로 대충 넘어가지 않는다).
//
// 필요한 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_TEST_EMAIL, DEV_TEST_PASSWORD
//             PROD_SUPABASE_URL — 운영 프로젝트 URL. 같으면 즉시 중단한다 (없으면 이 검사만 건너뜀)
//             (선택) E2E_PROJECT_REF — 보조 확인용
//
// `--check-only`를 붙이면 1) 표식 확인만 하고 끝낸다(개발 계정 자격증명 불필요).
// 표식 테이블은 마이그레이션에 없다 — supabase/e2e-marker.sql 을 테스트 프로젝트에서 1회 실행한다.
//
// **순서 주의(2026-09-27)**: 날짜를 고르려면 운항 스케줄이 이미 있어야 하므로(아래 3단계)
// 이 스크립트는 `npm run sync` **뒤에** 돌아야 한다. 그래서 데이터 워크플로는
// 표식 확인(`--check-only`) → sync → 이 스크립트 → 시드 순으로 돈다.
// 예전에는 sync보다 먼저 돌았는데, 빈 테스트 프로젝트에서는 "실제 운항 스케줄이 없어요"로
// 멈춰서 첫 실행이 영원히 성공할 수 없었다.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { markerProblem, sameProject } from '../lib/server/e2e-guard';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const url = need('NEXT_PUBLIC_SUPABASE_URL');
const admin = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/**
 * `--check-only`: 이 DB가 테스트 전용인지만 증명하고 끝낸다.
 * 데이터 동기화 워크플로가 sync보다 먼저 돌려 "운영 DB에 쓰지 않는다"만 확인할 때 쓴다.
 * 이때는 개발 계정 자격증명이 필요 없다 — 그래서 아래 need() 호출을 표식 확인 뒤로 미뤘다.
 * (워크플로가 DEV_TEST_*를 안 넘겨서 CI가 exit 2로 멈춘 적이 있다.)
 */
const checkOnly = process.argv.includes('--check-only');

// 타입을 **변수에** 명시한다. 화살표 함수에만 : never를 붙이면 TS가 제어 흐름 분석에서
// never 반환 호출로 보지 않아, 이 함수 뒤에서 값이 좁혀지지 않는다 (tsc: 'possibly null').
const fail: (msg: string) => never = (msg) => { console.error(`중단: ${msg}`); process.exit(2); };

/** 없으면 동기화·검사가 성립하지 않는 테이블. 나머지는 목록으로 알려만 준다. */
const CRITICAL_TABLES = ['e2e_marker', 'regions', 'flight_schedules', 'profiles'];

// ── 0) 운영 프로젝트를 가리키고 있지 않은지 먼저 본다 (표식보다 앞이다)
// 표식 테이블이 없는 이유가 "운영 프로젝트라서"일 수 있다. 그때 안내대로 표식을 만들면
// **운영 DB에 표식을 심어 보호가 무력화된다** — 그래서 표식을 만들기 전에 여기서 막는다.
// PROD_SUPABASE_URL이 없으면(시크릿 미설정) 이 검사는 건너뛰고 표식 검사가 계속 지킨다.
const prodUrl = process.env.PROD_SUPABASE_URL;
if (prodUrl) {
  if (sameProject(url, prodUrl)) {
    fail(
      `E2E_SUPABASE_URL이 **운영 프로젝트**(${new URL(url).host})를 가리키고 있어요.\n` +
      '  · 테스트 전용 프로젝트의 URL을 E2E_SUPABASE_URL 시크릿에 넣으세요.\n' +
      '  · 이대로 두면 운영 DB의 계정·운항 스케줄을 덮어씁니다. 표식을 만들지 마세요 — 만들면 보호가 사라집니다.',
    );
  }
  console.log(`운영 프로젝트(${new URL(prodUrl).host})와 다른 프로젝트입니다 — 진행합니다.`);
} else {
  console.log('PROD_SUPABASE_URL이 없어 운영 프로젝트 대조를 건너뜁니다 (표식 검사는 그대로 돕니다).');
}

// ── 1) 이 DB가 테스트 전용인지 증명한다 (조회 오류도 중단 사유로 본다)
// PostgREST가 "테이블이 없다"고 할 때의 문구. 표식 테이블은 마이그레이션에 없다(운영에 생기면 안 되므로
// 수동으로 만든다 — supabase/e2e-marker.sql). 그래서 "없음"과 "값이 다름"을 구분해 안내해야 한다.
// 구분하지 않으면 "운영 프로젝트인가?"와 "표식 만들기를 잊었나?"를 알 수 없어 왕복이 늘어난다(실제로 그랬다).
const MISSING_TABLE = /could not find the table|schema cache|does not exist/i;

const marker = await admin.from('e2e_marker').select('note').eq('id', 1).maybeSingle();
if (marker.error) {
  if (MISSING_TABLE.test(marker.error.message)) {
    fail(
      `이 프로젝트(${new URL(url).host})에 e2e_marker 표식 테이블이 없어요.\n` +
      '  · 테스트 전용 프로젝트의 SQL Editor에서 supabase/e2e-marker.sql 을 실행하세요 (1회).\n' +
      '  · 운영 프로젝트에는 절대 만들지 마세요 — 표식이 없어야 운영 DB를 보호합니다.\n' +
      `  · 만들어도 이 오류가 그대로면 NEXT_PUBLIC_SUPABASE_URL(E2E_SUPABASE_URL)이 다른 프로젝트를 가리키고 있어요. (원문: ${marker.error.message})`,
    );
  }
  fail(`e2e_marker를 확인할 수 없어요: ${marker.error.message}`);
}
const problem = markerProblem(marker.data?.note);
if (problem) fail(problem);
const ref = process.env.E2E_PROJECT_REF;
if (ref && !url.includes(ref)) fail(`NEXT_PUBLIC_SUPABASE_URL에 E2E_PROJECT_REF(${ref})가 없어요: ${url}`);
console.log(`표식 확인됨 — 테스트 전용 프로젝트(${new URL(url).host})로 진행합니다.`);

if (checkOnly) {
  // 표식만 보고 끝내면 다음 단계(sync)에서 스키마 문제로 또 멈춘다. 여기서 한 번에 훑어
  // "무엇이 없는지"를 알려준다 — 워크플로 왕복을 줄이기 위한 것이다(2026-09-27).
  const PROBE = ['e2e_marker', 'regions', 'countries', 'profiles', 'flight_schedules', 'flight_fetch_log',
    'sync_runs', 'access_times', 'visits', 'class_timetable', 'ai_calls'];
  const missing: string[] = [];
  for (const t of PROBE) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true });
    if (error && MISSING_TABLE.test(error.message)) missing.push(t);
  }
  if (missing.length) {
    const critical = missing.filter(t => CRITICAL_TABLES.includes(t));
    fail(
      `스키마가 아직 없어요: ${missing.join(', ')}\n` +
      '  · 테스트 전용 프로젝트에 supabase/migrations 를 적용하세요 (supabase db push, 또는 SQL Editor에서 마이그레이션 실행).\n' +
      `  · 이 중 꼭 필요한 것: ${CRITICAL_TABLES.join(', ')}${critical.length ? ` — 지금 없는 것: ${critical.join(', ')}` : ''}`,
    );
  }
  console.log(`스키마 확인: ${PROBE.length}개 테이블 모두 있음`);
  console.log('--check-only: 표식 확인만 하고 끝냅니다.');
  process.exit(0);
}

// ── 2) 개발 계정 초기화 — 여기서부터 자격증명이 필요하다
const email = need('DEV_TEST_EMAIL');
const password = need('DEV_TEST_PASSWORD');
const findUser = async () => {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`계정 목록을 읽지 못했어요: ${error.message}`);
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
};

const existing = await findUser();
if (existing) {
  const { error } = await admin.auth.admin.deleteUser(existing.id);
  if (error) fail(`${email} 계정을 지우지 못했어요: ${error.message}`);
  console.log(`기존 계정 삭제: ${email}`);
}

const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const createdUser = created?.user;
if (createErr || !createdUser) fail(`계정을 만들지 못했어요: ${createErr?.message ?? 'user 없음'}`);
const userId = createdUser.id;
console.log(`계정 생성: ${email}`);

// trigger가 profiles 행을 만들지만 반영이 늦을 수 있어 없으면 넣는다
const { data: profile, error: profErr } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
if (profErr) fail(`profiles 조회 실패: ${profErr.message}`);
if (!profile) {
  const { error } = await admin.from('profiles').insert({ id: userId, display_name: '민지' });
  if (error) fail(`profiles 생성 실패: ${error.message}`);
} else {
  const { error } = await admin.from('profiles').update({ display_name: '민지' }).eq('id', userId);
  if (error) fail(`profiles 수정 실패: ${error.message}`);
}

// seed-dev.sql과 같은 방문 기록 (검사 흐름이 '지난 제주 방문 3회 · 방문 기록 4건'을 확인한다)
const { error: visitErr } = await admin.from('visits').insert([
  { user_id: userId, dest_city: '제주', visited_on: '2025-10-03', reason: '추석 고향 방문', from_airport: 'GMP', source: 'manual', is_sample: true },
  { user_id: userId, dest_city: '제주', visited_on: '2025-02-10', reason: '현장 강의 수강', from_airport: 'CJJ', source: 'manual', is_sample: true },
  { user_id: userId, dest_city: '제주', visited_on: '2024-09-15', reason: '추석 고향 방문', from_airport: 'GMP', source: 'manual', is_sample: true },
  { user_id: userId, dest_city: '부산', visited_on: '2025-06-20', reason: '네트워킹 참여', from_airport: 'GMP', source: 'manual', is_sample: true },
]);
if (visitErr) fail(`방문 기록 생성 실패: ${visitErr.message}`);
console.log('방문 기록 4건 생성');

// ── 3) 검사할 날짜 — 운항 스케줄이 실제로 덮는 범위 안의 첫 금요일
const kstToday = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
};

const { data: lastValid, error: rangeErr } = await admin.from('flight_schedules').select('valid_to')
  .eq('is_sample', false).not('valid_to', 'is', null).order('valid_to', { ascending: false }).limit(1).maybeSingle();
if (rangeErr) fail(`운항 스케줄 범위를 읽지 못했어요: ${rangeErr.message}`);
const until = (lastValid?.valid_to ?? null) as string | null;
if (!until) fail('실제 운항 스케줄이 없어요. test 프로젝트에 sync를 먼저 채워야 합니다.');

const horizon = Number(process.env.E2E_HORIZON_DAYS ?? 120);
let date = addDays(kstToday, 2);
for (let i = 0; i < horizon; i++, date = addDays(date, 1)) {
  const [y, m, d] = date.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 5) continue; // 금요일
  if (date > until) break;
  const { count, error } = await admin.from('flight_schedules').select('id', { count: 'exact', head: true })
    .eq('is_sample', false).contains('days_of_week', [5])
    .or(`valid_from.is.null,valid_from.lte.${date}`).or(`valid_to.is.null,valid_to.gte.${date}`);
  if (error) fail(`날짜 후보 조회 실패: ${error.message}`);
  if (count) {
    writeFileSync('.e2e-date', `${date}\n`);
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `E2E_DATE=${date}\n`);
    console.log(`검사 날짜: ${date} (금요일, 운항 스케줄 공개 범위 ${kstToday}~${until} 안, 그날 금요일 편 ${count}건)`);
    console.log('준비 완료 — npm run build && npm run start 후 npm run e2e');
    process.exit(0);
  }
}
fail(`오늘+2일(${addDays(kstToday, 2)})부터 공개 범위 끝(${until})까지 금요일 편이 있는 날이 없어요. sync를 갱신하거나 공개 범위를 확인하세요.`);
