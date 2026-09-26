# 체크리스트 — 시각대 배치 실행과 doctor 게이트 확인

2026-09-26 작성 · 2026-09-27 실측 갱신. 코드(`scripts/build-access-times.mts`, `lib/data/access-time.ts`, `lib/server/data-health.ts`)를 읽고 뽑았다.
확인된 것과 아직 확인하지 못한 것을 8장에 구분해 적었다.

시각대 컬럼(`access_times.depart_band`)을 붙였지만 값을 채우기 전까지 실측은 전부 `any`다.
`any`는 **호출 시점의 실시간 교통**으로 계산한 값이라, 2026-09-25 배치에서는 퇴근길 정체가 섞였다
(수원 영통구 → 김포 137분). 그 상태로 추천이 돌면 값이 어긋나므로 채워야 한다.

---

## 지금 어디까지 됐나 (2026-09-27 실측)

이 배치는 **실제로 돌았다.** 아래 값은 사용자 PC(Windows, Node 25.8.2)의 2026-09-27 새벽 실행과 그 직후 `npm run doctor`에 나온 값 그대로다.

| 항목 | 값 | 어디서 나온 값인가 |
|---|---|---|
| 시각대를 채울 차량 조합 | 3,544개 | 배치 `대상:` 줄의 `도달 가능한 조합 ÷ 4` · `doctor` 출처 줄 |
| 시각대 조합 전체 | 14,176개 (= 3,544 × 4) | 배치 `대상:` 줄 |
| 저장된 시각대 행 | 5,256건 (= 1,314 × 4) | `doctor` `access-bands` · `이동 시간 시각대` |
| **남은 조합** | **8,920건** (= 14,176 − 5,256) | 위 두 값의 차 |
| 회차 속도 | 5,000건 / 27.7분 (100건당 약 33초) | 배치 진행 줄 |
| 대중교통 | **0건** | `doctor` `접근 시간 출처` |
| 좌표 출처 미기록 지역 | 62곳 (좌표 자체는 256/256에 있음) | `doctor` `행정구역 좌표 출처` |

