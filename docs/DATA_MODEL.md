# 데이터 모델 — 어느 화면이 무슨 테이블을 쓰는가

2026-09-26 작성. 스키마(`supabase/migrations/`)와 코드의 실제 조회 지점에서 뽑았다.

**이 문서의 범위는 데이터 층이다.** 화면 문구·배치·색 같은 디자인 층은 다루지 않는다.
리뷰 ⑤("디자인과 코드 중 어느 쪽이 기준인가")에서 화면 층의 기준은 사용자가 정할 문제이고,
이 문서는 그 판단에 필요한 데이터 층 사실을 한 곳에 고정한다.

## 1. 읽는 주체 세 가지

RLS(행 수준 보안)는 **키에 따라 적용되느냐 마느냐가 갈린다.** 같은 테이블도 누가 읽는지에 따라 보이는 행이 다르다.

| 주체 | 쓰는 키 | RLS | 어디서 |
|---|---|---|---|
| 브라우저·로그인 세션 | anon 키 + 사용자 JWT | **적용** | `components/*`(클라이언트), `app/*`의 서버 컴포넌트 |
| 서버 전용 | service role (`SUPABASE_SERVICE_ROLE_KEY`) | **우회** | `scripts/*`, `lib/server/flight-sync.ts`, `lib/server/trip.ts`의 즉시 조회 경로 |
| 공개 읽기 | anon 키 | 정책이 `using (true)` | 참조 데이터 테이블 |

그래서 service role을 쓰는 스크립트는 남의 행도 읽는다(배치·집계가 그래야 한다).
반대로 브라우저에서 읽는 화면은 RLS가 막아 주므로, 화면 코드에 `.eq('user_id', …)`를 빠뜨려도
남의 행은 보이지 않는다 — **정책이 있으면 안전하고, 없으면 그냥 뚫린다.**

## 2. 참조 데이터 (누구나 읽기)

| 테이블 | 내용 | 읽는 화면 | 채우는 것 |
|---|---|---|---|
| `countries` | 국가 목록·사용 여부 | 온보딩(국가) | 마이그레이션 시드 |
| `regions` | 행정구역(시도·시군구·구) + 좌표·지오코딩 출처 | 온보딩(거주지), 추천, 배치 | 시드 + `npm run geocode-regions` |
| `airports` | 공항 코드·이름·도시·좌표 | 온보딩, 추천, 배치 | 마이그레이션 |
| `flight_schedules` | 운항 스케줄(노선·시각·운항 요일·유효 기간·요금) | 추천, `doctor` | Actions 동기화(매일) |
| `access_times` | 거주지 → 공항 이동 시간(수단·**시각대**별) | 추천, `doctor` | `npm run access-times` |

추천은 이 다섯이 모두 있어야 계산된다. 하나라도 비면 화면이 그 사실을 말하거나 `doctor`가 게이트로 막는다.

## 3. 사용자 데이터 (본인 행만)

전부 `user_id = auth.uid()`(또는 `id = auth.uid()`) 정책이다. 삭제는 **계정 삭제 시 cascade**, 방문 기록만 예외적으로 즉시 삭제다.

| 테이블 | 내용 | 읽는 화면 | 쓰는 곳 | 지워지는 때 |
|---|---|---|---|---|
| `profiles` | 거주 지역·국가·사용자 유형·온보딩 진행·AI 사용 여부 | 온보딩, `/me`, 추천 | 온보딩, `/me` | 계정 삭제 |
| `class_timetable` | 수업 시간표 | 온보딩(일정), 대화의 날짜 계획 | 온보딩 | 계정 삭제 |
| `schedules` | 개인 일정 | 온보딩, `/me`, 대화의 날짜 계획 | 온보딩, 타임라인 가져오기 | 계정 삭제 |
| `visits` | 방문 기록 | `/me` | `/me`, `POST /api/visits`(확인), 타임라인 | **동의 철회 즉시** · 계정 삭제 |
| `visit_candidates` | 타임라인에서 온 확인 대기 후보 | `/me` | 타임라인 가져오기 | 사용자가 "안 갔어요"(dismiss) · 계정 삭제 |
| `trips` | 추천한 여정(고른 편·편명·출발/도착 시각) | `/me`(확인 대기) | `POST /api/recommend` | 계정 삭제 |
| `ai_calls` | AI 호출 기록(프롬프트·응답·검증 결과·제공자·모델) | `/me`(AI 기록) | `POST /api/ai` | 계정 삭제 |
| `location_consents` | 위치정보 동의 이력(버전·동의 시각·철회 시각) | 온보딩, `/me` | 온보딩, `/me` | 계정 삭제 |

