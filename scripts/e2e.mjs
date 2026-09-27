// 로컬 E2E 확인: 로그인 → 가입 6단계 → 대화 → 추천 결과.
// 준비: `npm run dev`, supabase/seed-dev.sql로 만든 테스트 계정(.env.local의 DEV_TEST_EMAIL/PASSWORD, 가입 전 상태).
// 실행: npm run e2e   (앞서 `npm run e2e:reset`으로 계정과 날짜를 준비한다)
// 채널: 기본은 playwright가 받은 번들 Chromium. 설치된 브라우저를 쓰려면 E2E_CHANNEL=msedge.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? 'e2e-shots';
// 채널을 지정하지 않으면 번들 Chromium을 쓴다 — 러너에는 msedge가 없다.
const CHANNEL = process.env.E2E_CHANNEL;
mkdirSync(OUT, { recursive: true });

// 검사 날짜 — `npm run e2e:reset`이 운항 스케줄 공개 범위를 보고 골라 .e2e-date에 남긴다.
// 파일이 없으면 오늘+2일(KST) 이후 첫 금요일을 계산해 쓰고, 그 사실을 경고로 남긴다(DB 범위는 확인하지 못한다).
const isoDate = (() => {
  try {
    const t = readFileSync('.e2e-date', 'utf8').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  } catch { /* reset을 돌리지 않은 경우 */ }
  if (process.env.E2E_DATE) return process.env.E2E_DATE;
  const d = new Date(Date.now() + 9 * 3600_000);
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  console.warn('⚠ .e2e-date가 없어 날짜를 계산해 씁니다. npm run e2e:reset을 먼저 돌리면 DB 공개 범위 안에서 고릅니다.');
  return d.toISOString().slice(0, 10);
})();
const DATE_MD = `${Number(isoDate.slice(5, 7))}/${Number(isoDate.slice(8, 10))}`;

// 이 화면이 어느 Supabase 프로젝트로 말을 거는지 기록한다 (테스트 프로젝트가 아니면 알려야 한다)
const supaHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host; } catch { return null; } })();
const hosts = new Set();
const watchHosts = page => page.on('request', r => { try { hosts.add(new URL(r.url()).host); } catch { /* data: 등 */ } });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});

async function login(page) {
  await page.goto(BASE);
  await page.waitForURL('**/login');
  await page.fill('input[type=email]', process.env.DEV_TEST_EMAIL);
  await page.fill('input[type=password]', process.env.DEV_TEST_PASSWORD);
  // 일반 이메일·비밀번호 로그인을 쓴다. '(개발용)' 버튼은 NODE_ENV가 production이 아닐 때만 보이는데,
  // CI는 build → start(production)로 돌아서 그 버튼이 없다.
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}

async function chatFlow(page, tag) {
  await page.getByRole('button', { name: /^제주/ }).click();
  await page.getByText('제주 일정은 언제인가요?').waitFor();
  await page.fill('form input', DATE_MD);
  await page.press('form input', 'Enter');
  await page.getByText('마지막 일정이 14:30에 끝나요.').waitFor({ timeout: 15000 });
  check(`[${tag}] 일정 DB에서 출발 가능 시각 14:30 계산`, true);
  await page.getByRole('button', { name: '14:30 이후 출발할게요' }).click();
  await page.getByText('지난 제주 방문 3회').waitFor();
  await page.getByRole('button', { name: '연휴 고향 방문' }).click();
  await page.getByText('14:30 집 출발 기준 총 소요').first().waitFor({ timeout: 15000 });
  const cards = await page.getByText('14:30 집 출발 기준 총 소요').count();
  check(`[${tag}] 결과 카드 2개 이상`, cards >= 2, `${cards}개`);
  // 앞당겨진 금요일(E2E_DATE)은 TAGO 조회 범위(오늘~6일) 밖이라 한국공항공사 정기 스케줄이 쓰인다
  check(`[${tag}] 실제 운항 스케줄 (한국공항공사 출처, 샘플 아님)`,
    (await page.getByText(/한국공항공사 · \d+\/\d+ 확인|국토교통부 TAGO · \d+\/\d+ 확인/).count()) === cards
      && (await page.getByText('화면용 샘플 데이터').count()) === 0);
  check(`[${tag}] 1순위 편명`, true, await page.getByText(/^탑승 편 · /).first().innerText());
  check(`[${tag}] 방문 기록 대조 문장`, await page.getByText('같은 이유로 간 2번은 모두 김포에서 출발하셨어요.').isVisible());
  check(`[${tag}] 가로 스크롤 없음`, await noHScroll(page));
}