- 5,256 = 256건(중단된 1회차) + 5,000건(2회차). 중단된 회차의 저장분도 남았고, 다음 회차가 `최근 실측 256개 건너뜀`으로 이어받았다.
- 남은 8,920건은 **미래 운행 정보 길찾기 하루 한도 5,000건**([요금표](https://developers.kakaomobility.com/price/)) 기준 **2회차**(5,000 + 3,920)면 끝난다. 회차당 약 28분.

### 다음 실행 전 게이트 — 건너뛰지 말 것

- [ ] **G1. 오늘 사용량을 콘솔에서 확인한다 (돈이 걸려 있다)** — 미래 운행 정보 길찾기는 하루 5,000건까지 무료이고 초과분은 **8원/건**이다.
      2026-09-27 새벽에 이미 5,000건을 썼다. 카카오 개발자 콘솔의 사용량 화면에서 **오늘 호출 수와 한도 리셋 시각**을 확인하고, 한도가 돌아온 뒤에 실행한다.
      확인하지 않고 돌리면 그 회차 전체가 과금 대상이 된다.
- [ ] **G2. 5장의 am/pm 검증 SQL을 먼저 돌린다 (호출 0건)** — 남은 8,920건을 태우기 전에 **이미 저장된 1,314조합**으로 확인한다.
      `same = total`이면 카카오가 출발 시각을 반영하지 않은 것이고, 지금까지 저장한 5,256건은 전부 버려진 값이다.
      이 게이트를 통과하지 못하면 배치를 더 돌리지 말고 `lib/data/access-time.ts`의 `departure_time` 전달을 본다.
- [ ] **G3. 대중교통은 별개 작업** — 0건이다. 차량 회차에 섞이지 않으므로(계획 단계에서 분리) 0장의 ODsay 절차로 키 인증을 통과시킨 뒤 `--mode transit`으로 따로 돌린다.

### 재개 명령

```powershell
# G1(사용량)·G2(am/pm)를 통과한 뒤에만 실행한다
npm run access-times -- --bands "weekday_am,weekday_day,weekday_pm,weekend" --limit 5000
```

- 5,000건이 끝나면 **같은 명령을 한 번 더** 돌린다. 남은 3,920건이 잡히고 `계산할 것이 없어요.`(exit 0)로 끝난다.
- 이어받기는 `--refresh-days`(기본 30일)로 동작하므로 방금 저장한 행은 자동으로 건너뛴다.
- 회차마다 `npm run doctor`를 돌려 위 표의 `저장된 시각대 행`·`남은 조합`을 갱신한다. 남은 양은 **`14,176 − (doctor의 「시각대 지정」 건수)`**로 계산하면 된다.

### 이 실행에서 실제로 나온 오류 두 개 (기록)

| 문구 | 판단 |
|---|---|
| `Error: JWT issued at future` — `lib/server/paginate.ts:17`, 실행 직후 조회 단계 | 실행 기계의 시계가 Supabase 서버보다 앞설 때 난다. **같은 명령을 곧바로 다시 돌리면 통과했다.** 계획·조회 단계라 저장 전에 죽으므로 데이터 손상은 없고, 그 회차는 아무것도 못 채운다. 재발하면 Windows 시계 동기화(`w32tm /resync`, 관리자 권한)를 확인한다 |
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` — 결과 출력 뒤 | Node 25(비LTS) Windows의 종료 경로 문제로 보인다. **결과·저장에는 영향이 없다**(요약 줄이 다 찍힌 뒤에 난다). CI는 Node 24(LTS)이므로 로컬도 24로 맞추는 편이 낫다 |

### 저장되지 않는 조합 — 알고 있어야 할 동작

- **`경로 없음`(nodata)으로 끝난 조합은 DB에 저장되지 않아 매 회차 다시 호출된다.** 길이 없는 조합 하나가 회차마다 한도 1건을 계속 먹는다는 뜻이다.
  2026-09-27 실행은 `경로 없음 0`이라 영향이 없었지만, 이 값이 커지면 제외 목록이 필요하다(그때 별도 작업).
- `사용 중지: …(사유)`가 찍히면 **그 실행에서 그 제공자가 빠진 것**이다. 남은 조합은 계산되지 않았으니 원인을 고치고 다시 돌린다.
- `최근 실측 N개 건너뜀`의 N은 **이번에 계획한 시각대의** 최근 저장분만 센다(`planAccessTimes`가 `bands` 안에서만 `fresh`를 센다).
  `any` 행 3,544건은 여기에 잡히지 않으므로, 이 숫자로 전체 진행률을 판단하지 말고 4장의 시각대 분포 줄을 본다.

---

## 0. 전제 확인

- [ ] **마이그레이션이 적용됐는가** — Supabase SQL 편집기에서:
      ```sql
      select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'access_times' and column_name = 'depart_band';
      select conname, pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.access_times'::regclass and contype = 'u';
      ```
      첫 질의가 한 행(`text`)을 돌려주고, 둘째에 `(region_id, airport, mode, depart_band)` 유니크가 보여야 한다.
      아직이면 `supabase/migrations/20260925180000_access_time_bands.sql`을 먼저 실행한다.
      **적용 전에 배치를 돌리면 `depart_band` 컬럼을 못 찾아 조회 단계에서 죽는다**(0-3 참고).
- [ ] **키가 있는가** — `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KAKAO_REST_KEY`.
      시각대 배치는 **출발 시각을 실제로 반영하는 제공자만** 쓴다(`supportsDepartureTime`). 지금 그 조건을 만족하는 건
      카카오모빌리티 미래 운행 정보 길찾기 하나뿐이라 **`KAKAO_REST_KEY`가 없으면 시각대는 못 채운다.**
- [ ] **대중교통을 쓸 거면 ODsay 애플리케이션 등록** — `서버` 플랫폼으로 등록하고, **`npm run access-times`를
      실행하는 기계의 공인 IP**를 넣는다(웹 키는 도메인으로 식별하니 이 용도에 맞지 않는다).
      서버 키는 IP로 사용자를 식별하므로 **IP가 바뀌면 인증이 실패한다**. `URI/IP`는 5개까지 등록되고
      반영에 최대 1분 걸린다. 공인 IP는 실행하는 기계에서 확인한다(사설 IP가 아니다):
      ```powershell
      (Invoke-RestMethod -Uri "https://api.ipify.org")   # PowerShell에서는 curl이 Invoke-WebRequest 별칭이라 -s가 안 먹는다
      ```
      근거: [애플리케이션 등록 가이드](https://lab.odsay.com/guide/guide), [개발자포럼(고정 IP 요구)](https://lab.odsay.com/community/boardView?seq=609)
- [ ] **`--bands` 값은 반드시 따옴표로 묶는다 (PowerShell)** — 쉼표를 그대로 쓰면 PowerShell이 배열로 쪼개
      `--bands weekday_am weekday_day …`가 되고, 스크립트는 첫 값만 읽어 **조용히 한 시각대만 계산한다.**
      ```powershell
      npm run access-times -- --bands "weekday_am,weekday_day,weekday_pm,weekend"
      ```
      값 없는 `--bands`는 기본값 `any`가 된다(2장의 위험한 실수).
- [ ] **가짜 실행으로 확인** — 아래를 먼저 돌린다. DB에 아무것도 쓰지 않는다.
      ```bash
      npm run access-times -- --bands weekday_am --region 1 --limit 3 --dry
      ```
      기대 출력에 `시각대: 평일 아침 (08:00) → …Z`, `[dry] …→…공항 …분 (카카오모빌리티 미래 길찾기)`가 있어야 한다.
      `--dry`는 DB에 쓰지 않지만 **제공자 호출은 실제로 나간다** — 대중교통 조합이 계획에 들어 있으면 ODsay 한도를 쓴다.

## 1. 배치 전 상태 기록

- [ ] 지금 분포를 남긴다(나중에 비교):
      ```sql
      select depart_band, count(*) from public.access_times group by 1 order by 1;
      ```
- [ ] `npm run doctor`를 돌려 `access-bands` 줄이 `[주의]`인지 본다. 배치 전에는
      `실측 3544건 중 시각대 지정 0건`으로 나오는 게 정상이다.

## 2. 배치 실행

- [ ] **시각대는 `--bands`로 명시한다.** 인자를 빼면 기본값이 `any`라서, **`any` 행을 다시 계산해 퇴근길 정체를 새로 덮어쓴다.**
      이게 이 작업에서 가장 위험한 실수다.
      ```bash
      npm run access-times -- --bands weekday_am,weekday_day,weekday_pm,weekend
      ```
- [ ] **`--limit` 기본값은 4000이다.** 전국에 시각대 4개를 채우면 조합이 1만 개를 넘으므로 한 번에 끝나지 않는다.
      **`계산할 것이 없어요.`가 나올 때까지 같은 명령을 반복**한다. 이미 저장된 행은 시각대 단위로
      `refresh-days`(기본 30일) 안이면 자동으로 건너뛰므로 이어서 진행된다.
      ```bash
      while :; do npm run access-times -- --bands weekday_am,weekday_day,weekday_pm,weekend --limit 4000; \
        echo "--- 다음 회차 ---"; done   # '계산할 것이 없어요.' 가 보이면 중단
      ```
- [ ] 대중교통 시각대는 지금 **계산할 수 없다**. `ODSAY_KEY`가 있어도 대중교통 쪽에 출발 시각을 반영하는
      제공자가 없어서 `--mode transit --bands …`는 `계산할 수단이 없어요.`로 끝난다(exit 2). 차량만 돌린다.
- [ ] 진행 상황은 100건마다 `… 400/4000 (12.3분) 저장 380 · 경로 없음 0 · 오류 20` 형태로 찍힌다.
      회차당 걸리는 시간은 제공자 응답 속도에 달려 있으니 이 줄로 가늠한다.

## 3. 출력 읽기

- [ ] 마지막 네 줄이 요약이다. 이 순서로 본다.
      ```
      결과: 계산 384 · 경로 없음 0 · 오류 0
      시각대별 저장: weekday_am 96 · weekday_day 96 · weekday_pm 96 · weekend 96
      car|dep 제공자별 성공: 카카오모빌리티 길찾기 384
        다음: npm run doctor 로 …
      ```
- [ ] **`시각대별 저장`에 네 시각대가 모두 있는가.** 한 시각대만 찍히면 `--bands`를 빠뜨린 것이거나 그 시각대만 남은 상태다.
- [ ] **`경로 없음`이 많으면** 그 조합은 실패가 아니라 "길이 없다"로 기록된 것이다(권역 규칙·주소 못 찾음).
      오류로 세지 않으므로 회차를 반복해도 채워지지 않는다.
- [ ] **`오류`가 많거나 `연속 N번 실패해 멈춥니다`가 찍혔으면** 6장의 표로 간다.
- [ ] `사용 중지: 카카오모빌리티 길찾기(…)`가 찍혔으면 **그 실행 동안 제공자가 빠진 것**이다(한도·키 문제).
      이후 조합은 계산되지 않았으니 원인을 고치고 다시 돌린다.

## 4. doctor 게이트 확인 (핵심)

- [ ] ```bash
      npm run doctor
      ```
- [ ] 이 줄이 **`[통과]`**로 바뀌었는가:
      ```
      [통과] access-bands — 이동 시간 시각대 — 실측 1420건 중 시각대 지정 1420건
              시각대 지정 1420건 · 나머지 706건은 정확히 맞는 시각대가 없을 때만 쓰는 fallback이에요.
      ```
      조건은 "실측 중 시각대가 `any`가 아닌 행이 1건 이상"이다(`lib/server/data-health.ts`).
      `[주의]`로 남아 있으면 아직 값을 못 채운 것이다.
- [ ] 시각대 분포 줄도 함께 본다:
      ```
      이동 시간 시각대: any 2022 · weekday_am 384 · weekday_day 384 · weekday_pm 384 · weekend 384
      ```
- [ ] **종료 코드는 `access-bands`로 바뀌지 않는다.** 이 게이트는 `critical: false`라 실패해도 0을 돌려준다
      (서비스는 계속 돌아가고 화면이 물러선 사실을 표시하므로). 종료 코드만 보고 판단하지 말고 이 줄을 직접 본다.
- [ ] `access-times` 게이트는 `critical: true`다. 그게 실패하면 배치가 아니라 데이터 자체가 없는 상태다.

## 5. 값이 진짜인지 확인 (이게 없으면 컬럼이 거짓말을 할 수 있다)

> **2026-09-27 현재 이 게이트는 아직 통과하지 않았다.** 남은 8,920건을 돌리기 전에 먼저 통과시킨다(맨 위 「지금 어디까지 됐나」의 G2).
> 비교 대상은 지금 저장된 **1,314조합**이다 — `total`이 1,314로 나오는 게 정상이고, `same = total`이면 5,256건이 전부 버려진 값이다.

시각대 값이 `any`와 **똑같기만 하다면** 카카오가 `departure_time`을 반영하지 않은 것이다.
그러면 컬럼은 "평일 아침"이라고 적혀 있지만 실제로는 아무 시각의 값이나 담고 있다.

- [ ] 분포가 갈리는지 본다 — 아침이 저녁보다 짧은 조합이 다수여야 정상(짧은 구간은 분 단위 반올림 때문에 같을 수 있다):
      ```sql
      select count(*) filter (where pm > am) as pm_longer,
             count(*) filter (where pm = am) as same,
             count(*) as total
      from (
        select a.minutes as am, p.minutes as pm
        from public.access_times a
        join public.access_times p
          on p.region_id = a.region_id and p.airport = a.airport and p.mode = a.mode
        where a.mode = 'car' and a.depart_band = 'weekday_am' and p.depart_band = 'weekday_pm'
      ) t;
      ```
      **`same = total`이면 멈추고 원인을 찾는다** — 출발 시각이 무시되고 있다는 뜻이다.
- [ ] 상위 몇 건을 눈으로 본다(먼 거리일수록 차이가 크게 나야 한다):
      ```sql
      select a.region_id, a.airport, a.minutes as am, p.minutes as pm, (p.minutes - a.minutes) as diff
      from public.access_times a
      join public.access_times p
        on p.region_id = a.region_id and p.airport = a.airport and p.mode = a.mode
      where a.mode = 'car' and a.depart_band = 'weekday_am' and p.depart_band = 'weekday_pm'
      order by diff desc nulls last limit 10;
      ```
- [ ] 앱에서 확인: 평일 아침 출발로 추천을 받아 결과 카드 타일 출처에 **`카카오모빌리티 길찾기 · 평일 아침 (08:00)`**이 뜨고,
      아래 경고문("… 기준 이동 시간이 아직 없어서 …")이 **사라졌는지** 본다.

## 6. 실패했을 때

| 증상 (정확한 문구) | 원인 | 조치 |
|---|---|---|
| `환경변수 KAKAO_REST_KEY가 없어요.` (exit 2) | 시각대 배치에 필요한 키 없음 | 카카오 개발자 콘솔에서 REST 키 발급. 없으면 시각대는 못 채운다 |
| 시작하자마자 `depart_band` 관련 예외/`저장 실패 …column…does not exist` | 마이그레이션 미적용 | 0장의 마이그레이션을 먼저 실행 |
| `모르는 시각대: weekday_morn` (exit 2) | 이름 오타 | 가능한 값: `any, weekday_am, weekday_day, weekday_pm, weekend` |
| `계산할 수단이 없어요.` (exit 2) | 차량 소스도 없고 대중교통도 없음 | `OSRM_URL=off`로 꺼 두지 않았는지 확인. 대중교통은 `ODSAY_KEY` 필요 |
| `ODsay 오류(500): [ApiKeyAuthFailed] ApiKey authentication failed.` | 서버 키 인증 실패 — **등록한 IP와 호출 IP가 다르거나 키 플랫폼이 서버가 아님** | 0장의 공인 IP 확인 절차로 IP를 다시 등록(설정 반영 최대 1분). 이 오류가 나면 그 실행에서 ODsay는 빠진다 |
| `ODsay 응답에 result가 없어요.` | 오류 본문을 못 읽은 경우(형식 변경) | `ODsay 오류(…)` 형태가 아니면 응답 본문을 확인해 `lib/data/access-time.ts`의 `odsayError`를 맞춘다 |
| `시각대 weekday_am의 출발 시각을 계산할 수 없어요.` (exit 2) | 출발 시각 산출 실패(시계·요일 처리 이상) | 서버 시각을 확인하고 다시 실행. 재현되면 `lib/data/access-bands.ts`를 본다 |
| `airports 조회 실패: …` (exit 2) | DB 접속·권한 | `SUPABASE_SERVICE_ROLE_KEY`가 secret 키인지 확인 |
| `좌표가 있는 지역이 없어요. 먼저 npm run geocode-regions 를 돌리세요.` (exit 1) | `regions.lat/lng`가 비었음 | 지오코딩 배치를 먼저 돌린다 |
| `제공자를 모두 쓸 수 없어 멈춥니다: …` | 카카오 한도(429)·키 거부(401/403) | 카카오 콘솔에서 한도·키 상태 확인. 그 실행은 중단됐고, 남은 조합은 다음 실행에서 이어진다 |
| `연속 N번 실패해 멈춥니다` | 제공자 장애·네트워크 | 잠시 뒤 다시 실행. `--max-fail`·`--concurrency`로 민감도를 조절할 수 있다 |
| `계산할 것이 없어요.` (exit 0) | 남은 조합 없음 | 정상 완료. 4·5장으로 간다 |

## 7. 주기

- [ ] 시각대 값은 **대표 출발 시각 하나**(평일 08:00 / 13:00 / 18:00, 주말 13:00)로 계산한 근사다. 실제 분포가 아니다.
      화면이 어느 가정을 썼는지 함께 표시하는 이유다.
- [ ] `--refresh-days`(기본 30일)가 지나면 다음 배치가 그 행을 다시 계산한다. 월 1회 정도 돌리면 된다.
- [ ] 공항·지역이 늘거나 좌표가 바뀌면 그 조합은 다음 배치에서 새로 계산된다(계획이 매번 전체를 훑는다).

## 8. 이 문서의 검증 범위

**확인한 것** (코드에서):
- 인자·기본값(`--bands`/`--limit` 4000/`--refresh-days` 30/`--max-fail` 5/`--concurrency` 4/`--dry`/`--mode`/`--region`),
  종료 코드(2=환경·인자·계획 문제, 1=좌표 없음, 0=끝), 이어받기 키(`region_id|airport|mode|depart_band` + `refresh-days`),
  중단 조건(`exhausted`, `maxFail × concurrency` 연속 실패), 출력 문구, 저장 방식(`onConflict: region_id,airport,mode,depart_band`).
- `doctor`의 `access-bands` 판정식과 `critical: false`(통과/주의 문구는 합성 입력으로 실제 렌더해 확인했다).

**2026-09-27에 실제로 확인된 것** (사용자 PC에서 실행):
- 시각대 배치가 `카카오모빌리티 미래 길찾기`로 **실제 값을 저장했다** — 시각대 4개 × 1,314조합 = 5,256건.
- 5,000건 회차에 **27.7분**(100건당 약 33초)이 걸렸고, 하루 한도 안에서 네 시각대가 모두 채워졌다(한도 초과로 중단된 적 없음).
- 중단된 회차가 있어도 **이어받기가 동작한다** — 다음 회차가 앞서 저장한 256건을 `최근 실측 256개 건너뜀`으로 건너뛰었다.
- `경로 없음 0 · 오류 0` — 제공자 오류 없이 전량 저장됐다.
- 실행 시작 직후 `JWT issued at future` 1회(같은 명령 재실행에서 통과), 결과 출력 뒤 libuv assertion 1회(결과·저장에 영향 없음).
- 2026-09-26 Windows에서 `--bands weekday_am --region 1 --limit 3 --dry`가 `카카오모빌리티 미래 길찾기`로
  3건을 계산하는 것은 확인됐다. 출발 시각으로 2026-09-28(월) 08:00 KST를 골랐다 — 주말을 건너뛰는 것이 맞다.

**아직 확인하지 못한 것**:
- **카카오가 `departure_time`을 실제로 반영하는지 — 5장 게이트 미통과.** 배치를 더 돌리기 전에 5장을 돌린다.
- 남은 무료 한도(콘솔 사용량 화면)와 한도 리셋 시각 — 다음 회차 실행 전에 확인해야 한다(G1).
- 대중교통은 한 건도 받지 못했다(`ApiKeyAuthFailed` — 서버 키 IP 미등록으로 보임).
- 배치를 끝까지 돌린 결과(남은 8,920건의 실제 회차 수). 2026-09-27 기준 8,920건이 남아 있다.
