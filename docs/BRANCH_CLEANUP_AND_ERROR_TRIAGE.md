# 브랜치 정리·업데이트·오류 분리 대응 가이드

2026-09-27 작성. 이 레포에서 실제로 겪은 충돌, 오래된 PR, 테스트 프로젝트/운영 프로젝트 혼동,
GitHub Actions 네트워크 실패를 기준으로 정리했다. **Windows PowerShell 기준**이며, 명령은
레포 루트(`Airports_near_me`)에서 실행한다.

이 문서의 목적은 세 가지다.

1. 브랜치를 **안전하게 정리**하는 절차를 남긴다.
2. 무엇을 **먼저 해결해야 하는지 우선순위**를 고정한다.
3. 겉으로는 같은 "빨간불"처럼 보여도, 실제 원인이 다른 **불필요한 오류/후행 증상**을 구분하는 법을 남긴다.

---

## 0. 먼저 결론 — 우선순위 규칙

문제가 여러 개처럼 보여도, 아래 순서를 어기면 시간을 버린다.

### 0-1. 항상 먼저 보는 것

1. **지금 보고 있는 것이 어느 브랜치/PR/커밋의 결과인가**
2. **실패가 첫 원인인지, 앞 단계 실패의 후행 증상인지**
3. **운영 프로젝트/테스트 프로젝트를 헷갈릴 여지가 없는지**
4. **네트워크/환경 문제인지, 코드 문제인지**

### 0-2. 이 레포의 실제 우선순위

| 우선순위 | 먼저 해결할 것 | 이유 |
|---|---|---|
| 1 | **운영 DB 보호** (`PROD_SUPABASE_URL`, `e2e_marker`) | 잘못 건드리면 되돌리기 어렵다 |
| 2 | **브랜치/PR 기준선 정리** (`origin/main`, 오래된 PR, 충돌 브랜치) | 기준선이 틀리면 같은 오류를 계속 본다 |
| 3 | **빌드/타입 오류** (`npm run build`) | merge 전 필수 검사를 막는다 |
| 4 | **데이터 채우기 워크플로** (`e2e-data.yml`) | E2E 준비용이지만, 원인이 환경일 수 있다 |
| 5 | **doctor의 0건 경고** | 앞 단계가 실패하면 거의 항상 후행 증상이다 |

**중요**: `doctor`의 `schedules-real 0건`, `access-times 0건`은 자주 **원인처럼 보이는 결과**다.
`sync`가 스킵되었거나 `e2e:check`가 먼저 실패했으면 당연히 0건이다. 숫자만 보고 키 문제라고 단정하면 틀린다.

---

## 1. 브랜치 정리의 목적

브랜치를 지우는 이유는 "예뻐 보이기"가 아니다. 다음 세 가지를 막기 위해서다.

1. **오래된 브랜치에서 stale한 파일을 다시 끌어오는 것**
2. **이미 머지된 작업을 다시 cherry-pick 하며 충돌을 만드는 것**
3. `main`이 원격과 갈라진 채 남아, 나중에 `pull`/`merge`/`reset` 때 엉뚱한 커밋을 보게 되는 것

이 레포에서 실제로 일어난 일:

- `feat/e2e-ci`가 오래된 PR 기준선(`eec387a` 계열) 위에 남아 있었다.
- 새 브랜치를 만들고 cherry-pick 하면서 충돌을 피해 갔지만, `main`을 stale한 `origin/main`으로 한 번 잘못 맞췄다.
- 그 결과, PR은 머지됐는데 로컬 `main`은 여전히 `65ad256`에 머물렀다.

이 문서는 그 과정을 다시 밟지 않게 하기 위한 체크리스트다.

---

## 2. 브랜치 정리 — 가장 안전한 절차

### 2-1. main을 건드리기 전: 먼저 fetch

```powershell
git fetch origin --prune
```

- `--prune`를 붙이면 이미 삭제된 원격 브랜치 흔적도 함께 정리된다.
- **`reset --hard origin/main`보다 fetch가 먼저**다. fetch 없이 reset하면 stale한 `origin/main`으로 되돌릴 수 있다.

### 2-2. main 상태 확인

```powershell
git switch main
git status
git log --oneline --left-right main...origin/main
```

#### 해석

- `<` 로 시작하는 줄: **로컬 main에만 있는 커밋**
- `>` 로 시작하는 줄: **원격 main에만 있는 커밋**

예:

```text
< abc1234 로컬에만 남은 커밋
> def5678 origin/main에 새로 들어온 머지 커밋
```

이렇게 나오면, `pull` 전에 **무엇이 로컬에만 남아 있는지 먼저 확인**해야 한다.

### 2-3. 로컬 main의 단독 커밋이 필요 없는 경우

가장 흔한 케이스다. PR이 이미 머지됐고, 로컬 `main`에만 찌꺼기 커밋 1개가 남아 있다.

#### 안전한 절차

```powershell
git branch backup/main-before-reset
git reset --hard origin/main
```

- 백업 브랜치를 먼저 따면, 혹시 놓친 게 있어도 다시 돌아갈 수 있다.
- `git pull`보다 `reset --hard origin/main`이 나은 이유: 의도치 않은 merge commit을 만들지 않는다.

### 2-4. main이 정상화됐는지 확인

```powershell
git log --oneline -1
git status
```

정상 예시:

```text
59ddc0c (HEAD -> main, origin/main, origin/HEAD) Feat/e2e clean (#5)
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

---

## 3. 작업 브랜치 정리

### 3-1. 이미 머지된 로컬 브랜치 삭제

```powershell
git branch -d feat/e2e-clean
```

- `-d`는 **정상 삭제**다. 머지되지 않았으면 거부한다.
- 거부되면 정말 필요한 브랜치인지 다시 본다.

### 3-2. 이미 쓸모없는 충돌 브랜치 삭제

```powershell
git branch -D feat/e2e-ci
```

- `-D`는 강제 삭제다.
- 오래된 PR의 충돌 기준선을 계속 들고 있는 브랜치는 보통 유지 가치가 없다.

### 3-3. 원격 브랜치 삭제

```powershell
git push origin --delete feat/e2e-ci
```

#### `remote ref does not exist`가 뜨면?

```text
error: unable to delete 'feat/e2e-clean': remote ref does not exist
```

이건 대개 **PR 머지 후 GitHub가 원격 브랜치를 자동 삭제한 상태**다. 실패가 아니라 정상에 가깝다.

다시 확인:

```powershell
git fetch origin --prune
git branch -r
```

원격 브랜치가 목록에 없으면 더 할 일 없다.

---

## 4. 새 PR을 만드는 기준 — 기존 PR을 살리지 않는 이유

이 레포에서는 다음 조건 중 하나라도 있으면 **기존 PR을 버리고 새 브랜치/새 PR**이 낫다.

- 충돌 파일이 많다
- 기준선이 오래됐다 (`origin/main..브랜치` 로그가 길다)
- 불필요한 커밋 하나를 빼려다 히스토리 전체가 꼬인다
- 강제 푸시 없이 끝낼 수 없다

### 실제 권장 절차

```powershell
git fetch origin
git checkout -b feat/e2e-clean origin/main
```

그 뒤 필요한 커밋만 `cherry-pick`한다.

```powershell
git cherry-pick <좋은커밋1> <좋은커밋2> <좋은커밋3>
```

**핵심 원칙**: 문제 커밋은 빼는 게 아니라, **좋은 커밋만 다시 쌓는다.**

---

## 5. cherry-pick 중 자주 나오는 상황과 처리

### 5-1. 첫 커밋이 empty인 경우

실제 문구:

```text
The previous cherry-pick is now empty, possibly due to conflict resolution.
```

뜻:
- 그 커밋의 내용이 이미 기준선에 있거나
- 충돌 정리 결과 남길 변화가 없었다

처리:

```powershell
git cherry-pick --skip
```

**`--continue`가 아니다.** 계속할 내용이 없으니 건너뛰는 게 맞다.

### 5-2. `git cherry-pick --continue`가 안 되는 경우

실제 문구:

```text
error: no cherry-pick or revert in progress
```

뜻:
- 이미 cherry-pick이 끝났거나
- `--skip`으로 다음 단계로 넘어간 뒤라서 더 이상 이어갈 세션이 없다

처리:
- 오류가 아니라 상태 안내에 가깝다.
- 그냥 `git status`, `git log --oneline -3`으로 현재 상태를 보고 다음 작업을 하면 된다.

### 5-3. cherry-pick 후 꼭 확인할 것

```powershell
git diff --name-status origin/main...HEAD
```

이 명령은 **지금 브랜치가 main 대비 실제로 바꾼 파일 목록**을 보여준다.

여기서 찾아야 할 것:

- 의도한 파일만 들어 있는가
- `prod.sql`, `test.sql` 같은 **설명되지 않은 파일**이 섞였는가
- `.patch` 파일, 임시 산출물, 실험 파일이 들어왔는가

### 5-4. 불필요 파일이 섞였을 때

예:

```text
A  prod.sql
A  test.sql
```

문제점:
- 사용자가 직접 요구하지 않았다
- E2E/로그인/브랜치 정리의 핵심과 관련이 없다
- 이름이 너무 일반적이라 역할을 알 수 없다

처리:

```powershell
git rm prod.sql test.sql
git commit -m "불필요한 SQL 파일을 제거한다"
```

**중요**: 이미 브랜치를 푸시한 뒤라도, 히스토리를 다시 고치기보다 **제거 커밋 하나를 더 올리는 쪽이 안전**하다.

---

## 6. 어떤 오류가 우선 원인이고, 어떤 것은 불필요한 후행 증상인가

이 레포에서 헷갈리기 쉬운 대표 사례를 적는다.

### 6-1. `doctor`의 0건 경고

예:

```text
❌ schedules-real — 실제 운항 스케줄 0건
❌ sync-recent — 성공한 동기화 기록이 없어요
❌ access-times — 접근 시간 0건
```

이게 **원인**인 경우는 드물다. 대개는 아래 같은 앞 단계 실패의 결과다.

- `e2e:check` 실패 → `sync` 스킵 → `doctor`가 빈 DB를 보고 0건이라고 말함
- `sync -- kac-full` 첫 호출 네트워크 타임아웃 → 저장 0 → `doctor`가 0건이라고 말함

#### 판정 규칙

먼저 로그에서 **가장 먼저 실패한 step**을 본다.

- `테스트 DB 표식 확인` 실패 → `doctor` 경고는 후행 증상
- `Run npm run sync -- kac-full` 실패 → `doctor` 경고는 후행 증상

즉 `doctor`는 상태 요약이지, 항상 1차 원인을 말하는 도구가 아니다.

### 6-2. `SUPABASE_SERVICE_ROLE_KEY`가 잘못된 것처럼 보이는 경고

`doctor`가 이런 문구를 낼 수 있다.

```text
SUPABASE_SERVICE_ROLE_KEY가 secret 키(sb_secret_… 또는 service_role JWT)인지 확인하세요.
```

하지만 실제 로그가 이거라면:

```text
ConnectTimeoutError: Connect Timeout Error (attempted address: apis.data.go.kr:443)
```

원인은 키가 아니라 **네트워크**다. 키 검증 전에 공공데이터포털 연결이 죽은 것이다.

**규칙**: 키 의심은 포털이 실제로 응답을 준 뒤(30/31/32, 인증 오류 본문)여야 한다. 연결 전 타임아웃이면 키 문제라고 단정하지 않는다.

### 6-3. Windows의 종료 assertion

실제 문구:

```text
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