// ── 모바일: 가입 6단계 + 대화
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  watchHosts(page);
  await login(page);
  await page.waitForURL('**/onboarding');
  await page.screenshot({ path: `${OUT}/m1-country.png` });
  check('일본은 선택 불가(승인 대기)', await page.getByRole('button', { name: /JP/ }).isDisabled());
  await page.getByRole('button', { name: '다음', exact: true }).click();

  await page.fill('input[placeholder^="동네 이름"]', '영통');
  await page.getByRole('button', { name: /수원시 영통구/ }).click();
  check('"영통" 검색으로 거주지 확정', await page.getByText('경기도 수원시 영통구', { exact: true }).isVisible());
  check('시·도 16개 (전남광주 통합 반영)', await page.getByText('16개 중 선택').isVisible());
  await page.screenshot({ path: `${OUT}/m2-home.png`, fullPage: true });
  await page.getByRole('button', { name: '다음', exact: true }).click();

  await page.getByRole('button', { name: /대학생/ }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();

  await page.fill('input[placeholder="과목명 (필수)"]', '캡스톤디자인');
  await page.getByRole('button', { name: '금', exact: true }).click();
  await page.getByRole('button', { name: '10:30–11:45' }).click();
  await page.getByRole('button', { name: '시간표에 추가' }).click();
  await page.getByText('캡스톤디자인 수업을 저장했어요.').waitFor();
  check('수업 저장', true);
  await page.screenshot({ path: `${OUT}/m3-classes.png`, fullPage: true });

  await page.getByRole('button', { name: /다가오는 일정/ }).click();
  await page.getByRole('button', { name: '회의' }).click();
  // 일정 날짜는 검사 날짜와 같아야 한다. 이 회의가 그날의 마지막 일정이 되어 출발 시각 14:30이 나온다.
  // 예전엔 2026-10-02로 박아 두었는데, 검사 날짜는 e2e:reset이 운항 스케줄 공개 범위를 보고 고른다.
  // 둘이 어긋나면 그날 마지막 일정은 금요일 수업(11:45)이 되어 아래 14:30 단언이 전부 깨진다.
  await page.fill('input[type=date]', isoDate);
  const times = page.locator('input[type=time]');
  await times.nth(0).fill('13:00');
  await times.nth(1).fill('14:30');
  check('설명 없는 일정은 추가 불가', await page.getByRole('button', { name: '일정 추가' }).isDisabled());
  await page.fill('input[placeholder^="예: 캡스톤"]', '캡스톤 팀 회의');
  await page.getByRole('button', { name: '일정 추가' }).click();
  await page.getByText('다가오는 일정 1개').waitFor();
  check('일정 저장', true);
  await page.screenshot({ path: `${OUT}/m4-events.png`, fullPage: true });
  await page.getByRole('button', { name: '다음', exact: true }).click();

  check('위치정보 동의 없이 다음 불가', await page.getByRole('button', { name: '저장하고 계속' }).isDisabled());
  await page.getByRole('checkbox').click();
  await page.screenshot({ path: `${OUT}/m5-history.png`, fullPage: true });
  await page.getByRole('button', { name: '저장하고 계속' }).click();

  await page.getByText('준비됐어요, 민지님.').waitFor();
  await page.screenshot({ path: `${OUT}/m6-summary.png`, fullPage: true });
  await page.getByRole('button', { name: '대화로 공항 찾기' }).click();
  await page.waitForURL('**/chat');

  await chatFlow(page, '393×852');
  await page.screenshot({ path: `${OUT}/m7-chat-results.png` });

  // 주소·키가 섞이면(운영 프로젝트를 가리키면) 여기서 드러난다
  const supa = [...hosts].filter(h => h.endsWith('.supabase.co'));
  check('[393×852] 데이터 요청이 테스트 프로젝트로만 감',
    supa.length === 0 || !supaHost || supa.every(h => h === supaHost), supa.join(', ') || '기록 없음');

  await page.getByRole('button', { name: 'AI 요약 받기' }).click();
  const aiMsg = page.getByText(/쓸 수 있는 AI 제공자가 없어요|DB 대조 통과|DB와 맞지 않는 값|응답하지 않았어요/).first();
  await aiMsg.waitFor({ timeout: 60000 });
  check('AI는 버튼으로만 호출되고 결과가 표시됨', true, await aiMsg.innerText());

  await page.getByRole('button', { name: /수집 정보/ }).click();
  await page.screenshot({ path: `${OUT}/m8-sheet.png` });
  await ctx.close();
}

