# 테스트 전용 Supabase 프로젝트 준비 (E2E 인프라)

2026-09-27 작성. `docs/E2E.md`가 **검사가 어떻게 도는지**를 다룬다면, 이 문서는 **프로젝트를 만드는 절차**다.
E2E는 표식(`e2e_marker`)이 있는 프로젝트에서만 돌기 때문에, 이 절차를 끝내기 전에는 `e2e.yml`이 조용히 건너뛴다.

## 0. 사전 확인

```powershell
supabase --version          # 프로젝트 생성·link·db push에 필요
supabase projects list      # 지금 활성 프로젝트 확인
gh auth status              # Secrets 등록과 워크플로 실행에 필요
```

**무료 한도**: 활성 프로젝트 2개까지이고 **pause된 프로젝트는 한도에 들어가지 않는다**
([billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) · [pricing](https://supabase.com/pricing)).
단, 테스트 프로젝트는 E2E가 상시 쓰므로 **슬롯 1개를 계속 점유**한다 — 지금 활성 1개(운영)라면 이 결정으로 2/2가 된다.

## 1. 프로젝트 생성

```powershell
supabase orgs list                                   # ORGANIZATION ID 확인
$env:SUPABASE_DB_PASSWORD = '<새 DB 비밀번호>'        # 운영과 다른 값으로. 비밀번호 관리자에 보관
supabase projects create "공항 찾기 (test)" --org-id <ORG_ID> --region ap-northeast-2 --db-password $env:SUPABASE_DB_PASSWORD
supabase projects list                               # 새 ref 확인
```

- 리전 `ap-northeast-2` = 서울. E2E는 러너(미국)에서 도니 리전이 결과에 영향을 주진 않지만, 운영과 맞춰 둔다.
- `projects create`의 플래그는 CLI 버전에 따라 다를 수 있다 — 먼저 `supabase projects create --help`로 확인한다(이 문서는 실행 전 기준으로 작성했다).
- **`$env:SUPABASE_DB_PASSWORD`를 두 프로젝트 각각 준비**한다. `link`와 `db push`가 대화형으로 비밀번호를 물으면 자동화가 멈춘다.
  운영 비밀번호를 모르면 대시보드(Project Settings → Database)에서 재설정해야 한다 — 재설정은 운영 앱의 연결을 끊으므로 먼저 확인할 것.

## 2. 마이그레이션 적용 (link 규율)

**한 번에 한 프로젝트만 링크한다.** 매 단계에서 어느 프로젝트에 붙어 있는지 확인한다.

```powershell
# ① 테스트로 전환
supabase link --project-ref <TEST_REF> -p $env:SUPABASE_DB_PASSWORD
cat supabase/.temp/project-ref                        # <TEST_REF> 인지 확인 (다르면 즉시 중단)
supabase db push

# ② 운영으로 복귀
supabase link --project-ref zmyixzybnvgnejbqsnmt -p $env:SUPABASE_DB_PASSWORD
cat supabase/.temp/project-ref                        # zmyixzybnvgnejbqsnmt 인지 확인
```

`supabase/.temp/project-ref`와 `.branches`는 `supabase/.gitignore`에 있어 커밋되지 않는다(확인함).

**`db push`가 실패하면** — 그 자체가 발견이다. 실패한 마이그레이션 이름과 에러 원문을 `docs/CONTINGENCY.md`에 남긴다.
고칠 수 있으면 새 마이그레이션으로 앞으로 고친다(운영은 이미 적용돼 영향이 없다). 고칠 수 없으면
**운영 스키마를 덤프해 테스트로 복원**하는 우회로 간다(`supabase db dump` → `psql -f`).

## 3. 스키마 감사(3b)를 먼저, 표식은 그 다음

```powershell
cat supabase/.temp/project-ref                        # 운영인지 확인
supabase db dump --linked --schema public -f prod.sql
# 테스트로 링크한 뒤
supabase db dump --linked --schema public -f test.sql
diff -u prod.sql test.sql
```

`e2e_marker`를 **먼저 만들면** "테스트에만 있는 테이블"로 차이에 잡혀 진짜 차이를 가린다. 감사가 끝난 뒤에 만든다.
절차와 판정 규칙은 `docs/E2E.md`·3b 절차 참고 — 결과는 `docs/SCHEMA_AUDIT.md`에 남긴다(차이가 없어도 파일은 만든다).

## 4. 표식 만들기 (마이그레이션이 아니다)

대시보드 → SQL Editor에서 한 번 실행한다. **`supabase/migrations/`에 넣지 않는다** — 운영에 들어가면 안 되는 표식이다.

```sql
create table public.e2e_marker (id int primary key, note text);
insert into public.e2e_marker values (1, 'e2e-test-project');
alter table public.e2e_marker enable row level security;   -- 정책 없음 = 서비스 롤만 읽는다
```

## 5. Secrets 6개

```powershell
gh secret set E2E_SUPABASE_URL                 # https://<TEST_REF>.supabase.co
gh secret set E2E_SUPABASE_PUBLISHABLE_KEY     # 테스트 프로젝트의 publishable 키
gh secret set E2E_SUPABASE_SERVICE_ROLE_KEY    # 테스트 프로젝트의 secret 키
gh secret set E2E_PROJECT_REF                  # <TEST_REF>
gh secret set DEV_TEST_EMAIL
gh secret set DEV_TEST_PASSWORD
```

값은 프롬프트에서 입력한다(명령줄에 남기지 않는다). **운영 프로젝트의 키를 넣지 않도록** 대시보드에서 복사한 값을 다시 확인한다.
`DATA_GO_KR_KEY`는 이미 있는 Secrets를 `e2e-data.yml`이 그대로 쓴다 — 새로 만들지 않는다.

## 6. 테스트 데이터 채우기

```powershell
gh workflow run e2e-data.yml && gh run watch
```

표식이 없으면 여기서도 `중단: e2e_marker…`로 멈춘다(운영 프로젝트에 sync가 흘러드는 것을 막는 장치).

## 7. 운영 정리

```powershell
npm run delete-dev-account -- --yes
```

`e2e_marker`가 없는(=운영) 프로젝트에서 실행한다. 지운 뒤 확인:

```sql
select count(*) from auth.users where email = 'dev@airports-near-me.test';   -- 0
select count(*) from public.e2e_marker;                                      -- 테이블 없음(오류)이 정상
```

## 이 워크플로가 하는 일

### 실행 순서 (2026-09-27 교정)

1. `npm run e2e:check` — 표식만 확인 (운영 DB 보호. 자격증명·데이터 불필요)
2. `npm run sync -- kac-full` / `npm run sync -- tago-horizon`
3. `npm run e2e:reset` — 계정 초기화 + 검사 날짜 (2에서 스케줄이 채워져야 성공)
4. `npm run e2e:seed` — 접근 시간 고정값
5. `npm run doctor`

예전에는 3이 2보다 먼저였다. 빈 테스트 프로젝트에서는 3이 "실제 운항 스케줄이 없어요"로 멈춰
첫 실행이 성공할 수 없었고, 워크플로가 `DEV_TEST_EMAIL`을 넘기지 않아 `e2e:reset`이
`환경변수 DEV_TEST_EMAIL가 없어요`(exit 2)로 죽었다. 둘 다 위 순서와 env로 고쳤다.

`e2e:reset`(표식 확인) → `sync kac-full` → `sync tago-horizon` → `e2e:seed` → `doctor`.

`e2e:seed`가 **거주지→공항 접근 시간 고정값**(`source = E2E 고정값`)을 넣는다 — 없으면 추천이 계산되지 않아
대화 흐름이 `regionMissing`에서 멈춘다. 카카오 키를 CI에 두지 않기 위한 선택이다(근거는 `docs/E2E.md`).
지역 좌표(`geocode-regions`)는 이 검사에 필요 없다.


## 8. 끝난 뒤 확인 목록

- [ ] `cat supabase/.temp/project-ref` = 운영
- [ ] 운영에 `e2e_marker` 없음(테이블 자체가 없음)
- [ ] 운영 `dev@airports-near-me.test` 0건
- [ ] 테스트에서 `npm run doctor` 통과
- [ ] E2E PR에서 `e2e` 잡이 건너뛰지 않고 **실제로 실행**됨(게이트가 열림)
- [ ] 운영 활성 프로젝트 2개 / 무료 한도 안
