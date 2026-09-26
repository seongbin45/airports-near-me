# 비상 계획

(참고: `reference/…/docs/Contingency_Plan/CONTINGENCY.md`의 형식을 따름)

| 상황 | 심각도 | 대응 |
|---|---|---|
| AI 답이 정해진 JSON 형식이 아님 | 중 | 버린다. 사용자에게는 "형식이 아니어서 보여드리지 않아요"와 DB 결과 표만. `ai_calls.verify_detail.parseError` 기록 |
| AI 답에 DB에 없는 값 | 상 | 차단(표시 안 함). 불일치 값을 `ai_calls.verify_detail`에 남기고 내 데이터 → AI 기록에 표시 |
| 검증기 예외 | 상 | fail-closed. AI 문장을 보여주지 않음 |
| AI 거절(`refusal`) | 하 | Claude는 서버 측 fallback 모델로 자동 재시도. 그래도 거절이면 다른 회사로 넘기지 않고 표만 |
| 1차 AI 제공자 장애·한도 초과 | 중 | `AI_PROVIDERS` 순서로 다음 제공자(키·모델 있는 것만). 전부 실패면 "잠시 뒤 다시" 안내, 추천 표는 AI 없이 계속 동작 |
| 특정 제공자가 형식이 틀린 답 | 중 | 그 답은 버리고 다음 제공자 |
| 운항 편이 없어짐(동기화 삭제) | 하 | `trips.chosen_flight_id`는 null이 되고, 고른 편명·시각은 `trips.chosen_*`에 남는다 |
| 공공데이터포털 키 오류·만료(30, 31)·IP 미등록(32) | 상 | 동기화 첫 호출에서 중단(`aborted`). 기존 스케줄은 지우지 않음. 포털에서 키 상태 확인 |
| 공공데이터포털 트래픽 초과(22)·5xx·네트워크 | 중 | 1·2·4초 재시도 후 그 노선만 실패. 다른 노선은 계속. 다음 Cron에서 재시도 |
| 제공기관 응답 형식 변경 | 상 | 받은 필드 목록과 함께 중단(`FORMAT`). 파서 수정 전까지 기존 데이터 유지 |
| 스케줄이 오래됨(7일 이상 미갱신) | 중 | 결과 카드에 "항공사에서 다시 확인하세요" 경고 |
| 인증키·secret key 유출 | 상 | 공공데이터포털·Supabase·Anthropic 콘솔에서 폐기·재발급. `.env*`는 커밋하지 않음. 오류 메시지는 `redactKey`로 키를 지움 |
| 인증 메일 한도 초과 | 중 | 커스텀 SMTP 연결 전에는 실사용자 받지 않음 (README 참조) |
| 위치정보 동의 철회 | — | **정책: 즉시 삭제** (30일 유예 없음, 유예용 스키마도 두지 않음). 방문 기록을 바로 지우고 추천은 거주지 기준으로만. 스위치를 한 번 더 누르거나 확인 버튼으로 확정하며, 확인 상태가 된 뒤 1초 안의 두 번째 탭은 무시한다(`lib/confirm.ts`, 모바일 연속 탭 방지). 계정 삭제도 같은 규칙 |
| 동기화가 비정상적으로 적은 양을 받음 | 상 | 기존의 절반 미만이면 삭제하지 않고 실패로 기록(`MASS_DELETE_RATIO`). 2026-09-25 날짜 없는 전체 조회가 2건만 돌려줘 565건이 지워진 사고 후 추가 — 같은 날 날짜별 조회로 복구 |
| 사용자 요청 시 API 조회가 느림·실패 | 하 | 8초까지만 기다리고 DB에 있는 것으로 추천. 실패는 `flight_fetch_log.error`에 기록 |
| 지도 API 한도 소진 (카카오 등) | 중 | `lib/data/map-chain.ts`: 한도(429)·키 거부(401/403)·응답 형식 변경이면 그 제공자를 그 실행 동안 빼고 다음 제공자로. 차량 카카오모빌리티 → TMAP → 네이버 → OSRM, 좌표 카카오 → 네이버 → Nominatim. 모두 소진되면 배치를 멈추고 남은 수를 보고, 다음 실행에서 이어감 |
| 지도 API 일시 오류 (5xx·네트워크) | 하 | 같은 제공자로 1회 재시도 후 그 조합만 다음 제공자로 (제공자는 계속 씀) |
| 경로 없음·주소 못 찾음 | 하 | 길찾기는 다른 제공자에게 묻지 않고 조합 실패로 기록(대개 같은 결과). 지오코딩은 다음 제공자에게 묻는다(새 행정구역 이름이 한 곳에만 있을 수 있음) |
| 권역이 다른 조합 (제주 구역 → 김포 등) | — | 계산하지 않는다(`planAccessTimes`의 권역 규칙). 육로가 없어 모든 제공자가 실패하기 때문 |
| 이동 시간에 시각대 값이 없음 (실측이 전부 `any`) | 중 | 추천은 `any`(호출 시점 실시간 교통)로 물러서고 결과 카드에 그 사실을 표시한다(`accessBandMatched`). `npm run doctor`의 `access-bands` 게이트가 주의로 알린다. 채우려면 `npm run access-times -- --bands weekday_am,weekday_day,weekday_pm,weekend` |
| 출발 시각을 반영하지 않는 제공자로 시각대 값을 만듦 | 중 | 저장하지 않는다(`supportsDepartureTime`). 실시간 전용(OSRM 등) 값에 "평일 아침" 딱지를 붙이면 컬럼이 거짓말을 하게 된다 |