// ── 데스크톱: 대화 (가입 완료된 계정)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await login(page);
  await page.waitForURL('**/chat');
  check('가입 완료 후 로그인하면 바로 /chat', true);
  await chatFlow(page, '1440×900');
  check('와이드 화면은 오른쪽 수집 정보 패널', await page.getByText('수집된 정보').isVisible());
  await page.screenshot({ path: `${OUT}/d1-chat-results.png` });

  // 테스트 프로젝트에는 차량 이동 시간만 있다(e2e:seed). 대중교통으로 바꾸면 "거주지 데이터 없음"이 아니라
  // 공항별 "대중교통 데이터가 아직 없어요" 안내가 나와야 한다.
  await page.getByRole('button', { name: '대중교통으로 보기' }).click();
  const noTransit = page.getByText(/대중교통으로 .+까지 가는 시간 데이터가 아직 없어요/);
  await noTransit.waitFor({ timeout: 15000 });
  check('[1440×900] 대중교통 값이 없으면 공항별 안내', await noTransit.isVisible());
  check('[1440×900] 거주지 데이터 없음으로 잘못 안내하지 않음', (await page.getByText('거주지에서 공항까지 걸리는 시간이').count()) === 0);
  await page.screenshot({ path: `${OUT}/d2-chat-transit.png` });
  await ctx.close();
}

