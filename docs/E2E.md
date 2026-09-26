# 브라우저 E2E — 테스트 전용 Supabase 프로젝트

2026-09-27 작성. `scripts/e2e.mjs`(검사), `scripts/e2e-reset.mts`(준비), `.github/workflows/e2e.yml`·`e2e-data.yml`(자동 실행).

## 왜 별도 프로젝트인가

E2E는 계정을 지우고 다시 만들고, 수업·일정을 넣는다. 운영 프로젝트에서 돌리면 **실제 사용자 데이터에 같은 일이 일어난다.**
그래서 검사는 `e2e_marker` 표식이 있는 프로젝트에서만 돈다. 표식이 없으면(조회 오류 포함) 첫 단계에서 멈춘다 —
URL·키·ref가 전부 틀려도 운영 DB에는 표식이 없으므로 운영 데이터를 건드리지 않는다.

```sql
create table public.e2e_marker (id int primary key, note text);
insert into public.e2e_marker values (1, 'e2e-test-project');
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

## 동시 실행

테스트 프로젝트는 **하나뿐인 공유 자원**이다. `e2e.yml`(PR)과 `e2e-data.yml`(주 1회 sync)이
같은 `concurrency: e2e-db` 그룹을 쓰고 `cancel-in-progress: false`라, 서로 취소하지 않고 기다린다.

한계: 같은 그룹에서 **대기(pending)는 1개만 유지된다.** PR이 여러 개 동시에 오면 밀린 실행이
취소될 수 있다. 필수 검사가 아니므로(보호 규칙은 `ci.yml`의 `check` 하나) 머지를 막지는 않는다.

## 실패했을 때

`if: failure()`로 **스크린샷과 `server.log`를 함께** 올린다. 스크린샷만으로는 500의 원인을 못 본다.

| 증상 | 원인 |
|---|---|
| `중단: e2e_marker…` | 테스트 프로젝트가 아니거나 표식이 지워졌다. 운영 DB에서는 정상 동작이다 |
| `환경변수 …가 없어요` (exit 2) | Secrets 누락 |
| `표식 확인됨` 뒤 `실제 운항 스케줄이 없어요` | `e2e-data.yml`을 한 번 돌려 데이터를 채운다 |
| 서버가 안 뜸 | `server.log` 아티팩트를 본다. 대개 env 누락(`NEXT_PUBLIC_*`를 빌드 전에 못 넣은 경우) |
| 로그인 실패 | `DEV_TEST_PASSWORD`와 계정 상태. `e2e:reset`이 계정을 새로 만들므로 비밀번호는 Secret 값 그대로여야 한다 |

## 관련 결정

- 채널을 지정하지 않으면 playwright가 받은 **번들 Chromium**을 쓴다. 러너에 msedge는 없다.
  로컬에서 설치된 브라우저를 쓰려면 `E2E_CHANNEL=msedge`.
- 브라우저 설치는 `npx playwright install --with-deps chromium`(러너 시스템 의존성 포함).
- 파일은 **브라우저에서만** 읽는다. E2E도 서버로 파일을 보내지 않는다.
