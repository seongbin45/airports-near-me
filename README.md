# 공항 찾기 (Airports near me)

수업 시간표·일정·거주지·지난 방문 기록을 바탕으로, 목적지까지 가장 알맞은 공항과 항공편을 대화 형식으로 추천하는 서비스. 첫 대상은 대한민국 국내선.

## 구조

| 경로 | 내용 |
|---|---|
| `design/` | Claude Design 프로토타입 원본 (`*.dc.html`, 생성된 런타임 `support.js`). 화면 이식의 기준 |
| `app/login` | 이메일 매직링크 로그인 (개발 모드에서만 비밀번호 로그인 추가) |
| `app/onboarding` | 가입 6단계: 국가 → 거주지 → 유형 → 시간표·일정 → 방문 기록 → 요약. 단계마다 DB 저장 |
| `app/chat` | 대화형 추천: 목적지 → 날짜 → 출발 시각(일정 DB로 계산) → 방문 이유(기록과 대조) → 공항별 결과 |
| `app/me` | 내 데이터: 기본 정보 · 방문 기록 · AI 기록 · 개인정보(동의, JSON 내보내기, 계정 삭제) |
| `app/api/{day,recommend,ai}` | 그날 일정 / 추천 계산 / AI 문장 (버튼으로만 호출) |
| `lib/recommend.ts` | 출발 시각 + 공항까지 시간 → 40분 여유로 탈 수 있는 첫 편 → 총소요 순 |
| `lib/ai/` | AI 호출(도구 없음, DB 결과만 전달)과 답변 속 편명·시각 DB 대조 |
| `lib/data/` | 외부 데이터 어댑터 자리 (공공데이터포털 운항 스케줄, 카카오모빌리티, ODsay, 타임라인, 캘린더) |
| `supabase/migrations/` | 스키마·시드 SQL. Supabase CLI로 연결됨(`supabase migration list`로 원격과 일치 확인, `supabase db push`로 적용) |

## AI 원칙

`reference/Various_AI_Support_and_Rollback_Logic/`(이전 프로젝트)의 "AI는 JSON만, 검증은 코드가 독립적으로" 원칙을 따른다. 세부: [docs/UNVERIFIED_VALUES.md](docs/UNVERIFIED_VALUES.md), [docs/CONTINGENCY.md](docs/CONTINGENCY.md).

- 사실(편명·시각·공항·소요시간)은 DB에서만 가져온다. AI는 그 결과를 문장으로 다듬기만 한다.
- AI는 사용자가 "AI 요약 받기" / "AI에게 보내기"를 눌렀을 때만 `/api/ai`에서 호출된다. 도구를 주지 않는다.
- AI는 정해진 JSON(`text`, `used_flight_nos`)으로만 답한다. 형식이 틀리면 버린다.
- 문장 속 편명·시각·공항·소요시간·날짜가 이번 추천의 DB 값과 하나라도 다르면 보여주지 않는다. 요금·지연·연락처는 값과 상관없이 막는다. 검증 중 예외도 차단(fail-closed). 결과는 `ai_calls.verify_detail`에 기록한다.
- 계정 설정에서 AI를 끄면 서버가 호출을 거절한다.
- **제공자 예비 체계** (`lib/ai/providers.ts`): `AI_PROVIDERS` 순서(기본 claude → openai → gemini → xai)로, 키와 모델 id(`*_MODEL`)가 모두 있는 제공자만 시도한다. 일시 오류(429·5xx·네트워크)는 `AI_HTTP_RETRIES`회 재시도 후 다음 제공자로, 형식이 틀린 답도 다음 제공자로 넘긴다. 거절은 다른 회사로 넘기지 않는다. 어느 제공자든 같은 JSON 형식·같은 DB 대조를 거치고, 누가 답했는지는 `ai_calls.provider/model/attempts`에 남는다.

## 실행

```bash
cp .env.example .env.local   # Supabase URL·키 입력. ANTHROPIC_API_KEY가 없으면 AI 버튼은 "키 미설정"으로 응답
npm install
npm run dev                  # http://localhost:3000
npm test                     # 추천·검증·입력 규칙 단위 테스트
```

