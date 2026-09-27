// E2E가 추천 결과를 볼 수 있도록 **테스트 프로젝트에만** 접근 시간 고정값을 넣는다.
//   npm run e2e:seed
//
// 왜 필요한가: E2E 대화 흐름은 "제주" 일정으로 추천 카드를 확인한다. 추천은 거주지→공항 접근 시간이 있어야
// 계산되므로(없으면 regionMissing), 테스트 프로젝트에도 access_times 행이 있어야 한다.
// 운영과 같은 방식(카카오 배치)을 쓰지 않는 이유:
//   - 카카오 키를 CI에 두면 쿼터가 운영 동기화·앱 런타임과 섞인다(시각대 배치의 과금 문제도 아직 미확정)
//   - 검사는 "추천이 뜨는가"를 보는 것이지 "카카오 값이 맞는가"를 보는 것이 아니다
// 그래서 값을 **투명하게 표시**한다: source = 'E2E 고정값'. is_sample은 켜지 않는다 —
// 화면이 '화면용 샘플 데이터' 배지를 달면 E2E의 "샘플 아님" 단언과 어긋난다.
//
// 표식(e2e_marker)이 없으면 즉시 중단한다 — 운영 DB에 이 값을 넣으면 안 된다.
import { createClient } from '@supabase/supabase-js';
import { markerProblem } from '../lib/server/e2e-guard';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) { console.error(`환경변수 ${k}가 없어요.`); process.exit(2); }
  return v;
};

const url = need('NEXT_PUBLIC_SUPABASE_URL');
const admin = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// ── 표식 확인 (운영 보호)
const marker = await admin.from('e2e_marker').select('note').eq('id', 1).maybeSingle();
if (marker.error) { console.error(`중단: e2e_marker를 확인할 수 없어요: ${marker.error.message}`); process.exit(2); }
const problem = markerProblem(marker.data?.note);
if (problem) { console.error(`중단: ${problem}`); process.exit(2); }
console.log(`표식 확인됨 — 테스트 전용 프로젝트(${new URL(url).host})`);

// ── 검사에 쓰는 지역 (docs/E2E.md의 대화 흐름이 '경기도 수원시 영통구'를 고른다)
const REGION = '경기도 수원시 영통구';
const { data: region, error: regionErr } = await admin.from('regions').select('id, full_name').eq('full_name', REGION).maybeSingle();
if (regionErr) { console.error(`중단: regions 조회 실패: ${regionErr.message}`); process.exit(1); }
if (!region) { console.error(`중단: '${REGION}'가 regions에 없어요. 마이그레이션(seed_reference_data)이 적용됐는지 확인하세요.`); process.exit(1); }

// 도착 공항(CJU)은 권역이 달라 접근 시간을 만들지 않는다 — 추천은 출발 공항의 접근 시간을 쓴다.
const { data: airports, error: airErr } = await admin.from('airports').select('code, name_ko').neq('code', 'CJU').order('code');
if (airErr) { console.error(`중단: airports 조회 실패: ${airErr.message}`); process.exit(1); }
if (!airports?.length) { console.error('중단: airports가 비어 있어요.'); process.exit(1); }

// 대화 흐름은 금요일 14:30 출발이라 bandFor가 'weekday_day'를 고른다. 'any'는 그 시각대가 없을 때의 fallback이다.
const bands = ['any', 'weekday_day'];
const rows = bands.flatMap((band, bi) =>
  airports.map((a, i) => ({
    region_id: region.id, airport: a.code, mode: 'car', depart_band: band,
    // 먼 공항일수록 길게 — 값 자체는 검사 대상이 아니고, 카드가 2개 이상 뜨면 된다
    minutes: 45 + i * 7 + bi * 5,
    source: 'E2E 고정값', fetched_at: new Date().toISOString(), is_sample: false,
  })));

const { error: upErr } = await admin.from('access_times').upsert(rows, { onConflict: 'region_id,airport,mode,depart_band' });
if (upErr) { console.error(`중단: access_times 저장 실패: ${upErr.message}`); process.exit(1); }

const { count } = await admin.from('access_times').select('id', { count: 'exact', head: true })
  .eq('region_id', region.id).eq('source', 'E2E 고정값');
console.log(`접근 시간 고정값 ${count ?? 0}건 — ${region.full_name} → 육지 공항 ${airports.length}곳 × 시각대 ${bands.join('·')}`);
console.log('이 값은 검사용입니다(source = E2E 고정값). 추천 카드가 뜨는지만 확인합니다.');
