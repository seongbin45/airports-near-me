# 확인되지 않았거나 근사인 값

추천 결과에 쓰이지만 공식 출처로 확인되지 않은 값, 또는 가정이 들어간 값 목록.
새 값을 코드·DB에 넣을 때 확인 전이면 여기에 적고, 확인되면 "확인됨"으로 옮긴다.
(참고: `reference/…/docs/Guidelines_File/Scope/UNVERIFIED_VALUES.md`의 방식을 따름)

## 아직 확인 전

| 값 | 위치 | 상태 | 확인 방법 |
|---|---|---|---|
| 집 → 공항 소요시간 (수원시 영통구 → 김포 55분 등) | `access_times` (`is_sample`) | **화면용 샘플** | 카카오모빌리티·ODsay 연동 후 교체 |
| 공항 좌표 10곳 (TAE, KWJ, RSU …) | `airports.lat/lng` | 근사값 | 국토부 공항 기준점 좌표와 대조 |
| 국내선 "출발 40분 전 공항 도착" | `DOMESTIC_BUFFER_MIN` | 일반 안내 기준 | 항공사별 탑승 마감 시각(20분 전 등)과 공항별 보안검색 대기 반영 여부 결정 |
| 샘플 운항편 (A 1203 등, 샘플항공) | `flight_schedules` (`is_sample`) | 가짜 | 실제 스케줄이 들어오면 출발 공항별로 자동 제외 (`pickBestSource`) |
| 샘플 방문 기록 4건 | 테스트 계정 `visits` (`is_sample`) | 가짜 | 운영 DB에는 넣지 않음 (`supabase/seed-dev.sql`) |
| TAGO `economyCharge = 0` 의 의미 | `parseTagoItem` | "요금 정보 없음"으로 처리 | TAGO 운영팀(054-459-7870) 문의 |
| TAGO에서 같은 날 같은 편명이 시각만 5분쯤 다르게 두 번 오는 경우 (예: OZ8963 15:05/15:10) | `dedupe` | 더 이른 출발을 남김 | 항공사 시간표와 대조 |
| 행정구역 목록 | `regions` | 2026-09 개편 반영, 공식 코드(`adm_code`) 없음 | 행정안전부 행정표준코드로 교체 |
| 에브리타임 XML `day` 번호 = 0 월 … 6 일 | `lib/everytime/xml.ts` `DAY_BY_INDEX` | every2cal 한 곳(파이썬 `weekday()`에 그대로 넘김)에서만 추론 | 본인 공유 링크에서 북마클릿 실행 → 미리보기 요일을 앱 화면과 대조 (docs/EVERYTIME.md) |
| 에브리타임 XML 시각 = 5분 단위 정수(`starttime×5`분) | `lib/everytime/xml.ts` `slot` | every2cal·linker 두 구현 일치 | 위와 같은 실측 |
| 공유 시간표 XML 요청이 사용자 브라우저(에브리타임 페이지)에서 CORS로 허용되는지, 쿠키가 필요한지 | `lib/everytime/bookmarklet.ts` | 모름 — 기본(same-origin) 실패 시 `include`로 한 번 더 | 북마클릿 실측 |
| 학기 표시(`<table year semester>`) | `lib/everytime/xml.ts` | 속성 이름 추정 — 없으면 "에브리타임 시간표"로 표시 | 북마클릿 실측 |
| 시간표 캡처 인식 정확도 | `lib/ai/timetable.ts` | 비전 모델의 위치→수치 오차 평균 6% 안팎(ExChart, CHI'26) — 모든 항목에 "시각 확인" 필수 | 실제 캡처(월–금, 월–토)로 제공자별 대조 |

## 확인됨

| 값 | 근거 | 날짜 |
|---|---|---|
| 한국공항공사 GW 엔드포인트·응답 필드 (`domesticNum`, `domesticStartTime`, `domesticStdate`="2026-10-24T00:00:00" 등) | 실제 호출 + `reference/KO_API_Guide/한국공항공사_…_V1.docx` | 2026-09-25 |
| `schDeptCityCode` = **출발** 공항 (가이드 표에는 "도착 도시 코드"로 적혀 있으나 실제는 출발) | GMP→CJU 호출 결과의 `startcityCode: GMP` | 2026-09-25 |
| TAGO 엔드포인트 `1613000/DmstcFlightNvgInfo` (구 `DmstcFlightNvgInfoService`는 폐기, 오류 12) | 실제 호출 + TAGO 가이드 v1.1 | 2026-09-25 |
| TAGO 공항 ID 15개 (NAARKSS 등) | `GetArprtList` 호출 | 2026-09-25 |
| 한국공항공사: 날짜 없이 조회하면 이력 **일부만** 섞여 나온다 (김포→제주 현재 편 128 중 42, 전체 59,970건). 현재·미래 스케줄은 `schDate`로만 온전히 나온다 | 전 페이지 조회 비교 | 2026-09-25 |
| 한국공항공사: `schDate`만 주고 노선을 비우면 그날 전 노선이 한 번에 (599건) | 실제 호출 | 2026-09-25 |
| 한국공항공사·공공데이터포털: `numOfRows` 100 초과 시 HTTP_ERROR(04) | 실제 호출 (300·500·999·1000 실패) | 2026-09-25 |
| 공개 범위: 두 API 모두 2026-10-24까지 (동계 스케줄 미공개) | 날짜별 조회 | 2026-09-25 |
| 전남광주통합특별시 출범 (2026-07-01) | 위키백과·전남일보 | 2026-09-25 |

## AI 문장에서 막는 값

AI가 쓴 문장은 `lib/ai/verify.ts`가 코드로만 검사한다(LLM 재검수 없음).

- 이번 추천의 DB 값과 같아야 통과: 편명, 시각(HH:MM), 공항·도시 이름, 소요시간(N시간 N분), 날짜(M/D, M월 D일)
- 값과 상관없이 차단: 금액·요금, 지연·결항·좌석·날씨, 전화번호·이메일·링크 — 추천 DB에 AI에게 준 근거가 없다
- AI가 "사용했다"고 밝힌 편명(`used_flight_nos`)이 문장에 없거나 DB에 없으면 차단
- 검증 중 예외가 나면 차단 (fail-closed)

## 지도 API 예비 체계 (2026-09-25 추가)

| 값 | 위치 | 상태 |
|---|---|---|
| TMAP 경로안내 응답 `features[0].properties.totalTime`(초)·오류 형식 | `parseTmapRoute` | 문서 기준, **키로 실측 전** |
| TMAP 대중교통 응답 `metaData.plan.itineraries[0].totalTime`(초)·`transferCount`·`fare.regular.totalFare` | `parseTmapTransit` | 문서 기준, **키로 실측 전**. **상품 구매 필요(유료)** |
| TMAP 대중교통 오류 `result.status`(14=경로 없음)의 HTTP 상태 | `parseTmapTransit` | 문서 Result Sample이 **HTTP 200**으로 보여 줌([에러 코드](https://tmap-public-skopenapi.readme.io/reference/error-code-34)). 그래서 상태 코드가 아니라 본문으로 판단한다 — 실측 전 |
| TMAP 대중교통 `searchDttm`(타임머신, yyyymmddhhmi)이 **미래 시각**을 받아 그 시각 기준 경로를 주는지 | `tmapTransitSource.supportsDepartureTime` | 파라미터 **존재는 문서로 확인**(transit.tmapmobility.com/docs/routes). 미래 시각 허용 여부는 미확인 → 그래서 아직 `false`. 확인 전에 켜면 `depart_band`가 거짓말을 한다 |
| TMAP 대중교통 `legs[].service`(1=운행중, 0=운행종료)가 0일 때 `totalTime`의 뜻 (경로 없음 14가 오는지, 시간표 기준 값이 오는지) | `parseTmapTransit` | 문서에 필드 정의만 있음, 동작 미확인. 배치가 심야에 돌면 문제가 될 수 있다 |
| TMAP 대중교통 일일 쿼터·요금 | 시각대 배치 비용 | 미확인 (SK open API 요금 페이지가 JS 렌더라 크롤 불가) |
| 대중교통 예비 체계: 1차 ODsay(무료, 서버 키는 등록한 고정 IP에서만 동작) → 예비 TMAP 대중교통(유료) | `buildAccessTimeSources` | ODsay가 IP·한도로 막혀도 대중교통 값을 계속 채우기 위한 것. 2026-09-27 현재 ODsay는 `ApiKeyAuthFailed`(IP 미등록으로 보임)로 한 건도 못 받았다 |
| 네이버 Directions 5 `route.traoptimal[0].summary.duration`(밀리초)·Geocoding `addresses[].x/y`, 도메인 `maps.apigw.ntruss.com` | `parseNaverDriving`, `parseNaverGeocode` | 문서 기준, **키로 실측 전** |
| OSRM·Nominatim 공용 서버 | `osrmCarSource`, `nominatimGeocoder` | 실제 호출로 확인. 실시간 교통 미반영(OSRM), 초당 1회 정책 |
| 제공자마다 소요시간 기준이 다름 (카카오: 교통 반영 추천 경로, OSRM: 도로 속도만) | `access_times.source` | 출처를 행마다 저장. `npm run doctor`가 출처별 분포를 보여준다 |
| 기존 `access_times` 실측은 전부 `depart_band = 'any'`(출발 시각 미지정). 카카오모빌리티는 이때 **호출 시각의 실시간 교통**으로 계산하므로, 2026-09-25 금요일 16~17시(KST) 배치에는 퇴근길 정체가 들어가 있다 (예: 수원 영통구 → 김포 137분) | `access_times` (`depart_band = 'any'`) | 실측값이지만 시각대 편향 · **시각대 배치를 아직 돌리지 않아 그대로 남아 있다** | `select depart_band, count(*) from access_times group by 1` 로 확인. 채우려면 `npm run access-times -- --bands weekday_am,weekday_day,weekday_pm,weekend` 후 `npm run doctor`의 `access-bands` 게이트 |
| 카카오모빌리티 "미래 운행 정보 길찾기"(`/v1/future/directions`)의 `departure_time` 파라미터와 응답 형식 | `kakaoFutureCarSource` | 문서 기준, **키로 실측 전**. 출발 시각은 현재 이후만 허용(`YYYYMMDDHHmm`) | 시각대 배치 1회 실행 — `weekday_pm`(18:00) 값이 `any`보다 큰지(정체 반영) 확인 |
| OSRM·Nominatim 등 실시간 전용 제공자의 값은 시각대를 지정해도 출발 시각이 반영되지 않는다 | `AccessTimeSource.supportsDepartureTime` | 코드로 차단(시각대 배치에서 제외) | 시각대 배치 후 `source` 분포에 OSRM이 섞이지 않는지 `npm run doctor`로 확인 |