이건 보통 **요약 줄이 다 찍힌 뒤** 나는 Node 25/Windows 종료 경로 문제다. 저장 결과와 분리해서 봐야 한다.

#### 판정 규칙

- 핵심 출력(예: `계정 생성`, `검사 날짜`, `성공 — 저장 612`)이 이미 찍혔는가?
- 그렇다면 본 작업은 끝났고, 종료 assertion은 부차적 문제일 수 있다.
- 단, CI는 Node 24이므로 로컬 재현 여부와 CI 결과를 분리해서 본다.

---

## 7. 테스트 프로젝트/운영 프로젝트 혼동을 막는 절차

이 레포에서 가장 비싼 실수는 **운영 DB를 테스트용으로 만지는 것**이다.

### 7-1. 로컬 `.env.local`에서 반드시 함께 둘 것

```env
NEXT_PUBLIC_SUPABASE_URL=https://<테스트프로젝트>.supabase.co
PROD_SUPABASE_URL=https://<운영프로젝트>.supabase.co
```

왜 필요한가:
- `NEXT_PUBLIC_SUPABASE_URL`만 있으면 `e2e-reset`은 표식 검사에만 의존한다.
- `PROD_SUPABASE_URL`까지 있으면, **운영 URL과 같을 때 표식 전에 먼저 중단**한다.

### 7-2. 표식 테이블이 없다고 바로 만들지 않는다

먼저 로그를 이렇게 읽는다.

```text
운영 프로젝트(zmyixzy...).와 다른 프로젝트입니다 — 진행합니다.
중단: 이 프로젝트(wxdjig...).에 e2e_marker 표식 테이블이 없어요.
```