`visits`의 동의 철회는 정책상 **즉시 삭제**이고 유예 기간도 유예용 스키마도 두지 않는다(`docs/CONTINGENCY.md`).

## 4. 운영 로그 (읽기는 공개, 쓰기는 서버만)

| 테이블 | 내용 | 읽는 곳 | 쓰는 곳 |
|---|---|---|---|
| `flight_fetch_log` | 공공 API 조회 결과·오류·건수 | `doctor`(최근 24시간) | 동기화 |
| `sync_runs` | 동기화 실행 이력(성공·중단 이유) | `doctor`, Actions 요약 | 동기화 |

동기화가 조용히 실패하는 것을 막으려고 둔 기록이다. `doctor`의 `sync-recent` 게이트가 이걸 읽는다.

## 5. 화면 ↔ 테이블

| 화면 | 읽는 테이블 | 주체 |
|---|---|---|
| `/` | `profiles`(온보딩 완료 여부) | 서버(세션) |
| `/login` | — | — |
| `/onboarding` | `countries`, `regions`, `profiles`, `class_timetable`, `schedules`, `airports`, `location_consents` | 서버 + 브라우저 |
| `/chat` | `profiles`, `schedules`, `class_timetable`, `airports`, `access_times`, `flight_schedules` | 서버(`lib/server/trip.ts`) + 브라우저 |
| `/me` | `profiles`, `visits`, `visit_candidates`, `trips`, `ai_calls`, `schedules`, `location_consents` | 서버 + 브라우저 |
| `POST /api/recommend` | `profiles`, `access_times`, `airports`, `flight_schedules` | 서버(세션) |
| `POST /api/visits` | `trips`, `visits`, `visit_candidates` | 서버(세션) |
| `POST /api/ai` | `ai_calls` | 서버(세션) |
| `scripts/*` | 전부 | 서버 전용(service role) |

## 6. 계정 삭제가 지우는 것

`public.delete_my_account()`는 `security definer`에 `set search_path = ''`로 고정돼 있고,
인자를 받지 않고 `auth.uid()` 한 명만 지운다. 실행 권한은 `authenticated`에게만 있다
(`revoke … from public, anon`).

`auth.users` 행이 지워지면 **사용자 테이블 8개**(3장의 표)가 FK `on delete cascade`로 함께 지워진다.
마이그레이션의 FK 선언 8개를 세어 확인했다. 남는 것은 사용자와 무관한 참조 데이터뿐이다.

## 7. 이 문서가 답하지 않는 것

- **디자인 층**(문구·배치·색·화면 흐름)의 기준. 리뷰 ⑤의 그 부분은 사용자 판단이 필요하다.
- **DB에 지금 무엇이 들어 있는지**(행 수·시각대 분포·좌표 채움률) — `npm run doctor`가 답한다.
- **마이그레이션 적용 순서** — 파일 이름의 타임스탬프 순서다.

## 8. 스키마를 바꿀 때

**이미 적용된 마이그레이션 파일은 고치지 않는다.** 새 타임스탬프의 파일을 추가한다.
적용된 파일을 고치면 파일과 실제 DB가 어긋나고, 어느 쪽이 맞는지 아무도 모르게 된다
(2026-09-26 `31852c7`이 이 경로를 열어 둔 사례가 있다 — 이번에는 내용이 옳았지만 규칙은 규칙이다).
