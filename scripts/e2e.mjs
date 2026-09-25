// 로컬 E2E 확인: 로그인 → 가입 6단계 → 대화 → 추천 결과.
// 준비: `npm run dev`, supabase/seed-dev.sql로 만든 테스트 계정(.env.local의 DEV_TEST_EMAIL/PASSWORD, 가입 전 상태).
// 실행: node --env-file=.env.local scripts/e2e.mjs [출력폴더]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? 'e2e-shots';
const CHANNEL = process.env.E2E_CHANNEL ?? 'msedge';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const browser = await chromium.launch({ channel: CHANNEL });

async function login(page) {
  await page.goto(BASE);
  await page.waitForURL('**/login');
  await page.fill('input[type=email]', process.env.DEV_TEST_EMAIL);
  await page.fill('input[type=password]', process.env.DEV_TEST_PASSWORD);
  await page.click('text=(개발용) 비밀번호로 로그인');
}

async function chatFlow(page, tag) {
  await page.getByRole('button', { name: /^제주/ }).click();
  await page.getByText('제주 일정은 언제인가요?').waitFor();
  await page.fill('form input', '10/2');
  await page.press('form input', 'Enter');
  await page.getByText('마지막 일정이 14:30에 끝나요.').waitFor({ timeout: 15000 });
  check(`[${tag}] 일정 DB에서 출발 가능 시각 14:30 계산`, true);
  await page.getByRole('button', { name: '14:30 이후 출발할게요' }).click();
  await page.getByText('지난 제주 방문 3회').waitFor();
  await page.getByRole('button', { name: '연휴 고향 방문' }).click();
  await page.getByText('14:30 집 출발 기준 총 소요').first().waitFor({ timeout: 15000 });
  const cards = await page.getByText('14:30 집 출발 기준 총 소요').count();
  check(`[${tag}] 결과 카드 2개 이상`, cards >= 2, `${cards}개`);
  // 10/2(금)은 TAGO 조회 범위(오늘~6일) 밖이라 한국공항공사 정기 스케줄이 쓰인다
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
  await page.fill('input[type=date]', '2026-10-02');
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

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