이 경우에만 테스트 프로젝트 SQL Editor에서 `supabase/e2e-marker.sql`을 실행한다.

반대로 운영 URL 대조가 없거나, URL이 같다는 로그가 있으면 **표식을 만들지 않는다.**
표식을 운영 DB에 심으면 보호가 무력화된다.

---

## 8. 로컬에서 E2E용 테스트 DB를 채우는 최소 순서

GitHub hosted runner가 미국(`centralus`, `westus`)에서 `apis.data.go.kr` 연결 타임아웃을 반복한 적이 있다.
그 경우 `e2e-data.yml`은 코드 문제가 아니라 **실행 위치** 문제일 수 있다. 한국 네트워크/로컬에서 먼저 채우는 편이 빠르다.

### 최소 환경변수

```env
NEXT_PUBLIC_SUPABASE_URL=https://<테스트프로젝트>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<테스트프로젝트 service_role 또는 sb_secret>
DATA_GO_KR_KEY=<공공데이터포털 키>
PROD_SUPABASE_URL=https://<운영프로젝트>.supabase.co
DEV_TEST_EMAIL=dev@airports-near-me.test
DEV_TEST_PASSWORD=<테스트 비밀번호>
```

### 순서

```powershell
npm run sync -- kac-full
npm run sync -- tago-horizon
npm run e2e:reset
npm run e2e:seed
npm run doctor
```

### 각 단계의 성공 기준

- `sync -- kac-full` → `성공 — 받음 ... 저장 ...`
- `sync -- tago-horizon` → `성공 — 받음 ... 저장 ...`
- `e2e:reset` → `검사 날짜: 2026-10-02 ...`
- `e2e:seed` → `접근 시간 고정값 28건 ...`
- `doctor` → `schedules-real`, `sync-recent`, `access-times` 통과

### 흔한 함정

- 첫 번째 `e2e:reset`이 운영 URL을 가리켜 표식 경고를 낼 수 있다. **다시 실행해서 우연히 통과했다고 안심하지 말고 `.env.local`을 확인**한다.
- `regions-coords 0/256`은 E2E 자체를 막지 않는다. 지금 시나리오는 **고정 접근 시간 시드**로 우회한다.

---

## 9. PR을 올리기 전 최종 확인 체크리스트

```powershell
git diff --name-status origin/main...HEAD
npm run lint
npm test
npm run build
```

### 무엇을 확인하나

1. **파일 목록**
   - 의도한 파일만 있는가
   - `prod.sql`, `test.sql`, 임시 패치, 실험 산출물이 없는가

2. **lint/test/build**
   - lint 통과
   - test 통과
   - build 통과

3. **브랜치 기준선**
   - 새 PR이라면 `origin/main`에서 시작했는가
   - 오래된 충돌 브랜치(`feat/e2e-ci`)를 계속 살리려 하지 않는가

---

## 10. 최종 정리 절차 (실전용 요약)

### A. 오래된 PR이 충돌나고 커밋 하나를 빼고 싶다

```powershell
git fetch origin --prune
git checkout -b feat/e2e-clean origin/main
git cherry-pick <넣을커밋들>
git diff --name-status origin/main...HEAD
npm run lint
npm test
npm run build
git push -u origin feat/e2e-clean
```

### B. PR 머지 후 로컬 main이 꼬였다

```powershell
git fetch origin --prune
git switch main
git log --oneline --left-right main...origin/main
git branch backup/main-before-reset
git reset --hard origin/main
git log --oneline -1
git status
```

### C. 머지된 브랜치 찌꺼기 정리

```powershell
git branch -d feat/e2e-clean
git branch -D feat/e2e-ci
git fetch origin --prune
```

---

## 11. 기억할 것

- **항상 첫 실패를 본다.** 나중에 나온 0건 경고를 원인으로 오해하지 않는다.
- **fetch 없이 reset하지 않는다.** stale한 `origin/main`으로 되돌릴 수 있다.
- **표식이 없다고 바로 만들지 않는다.** 먼저 운영 URL과 다른지 확인한다.
- **문제 커밋 하나를 빼려 하지 말고, 좋은 커밋만 다시 쌓는다.** 새 브랜치가 안전하다.
- **불필요한 파일은 제거 커밋으로 뺀다.** 히스토리를 다시 꼬지 않는다.
- **최종 기준은 `npm run build`.** lint/test가 통과해도 Next build 타입검사가 잡을 수 있다.
