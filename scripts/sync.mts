// 운항 스케줄 주기 전체 동기화 — 개발 서버 없이 단독 실행 (GitHub Actions에서 이 파일을 돌린다)
//   npm run sync                     한국공항공사 전체 + TAGO 전체 기간
//   npm run sync -- kac-full         한국공항공사만
//   npm run sync -- tago-horizon     TAGO만 (한국공항공사 스케줄이 먼저 있어야 함)
//   npm run sync -- kac-full --dry   DB에 쓰지 않고 받기만
// 필요한 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATA_GO_KR_KEY (로컬은 .env.local, Actions는 Secrets)
import { createClient } from '@supabase/supabase-js';
import { syncKacFull, syncTagoHorizon, type JobReport, type Trigger } from '../lib/server/flight-sync';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const args = process.argv.slice(2);
const job = args.find(a => !a.startsWith('--')) ?? 'all';
const dryRun = args.includes('--dry');
const trigger: Trigger = process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : 'manual';
// 한국 날짜 기준 "오늘"
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const opts = { serviceKey: need('DATA_GO_KR_KEY'), today, trigger, dryRun, log: (m: string) => console.log(`  … ${m}`) };

const print = (r: JobReport) => {
  console.log(`\n[${r.job}] ${r.ok ? '성공' : '실패'} — 받음 ${r.fetched} · 저장 ${r.saved} · 삭제 ${r.removed} · 호출 ${r.calls}${r.note ? ` (${r.note})` : ''}`);
  if (r.aborted) console.log(`  중단: ${r.aborted}`);
  for (const f of r.failed.slice(0, 10)) console.log(`  실패: ${f}`);
  if (r.failed.length > 10) console.log(`  … 외 ${r.failed.length - 10}건`);
};

const reports: JobReport[] = [];
console.log(`운항 스케줄 동기화 ${today} (${trigger}${dryRun ? ', dry run' : ''})`);
if (job === 'kac-full' || job === 'all') { reports.push(await syncKacFull(dryRun ? null : admin, opts)); print(reports.at(-1)!); }
if ((job === 'tago-horizon' || job === 'all') && !dryRun) { reports.push(await syncTagoHorizon(admin, opts)); print(reports.at(-1)!); }
process.exit(reports.every(r => r.ok) ? 0 : 1);