## 동기화 실행이 조용히 취소되는 문제 (2026-09-27)

**증상** — 2026-09-25 21:07 UTC 정기 실행(`sync-flights`)이 `cancelled`로 끝났고, 36시간 동안 성공한 동기화가
없었다(`npm run doctor`의 `sync-recent` 실패로 발견). 로그에는 `apis.data.go.kr:443` 연결 타임아웃이 반복됐고,
TAGO 1,102회 중 111회를 22분 동안 두드리다 job `timeout-minutes: 30`에 걸려 취소됐다.

**왜 조용한가** — GitHub이 timeout으로 끝낸 job은 `cancelled`가 되고 알림이 없다. 게다가
`sync_runs` 행은 정상 종료 경로에서만 닫히므로(`lib/server/flight-sync.ts` `recordRun`)
`ok=null, finished_at=null`로 남는다. `sync-recent`는 `ok === true`만 세므로 성공으로 오인하지는 않지만,
"중단됐다"고 알려주지도 않는다. 그래서 두 곳을 고쳤다.

1. **스스로 멈춘다** — `SYNC_DEADLINE_MS`(45분)와 연결 실패 회로 차단기(`TRANSPORT_FAIL_STREAK` = 5회 연속).
   스스로 멈추면 `aborted`가 기록되고 `scripts/sync.mts`가 exit 1을 돌려 워크플로가 **실패**로 남는다.
   워크플로 `timeout-minutes`는 60분 안전망으로만 남긴다.
2. **중단을 보이게 한다** — `doctor`에 `sync-pending` 게이트(`SYNC_PENDING_HOURS` = 2시간).
   끝나지 않은 실행이 있으면 `[주의]`로 표시한다(`critical: false` — 데이터가 낡았다는 사실은 `sync-recent`가 이미 말한다).

**회로 차단기가 세는 대상** — `NETWORK`뿐 아니라 **재시도 가능한 오류(5xx·트래픽 초과)**도 센다.
22분을 태운 경로가 타임아웃과 재시도였기 때문이다(`lib/data/data-go-kr.ts` — `retryable`).
`FORMAT`·`DB 권한` 오류는 다시 물어도 같은 결과이므로 세지 않는다.

**함께 고친 것** — `kac-full`이 실패하면 `tago-horizon`(1,102회)을 시작하지 않는다.
2026-09-25에는 연결이 막힌 상태에서 TAGO를 그대로 돌려 22분을 버렸다.

**아직 모르는 것** — 원인이 "해외 러너"인지 "그 시간대"인지. 표본이 각 1건이다
(실패 1건 = 2026-09-25 21:07 UTC / 성공 1건 = 2026-09-25 02:47 UTC 수동 실행).
그래서 cron을 호출량이 두 배가 되는 두 번째 실행 대신, 관측된 성공 시간대(**KST 11:00**)로 옮겼다.
`DATA_GO_KR_KEY`는 운영 앱 런타임도 쓰므로(`lib/server/trip.ts`) 동기화 호출량을 늘리면 사용자 요청이
트래픽 초과(코드 `22`)로 막힐 수 있다.

**다음 실행이 또 실패하면** — 시간대 가설이 틀린 것이므로 국내 self-hosted runner 또는
Supabase Edge Function(서울 리전)으로 옮긴다. 둘 다 네트워크 경로 자체를 바꾸는 조치다.

**확인 방법** — `gh run list --workflow=sync-flights.yml --event schedule --limit 10`.
14일 넘게 스케줄 실행이 없으면 저장소 비활성으로 워크플로가 꺼진 것이다(`gh workflow enable sync-flights`).

## 로컬 실행에서 나는 두 가지 (2026-09-27)

- **`Error: JWT issued at future`** — Supabase가 발급한 JWT의 `iat`가 실행 기계 시계보다 미래일 때 난다.
  계획·조회 단계(`lib/server/paginate.ts`)에서 죽으므로 저장 전에 멈추고 그 회차는 아무것도 못 채운다.
  **같은 명령을 다시 돌리면 통과한다**(실측). 반복되면 Windows 시계 동기화를 확인한다(관리자 권한으로 `w32tm /resync`).
- **`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c`** — Node 25(비LTS) Windows의
  종료 경로 문제로 보인다. 요약 줄이 다 찍힌 **뒤에** 나므로 결과·저장에 영향이 없다. CI는 Node 24(LTS)다.
