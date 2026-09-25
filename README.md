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


## 입력 규칙과 기록

- 방문 이유는 자유 입력이지만 금액·연락처·링크는 받지 않는다(`checkReason`). 이유는 그대로 AI에게 넘어가고, AI가 그 값을 되받아 쓰면 검증기의 금지 규칙에 걸려 그 여정은 계속 답을 못 받기 때문이다.
- AI 문장 검증은 값 집합 비교가 아니라 **문장 단위 조합 검사**다(`lib/ai/verify.ts`). 값 하나하나가 DB에 있어도 "청주공항에서 A 1207편"(A 1207은 김포 편) 같은 조합은 막는다.
- `ai_calls`에는 체인에서 고른 모델(`model`)과 **실제로 답한 모델**(`served_model`), 제공자 응답의 사용량(`usage`)을 함께 남긴다. Anthropic 서버 측 폴백이 일어나면 두 값이 다르다.
- 스키마 변경은 `supabase/migrations/`에만 넣고, 적용은 `supabase db push`.
- 푸시·PR마다 `.github/workflows/ci.yml`이 린트·테스트·빌드를 돌린다.

## 동기화 안전장치 (2026-09-25 보강)

기존 스케줄과 이번 응답이 크게 어긋나면(절반 미만) **저장도 삭제도 하지 않는다**. 저장을 먼저 하면 기존 편이 남은 채 새 편만 더해져 그날 추천에 유령 편이 섞이기 때문이다. 조회 기록(`flight_fetch_log`)도 남기지 않아 다음 실행에서 다시 시도한다. 같은 규칙을 주기 전체 동기화뿐 아니라 사용자 요청 시 채우기(`ensureFresh`)에도 적용한다.


## 방문 기록(visits)은 어디서 만들어지나

`visits`에 쓰는 경로는 `POST /api/visits` 한 곳이다. 대화에서 만든 여정(`trips`)을 **자동으로 옮기지 않는다** — 날짜가 지났다고 그냥 옮기면 취소한 여정도 기록으로 남고, 그 가짜 기록이 이유 대조(`reasonCrossCheck`)와 "지난 2회" 칩의 근거가 되기 때문이다.

- 내 데이터 → 방문 기록에서 **확인 대기**로 보여주고, [다녀왔어요]를 누르면 `visits`에 들어간다(`source = 'trip'`, `trip_id`로 출처 추적). [안 갔어요]는 `trips.visit_dismissed_at`에 남겨 다시 묻지 않는다.
- 목적지·날짜·출발 공항은 요청 본문이 아니라 **DB의 여정 행**에서 읽는다. 같은 날 같은 목적지는 한 번의 방문이므로 `visits (user_id, dest_city, visited_on)` unique로 중복을 막는다.
- 확인해서 만든 기록을 지우면 그 여정도 확인 대기에서 뺀다(지운 기록이 바로 다시 올라오지 않게).
- 방문 이유는 어느 경로로 들어와도 `checkReason`(《입력 규칙과 기록》)을 지난다.
- 확인 대기 판단은 `lib/visits.ts`의 순수 함수에 있고 테스트가 있다.