E2E(가입 → 대화 → 결과 → 내 데이터): `supabase/seed-dev.sql`로 테스트 계정을 만들고 `.env.local`에 `DEV_TEST_EMAIL`/`DEV_TEST_PASSWORD`를 넣은 뒤

```bash
node --env-file=.env.local scripts/e2e.mjs [스크린샷 폴더]
```

(로컬 Edge 사용. `E2E_CHANNEL=chrome`으로 바꿀 수 있음. 테스트 계정은 가입 전 상태여야 한다.)

## 운항 스케줄 동기화

공식 오픈API 두 개를 쓴다 (활용가이드 원본: `reference/KO_API_Guide/`, git 제외).

| 출처 | 엔드포인트 | 내용 |
|---|---|---|
| [한국공항공사_항공기 운항 스케줄 정보_GW](https://www.data.go.kr/data/15158949/openapi.do) | `apis.data.go.kr/B551178/flight-schedule/dom` | 정기 스케줄 (운항 요일·유효 기간). 인천 국내선 포함 |
| [국토교통부_(TAGO)_국내항공운항정보](https://www.data.go.kr/data/15098526/openapi.do) | `apis.data.go.kr/1613000/DmstcFlightNvgInfo/GetFlightOpratInfoList` | 날짜별 실제 운항편 + 일반석 요금 |

추천은 출발 공항마다 **TAGO(그날 운항) > 한국공항공사(정기)** 중 있는 것을 쓴다.

### 불러오는 방식 — 날짜를 미리 정하지 않는다

1. **주기 전체 동기화** (`npm run sync`, GitHub Actions 매일 03:00 KST)
   - 한국공항공사: 오늘부터 하루씩 "그날 전 노선"을 조회하고, **7일 연속 0건이면 공개된 끝**으로 보고 멈춘다. 새 시즌이 공개되면 자동으로 범위가 늘어난다. (약 190회 호출)
   - TAGO: 한국공항공사 스케줄이 있는 노선마다, **그 노선 스케줄이 끝나는 날까지 모든 날짜**. (2026-09 기준 38개 노선 × 30일 = 1,140회)
2. **사용자 요청 시 채우기** (`ensureFresh`): 사용자가 고른 날짜·노선이 DB에 없으면 추천 직전에 두 API를 불러 저장한다(약 0.7초, 최대 8초 기다림).
   `flight_fetch_log`에 "이미 물어봤음(0건이어도)"을 남겨 같은 조회를 반복하지 않는다 (한국공항공사 24시간, TAGO 6시간).
3. 공개 범위 밖 날짜는 대화에서 "○○ 이후 운항 스케줄은 아직 공개되지 않았어요"로 안내한다.

안전장치: 이번에 받은 양이 기존의 절반도 안 되면 삭제하지 않고 실패로 기록한다(대량 삭제 방지). 실행 기록은 `sync_runs`.

```bash
npm run sync                     # 한국공항공사 + TAGO (약 2분, 개발 서버 필요 없음)
npm run sync -- kac-full         # 한국공항공사만
npm run sync -- tago-horizon     # TAGO만
npm run sync -- kac-full --dry   # DB에 쓰지 않고 받기만
```

필요한 env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(Supabase secret key, `supabase projects api-keys --reveal`), `DATA_GO_KR_KEY`(공공데이터포털 일반 인증키, 두 API 공용).

GitHub Actions: `.github/workflows/sync-flights.yml`. 저장소 Settings → Secrets에 위 세 값을 넣으면 매일 돌고, Actions 탭에서 수동 실행도 된다.
배포 서버에서 HTTP로 돌리려면 `GET /api/cron/sync-flights?job=all` (`Authorization: Bearer $CRON_SECRET`).

## 데이터 현황

- 행정구역: 2026년 9월 기준 16개 시·도 (인천 구 개편, 전남광주통합특별시, 화성시 4개 구, 군위군 대구 편입). 개편 전 구역은 `valid_to`로 남겨 과거 방문 기록을 매핑한다. 행정안전부 행정표준코드(`adm_code`)로 교체 예정.
- 공항: 한국공항공사 국내선 14개 + 인천.
- 공항 접근 시간은 아직 **화면용 샘플**(수원시 영통구 기준). 카카오모빌리티·ODsay 연동은 다음 단계.
