# 브라우저 E2E — 테스트 전용 Supabase 프로젝트

2026-09-27 작성. `scripts/e2e.mjs`(검사), `scripts/e2e-reset.mts`(준비), `.github/workflows/e2e.yml`·`e2e-data.yml`(자동 실행).

## 왜 별도 프로젝트인가

E2E는 계정을 지우고 다시 만들고, 수업·일정을 넣는다. 운영 프로젝트에서 돌리면 **실제 사용자 데이터에 같은 일이 일어난다.**
그래서 검사는 `e2e_marker` 표식이 있는 프로젝트에서만 돈다. 표식이 없으면(조회 오류 포함) 첫 단계에서 멈춘다 —
URL·키·ref가 전부 틀려도 운영 DB에는 표식이 없으므로 운영 데이터를 건드리지 않는다.

표식 테이블은 마이그레이션에 없다 — 운영 프로젝트에 생기면 보호가 무력해지기 때문이다.
**테스트 프로젝트에서만** `supabase/e2e-marker.sql` 을 SQL Editor로 1회 실행한다.

```sql
-- supabase/e2e-marker.sql 과 같은 내용
create table if not exists public.e2e_marker (id int primary key, note text not null);
insert into public.e2e_marker (id, note) values (1, 'e2e-test-project')
  on conflict (id) do update set note = excluded.note;
alter table public.e2e_marker enable row level security;  -- 정책 없음 = 서비스 롤만 읽는다
```

이 표는 **테스트에만** 있다. 운영에 넣으려는 마이그레이션이 아니다(`docs/SCHEMA_AUDIT.md`의 "예상된 차이").
스키마 비교를 할 때는 **비교가 끝난 뒤에** 만든다 — 먼저 만들면 "test에만 있는 테이블"로 차이에 잡힌다.

## 필요한 Secrets

운영 값과 섞이지 않게 `E2E_` 접두사를 쓴다. **`DATA_GO_KR_KEY`는 `e2e.yml`에 넣지 않는다** —
공공데이터포털 쿼터는 운영 야간 동기화·앱 런타임과 공유하므로, 검사 잡이 그 키를 들고 있으면
같은 저장소 브랜치의 PR에서 그대로 새어 나갈 수 있다.

| Secret | 쓰는 곳 |
|---|---|
| `E2E_SUPABASE_URL` / `E2E_SUPABASE_PUBLISHABLE_KEY` / `E2E_SUPABASE_SERVICE_ROLE_KEY` | `e2e.yml` |
| `E2E_PROJECT_REF` | 보조 확인(URL이 테스트 프로젝트를 가리키는지) |
| `DEV_TEST_EMAIL` / `DEV_TEST_PASSWORD` | 계정 초기화·로그인 |
| `DATA_GO_KR_KEY` | **`e2e-data.yml`에만** (주 1회 sync) |

```powershell
gh secret set E2E_SUPABASE_URL                 # 값은 프롬프트에서 입력 (명령줄에 남기지 않는다)
gh secret set E2E_SUPABASE_PUBLISHABLE_KEY
gh secret set E2E_SUPABASE_SERVICE_ROLE_KEY
gh secret set E2E_PROJECT_REF
gh secret set DEV_TEST_EMAIL
gh secret set DEV_TEST_PASSWORD
```

## 흐름

```
e2e:reset   표식 확인 → 계정 삭제·재생성(seed-dev.sql과 같은 상태) → 검사 날짜를 .e2e-date에 기록
build       NEXT_PUBLIC_* 를 인라인한다 — 빌드 전에 env가 있어야 한다
start       서버 기동 → 3000 포트 대기 (60초)
e2e         로그인 → 가입 6단계 → 대화 → 추천 → /me
```

- **검사 날짜**: 오늘+2일(KST) 이후 첫 **금요일**을 운항 스케줄이 덮는 범위 안에서 고른다.
  금요일인 이유는 검사 흐름이 금요일 수업(금 10:30–11:45)과 그날 일정(13:00–14:30)을 넣고 추천을 받기 때문이다.
  범위 안에 없으면 이유를 남기고 실패한다 — 임의의 날짜로 넘어가지 않는다.
- **`.e2e-date`**는 기계마다 다르므로 커밋하지 않는다(`.gitignore`).
- 로컬 실행: `npm run dev` 대신 `npm run build && npm run start`를 쓴다(빌드 시점 인라인 때문).

## 검사에 필요한 데이터

| 무엇 | 어떻게 | 없으면 |
|---|---|---|
| 운항 스케줄 | `e2e-data.yml`의 `sync -- kac-full`·`tago-horizon` | 추천 카드가 0건 |
| 거주지 → 공항 접근 시간 | `e2e-data.yml`의 `e2e:seed` (고정값 `source = E2E 고정값`) | `regionMissing` → "걸리는 시간이 아직 DB에 없어 계산할 수 없어요" |
| 계정·방문 기록 | `e2e-reset.mts` | '지난 제주 방문 3회' 단언 실패 |
| 지역 좌표 | 필요 없음 (고정값을 직접 넣으므로 좌표를 안 쓴다) | `doctor`의 `regions-coords`가 주의로 뜰 뿐이다 |

