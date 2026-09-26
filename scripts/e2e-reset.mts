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
//             (선택) E2E_PROJECT_REF — 보조 확인용
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const url = need('NEXT_PUBLIC_SUPABASE_URL');
const email = need('DEV_TEST_EMAIL');
const password = need('DEV_TEST_PASSWORD');
const admin = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const fail = (msg: string) => { console.error(`중단: ${msg}`); process.exit(2); };

// ── 1) 이 DB가 테스트 전용인지 증명한다 (가장 먼저, 그리고 조회 오류도 중단 사유로 본다)
const marker = await admin.from('e2e_marker').select('note').eq('id', 1).maybeSingle();
if (marker.error) fail(`e2e_marker를 확인할 수 없어요: ${marker.error.message} — 테스트 전용 프로젝트가 아니거나 스키마가 달라요.`);
if (marker.data?.note !== 'e2e-test-project') {
  fail(`e2e_marker의 note가 'e2e-test-project'가 아니에요(받은 값: ${JSON.stringify(marker.data?.note ?? null)}). 운영 DB에서는 이 표식이 없습니다.`);
}
const ref = process.env.E2E_PROJECT_REF;
if (ref && !url.includes(ref)) fail(`NEXT_PUBLIC_SUPABASE_URL에 E2E_PROJECT_REF(${ref})가 없어요: ${url}`);
console.log(`표식 확인됨 — 테스트 전용 프로젝트(${new URL(url).host})로 진행합니다.`);

// ── 2) 개발 계정 초기화
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
if (createErr || !created?.user) fail(`계정을 만들지 못했어요: ${createErr?.message ?? 'user 없음'}`);
const userId = created.user.id;
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
const until = lastValid?.valid_to as string | undefined;
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
