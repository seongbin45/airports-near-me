// 운영 DB에서 개발용 테스트 계정(dev@airports-near-me.test)을 지운다.
//   npm run delete-dev-account -- --yes
//
// 이 계정은 supabase/seed-dev.sql로 만들었다. 저장소가 공개라 anon 키를 아는 사람이 그대로 로그인할 수 있어
// (UI가 막아도 DB는 계정을 인정한다 — docs/DATA_MODEL.md) 운영에는 남기지 않는다.
// 지우면 profiles·visits·class_timetable·schedules 등 auth.users를 참조하는 행이 cascade로 함께 사라진다.
//
// 운영에서 실행하는 것이 목적이라 "테스트 프로젝트가 아닌지"를 **반대로** 확인한다 —
// e2e_marker가 있으면 테스트 프로젝트이므로 E2E가 쓸 계정을 지우게 된다(해는 없지만 헛수고다).
import { createClient } from '@supabase/supabase-js';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const email = process.env.DEV_TEST_EMAIL ?? 'dev@airports-near-me.test';
const url = need('NEXT_PUBLIC_SUPABASE_URL');
const admin = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const host = new URL(url).host;

const marker = await admin.from('e2e_marker').select('note').eq('id', 1).maybeSingle();
if (marker.data) {
  console.log(`알림: ${host}는 테스트 전용 프로젝트로 보입니다(e2e_marker 있음). 계정을 지우면 다음 E2E 실행이 다시 만듭니다.`);
}

if (!process.argv.includes('--yes')) {
  console.error(`중단: 지울 대상 확인이 필요해요.\n  프로젝트: ${host}\n  계정: ${email}\n  운영 프로젝트가 맞으면 --yes를 붙여 다시 실행하세요.`);
  process.exit(2);
}

// listUsers는 페이지 단위다 — 첫 페이지에 없다고 없다고 말하면 안 된다
const findUser = async () => {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error(`계정 목록을 읽지 못했어요: ${error.message}`); process.exit(2); }
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
};

const user = await findUser();
if (!user) {
  console.log(`지울 계정이 없어요 (${host}: ${email} 0건).`);
  process.exit(0);
}

const { error } = await admin.auth.admin.deleteUser(user.id);
if (error) { console.error(`삭제 실패: ${error.message}`); process.exit(1); }

// 확인 — 지웠다고 말하기 전에 다시 세어 본다
const after = await findUser();
if (after) { console.error('삭제 후에도 계정이 남아 있어요. 다시 확인하세요.'); process.exit(1); }
console.log(`삭제 완료: ${email} (${host}) — 확인 결과 0건`);