접근 시간을 카카오 배치로 채우지 않는 이유: 키를 CI에 두면 쿼터가 운영 동기화·앱 런타임과 섞이고,
검사는 "추천이 뜨는가"를 보는 것이지 "카카오 값이 맞는가"를 보는 것이 아니다.
값은 `source = E2E 고정값`으로 **투명하게 표시**한다(`is_sample`은 켜지 않는다 — 화면에 샘플 배지가 붙으면 E2E의 "샘플 아님" 단언과 어긋난다).

## 시크릿이 없을 때 (테스트 프로젝트를 만들기 전)

`E2E_SUPABASE_URL`·`E2E_SUPABASE_SERVICE_ROLE_KEY`·`DEV_TEST_PASSWORD` 중 하나라도 비어 있으면
`gate` 잡이 `ready=false`를 내고 실제 잡은 **건너뛴다**. 테스트 프로젝트를 만들기 전 구간에서
PR마다 빨간 X가 쌓이지 않게 하려는 것이다. 건너뛸 때는 `::warning::` 주석을 남기므로 Checks 화면에서 보인다.

**한계를 알고 쓸 것**: 이 게이트는 "시크릿이 없다"와 "시크릿이 잘못됐다"를 구분하지 않는다.
누군가 시크릿을 지우면 검사가 조용히 건너뛰어진다. 그래서 경고 문구를 notice가 아니라 warning으로 두었고,
시크릿이 준비되면 이 게이트는 항상 `ready=true`가 되어 아무 일도 하지 않는다.
게이트를 없애고 실패를 그대로 보이게 하려면 `gate` 잡과 `needs:`·`if:` 두 줄을 지우면 된다 —
그러면 시크릿이 없을 때 `e2e:reset`의 표식 확인 단계에서 멈춘다(운영 데이터는 건드리지 않는다).

## 동시 실행

테스트 프로젝트는 **하나뿐인 공유 자원**이다. `e2e.yml`(PR)과 `e2e-data.yml`(주 1회 sync)이
같은 `concurrency: e2e-db` 그룹을 쓰고 `cancel-in-progress: false`라, 서로 취소하지 않고 기다린다.

한계: 같은 그룹에서 **대기(pending)는 1개만 유지된다.** PR이 여러 개 동시에 오면 밀린 실행이
취소될 수 있다. 필수 검사가 아니므로(보호 규칙은 `ci.yml`의 `check` 하나) 머지를 막지는 않는다.

## 실패했을 때

`if: failure()`로 **스크린샷과 `server.log`를 함께** 올린다. 스크린샷만으로는 500의 원인을 못 본다.

| 증상 | 원인 |
|---|---|
| `중단: …에 e2e_marker 표식 테이블이 없어요` | 표식 만들기를 아직 안 했다(또는 URL이 다른 프로젝트다). 테스트 프로젝트 SQL Editor에서 `supabase/e2e-marker.sql` 실행 |
| `중단: e2e_marker의 note가 …가 아니에요` | 표식 행의 값이 다르다. 운영 DB에서는 정상 동작이다(보호가 작동한 것) |
| `중단: 스키마가 아직 없어요: …` | 테스트 프로젝트에 마이그레이션이 적용되지 않았다. `supabase db push` 또는 SQL Editor |
| `환경변수 …가 없어요` (exit 2) | Secrets 누락 |
| `표식 확인됨` 뒤 `실제 운항 스케줄이 없어요` | `e2e-data.yml`을 한 번 돌려 데이터를 채운다 |
| 서버가 안 뜸 | `server.log` 아티팩트를 본다. 대개 env 누락(`NEXT_PUBLIC_*`를 빌드 전에 못 넣은 경우) |
| 로그인 실패 | `DEV_TEST_PASSWORD`와 계정 상태. `e2e:reset`이 계정을 새로 만들므로 비밀번호는 Secret 값 그대로여야 한다 |

## 프로젝트 준비

프로젝트 생성·마이그레이션·표식·Secrets·운영 정리 절차는 **`docs/E2E_SETUP.md`** 에 있다.

## 관련 결정

- 채널을 지정하지 않으면 playwright가 받은 **번들 Chromium**을 쓴다. 러너에 msedge는 없다.
  로컬에서 설치된 브라우저를 쓰려면 `E2E_CHANNEL=msedge`.
- 브라우저 설치는 `npx playwright install --with-deps chromium`(러너 시스템 의존성 포함).
- 파일은 **브라우저에서만** 읽는다. E2E도 서버로 파일을 보내지 않는다.