// ── 내 데이터 (/me)
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await login(page);
  await page.waitForURL('**/chat');
  await page.getByRole('link', { name: '내 데이터' }).click();
  await page.waitForURL('**/me');
  check('[me] 기본 정보: 거주지·가까운 공항 3곳', await page.getByText('경기도 수원시 영통구').isVisible() && (await page.getByText(/^자동차 /).count()) === 3);
  await page.screenshot({ path: `${OUT}/me1-basic.png`, fullPage: true });

  await page.getByRole('tab', { name: '방문 기록' }).click();
  check('[me] 방문 기록 4건', await page.getByText('공항 방문 4회 · 이유 입력 4회').isVisible());
  await page.getByRole('button', { name: '추석 고향 방문' }).click();
  check('[me] 이유 필터', (await page.getByText('기록 삭제').count()) === 2);
  await page.screenshot({ path: `${OUT}/me2-trips.png`, fullPage: true });

  await page.getByRole('tab', { name: 'AI 기록' }).click();
  await page.screenshot({ path: `${OUT}/me3-ai.png`, fullPage: true });

  await page.getByRole('tab', { name: '개인정보' }).click();
  await page.getByRole('switch', { name: /AI 문장 다듬기/ }).click();
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-checked=false]'));
  await page.getByRole('switch', { name: /위치정보/ }).click();
  check('[me] 위치정보 끄기 → 삭제 경고와 확인 버튼', await page.getByText('방문 기록 4건이 바로 삭제되고').isVisible());
  await page.screenshot({ path: `${OUT}/me4-privacy.png`, fullPage: true });
  await page.getByRole('button', { name: '취소' }).click();

  await page.goto(`${BASE}/chat`);
  await page.getByRole('button', { name: /^제주/ }).waitFor();
  check('[me] AI 끄면 대화 패널에 꺼짐 표시', await page.getByText('꺼져 있음. DB 결과 표만').count() === 1);
  await page.goto(`${BASE}/me`);
  await page.getByRole('tab', { name: '개인정보' }).click();
  await page.getByRole('switch', { name: /AI 문장 다듬기/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role=switch]')].pop()?.getAttribute('aria-checked') === 'true');

  await page.getByRole('tab', { name: '기본 정보' }).click();
  await page.getByRole('link', { name: '수정' }).first().click();
  await page.getByText('어디에 사세요?').waitFor();
  check('[me] 수정 → 가입의 거주지 단계로', true);
  check('[me] 가로 스크롤 없음', await noHScroll(page));
  await ctx.close();
}

// ── 내 데이터: 위치정보 동의 철회 (방문 기록을 지우므로 맨 마지막에 둔다)
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await login(page);
  await page.waitForURL('**/chat');
  // 타임라인에서 찾은 여정 하나를 확인 대기 후보로 넣는다 (파일 파싱은 브라우저 몫이라 API로 바로 보낸다)
  const importOne = () => page.request.post(`${BASE}/api/visits`, {
    data: { action: 'import_timeline', trips: [{ from_airport: 'GMP', dest_airport: 'CJU', depart_on: '2025-05-03' }] },
  });
  const first = await importOne();
  check('[revoke] 타임라인 후보 1건 추가', first.ok() && (await first.json()).added === 1, String(first.status()));

  await page.goto(`${BASE}/me`);
  await page.getByRole('tab', { name: '방문 기록' }).click();
  check('[revoke] 확인 대기 1건 표시', await page.getByText(/확인 대기 1건/).isVisible());

  await page.getByRole('tab', { name: '개인정보' }).click();
  await page.getByRole('switch', { name: /위치정보/ }).click();
  await page.getByRole('button', { name: '동의 철회하고 삭제' }).click();
  await page.getByText('위치정보 동의를 철회하고 방문 기록을 삭제했어요.').waitFor();
  check('[revoke] 철회 완료 문구', true);

  const again = await importOne();
  check('[revoke] 동의가 꺼지면 타임라인 가져오기 403', again.status() === 403, String(again.status()));

  await page.reload();
  await page.getByRole('tab', { name: '방문 기록' }).click();
  check('[revoke] 새로고침 뒤 방문 기록 0건 + 동의 안내',
    await page.getByText(/^공항 방문 0회/).isVisible() && await page.getByText('위치정보 동의를 켜면 방문 기록을 남길 수 있어요.').isVisible());
  await page.screenshot({ path: `${OUT}/me5-revoked.png`, fullPage: true });

  // 동의를 다시 켜면 서버가 확인 대기를 다시 계산한다. 후보가 DB에 남아 있었다면 여기서 다시 보인다.
  await page.getByRole('tab', { name: '개인정보' }).click();
  await page.getByRole('switch', { name: /위치정보/ }).click();
  await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true');
  await page.reload();
  await page.getByRole('tab', { name: '방문 기록' }).click();
  await page.getByText('구글 타임라인 가져오기').waitFor();
  check('[revoke] 동의를 다시 켜도 확인 대기 0건 (visit_candidates 삭제됨)', (await page.getByText(/확인 대기 \d+건/).count()) === 0);
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
